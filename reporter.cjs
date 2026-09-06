'use strict';
/**
 * CommonJS entry for `--reporter @qualflare/mocha/reporter`.
 *
 * Hand-written and committed rather than generated, because Mocha requires the
 * module's exports to BE the constructor:
 *
 *   this._reporter = require(name);
 *   new this._reporter(runner, options);
 *
 * tsup's CJS output is a namespace object (`exports.default`,
 * `exports.QualflareMochaReporter`), which Mocha 12 unwraps but Mocha 8 and 10 do
 * not -- they fail with `TypeError: this._reporter is not a constructor` before a
 * single test runs. Measured on 8.4.0 and 10.8.2.
 *
 * This shim is what makes the declared peer range real rather than aspirational.
 */
const { QualflareMochaReporter } = require('./dist/reporter/index.cjs');

module.exports = QualflareMochaReporter;
// Kept so `require('@qualflare/mocha/reporter').default` also resolves, for
// anyone who wired it up against the namespace shape.
module.exports.default = QualflareMochaReporter;
module.exports.QualflareMochaReporter = QualflareMochaReporter;
