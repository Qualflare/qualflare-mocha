import { describe, expect, it } from 'vitest';

import { buildAttempts, clampAttempts, describeError } from '../../src/reporter/attempts.js';
import type { MochaTest } from '../../src/shared/mocha-types.js';

/**
 * Per-attempt retry history.
 *
 * The numbers here were measured against real mocha@8/10/12 runs, not taken from
 * the docs. Two measurements shape the whole design:
 *
 *   - EVENT_TEST_RETRY fires in --parallel as well as serial, carrying each
 *     attempt's error. So there is ONE path, not one per mode.
 *   - `$$retriedTest` is depth 1 in serial and 0 in parallel, so it never held
 *     the full history and is not used.
 */

const test = (over: Partial<MochaTest> = {}): MochaTest => ({
  title: 'flaky',
  $$fullTitle: 'suite flaky',
  state: 'passed',
  ...over,
});

describe('buildAttempts', () => {
  it('records nothing for a test that ran once', () => {
    // Fewer than two attempts persists nothing server-side, so sending one is
    // bytes against the body limit for a row the server discards.
    expect(buildAttempts([], test({ $$currentRetry: 0 }), 'passed')).toBeUndefined();
  });

  it('reconstructs a flaky run: earlier attempts failed, the final one passed', () => {
    const attempts = buildAttempts(
      [{ message: 'boom 1' }, { message: 'boom 2' }],
      test({ $$currentRetry: 2 }),
      'passed',
    )!;
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'passed']);
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    expect(attempts[0]!.message).toBe('boom 1');
    expect(attempts[1]!.message).toBe('boom 2');
    // The final attempt passed, so it contributed no error.
    expect(attempts[2]!.message).toBeUndefined();
  });

  it('reconstructs a run where every attempt failed', () => {
    const attempts = buildAttempts(
      [{ message: 'boom 1' }, { message: 'boom 2' }],
      test({ state: 'failed', $$currentRetry: 2, err: { message: 'boom 3' } }),
      'failed',
    )!;
    expect(attempts.map((a) => a.status)).toEqual(['failed', 'failed', 'failed']);
    expect(attempts.map((a) => a.message)).toEqual(['boom 1', 'boom 2', 'boom 3']);
  });

  it('trusts the larger of the observed and claimed retry counts', () => {
    // A dropped retry event loses history; an extra placeholder only adds an
    // empty row. When the two disagree, prefer not losing history.
    const attempts = buildAttempts([{ message: 'only one seen' }], test({ $$currentRetry: 3 }), 'passed')!;
    expect(attempts).toHaveLength(4);
    expect(attempts[0]!.message).toBe('only one seen');
    expect(attempts[1]!.message).toBeUndefined();
    expect(attempts[3]!.status).toBe('passed');
  });

  it('keeps the final attempt when trimming past the server cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ message: `e-${i}` }));
    const attempts = buildAttempts(many, test({ $$currentRetry: 60 }), 'passed')!;
    expect(attempts).toHaveLength(50);
    // A plain slice(0, 50) would discard the attempt carrying the outcome.
    expect(attempts[49]!.status).toBe('passed');
    expect(attempts[49]!.attempt).toBe(61);
  });

  it('converts the terminal duration from milliseconds to nanoseconds', () => {
    const attempts = buildAttempts([{ message: 'e' }], test({ $$currentRetry: 1, duration: 1200 }), 'passed')!;
    expect(attempts[1]!.duration).toBe(1_200_000_000);
    // Mocha reports one duration for the case, not per attempt. Filling the
    // earlier ones from it would claim each took the whole time.
    expect(attempts[0]!.duration).toBeUndefined();
  });

  it('truncates an oversized attempt message to the cap the server stores', () => {
    const attempts = buildAttempts(
      [describeError({ message: 'x'.repeat(20_000) })],
      test({ $$currentRetry: 1 }),
      'passed',
    )!;
    expect(attempts[0]!.message).toHaveLength(8192);
  });
});

describe('describeError', () => {
  it('tolerates a bare string, which Mocha can emit', () => {
    expect(describeError('plain failure').message).toBe('plain failure');
  });

  it('returns nothing for a missing error rather than inventing one', () => {
    expect(describeError(undefined)).toEqual({});
  });
});

describe('clampAttempts', () => {
  it('leaves a list within the cap untouched', () => {
    const list = [
      { attempt: 1, status: 'failed' as const },
      { attempt: 2, status: 'passed' as const },
    ];
    expect(clampAttempts(list)).toBe(list);
  });
});
