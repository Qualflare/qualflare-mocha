import { describe, expect, it } from 'vitest';

import { buildCase, mapStatus } from '../../src/reporter/case-builder.js';
import { AttachmentBudget } from '../../src/reporter/attachment-reader.js';
import { resolveConfig } from '../../src/config/resolve-config.js';
import type { MochaTest } from '../../src/shared/mocha-types.js';
import type { RuntimeMessage } from '../../src/runtime/message-types.js';

const config = () => resolveConfig({ outputDir: '/tmp/qualflare-mocha-unit' });
const budget = () => new AttachmentBudget(10_000_000);

const test = (over: Partial<MochaTest> = {}): MochaTest => ({
  title: 'works',
  $$fullTitle: 'suite works',
  state: 'passed',
  duration: 5,
  file: '/repo/test/a.spec.cjs',
  ...over,
});

const build = (t: MochaTest, messages: RuntimeMessage[] = []) =>
  buildCase(t, 'test/a.spec.cjs', [], messages, config(), budget())!;

describe('mapStatus', () => {
  it('maps Mocha’s three states onto the wire vocabulary', () => {
    expect(mapStatus(test({ state: 'passed' }))).toBe('passed');
    expect(mapStatus(test({ state: 'failed' }))).toBe('failed');
    // Mocha calls a skipped test "pending".
    expect(mapStatus(test({ state: 'pending' }))).toBe('skipped');
  });

  it('treats both pending markers as skipped', () => {
    // Serialization sets `$$isPending`; a live object has `pending`.
    expect(mapStatus(test({ state: undefined, $$isPending: true }))).toBe('skipped');
    expect(mapStatus(test({ state: undefined, pending: true }))).toBe('skipped');
  });

  it('reports a stateless test as error, not failed', () => {
    // A test with no state reached neither verdict — typically a hook failure
    // aborted the suite around it. `failed` would blame the test itself, and the
    // CLI turns anything unrecognized into `error` anyway.
    expect(mapStatus(test({ state: undefined }))).toBe('error');
  });
});

describe('buildCase', () => {
  it('includes the file in the id, so same-named tests never merge', () => {
    const a = buildCase(test(), 'test/a.spec.cjs', [], [], config(), budget())!;
    const b = buildCase(test(), 'test/b.spec.cjs', [], [], config(), budget())!;
    expect(a.id).not.toBe(b.id);
    expect(a.id).toContain('test/a.spec.cjs');
  });

  it('converts Mocha’s millisecond duration to nanoseconds', () => {
    expect(build(test({ duration: 1200 })).duration).toBe(1_200_000_000);
  });

  it('records the file as a property', () => {
    expect(build(test()).properties?.file).toBe('test/a.spec.cjs');
  });

  it('carries the failure message only when the case failed', () => {
    const failed = build(test({ state: 'failed', err: { message: 'boom', stack: 'at x' } }));
    expect(failed.error).toBe('boom');

    // A passing test may still carry a stale `err` from an earlier attempt; it
    // must not be reported as this case's error.
    const passed = build(test({ state: 'passed', err: { message: 'stale' } }));
    expect(passed.error).toBeUndefined();
  });

  it('omits attempts, retryCount and isFlaky for a test that ran once', () => {
    const built = build(test());
    expect(built.attempts).toBeUndefined();
    expect(built.retryCount).toBeUndefined();
    expect(built.isFlaky).toBeUndefined();
  });

  it('marks a retried test that ended green as flaky, and one that failed as not', () => {
    const flaky = buildCase(
      test({ $$currentRetry: 2, state: 'passed' }),
      'test/a.spec.cjs',
      [{ message: 'boom 1' }, { message: 'boom 2' }],
      [],
      config(),
      budget(),
    )!;
    expect(flaky.attempts).toHaveLength(3);
    // retryCount counts RETRIES, so it is one less than the attempts.
    expect(flaky.retryCount).toBe(2);
    expect(flaky.isFlaky).toBe(true);

    const stillFailing = buildCase(
      test({ $$currentRetry: 2, state: 'failed', err: { message: 'boom 3' } }),
      'test/a.spec.cjs',
      [{ message: 'boom 1' }, { message: 'boom 2' }],
      [],
      config(),
      budget(),
    )!;
    // "Failed after retries" is not flaky — the narrow definition the siblings use.
    expect(stillFailing.isFlaky).toBe(false);
  });

  it('replays metadata messages onto the case', () => {
    const built = build(test(), [
      { type: 'label', name: 'team', value: 'platform' },
      { type: 'tag', tags: ['smoke'] },
      { type: 'priority', value: 'high' },
      { type: 'link', url: 'https://example.com/1', linkType: 'issue' },
    ] as RuntimeMessage[]);
    expect(built.labels).toEqual([{ name: 'team', value: 'platform' }]);
    expect(built.tags).toEqual(['smoke']);
    expect(built.priority).toBe('high');
    expect(built.links?.[0]?.url).toBe('https://example.com/1');
  });

  it('never writes a masked parameter’s value into the report', () => {
    // Security regression test. `masked` is not a display hint: the value must
    // not reach the report at all.
    const built = build(test(), [
      { type: 'parameter', name: 'token', value: 'super-secret-value', masked: true },
    ] as RuntimeMessage[]);
    expect(JSON.stringify(built)).not.toContain('super-secret-value');
    expect(built.properties?.token).toBeTruthy();
  });

  it('stamps the shard index when one is configured', () => {
    const cfg = resolveConfig({ outputDir: '/tmp/x', shardIndex: 3 });
    const built = buildCase(test(), 'test/a.spec.cjs', [], [], cfg, budget())!;
    expect(built.shardIndex).toBe(3);
    // Absent, not zero, when unconfigured — 0 is a real worker index.
    expect(build(test()).shardIndex).toBeUndefined();
  });
});
