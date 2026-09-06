/**
 * The currently-executing Mocha test, held on a `globalThis` symbol.
 *
 * WHY A GLOBAL AND NOT A MODULE-LEVEL `let`
 *
 * This package ships dual-format (ESM + CJS), and the two halves of the metadata
 * feature are loaded through DIFFERENT export conditions:
 *
 *   - the Root Hook Plugin arrives via `mocha --require @qualflare/mocha/hooks`,
 *     which Node resolves through the `require` condition -> the CJS build;
 *   - `qualflare.label()` is imported by the user's test file, which for an ESM
 *     project resolves through the `import` condition -> the ESM build.
 *
 * Those are two separate module instances with two separate module scopes. A
 * module-level `let current` is therefore written by the hook in one instance and
 * read as `undefined` by the API in the other -- and the failure is SILENT: the
 * metadata is still emitted, just attributed to no test at all.
 *
 * That was measured, not assumed. With module scope, an ESM test file plus CJS
 * hooks recorded `test: null`; with the symbol below, all four combinations
 * (CJS/ESM test x CJS/ESM hooks, serial and --parallel) attribute correctly.
 *
 * `Symbol.for` uses the cross-realm registry, so both instances resolve the same
 * key. Never replace this with a module-level variable.
 */
import type { MochaTest } from '../shared/mocha-types.js';

const CURRENT_TEST_KEY = Symbol.for('qualflare.mocha.currentTest');

type GlobalWithCurrent = typeof globalThis & { [CURRENT_TEST_KEY]?: MochaTest | null };

/** Called by the Root Hook Plugin's `beforeEach`, before each test body runs. */
export function setCurrentTest(test: MochaTest | null | undefined): void {
  (globalThis as GlobalWithCurrent)[CURRENT_TEST_KEY] = test ?? null;
}

/**
 * The test a `qualflare.*()` call belongs to, or null outside a test body.
 *
 * Null means one of two things, and the reporter must not guess between them:
 * the call happened outside a test (a `before` hook, module scope), or the user
 * never loaded the Root Hook Plugin. Both are reported as a dropped-metadata
 * warning rather than attributed to whichever test happens to be nearby.
 */
export function getCurrentTest(): MochaTest | null {
  return (globalThis as GlobalWithCurrent)[CURRENT_TEST_KEY] ?? null;
}

/** Clears the reference so metadata emitted between tests is not misattributed. */
export function clearCurrentTest(): void {
  (globalThis as GlobalWithCurrent)[CURRENT_TEST_KEY] = null;
}
