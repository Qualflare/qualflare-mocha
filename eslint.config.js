// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test/integration/fixtures/**',
      // A standalone example project with its own package.json/dependency
      // resolution (imports '@qualflare/mocha' by its published name, not a
      // relative path) — not part of this repo's own TS project graph.
      'examples/**',
      // The dogfood suite: a standalone Mocha project that loads the reporter
      // from built dist/, exactly like the fixtures above. Outside tsconfig's
      // include, so type-aware linting cannot parse it.
      'e2e/**',
      'coverage/**',
      // Plain JS, not part of the TS project graph — no type-aware linting
      // needed for the flat config file itself.
      'eslint.config.js',
      // Hand-written CommonJS shim, not TypeScript: Mocha 8 and 10 need the
      // reporter module's exports to BE the constructor. Types come from
      // dist/reporter/index.d.ts.
      'reporter.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // A dedicated tsconfig for linting: tsconfig.json's own `include`
        // deliberately covers only `src` (the published package), but
        // ESLint also needs to type-check test/*.ts and the root-level
        // *.config.ts files.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
