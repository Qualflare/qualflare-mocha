/**
 * The reporter entry point: `mocha --reporter @qualflare/mocha/reporter`.
 *
 * Mocha calls `new Reporter(runner, options)` on the module's default export, so
 * the default export must be the class itself.
 */
export { QualflareMochaReporter, default } from './reporter.js';
