/**
 * The Mocha reporter.
 *
 * Mocha instantiates this as `new Reporter(runner, options)` and the runner is an
 * EventEmitter, so everything below is event subscription. The report is written
 * once, on `EVENT_RUN_END`.
 *
 * PARALLEL MODE IS THE CONSTRAINT THAT SHAPES THIS FILE. Under `mocha --parallel`
 * the reporter runs in the main process while tests run in workers, and a Test
 * crosses that boundary through `Test.prototype.serialize()` -- a closed
 * allowlist. Only fields named in `shared/mocha-types.ts` may be read here.
 * Reading anything else yields a reporter that works locally and quietly loses
 * data in CI, which is what mochajs/mocha#4453 was about.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveConfig, type QualflareMochaOptions, type ResolvedReporterConfig } from '../config/resolve-config.js';
import { normalizeReporterOptions } from '../config/reporter-options.js';
import { CHANNEL_DIR_PREFIX } from '../shared/constants.js';
import { logger } from '../shared/logger.js';
import { fullTitleOf, testKeyOf, type MochaError, type MochaTest } from '../shared/mocha-types.js';
import { CHANNEL_ENV_VAR, collapseByCase, drain, segmentKey } from '../runtime/channel.js';
import { AttachmentBudget } from './attachment-reader.js';
import { buildCase } from './case-builder.js';
import { describeError, type RecordedRetry } from './attempts.js';
import { buildCollectPayload } from './collect-builder.js';
import { groupIntoSuites, relativizeFile, type CaseWithFile } from './suite-builder.js';

/** Options as Mocha hands them over. See the constructor for why both spellings. */
interface MochaReporterOptions {
  /** Object on Mocha 12, `key=value` array on 8/10 — see normalizeReporterOptions. */
  reporterOption?: QualflareMochaOptions | string[];
  reporterOptions?: QualflareMochaOptions | string[];
}

/** The subset of Mocha's Runner this reporter uses. */
interface MochaRunner {
  on(event: string, listener: (...args: unknown[]) => void): MochaRunner;
  once(event: string, listener: (...args: unknown[]) => void): MochaRunner;
}

/** Mocha's runner event names. Hard-coded rather than imported from `mocha`,
 * which is a peer dependency; these strings have been stable since Mocha 6. */
const EVENT_TEST_RETRY = 'retry';
const EVENT_TEST_PASS = 'pass';
const EVENT_TEST_FAIL = 'fail';
const EVENT_TEST_PENDING = 'pending';
const EVENT_RUN_END = 'end';

export class QualflareMochaReporter {
  private readonly config: ResolvedReporterConfig;
  private readonly budget: AttachmentBudget;
  private readonly channelDir: string | undefined;
  /**
   * The base that test file paths are made relative to.
   *
   * Mocha resolves spec globs against the current working directory and has no
   * `rootDir` of its own, so CWD is the only base it actually defines -- the same
   * choice the cucumber-js sibling makes. Paths must be relativized or the same
   * test looks like a different one on another machine, and the report leaks the
   * CI agent's directory layout.
   */
  private readonly rootDir = process.cwd();
  /** Failed attempts per test, accumulated from EVENT_TEST_RETRY. */
  private readonly retries = new Map<string, RecordedRetry[]>();
  private readonly cases: CaseWithFile[] = [];

