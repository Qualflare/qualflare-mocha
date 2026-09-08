# Changelog

## 0.1.2

Documentation and package metadata — no code change, and nothing to do if you
are already on 0.1.1.

`homepage` now points at https://qualflare.com/mocha-test-reporting/ instead of
falling back to the GitHub README, and `keywords` matches the rest of the
reporter family. The README gained the Qualflare badge and the public report
banner for this package's own dogfood suite, which now runs on every merge.

## 0.1.1

**Fixes reporter options being silently ignored on Mocha 8 and 10.**

Mocha reads `reporterOption` differently by version. Measured with one key set
both ways:

| Mocha | `['environment=staging']` | `{ environment: 'staging' }` |
|---|---|---|
| 8.4.0 | works | discarded before the reporter sees it |
| 10.8.2 | works | stringified to `{'[object Object]': true}` |
| 12.0.0 | works | works |

0.1.0 documented the object form, which is correct only on Mocha 12. On 8 and 10
it failed **silently**: the run stayed green and every option — `environment`,
`outputDir`, everything — fell back to its default.

The reporter now normalises the `key=value` array form itself, so one config
works on every supported version, and it warns when it detects the shape Mocha 10
leaves behind. The docs and example now use the array form.

If you are on Mocha 12 and using the object form, nothing changes.

## 0.1.0

First release of `@qualflare/mocha` — a native Mocha reporter for Qualflare.

Captures what Mocha's JSON reporter cannot: per-attempt retry history with each
attempt's error, nested steps, image attachments, and the author-facing metadata
API (labels, links, tags, priority, parameters). Mocha users previously reached
Qualflare through the CLI's Mocha-JSON parser, which carries status, duration and
a retry count and nothing else.

The reporter makes no network calls. It writes a report directory that
`qualflare-cli collect` uploads, which is what lets any number of sharded CI jobs
merge into a single Launch.

**`mocha --parallel` is fully supported**, and CI asserts that a run produces the
same report with and without it. Two things make that work, both settled by
measurement against real Mocha runs rather than from the docs:

- Retry history comes from `EVENT_TEST_RETRY`, which fires in parallel mode too
  and carries each attempt's error with no opt-in. `$$retriedTest` is deliberately
  unused — measured at depth 1 in serial and 0 in parallel, it never held the full
  history.
- Metadata travels on a temp-directory channel, because `Test.prototype.serialize()`
  is a closed allowlist: a property set on a test object does not reach the
  reporter in parallel mode.

Requires `mocha >=8.0.0` and `@qualflare/cli >=0.1.24`. Verified against Mocha
8.4.0, 9.2.2, 10.8.2, 11.8.0 and 12.0.0.

Two things to know before relying on it, both in `docs/LIMITATIONS.md`: the
metadata API needs `--require @qualflare/mocha/hooks` (results are reported in
full without it; only metadata is affected), and Mocha exposes no captured
stdout/stderr to a reporter, so cases carry no console output.
