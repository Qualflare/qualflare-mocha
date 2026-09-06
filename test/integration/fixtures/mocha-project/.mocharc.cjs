'use strict';
const path = require('node:path');

const pkgRoot = path.resolve(__dirname, '../../../..');

module.exports = {
  // The PUBLISHED entry, not dist/reporter/index.cjs. reporter.cjs is the shim
  // that assigns the class to module.exports, and Mocha 8 and 10 fail with
  // "this._reporter is not a constructor" without it. Pointing at the built
  // namespace object directly would let that regression through on every
  // version except 12 — which is exactly what it did until CI caught it.
  reporter: path.join(pkgRoot, 'reporter.cjs'),
  require: [path.join(pkgRoot, 'dist/hooks.cjs')],
  spec: [path.resolve(__dirname, 'test/**/*.spec.cjs')],
};