  constructor(runner: MochaRunner, options?: MochaReporterOptions) {
    // BOTH spellings, deliberately. Mocha renamed `reporterOptions` (plural) to
    // `reporterOption` (singular) and its own bundled reporters still read both --
    // `xunit` checks `reporterOption.output`, `tap` checks
    // `reporterOptions.tapVersion`. Reading only one silently ignores the user's
    // configuration on half the versions in the declared peer range.
    const provided = normalizeReporterOptions(options?.reporterOption ?? options?.reporterOptions);
    this.config = resolveConfig(provided as QualflareMochaOptions);
    this.budget = new AttachmentBudget(this.config.maxTotalAttachmentBytes);

    // The channel directory must exist and be exported BEFORE any worker spawns,
    // because a worker inherits this process's env at fork time. The reporter is
    // constructed before the run starts, which is the only point where that
    // ordering is guaranteed.
    this.channelDir = this.config.enabled ? this.openChannel() : undefined;

    runner.on(EVENT_TEST_RETRY, (...args: unknown[]) => {
      const test = args[0] as MochaTest | undefined;
      const err = args[1] as MochaError | undefined;
      if (!test) return;
      const key = testKeyOf(test);
      const list = this.retries.get(key) ?? [];
      list.push(describeError(err));
      this.retries.set(key, list);
    });

    // The error arrives as the SECOND argument, not on `test.err`. Measured:
    // `test.err` was unset on every retry event and on the serial `fail` event,
    // and present only on the parallel `fail` -- reading it alone loses the
    // message for most failures.
    const finish = (...args: unknown[]): void => {
      const test = args[0] as MochaTest | undefined;
      const err = args[1] as MochaError | undefined;
      if (test) this.recordCase(test, err ?? test.err);
    };
    runner.on(EVENT_TEST_PASS, finish);
    runner.on(EVENT_TEST_FAIL, finish);
    runner.on(EVENT_TEST_PENDING, finish);

    runner.once(EVENT_RUN_END, () => {
      this.writeReport();
    });
  }

  /** Creates the per-process channel directory and publishes it to workers. */
  private openChannel(): string | undefined {
    try {
      // pid + uuid so a stale directory can be attributed to a dead process, and
      // so two concurrent mocha runs never share one.
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), `${CHANNEL_DIR_PREFIX}${process.pid}-${randomUUID()}-`),
      );
      process.env[CHANNEL_ENV_VAR] = dir;
      return dir;
    } catch (err) {
      logger.warn(`could not create the metadata channel directory: ${(err as Error).message}`);
      return undefined;
    }
  }

  private recordCase(test: MochaTest, err?: MochaError): void {
    const key = testKeyOf(test);
    const retries = this.retries.get(key) ?? [];
    this.retries.delete(key);
    if (err) {
      // Carried on the object the case-builder reads, so the terminal failure's
      // message survives regardless of which mode set (or did not set) test.err.
      test.err = err;
    }
    // Held until EVENT_RUN_END: the channel is drained once, at the end, so
    // metadata is matched to cases after every worker has flushed its writes.
    this.pending.push({ test, retries });
  }

  private readonly pending: { test: MochaTest; retries: RecordedRetry[] }[] = [];

  private writeReport(): void {
    if (!this.config.enabled) {
      this.cleanupChannel();
      return;
    }

    const byCase = this.channelDir
      ? collapseByCase(drain(this.channelDir))
      : new Map<string, ReturnType<typeof collapseByCase> extends Map<string, infer V> ? V : never>();

    for (const { test, retries } of this.pending) {
      const rawFile = test.file ?? '';
      const file = relativizeFile(rawFile, this.rootDir);
      // fullTitleOf(), NOT `$$fullTitle` directly: that field is only populated by
      // serialization, so in SERIAL mode it is undefined and every lookup misses.
      // The channel keys its segments with the same helper -- the two must agree
      // or metadata silently never reaches a case.
      const messages = byCase.get(segmentKey(rawFile, fullTitleOf(test))) ?? [];
      const built = buildCase(test, file, retries, messages, this.config, this.budget);
      if (built) {
        this.cases.push({ file, testCase: built });
      }
    }

    const suites = groupIntoSuites(this.cases);
    if (suites.length === 0) {
      logger.info('no test results were captured this run — skipping file write.');
      this.cleanupChannel();
      return;
    }

    const collect = buildCollectPayload(suites, this.config);
    try {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
      const target = path.join(
        this.config.outputDir,
        `qualflare-mocha-${process.pid}-${randomUUID()}.json`,
      );
      fs.writeFileSync(target, JSON.stringify(collect), 'utf8');
      logger.info(`wrote ${this.cases.length} case(s) to ${target}`);
    } catch (err) {
      logger.error(`could not write the report: ${(err as Error).message}`);
    }
    this.cleanupChannel();
  }

  private cleanupChannel(): void {
    if (this.channelDir) {
      try {
        fs.rmSync(this.channelDir, { recursive: true, force: true });
      } catch {
        // A leftover temp directory is not worth failing a run over.
      }
    }
    delete process.env[CHANNEL_ENV_VAR];
  }
}

export default QualflareMochaReporter;
