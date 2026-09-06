import { describe, expect, it } from 'vitest';

import { normalizeReporterOptions } from '../../src/config/reporter-options.js';

/**
 * Mocha delivers `reporterOption` in three different shapes across the supported
 * range. Measured, one key set two ways:
 *
 *   mocha 8.4.0   ['environment=staging']    -> { environment: 'staging' }
 *                 { environment: 'staging' } -> dropped entirely
 *   mocha 10.8.2  ['environment=staging']    -> { environment: 'staging' }
 *                 { environment: 'staging' } -> { '[object Object]': true }
 *   mocha 12.0.0  ['environment=staging']    -> ['environment=staging']  (raw)
 *                 { environment: 'staging' } -> { environment: 'staging' }
 *
 * Normalising the array form here is what makes one config work everywhere.
 */

describe('normalizeReporterOptions', () => {
  it('parses the key=value array Mocha 12 passes through untouched', () => {
    expect(normalizeReporterOptions(['environment=staging'])).toEqual({ environment: 'staging' });
  });

  it('passes through the object form Mocha 12 parses itself', () => {
    expect(normalizeReporterOptions({ environment: 'staging' })).toEqual({ environment: 'staging' });
  });

  it('coerces booleans and numbers out of key=value strings', () => {
    // Everything in the array form is a string, but the options are typed.
    expect(normalizeReporterOptions(['debug=true', 'enabled=false', 'shardIndex=2'])).toEqual({
      debug: true,
      enabled: false,
      shardIndex: 2,
    });
  });

  it('keeps a value containing "=" intact', () => {
    expect(normalizeReporterOptions(['outputDir=a=b'])).toEqual({ outputDir: 'a=b' });
  });

  it('drops the mangled marker Mocha 8/10 leave when handed an object', () => {
    // Without this the marker becomes an option named "[object Object]", and the
    // real settings are gone — silently, on a run that otherwise looks fine.
    expect(normalizeReporterOptions({ '[object Object]': true })).toEqual({});
  });

  it('keeps real options alongside the mangled marker', () => {
    expect(normalizeReporterOptions({ '[object Object]': true, environment: 'ci' })).toEqual({
      environment: 'ci',
    });
  });

  it('returns an empty object for anything unusable rather than throwing', () => {
    // A reporter must never be the reason a run fails.
    expect(normalizeReporterOptions(undefined)).toEqual({});
    expect(normalizeReporterOptions(null)).toEqual({});
    expect(normalizeReporterOptions('environment=staging')).toEqual({});
    expect(normalizeReporterOptions([42, 'ok=1'])).toEqual({ ok: 1 });
    expect(normalizeReporterOptions(['novalue'])).toEqual({});
  });
});
