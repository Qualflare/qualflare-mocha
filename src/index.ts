export { qualflare } from './runtime/qualflare-api.js';

export type { QualflareMochaOptions, ResolvedReporterConfig } from './config/resolve-config.js';

export type {
  Attachment,
  Case,
  CasePriority,
  CaseStatus,
  Collect,
  FrameworkCategory,
  Label,
  Link,
  LinkType,
  Metadata,
  NanosecondDuration,
  Parameter,
  Platform,
  Step,
  Suite,
} from './shared/types.js';

/**
 * NO `qualflareReporter()` TUPLE HELPER HERE.
 *
 * The Jest and Vitest siblings export one because those runners take an array of
 * `[name, options]` tuples. Mocha does not: it takes a single `reporter` string
 * plus a separate options bag, so there is no tuple to build and a helper would
 * only invent an API Mocha cannot consume.
 *
 * Configure it in `.mocharc.cjs` instead:
 *
 * ```js
 * module.exports = {
 *   reporter: '@qualflare/mocha/reporter',
 *   reporterOption: { environment: 'staging' },
 *   // Required only for the qualflare.*() metadata API:
 *   require: ['@qualflare/mocha/hooks'],
 * };
 * ```
 *
 * Or on the command line, where options are `key=value` strings:
 *
 * ```bash
 * mocha --reporter @qualflare/mocha/reporter \
 *       --reporter-option environment=staging \
 *       --require @qualflare/mocha/hooks
 * ```
 */
export {};
