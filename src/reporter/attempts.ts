/**
 * Per-attempt retry history, built from Mocha's `EVENT_TEST_RETRY` stream.
 *
 * HOW THIS WORKS, AND WHY IT IS THE ONLY PATH
 *
 * Mocha emits `EVENT_TEST_RETRY (test, err)` every time a test fails and is about
 * to be retried, then a terminal `EVENT_TEST_PASS` or `EVENT_TEST_FAIL`. So a test
 * that failed twice before passing produces:
 *
 *   RETRY(err "boom 1") -> RETRY(err "boom 2") -> PASS
 *
 * which is exactly three attempts, the first two failed with their own messages.
 * Unlike Jest -- which only supplies per-attempt errors under
 * `jest.retryTimes(n, { logErrorsBeforeRetry: true })` -- Mocha gives the error
 * of every attempt with no opt-in.
 *
 * The retry events were MEASURED to fire in `--parallel` mode as well as serial,
 * carrying their errors intact, so serial and parallel share this one code path.
 *
 * `$$retriedTest` is deliberately NOT used. It is in Mocha's serialization
 * allowlist and looks like a linked list of attempts, but it was measured at
 * depth 1 in serial and 0 in parallel -- it points at the immediately-previous
 * attempt only, never the full history. Building on it would silently lose every
 * intermediate failure.
 */
import {
  MAX_ATTEMPTS_PER_CASE,
  MAX_ATTEMPT_MESSAGE_RUNES,
  MAX_ATTEMPT_TRACE_RUNES,
} from '../shared/constants.js';
import { truncateRunes } from '../shared/text.js';
import { currentRetryOf, type MochaError, type MochaTest } from '../shared/mocha-types.js';
import type { Attempt, CaseStatus } from '../shared/types.js';

/** One recorded failed attempt, captured when the retry event fired. */
export interface RecordedRetry {
  message?: string;
  trace?: string;
  duration?: number;
}

/** Pulls the reportable text off a Mocha error, tolerating a bare string. */
export function describeError(err: MochaError | string | undefined): RecordedRetry {
  if (!err) {
    return {};
  }
  if (typeof err === 'string') {
    return { message: truncateRunes(err, MAX_ATTEMPT_MESSAGE_RUNES) };
  }
  return {
    ...(err.message ? { message: truncateRunes(err.message, MAX_ATTEMPT_MESSAGE_RUNES) } : {}),
    ...(err.stack ? { trace: truncateRunes(err.stack, MAX_ATTEMPT_TRACE_RUNES) } : {}),
  };
}

/**
 * Builds the wire `attempts[]` for one case.
 *
 * `retries` are the failed attempts in arrival order; `final` is the terminal
 * execution. Returns undefined below two attempts: the server persists nothing
 * for a lone attempt, since it carries no status or duration the case run does
 * not already hold, so sending one is bytes against the body limit for a row
 * that is discarded.
 */
export function buildAttempts(
  retries: RecordedRetry[],
  final: MochaTest,
  finalStatus: CaseStatus,
): Attempt[] | undefined {
  // Cross-check the observed retry count against Mocha's own counter. They agree
  // in every measured case; when they do not, the larger wins, because a missed
  // event loses history whereas an extra placeholder only adds an empty row.
  const observed = retries.length;
  const claimed = currentRetryOf(final);
  const failedCount = Math.max(observed, Number.isFinite(claimed) ? claimed : 0);
  if (failedCount < 1) {
    return undefined;
  }

  const out: Attempt[] = [];
  for (let i = 0; i < failedCount; i += 1) {
    const recorded = retries[i];
    out.push({
      attempt: i + 1,
      status: 'failed',
      ...(recorded?.message ? { message: recorded.message } : {}),
      ...(recorded?.trace ? { trace: recorded.trace } : {}),
    });
  }

  // The terminal execution. Its error is only meaningful when it failed; a passing
  // final attempt contributed none.
  const terminal: Attempt = { attempt: failedCount + 1, status: finalStatus };
  if (finalStatus === 'failed') {
    const described = describeError(final.err);
    if (described.message) terminal.message = described.message;
    if (described.trace) terminal.trace = described.trace;
  }
  // Mocha reports one duration for the case, not per attempt. Filling the others
  // from it would claim each attempt took the whole time, so only the terminal
  // one carries a duration -- and only when Mocha actually measured it.
  if (typeof final.duration === 'number' && final.duration > 0) {
    terminal.duration = final.duration * 1_000_000;
  }
  out.push(terminal);

  if (out.length < 2) {
    return undefined;
  }
  return clampAttempts(out);
}

/**
 * Bounds the list to what one case run persists, keeping the FINAL attempt.
 *
 * A plain `slice(0, MAX)` would discard the attempt that carries the outcome --
 * the only element explaining why the case passed or failed.
 */
export function clampAttempts(attempts: Attempt[]): Attempt[] {
  if (attempts.length <= MAX_ATTEMPTS_PER_CASE) {
    return attempts;
  }
  return [...attempts.slice(0, MAX_ATTEMPTS_PER_CASE - 1), attempts[attempts.length - 1]!];
}
