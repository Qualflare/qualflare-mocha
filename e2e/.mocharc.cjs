'use strict';
// Dogfood config: this reporter reports on a suite of itself, loading from
// BUILT dist/ exactly as a user would load the published package.
const path = require('node:path');
const pkgRoot = path.resolve(__dirname, '..');

module.exports = {
  reporter: path.join(pkgRoot, 'reporter.cjs'),
  require: [path.join(pkgRoot, 'dist/hooks.cjs')],
  spec: [path.resolve(__dirname, 'tests/**/*.e2e.cjs')],
  // Array form, not an object: Mocha 8 and 10 cannot read an object here.
  // See docs/CONFIGURATION.md.
  reporterOption: ['outputDir=e2e-results', 'environment=ci'],
};
