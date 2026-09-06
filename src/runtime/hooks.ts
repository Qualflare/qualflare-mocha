/**
 * The Root Hook Plugin, loaded with `mocha --require @qualflare/mocha/hooks`.
 *
 * This is the one piece of user setup this package cannot avoid. Mocha gives a
 * test body no way to identify itself -- there is no `expect.getState()` as in
 * Jest and no `task.meta` as in Vitest -- so something has to record the running
 * test for `qualflare.label()` and friends to attach to. A root `beforeEach` is
 * that something.
 *
 * It MUST be a Root Hook Plugin rather than a file that calls `beforeEach()` at
 * module scope. Mocha installs its globals after `--require` modules load, so the
 * module-scope form throws `ReferenceError: beforeEach is not defined` before any
 * test runs -- in serial mode as well as parallel. Loud, at least, rather than
 * silently skipped.
 *
 * Loading this is optional. Without it the reporter still records every result,
 * status, duration, error and retry -- only the author-facing metadata API needs
 * a test to attach to, and calls made without it are dropped with a warning.
 */
import { openSegment } from './channel.js';
import { clearCurrentTest, setCurrentTest } from './current-test.js';
import type { MochaTest } from '../shared/mocha-types.js';

/** Mocha's hook context; `currentTest` is set on `beforeEach`, `test` on afterEach. */
interface HookContext {
  currentTest?: MochaTest;
  test?: MochaTest;
}

export const mochaHooks = {
  beforeEach(this: HookContext): void {
    setCurrentTest(this.currentTest ?? null);
    // Opens a fresh channel segment for THIS execution. Without it a retried
    // test's attempts would all append to one segment and merge -- labels counted
    // once per attempt, and no way to tell which attempt an attachment came from.
    // The reporter takes the last segment, matching the final-attempt-wins rule
    // the sibling reporters document.
    openSegment();
  },

  afterEach(this: HookContext): void {
    // Cleared so a `qualflare.*()` call between tests -- in an `after` hook, say --
    // is dropped with a warning rather than attributed to the test that just
    // finished. Misattribution is worse than absence; the Cypress plugin had to
    // fix exactly that bug once.
    clearCurrentTest();
  },
};

export default { mochaHooks };
