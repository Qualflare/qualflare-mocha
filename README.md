# @qualflare/mocha

[![npm version](https://img.shields.io/npm/v/%40qualflare%2Fmocha.svg)](https://www.npmjs.com/package/@qualflare/mocha)
[![CI](https://github.com/Qualflare/qualflare-mocha/actions/workflows/ci.yml/badge.svg)](https://github.com/Qualflare/qualflare-mocha/actions/workflows/ci.yml)
[![Qualflare](https://api.qualflare.com/p/qualflare-mocha/badge.svg)](https://reports.qualflare.com/p/qualflare-mocha/launches)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)

A native Mocha reporter for [Qualflare](https://qualflare.com) — captures results
directly from your `mocha` run: status, per-attempt retry history and flakiness,
nested steps, attachments, and author-facing metadata (labels, links, tags,
priority, custom parameters).

Without it, Mocha results reach Qualflare through the JSON reporter, which
carries pass/fail, duration and a retry count — no per-attempt history, no
attachments, no metadata.

The reporter itself makes **no network calls**. It writes a report directory, and
[`qualflare-cli`](https://github.com/Qualflare/qualflare-cli) uploads it — which is
what lets any number of sharded CI jobs merge into a single Launch.

## Install

```bash
npm install --save-dev @qualflare/mocha
```

Requires `mocha` `>=8.0.0` (a peer dependency) and Node `>=18`. You also need
[`@qualflare/cli`](https://github.com/Qualflare/qualflare-cli) **v0.1.24 or newer**
— the first release that reads `localImagePath`; on an older CLI, image
attachments are recorded from their name alone as undownloadable placeholders.

## Quickstart

```js
// .mocharc.cjs
module.exports = {
  reporter: '@qualflare/mocha/reporter',
  // Array of `key=value`, NOT an object — see below.
  reporterOption: ['environment=staging'],
  // Required only for the qualflare.*() metadata API — see below.
  require: ['@qualflare/mocha/hooks'],
};
```

### Why `reporterOption` is an array

Mocha reads this key differently across versions. An **object** works only on
Mocha 12; on Mocha 10 it is stringified into nothing usable, and on Mocha 8 it is
discarded outright — in both cases the run stays green and every option silently
falls back to its default. The `key=value` **array** form works on every
supported version, so it is the one to use.

(On Mocha 10 this reporter detects the mangled object and warns. On Mocha 8 the
object never reaches the reporter at all, so there is nothing to warn about —
another reason to use the array.)

Or on the command line, where options are `key=value` strings:

```bash
mocha --reporter @qualflare/mocha/reporter \
      --reporter-option environment=staging \
      --require @qualflare/mocha/hooks
```

Then run your tests and upload:

```bash
npx mocha
npm install -g @qualflare/cli
qf login my-project "$QUALFLARE_TOKEN" --force
qf my-project collect ./qualflare-results
```

### Why `--require @qualflare/mocha/hooks`

Mocha gives a test body no way to identify itself — there is no equivalent of
Jest's `expect.getState()` or Vitest's `task.meta` — so a root hook has to record
the running test for `qualflare.label()` and friends to attach to. That hook must
be a [Root Hook Plugin](https://mochajs.org/#root-hook-plugins), which is what
this entry point is.

**It is optional.** Without it every result, status, duration, error and retry is
still reported in full; only the metadata API needs a test to attach to, and calls
made without it are dropped with a warning rather than guessed at.

### Parallel mode

`mocha --parallel` is fully supported and needs no extra configuration. The
reporter runs once in the main process and writes one report for the whole run.
The package's own CI asserts that a run produces the **same report** with and
without `--parallel`.

### Sharded CI

Point every shard at the **same** `outputDir` and collect once at the end. Each
Mocha process writes its own uniquely-named file, so shards never overwrite each
other, and `qf collect` merges every file in the directory into a single Launch.

## Enriching your tests

```js
const { qualflare } = require('@qualflare/mocha');

it('checks out', async function () {
  qualflare.label('feature', 'checkout');
  qualflare.link('https://example.com/issue/42', { type: 'issue', name: 'QF-42' });
  qualflare.tag('smoke');
  qualflare.priority('high');

  await qualflare.step('add to cart', () => {
    qualflare.parameter('sku', 'widget');
    qualflare.parameter('token', process.env.TOKEN, { masked: true });
  });
});
```

Full reference in [`docs/METADATA-API.md`](./docs/METADATA-API.md).

## Configuration

Every option and environment variable is in
[`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md).

## Test reports

This reporter is tested with itself. `e2e/` is a Mocha suite covering this
package's own behaviour — the metadata API, nested steps, image attachments and
per-attempt retry history — run by this reporter and uploaded to Qualflare on
every merge to `main`, using the **published** `qualflare-cli`. The results below
are that suite's, reported through the code this README documents:

[![Qualflare](https://api.qualflare.com/p/qualflare-mocha/banner.svg)](https://reports.qualflare.com/p/qualflare-mocha/launches)

Every case there is meant to pass, so a red run is a real regression rather than a
fixture failing on purpose. Deliberately-failing cases live in
`test/integration/`, which is never uploaded.

## Known limitations

- **Tests skipped by a failing hook are missing from the report.** The hook failure
  itself is recorded, but the tests it guarded are absent rather than marked
  skipped, so your case count drops for that run.
- **Nested `describe` blocks are flattened.** One suite per spec file, with the
  describe path folded into the case name. Use tags if you need to group by an
  intermediate `describe`.
- **The metadata API needs the Root Hook Plugin.** Without
  `--require @qualflare/mocha/hooks`, results are still reported in full but
  `qualflare.*()` calls are dropped with a warning.

Full details in [`docs/LIMITATIONS.md`](./docs/LIMITATIONS.md).

## Development

```bash
npm ci
npm run build
npm test                   # unit
npm run test:integration   # spawns a real mocha run against test/integration/fixtures
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
