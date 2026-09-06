# Known limitations

Things Mocha does that this reporter does not capture, or captures only partly.
Everything here is deliberate, and each entry says what you lose and what to do
about it.

## Tests skipped by a failing hook are missing from the report

When a `before`/`beforeEach` hook throws, Mocha reports the **hook failure** and
then skips the tests it guarded. The hook failure is recorded — as a case named
after the hook, e.g. `"before all" hook for "loads the cart"` — but the skipped
tests are **not in the report at all**.

So a suite of 10 tests behind a broken `before` hook produces 1 failed case, not
1 failed and 9 skipped, and your total case count drops for that run. The failure
is visible and attributed; the absent tests are the cost.

## Nested `describe` blocks are flattened

Mocha nests suites arbitrarily deep. The report has **one suite per spec file**,
with the full `describe` path folded into each case's name:

```js
describe('checkout', () => describe('payment', () => it('declines an expired card')))
// suite: test/checkout.spec.js
// case:  "checkout payment declines an expired card"
```

Grouping and filtering by file works; grouping by an intermediate `describe` does
not. Tags are the intended substitute — `qualflare.tag('payment')` gives you a
dimension you can filter on.

## The metadata API needs the Root Hook Plugin

`qualflare.label()` and friends need to know which test is running, and Mocha
gives a test body no way to identify itself. `@qualflare/mocha/hooks` records it
in a root `beforeEach`, and must be loaded:

```js
// .mocharc.cjs
require: ['@qualflare/mocha/hooks'],
```

It has to be a [Root Hook Plugin](https://mochajs.org/#root-hook-plugins), not a
file calling `beforeEach()` at module scope — Mocha installs its globals *after*
`--require` modules load, so the module-scope form throws
`ReferenceError: beforeEach is not defined` before any test runs.

Without the plugin, results are still reported in full; only metadata is
affected, and those calls are dropped with a warning.

## Metadata outside a test body is dropped

A `qualflare.*()` call in `before`, `after`, or at module scope has no test to
attach to. Those calls are discarded with a warning rather than attached to
whichever test reports first — silent misattribution is worse than absent data.

## Only the final attempt's metadata is kept for a retried test

With `this.retries(n)`, each attempt emits its own metadata. The reporter keeps
the **final** attempt's labels, steps and attachments and discards the rest.

`attempts[]` still records every attempt's status and error, so the retry history
itself is complete — it is only the metadata of superseded attempts that is lost.

## Two tests with the same full title in one file share metadata

Metadata is keyed on the test's full title plus its file. Two tests in one file
with an identical `describe` path *and* title cannot be told apart, so their
metadata merges. Their results are still reported separately.

(This is also why Mocha's own `__mocha_id__` is not used as the key: Mocha clones
the Test on every retry and each clone gets a fresh id, so it correlates nothing
across attempts.)

## Mocha's speed classification is not reported

Mocha grades each test `fast`/`medium`/`slow` against `--slow`. The report carries
the raw duration instead; the grading is not sent.

## Per-case output is not captured

Mocha does not hand reporters the console output of an individual test, and this
reporter does not install a global `console` interceptor to synthesise it —
patching a user's console to attribute output by timing is guesswork that goes
wrong under `--parallel`. Failures carry their error and stack; anything else you
want in the report, attach explicitly with `qualflare.attachment()`.

## Node only

This reporter writes to the filesystem, so it runs under Mocha on Node. Mocha in
the browser is not supported.

## Caps

Bounds applied per case, with anything beyond dropped and a warning logged: 300
steps per attempt, 50 attachments, 100 labels, 20 links, 64 tags, 50 attempts.
Attachment bytes are bounded per run by `maxTotalAttachmentBytes` (counted as
base64, which is what the report carries).

## Image attachments need `@qualflare/cli` v0.1.24+

Images are written into `outputDir` and referenced by `localImagePath`; the CLI
uploads them at collect time. An older CLI does not read that field, and records
the attachment from its name alone — an undownloadable placeholder.

## Not limitations

- **`mocha --parallel` is fully supported.** The reporter runs once in the main
  process and writes one report; CI asserts a run produces the same report with
  and without it.
- **No `timeout` status.** Mocha has no distinct timed-out state — a timeout is a
  failure whose message begins `Timeout of ...ms exceeded` — so it is reported as
  `failed`, which is what Mocha itself reports.
- **Sharded runs need no configuration.** Point every shard at the same
  `outputDir`; each process writes a uniquely-named file and `qf collect` merges
  them into one Launch.
