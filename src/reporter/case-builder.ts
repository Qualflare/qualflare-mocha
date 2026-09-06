import type { ResolvedReporterConfig } from '../config/resolve-config.js';
import {
  MAX_ATTACHMENTS_PER_CASE,
  MAX_LABELS_PER_CASE,
  MAX_LINKS_PER_CASE,
  MAX_PARAMETERS_PER_STEP,
  MAX_STEPS_PER_TEST_ATTEMPT,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CASE,
  MAX_ATTEMPT_MESSAGE_RUNES,
  MAX_ATTEMPT_TRACE_RUNES,
} from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import { propertyValue } from '../shared/parameters.js';
import { truncateRunes } from '../shared/text.js';
import type {
  Attachment,
  Case,
  CaseStatus,
  Label,
  Link,
  Parameter,
  Step,
} from '../shared/types.js';
import type { RuntimeMessage } from '../runtime/message-types.js';
import { msToNs } from '../shared/duration.js';
import { AttachmentBudget, inlineFromBuffer, inlineFromFile } from './attachment-reader.js';
import { copyImageAttachment, isOffloadableImage, writeImageAttachment } from './image-writer.js';
import { buildAttempts, describeError, type RecordedRetry } from './attempts.js';
import { fullTitleOf, type MochaTest } from '../shared/mocha-types.js';

/**
 * Maps Mocha's state onto the wire contract's vocabulary.
 *
 * `qualflare-cli` accepts exactly 7 values and turns anything it does not
 * recognize into `error` -- NOT into a pass -- so each is mapped explicitly
 * rather than passed through and hoped for.
 *
 * Mocha's vocabulary is narrow: a Test ends up `passed`, `failed` or `pending`,
 * and `pending` is what it calls a skipped test (`it.skip`, or `it` with no
 * body). It has no timed-out state -- a timeout surfaces as a failure whose
 * message begins "Timeout of ...ms exceeded" -- so this reporter never produces
 * `timeout` or `aborted`.
 */
export function mapStatus(test: MochaTest): CaseStatus {
  if (test.$$isPending === true || test.pending === true) {
    return 'skipped';
  }
  switch (test.state) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'pending':
      return 'skipped';
    default:
      // A test with no state reached neither a pass nor a fail -- typically a
      // hook failure aborted the suite around it. `error` says "did not run to a
      // verdict", which is honest; `failed` would blame the test itself.
      return 'error';
  }
}

interface ReplayedMetadata {
  labels: Label[];
  links: Link[];
  tags: string[];
  description?: string;
  priority?: Case['priority'];
  caseParameters: Parameter[];
  attachments: Attachment[];
  steps: Step[];
}

/**
 * Replays the messages a test emitted into structured metadata.
 *
 * The channel is append-only and flat, so `step_start`/`step_stop` arrive as a
 * pair stream. Walking it with a stack recovers nesting exactly: the index of
 * the enclosing step becomes `parentIndex`, and parameters declared inside a
 * step attach to that step rather than to the case.
 */
export function replayMetadata(
  messages: readonly RuntimeMessage[],
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): ReplayedMetadata {
  const meta: ReplayedMetadata = {
    labels: [],
    links: [],
    tags: [],
    caseParameters: [],
    attachments: [],
    steps: [],
  };
  const openSteps: number[] = [];
  // step_start timestamps, parallel to openSteps, so step_stop can compute a
  // real duration rather than reporting every step as instantaneous.
  const openStartedAt: number[] = [];
  let warnedStepCap = false;

  for (const message of messages) {
    switch (message.type) {
      case 'label':
        meta.labels.push({ name: message.name, value: message.value });
        break;
      case 'link':
        meta.links.push({
          url: message.url,
          // `type` is required on the wire and validated server-side against
          // issue/tms/custom. 'custom' is the neutral default when the author
          // did not say.
          type: message.linkType ?? 'custom',
          ...(message.name ? { name: message.name } : {}),
        });
        break;
      case 'tag':
        meta.tags.push(...message.tags);
        break;
      case 'description':
        meta.description = message.text;
        break;
      case 'priority':
        meta.priority = message.value;
        break;
      case 'parameter': {
        const param: Parameter = {
          name: message.name,
          ...(message.value !== undefined ? { value: message.value } : {}),
          ...(message.masked ? { masked: true } : {}),
        };
        const openStep = openSteps[openSteps.length - 1];
        if (openStep === undefined) {
          meta.caseParameters.push(param);
        } else {
          const step = meta.steps[openStep];
          // Capped, and pushed rather than re-spread: the previous form
          // allocated a fresh array per parameter, which is O(n^2) on a step
          // that records many.
          if (step) {
            if (!step.parameters) {
              step.parameters = [];
            }
            if (step.parameters.length < MAX_PARAMETERS_PER_STEP) {
              step.parameters.push(param);
            }
          }
        }
        break;
      }
      case 'attachment': {
        const bytes = Buffer.from(message.contentBase64, 'base64');
        const attachment = imageFromBuffer(message.name, bytes, message.mimeType, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const inlined = inlineFromBuffer(message.name, bytes, message.mimeType, config, budget);
        if (inlined) {
          meta.attachments.push(inlined);
        }
        break;
      }
      case 'attachment_from_file': {
        const attachment = imageFromFile(message.name, message.path, config);
        if (attachment) {
          meta.attachments.push(attachment);
          break;
        }
        const fromFile = inlineFromFile(message.name, message.path, message.mimeType, config, budget);
        if (fromFile) {
          meta.attachments.push(fromFile);
        }
        break;
      }
      case 'step_start': {
        if (meta.steps.length >= MAX_STEPS_PER_TEST_ATTEMPT) {
          if (!warnedStepCap) {
            warnedStepCap = true;
            logger.warn(
              `a test recorded more than ${MAX_STEPS_PER_TEST_ATTEMPT} steps; the rest were dropped.`,
            );
          }
          break;
        }
        const parentIndex = openSteps[openSteps.length - 1];
        const step: Step = {
          name: message.name,
          status: 'passed',
          duration: 0,
          ...(parentIndex !== undefined ? { parentIndex } : {}),
        };
        openSteps.push(meta.steps.length);
        openStartedAt.push(message.timestamp);
        meta.steps.push(step);
        break;
      }
      case 'step_stop': {
        const index = openSteps.pop();
        const startedAt = openStartedAt.pop();
        if (index === undefined) {
          break;
        }
        const step = meta.steps[index];
        if (step) {
          step.status = message.status;
          if (startedAt !== undefined) {
            step.duration = msToNs(Math.max(0, message.timestamp - startedAt));
          }
          if (message.error) {
            step.error = message.error;
          }
        }
        break;
      }
    }
  }
  return meta;
}

/** Routes an on-disk image onto `localImagePath`, or undefined so the caller
 * falls through to inlining. Undefined is the ordinary outcome for a log or a
 * JSON blob, and also for an image the writer could not place — so a bad
 * outputDir costs the offload rather than the user's attachment. */
function imageFromFile(
  name: string,
  filePath: string,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  const copied = copyImageAttachment(filePath, config.outputDir, config.maxAttachmentBytes);
  if (!copied) {
    return undefined;
  }
  return {
    name,
    mimeType: copied.mimeType,
    localImagePath: copied.localImagePath,
    fileSize: copied.fileSize,
  };
}

/** The in-memory counterpart — the shape `qualflare.attachment()` produces. */
function imageFromBuffer(
  name: string,
  bytes: Buffer,
  mimeType: string | undefined,
  config: ResolvedReporterConfig,
): Attachment | undefined {
  if (!isOffloadableImage(mimeType)) {
    return undefined;
  }
  const written = writeImageAttachment(bytes, mimeType, config.outputDir, config.maxAttachmentBytes);
  if (!written) {
    return undefined;
  }
  return {
    name,
    mimeType: written.mimeType,
    localImagePath: written.localImagePath,
    fileSize: written.fileSize,
  };
}

function capTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.slice(0, MAX_TAG_LENGTH);
    if (trimmed === '' || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS_PER_CASE) {
      break;
    }
  }
  return out;
}

