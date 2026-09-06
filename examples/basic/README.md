# @qualflare/mocha — basic example

A minimal Mocha project wired to the Qualflare reporter. CI installs the packed
tarball here and runs it exactly as the root README documents, so this doubles as
a smoke test that the published package works from a clean install.

## What is here

- **`.mocharc.cjs`** — the whole integration. `reporter` points at
  `@qualflare/mocha/reporter`, `reporterOption` carries the settings, and
  `require` loads the Root Hook Plugin.
- **`test/checkout.spec.cjs`** — one test using the metadata API (labels, tags,
  priority, links, a nested step with a parameter) and one plain test.

## Run it

```bash
npm install
npm test
```

That writes a report into `qualflare-results/`. Upload it with:

```bash
npm install -g @qualflare/cli
qf login my-project "$QUALFLARE_TOKEN" --force
qf my-project collect ./qualflare-results
```

## Sharding

Point every shard at the **same** `outputDir` and collect once at the end. Each
Mocha process writes its own uniquely-named file, so shards never overwrite each
other, and `qf collect` merges every file in the directory into a single Launch.
This is also why `--parallel` needs no special handling: the reporter runs once
in the main process and writes one file for the whole run.
