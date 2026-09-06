'use strict';
// Loads the reporter from BUILT dist/, so a broken exports map fails the
// integration suite rather than surfacing after publish.
const path = require('node:path');
module.exports = {
  reporter: path.resolve(__dirname, '../../../../dist/reporter/index.cjs'),
  require: [path.resolve(__dirname, '../../../../dist/hooks.cjs')],
  spec: [path.resolve(__dirname, 'test/**/*.spec.cjs')],
};
