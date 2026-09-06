# Known limitations

What this reporter does not do, and why. Everything here is deliberate; where a
limitation comes from Mocha rather than from this package, that is said plainly.

## The metadata API requires the Root Hook Plugin

`qualflare.label()` and friends need to know which test is running. Mocha offers
no way for a test body to identify itself — there is no `expect.getState()` as in
Jest, and no `task.meta` as in Vitest — so `@qualflare/mocha/hooks` records the
current test in a root `beforeEach`, and it must be loaded:

```js
// .mocharc.cjs
require: ['@qualflare/mocha/hooks'],
```

It has to be a [Root Hook Plugin](https://mochajs.org/#root-hook-plugins) rather
than a file that calls `beforeEach()` at module scope. Mocha installs its globals
*after* `--require` modules load, so the module-scope form throws
`ReferenceError: beforeEach is not defined` before any test runs — in serial mode
as well as parallel.

Without the plugin, results are still reported in full. Only metadata is affected,
and those calls are **dropped with a warning** rather than attached to whichever
test reports first. Silent misattribution is worse than absent data; the Cypress
plugin had to fix exactly that bug once.

## No captured stdout or stderr

Mocha exposes no per-test console output to a reporter — there is no equivalent of
Jest's `TestResult.console` — so a case's `stdout` is never populated.

The size caps for it still exist in `shared/constants.ts`, mirroring the server's
own limits, so that if Mocha ever surfaces captured output the clamp is already
the right number rather than a fresh guess.

## Steps exist only in Qualflare

`qualflare.step()` records a step in the report. Mocha has no step concept of its
own, so steps never appear in Mocha's output, and a failing step surfaces as a
failing test.

Nesting is preserved via `parentIndex`, and steps are capped at 300 per attempt —
well under the server's 1000-per-case limit — with anything beyond dropped and a
warning logged.

## Metadata from an abandoned retry is discarded, not merged

When a test is retried, each attempt emits its own metadata. The reporter keeps
the **final** attempt's and discards the rest, matching the rule the sibling
reporters document: steps, metadata and attachments describe the attempt that
decided the outcome.

`attempts[]` still records every attempt's status and error, so nothing about the
retry history is lost — only the metadata of attempts that were superseded.

## Two tests with the same full title in one file share metadata

Metadata is keyed on the test's full title plus its file path. Two tests in the
same file with an identical `describe` path *and* title cannot be told apart, so
their metadata merges.

This is also why `__mocha_id__` is not used as that key, even though it looks
ideal: Mocha **clones the Test on every retry** and each clone gets a fresh id, so
keying on it correlates nothing across attempts.

## Only allowlisted Test fields are read

Under `mocha --parallel` the reporter runs in the main process while tests run in
workers, and a Test crosses that boundary through `Test.prototype.serialize()` —
a **closed allowlist**:

```
$$currentRetry, $$fullTitle, $$isPending, $$retriedTest, $$slow, $$titlePath,
body, duration, err, parent { $$fullTitle, id }, speed, state, title, type,
file, id
```

Anything outside it is `undefined` in parallel mode even though it is present in
serial — which is what
[mochajs/mocha#4453](https://github.com/mochajs/mocha/issues/4453) was about. This
reporter reads only allowlisted fields, and its CI asserts that a run produces the
same report with and without `--parallel`.

One consequence worth knowing: **a property you set on a test object does not
reach the reporter in parallel mode.** That is why the metadata API writes to a
temp-directory channel instead.

## `$$retriedTest` is not used for retry history

It is allowlisted and looks like a linked list of attempts, but it was measured at
depth 1 in serial and 0 in parallel — it points at the immediately-previous
attempt only. Per-attempt history comes from `EVENT_TEST_RETRY` instead, which
fires in both modes and carries each attempt's error with no opt-in. (Jest needs
`jest.retryTimes(n, { logErrorsBeforeRetry: true })` for the same data.)

## `parameter()` masking redacts the value

`qualflare.parameter(name, value, { masked: true })` sends the name and a masked
marker, never the value. This is not a display hint: the value is dropped **in the
test process**, before anything is serialized, so it never reaches the channel
file on disk, the report, or the server.

## Artifacts are written, not uploaded

Image attachments are written into `outputDir` and referenced by
`localImagePath`; `qualflare-cli` uploads them at collect time and resolves each
into a real `storageKey`. This reporter never makes a network call.

**Needs `@qualflare/cli` v0.1.24+.** An older CLI does not read the field, and
because such an attachment carries neither content nor a storage key the server
records it from its name alone — an undownloadable placeholder.

## Sharded CI: point every shard at the same `outputDir`

Each Mocha process writes one uniquely-named report, so shards never overwrite
each other. Collect the directory once at the end and `qf collect` merges every
file into a single Launch.

## Not limitations of this reporter

- **No `timeout` or `aborted` status.** Mocha has no distinct timed-out state — a
  timeout surfaces as a failure whose message begins `Timeout of ...ms exceeded` —
  so those two wire statuses are never produced.
- **A test with no state maps to `error`.** That happens when a hook failure
  aborted the suite around it. `failed` would blame the test itself.
- **No video.** Mocha records none.
- **`describe` titles are not tags.** They are already part of the test's full
  title.
