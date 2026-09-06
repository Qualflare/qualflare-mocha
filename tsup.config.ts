import { createRequire } from 'node:module';

import { defineConfig } from 'tsup';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // `hooks` is a THIRD entry, not a sub-path of the reporter: users load it with
  // `mocha --require @qualflare/mocha/hooks`, which resolves the `require`
  // condition even when their test files are ESM. See src/runtime/current-test.ts
  // for why that split does not break metadata attribution.
  entry: {
    index: 'src/index.ts',
    'reporter/index': 'src/reporter/index.ts',
    hooks: 'src/runtime/hooks.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  splitting: false,
  shims: false,
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
});
