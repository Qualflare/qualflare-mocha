import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Case, Collect } from '../../src/shared/types.js';

/**
 * Drives a REAL `mocha` run against the fixture project and asserts the report it
 * wrote. The fixture loads the reporter and hooks from BUILT dist/, so
 * `npm run build` is a prerequisite and a broken exports map fails here rather
 * than after publishing.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, 'fixtures/mocha-project');

let outputDir: string;

beforeEach(() => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualflare-mocha-integration-'));
});

afterEach(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

/** `reject: false` because the fixture fails on purpose — the assertions are
 * about the written report, never the exit code. */
async function runFixture(extraArgs: string[] = []): Promise<Collect> {
  const result = await execa('npx', ['mocha', '--config', '.mocharc.cjs', ...extraArgs], {
    cwd: fixtureDir,
    env: { ...process.env, QUALFLARE_OUTPUT_DIR: outputDir },
    reject: false,
  });

  const reports = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter((f) => f.endsWith('.json'))
    : [];
  if (reports.length !== 1) {
    throw new Error(
      `expected exactly one report in ${outputDir}, found ${reports.length}. exit=${result.exitCode}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
  return JSON.parse(fs.readFileSync(path.join(outputDir, reports[0]!), 'utf8')) as Collect;
}

const allCases = (report: Collect): Case[] => report.suites.flatMap((s) => s.cases);
const caseNamed = (report: Collect, needle: string): Case => {
  const found = allCases(report).find((c) => c.name.includes(needle));
  if (!found) {
    throw new Error(`no case matching ${needle}. Have: ${allCases(report).map((c) => c.name).join(' | ')}`);
  }
  return found;
};

describe('qualflare-mocha against a real mocha run', () => {
  it(
    'writes one report the CLI can identify, with statuses mapped correctly',
    async () => {
      const report = await runFixture();

      // The format-detection triple. Drop any one and `qf collect` falls back to
      // filename detection and misroutes the file.
      expect(report.framework).toBe('mocha');
      expect(report.metadata).toBeTruthy();
      expect(report.suites.length).toBeGreaterThan(0);
      expect(report.suites.every((s) => s.category === 'mocha')).toBe(true);
      // The Playwright-JSON signature must be absent or the CLI mis-routes.
      expect(report).not.toHaveProperty('config');

      expect(caseNamed(report, 'passes').status).toBe('passed');
      expect(caseNamed(report, 'recognizable error message').status).toBe('failed');
      expect(caseNamed(report, 'recognizable error message').error).toContain(
        'qualflare-mocha-integration-test-marker',
      );
      // Mocha calls both forms "pending"; both mean "did not execute".
      expect(caseNamed(report, 'is skipped statically').status).toBe('skipped');
      expect(caseNamed(report, 'is explicitly skipped').status).toBe('skipped');
      expect(caseNamed(report, 'runs after a skipped test').status).toBe('passed');

      // Paths relativized, so the same test is the same suite on another machine.
      expect(report.suites.every((s) => !path.isAbsolute(s.name))).toBe(true);
    },
    180_000,
  );

  it(
    'carries metadata across the Root Hook Plugin and the channel',
    async () => {
      const report = await runFixture();
      const meta = caseNamed(report, 'records metadata');

      expect(meta.labels).toEqual(expect.arrayContaining([{ name: 'team', value: 'platform' }]));
      expect(meta.tags).toEqual(expect.arrayContaining(['smoke']));
      expect(meta.priority).toBe('high');
      expect(meta.links?.[0]?.url).toBe('https://example.com/issue/42');
      expect(meta.properties?.plan).toBe('pro');

      // Masked at SOURCE, in the worker: the channel is a file, so the real value
      // must never be serialized. Asserted over the WHOLE payload.
      expect(JSON.stringify(report)).not.toContain('super-secret-value');
      expect(meta.properties?.apiKey).toBeTruthy();
      expect(meta.properties?.apiKey).not.toContain('secret');

      // Nested steps keep their parent relationship.
      const inner = meta.steps?.find((s) => s.name === 'inner');
      expect(inner).toBeDefined();
      expect(inner?.parentIndex).toBe(0);
    },
    180_000,
  );

  it(
    'builds per-attempt history from the retry events',
    async () => {
      const report = await runFixture();
      const flaky = caseNamed(report, 'fails twice then passes');

      expect(flaky.status).toBe('passed');
      expect(flaky.retryCount).toBe(2);
      expect(flaky.isFlaky).toBe(true);
      expect(flaky.attempts).toHaveLength(3);
      expect(flaky.attempts?.map((a) => a.status)).toEqual(['failed', 'failed', 'passed']);
      // Mocha supplies each attempt's error with no opt-in, unlike Jest.
      expect(flaky.attempts?.[0]?.message).toContain('flaky attempt 1');
      expect(flaky.attempts?.[1]?.message).toContain('flaky attempt 2');
      expect(flaky.attempts?.[2]?.message).toBeUndefined();
    },
    180_000,
  );

  it(
    'keeps an oversized attachment from failing the run, and inlines a small one',
    async () => {
      const report = await runFixture();
      expect(caseNamed(report, 'oversized attachment').status).toBe('passed');

      const note = caseNamed(report, 'attaches a note').attachments?.find((a) => a.name === 'note');
      expect(note).toBeDefined();
      expect(typeof note?.content).toBe('string');
    },
    180_000,
  );

  it(
    'produces the same report in serial and in --parallel',
    async () => {
      // THE load-bearing test of this package. Under --parallel the reporter runs
      // in the main process while tests run in workers, and a Test crosses that
      // boundary through a CLOSED serialization allowlist. Anything read outside
      // it is undefined in parallel while working locally in serial.
      //
      // This caught a real bug: the Root Hook Plugin (CJS) and the metadata API
      // (ESM) are separate module instances, and each opened its own channel
      // file. drain() makes one segment per file and collapseByCase() keeps the
      // last, so the metadata was discarded whenever the empty `open` file sorted
      // last -- which depended only on two random filenames.
      const serial = await runFixture();
      fs.rmSync(outputDir, { recursive: true, force: true });
      fs.mkdirSync(outputDir, { recursive: true });
      const parallel = await runFixture(['--parallel']);

      const shape = (r: Collect) =>
        allCases(r)
          .map((c) =>
            [
              c.name,
              c.status,
              (c.attempts ?? []).length,
              (c.steps ?? []).length,
              (c.labels ?? []).length,
              (c.tags ?? []).join(','),
              c.priority ?? '',
              Object.keys(c.properties ?? {}).sort().join(','),
            ].join('|'),
          )
          .sort();

      expect(shape(parallel)).toEqual(shape(serial));
    },
    240_000,
  );

  it(
    'makes no network calls',
    async () => {
      const dist = path.resolve(here, '../../dist');
      for (const file of ['index.js', 'reporter/index.js', 'hooks.js']) {
        const source = fs.readFileSync(path.join(dist, file), 'utf8');
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).not.toMatch(/require\(['"](https?|undici|axios|node-fetch)['"]\)/);
      }
    },
    30_000,
  );
});