/**
 * Turns one finished Mocha test plus its recorded metadata into a wire Case.
 *
 * `id` is the file-relative full name, which is what makes flaky history match
 * across runs: it stays the same for what a human would call "the same test"
 * even as the file moves between machines.
 */
/**
 * Builds one wire `Case` from a finished Mocha test.
 *
 * `retries` are the failed attempts recorded from `EVENT_TEST_RETRY` while this
 * test was running, in order. The reporter owns that accumulation because only it
 * sees the event stream; see `attempts.ts` for why that stream is the only
 * source of retry history.
 */
export function buildCase(
  test: MochaTest,
  /** RELATIVE to the config's rootDir. An absolute path would leak the CI agent's
   * directory layout into the report and make the same test look like a
   * different one on another machine. */
  testFilePath: string,
  retries: readonly RecordedRetry[],
  messages: readonly RuntimeMessage[],
  config: ResolvedReporterConfig,
  budget: AttachmentBudget,
): Case | undefined {
  const status = mapStatus(test);
  const meta = replayMetadata(messages, config, budget);
  const name = fullTitleOf(test);

  const properties: Record<string, string> = { file: testFilePath };
  for (const param of meta.caseParameters) {
    properties[param.name] = propertyValue(param.value, param.masked);
  }

  const attempts = buildAttempts([...retries], test, status);

  // `retryCount` counts RETRIES, not executions, so it is one less than the
  // number of attempts. isFlaky follows the narrow definition the siblings use:
  // flaky only when the final status is a pass. "Failed after retries" is not
  // flaky, it is just failed.
  const retryCount = attempts ? attempts.length - 1 : 0;

  const failure = status === 'failed' ? describeError(test.err) : undefined;

  const built: Case = {
    // The file is part of the id on purpose: two files may each contain a test
    // with the same title, and a bare name would merge their histories.
    id: `${testFilePath}#${name}`,
    name,
    status,
    duration: msToNs(typeof test.duration === 'number' ? test.duration : 0),
    properties,
    ...(failure?.message ? { error: truncateRunes(failure.message, MAX_ATTEMPT_MESSAGE_RUNES) } : {}),
    ...(failure?.trace ? { trace: truncateRunes(failure.trace, MAX_ATTEMPT_TRACE_RUNES) } : {}),
    ...(meta.labels.length > 0 ? { labels: meta.labels.slice(0, MAX_LABELS_PER_CASE) } : {}),
    ...(meta.links.length > 0 ? { links: meta.links.slice(0, MAX_LINKS_PER_CASE) } : {}),
    ...(meta.tags.length > 0 ? { tags: capTags(meta.tags) } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.priority ? { priority: meta.priority } : {}),
    ...(meta.steps.length > 0 ? { steps: meta.steps.slice(0, MAX_STEPS_PER_TEST_ATTEMPT) } : {}),
    ...(meta.attachments.length > 0
      ? { attachments: meta.attachments.slice(0, MAX_ATTACHMENTS_PER_CASE) }
      : {}),
    ...(attempts ? { attempts, retryCount, isFlaky: status === 'passed' } : {}),
  };

  if (config.shardIndex !== undefined) {
    built.shardIndex = config.shardIndex;
  }

  return built;
}
