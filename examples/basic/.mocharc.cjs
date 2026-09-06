'use strict';
module.exports = {
  reporter: '@qualflare/mocha/reporter',
  reporterOption: { environment: 'staging' },
  // Required only for the qualflare.*() metadata API. Without it results are
  // still reported in full; only labels, steps and attachments need a test to
  // attach to. See docs/LIMITATIONS.md.
  require: ['@qualflare/mocha/hooks'],
  spec: ['test/**/*.spec.cjs'],
};
