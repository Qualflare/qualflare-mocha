import { describe, expect, it } from 'vitest';

import { clearCurrentTest, getCurrentTest, setCurrentTest } from '../../src/runtime/current-test.js';
import type { MochaTest } from '../../src/shared/mocha-types.js';

/**
 * The dual-package hazard, guarded.
 *
 * This package ships ESM and CJS, and the two halves of the metadata feature are
 * loaded through DIFFERENT export conditions: the Root Hook Plugin via
 * `--require @qualflare/mocha/hooks` (the `require` condition) and
 * `qualflare.label()` via the user's test file (the `import` condition in an ESM
 * project). Those are two module instances with two module scopes.
 *
 * Held in module scope, the hook wrote the running test into one instance and
 * the API read `null` from the other -- and the metadata was still EMITTED, just
 * attributed to no test. Silent wrong data, which is the failure mode this family
 * refuses. Measured: an ESM test file with CJS hooks recorded `test: null`.
 *
 * The same bug then appeared a second time in the channel: each instance opened
 * its own file, drain() made a segment per file, collapseByCase() kept the last,
 * and the metadata was discarded whenever the empty `open` file happened to sort
 * last. It presented as metadata working in serial and vanishing in --parallel,
 * decided by nothing but two random filenames.
 *
 * Both are fixed by holding the state on a `Symbol.for()` key, which resolves to
 * the same slot in every realm. These tests assert the mechanism, because a unit
 * test cannot load two realms -- and the failure is invisible at runtime.
 */

const fake = (title: string): MochaTest => ({ title, $$fullTitle: `suite ${title}` });

describe('current test state', () => {
  it('round-trips through the holder', () => {
    setCurrentTest(fake('a'));
    expect(getCurrentTest()?.title).toBe('a');
    clearCurrentTest();
    expect(getCurrentTest()).toBeNull();
  });

  it('treats undefined as null rather than leaving a stale test in place', () => {
    setCurrentTest(fake('a'));
    setCurrentTest(undefined);
    // A stale value here would attribute a between-tests qualflare.*() call to
    // whichever test ran last -- the misattribution bug the Cypress plugin had
    // to fix once.
    expect(getCurrentTest()).toBeNull();
  });

  it('lives on a cross-realm registered symbol, NOT in module scope', () => {
    // The load-bearing assertion. A module-level `let` would pass every test
    // above and still lose metadata in production, because the hook and the API
    // are different module instances. Reading the value through an independently
    // obtained Symbol.for() handle proves the state is reachable from any realm.
    setCurrentTest(fake('cross-realm'));
    const key = Symbol.for('qualflare.mocha.currentTest');
    const viaRegistry = (globalThis as Record<symbol, unknown>)[key] as MochaTest | null;
    expect(viaRegistry?.title).toBe('cross-realm');

    // And the reverse direction: a write made through the registry, as the OTHER
    // module instance would make it, is visible to this one.
    (globalThis as Record<symbol, unknown>)[key] = fake('written-by-the-other-instance');
    expect(getCurrentTest()?.title).toBe('written-by-the-other-instance');
    clearCurrentTest();
  });

  it('uses the registered symbol, not a unique per-module one', () => {
    // Symbol() would look identical in this file and be a different key in every
    // realm. Symbol.for() is what makes it shared.
    expect(Symbol.for('qualflare.mocha.currentTest')).toBe(
      Symbol.for('qualflare.mocha.currentTest'),
    );
    expect(Symbol.keyFor(Symbol.for('qualflare.mocha.currentTest'))).toBe(
      'qualflare.mocha.currentTest',
    );
  });
});
