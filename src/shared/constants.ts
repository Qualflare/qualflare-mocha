/**
 * Shared constants used across the reporter and the author-facing runtime
 * API.
 */

/** Directory prefix for the metadata side-channel, under `os.tmpdir()`.
 *
 * Mocha offers no user-writable per-test meta channel: nothing a test body can
 * write survives to the reporter. In `--parallel` the reporter runs in the main
 * process while tests run in workers, and a Test crosses that boundary through
 * `Test.prototype.serialize()` -- a CLOSED allowlist, so a property set on the
 * test object is simply absent on the other side. Measured, not assumed.
 *
 * So the in-test runtime appends NDJSON into a directory here and the reporter
 * drains it at `EVENT_RUN_END`. The reporter creates that directory with
 * `mkdtemp` and publishes the path in `QUALFLARE_MOCHA_CHANNEL` before the run
 * starts, which is why workers can find it: a worker inherits the environment at
 * fork time. Two concurrent Mocha runs get two directories and cannot collide.
 *
 * The SAME path is used in serial mode. There is no in-memory shortcut, because
 * one code path is what makes the serial/parallel parity test meaningful -- if
 * the modes diverged internally, that test would prove nothing about the mode
 * users actually run. */
export const CHANNEL_DIR_PREFIX = 'qualflare-mocha-';

/** Server-side caps this client should respect defensively (see
 * `api-service/internal/core/domain/launch/launch.go`). */
export const MAX_SUITES_PER_LAUNCH = 2000;
export const MAX_CASES_PER_SUITE = 5000;
export const MAX_STEPS_PER_CASE = 1000;
export const MAX_PARAMETERS_PER_STEP = 50;
export const MAX_ATTACHMENTS_PER_CASE = 50;
export const MAX_LABELS_PER_CASE = 100;
export const MAX_LINKS_PER_CASE = 20;
export const MAX_TAGS_PER_CASE = 64;
export const MAX_TAG_LENGTH = 255;

/** Client-side SOFT cap on steps recorded per test attempt — well under
 * the server's 1000-per-case hard cap (`MAX_STEPS_PER_CASE`). Once hit,
 * further steps within that attempt are dropped (with a one-time warning),
 * not queued and truncated later. */
export const MAX_STEPS_PER_TEST_ATTEMPT = 300;

/**
 * Server-side bounds on `Case.attempts`, mirrored client-side so the bytes are
 * never sent rather than truncated on arrival. Values match the sibling
 * reporters and `case_run_attempts`.
 */
export const MAX_ATTEMPTS_PER_CASE = 50;
export const MAX_ATTEMPT_MESSAGE_RUNES = 8192;
export const MAX_ATTEMPT_TRACE_RUNES = 32768;

/** Bounds on the per-attempt text fields.
 *
 * Mocha exposes no captured stdout/stderr to a reporter -- it has no equivalent
 * of Jest's `TestResult.console` -- so this reporter never populates a case's
 * output and the OUTPUT caps below are unused today. They are kept because they
 * mirror the server's own limits, so if Mocha ever surfaces captured output the
 * clamp is already the right number rather than a fresh guess. */
export const MAX_ATTEMPT_SNIPPET_RUNES = 4096;
export const MAX_ATTEMPT_OUTPUT_RUNES = 16384;
export const MAX_ATTEMPT_OUTPUT_LINES = 200;
