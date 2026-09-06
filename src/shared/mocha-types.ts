/**
 * The shape of the Mocha objects this package reads.
 *
 * Declared locally rather than imported from `mocha`, for the same reason
 * @qualflare/jest declares Jest's types locally: `mocha` is a PEER dependency, so
 * the published package must not carry a runtime or type import that ties it to
 * one version of it.
 *
 * Every field below is one Mocha actually serializes. In `--parallel` mode a Test
 * crosses the worker boundary through `Test.prototype.serialize()`, which is a
 * CLOSED allowlist:
 *
 *   $$currentRetry, $$fullTitle, $$isPending, $$retriedTest, $$slow, $$titlePath,
 *   body, duration, err, parent { $$fullTitle, id }, speed, state, title, type,
 *   file, id
 *
 * Anything outside that list is `undefined` in parallel mode even though it is
 * present in serial. Reading such a field would produce a reporter that works
 * locally and quietly loses data in CI, which is what mochajs/mocha#4453 was
 * about. Do not add a field here without checking it against that allowlist.
 */

/** Mocha's own id property name, used to key attempts and match parents. */
export const MOCHA_ID_PROP = '__mocha_id__';

export interface MochaError {
  message?: string;
  stack?: string;
  /** Present on assertion errors; Mocha forwards them through serialization. */
  actual?: unknown;
  expected?: unknown;
}

export interface MochaSuite {
  title?: string;
  /** Serialized as `$$fullTitle`; a live object exposes `fullTitle()` instead. */
  $$fullTitle?: string;
  fullTitle?: () => string;
  [MOCHA_ID_PROP]?: string;
}

export interface MochaTest {
  title?: string;
  /** Serialized form of `fullTitle()`. Present in both modes. */
  $$fullTitle?: string;
  fullTitle?: () => string;
  /** Serialized form of `titlePath()` -- the describe chain plus the test title. */
  $$titlePath?: string[];
  titlePath?: () => string[];
  /** 0-based index of THIS execution. 0 on a first run, N on the Nth retry. */
  $$currentRetry?: number;
  currentRetry?: () => number;
  $$isPending?: boolean;
  pending?: boolean;
  state?: 'passed' | 'failed' | 'pending';
  duration?: number;
  err?: MochaError;
  file?: string;
  parent?: MochaSuite;
  type?: string;
  [MOCHA_ID_PROP]?: string;
}

/** Reads a test's full title in either mode. */
export function fullTitleOf(test: MochaTest): string {
  if (typeof test.$$fullTitle === 'string') return test.$$fullTitle;
  if (typeof test.fullTitle === 'function') return test.fullTitle();
  return test.title ?? '';
}

/** Reads a test's retry index in either mode. */
export function currentRetryOf(test: MochaTest): number {
  if (typeof test.$$currentRetry === 'number') return test.$$currentRetry;
  if (typeof test.currentRetry === 'function') return test.currentRetry();
  return 0;
}

/**
 * A stable identity for one test across its attempts.
 *
 * Mocha's own `__mocha_id__` is preferred: it is allowlisted, so it survives
 * parallel mode, and it is stable across the retries of a single test. The
 * file+fullTitle fallback covers a Mocha old enough not to set it.
 */
export function testKeyOf(test: MochaTest): string {
  const id = test[MOCHA_ID_PROP];
  if (typeof id === 'string' && id.length > 0) return id;
  return `${test.file ?? ''}#${fullTitleOf(test)}`;
}
