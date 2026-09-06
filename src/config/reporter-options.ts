/**
 * Normalises Mocha's `reporterOption` into a plain options object.
 *
 * Mocha has no single shape for this across the supported range, so a config
 * that works on one major silently misconfigures the reporter on another.
 * Measured, one key set three ways:
 *
 *   mocha 8.4.0   ['environment=staging']    -> { environment: 'staging' }
 *                 { environment: 'staging' } -> dropped entirely
 *   mocha 10.8.2  ['environment=staging']    -> { environment: 'staging' }
 *                 { environment: 'staging' } -> { '[object Object]': true }
 *   mocha 12.0.0  ['environment=staging']    -> ['environment=staging']   (raw)
 *                 { environment: 'staging' } -> { environment: 'staging' }
 *
 * So the ARRAY form is the one that can be made to work everywhere: Mocha 8 and
 * 10 parse it themselves, and Mocha 12 hands it over untouched for this function
 * to parse. The object form is correct only on 12, and on 8/10 it fails SILENTLY
 * -- the run succeeds and every option falls back to its default.
 *
 * That silent failure is why the mangled shape is detected and warned about
 * rather than ignored: a user who wrote the documented object form on Mocha 10
 * would otherwise see a green run reporting to the wrong environment.
 */
import { logger } from '../shared/logger.js';

/** The marker Mocha 8/10 leave behind when handed an object they cannot parse. */
const MANGLED_KEY = '[object Object]';

/** `"true"`/`"false"`/`"12"` arrive as strings from `key=value`; the option
 * types are booleans and numbers, so they are coerced back. */
function coerce(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

export function normalizeReporterOptions(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }

  // Mocha 12 with the array form: parse `key=value` entries ourselves.
  if (Array.isArray(input)) {
    const out: Record<string, unknown> = {};
    for (const entry of input) {
      if (typeof entry !== 'string') continue;
      const eq = entry.indexOf('=');
      if (eq <= 0) continue;
      out[entry.slice(0, eq)] = coerce(entry.slice(eq + 1));
    }
    return out;
  }

  if (typeof input !== 'object') {
    return {};
  }

  const obj = input as Record<string, unknown>;
  if (MANGLED_KEY in obj) {
    logger.warn(
      'reporter options were lost: this Mocha version cannot read an object `reporterOption` from a ' +
        'config file and stringified it away, so every option fell back to its default. Use the array ' +
        "form instead, which works on every supported Mocha: reporterOption: ['environment=staging'].",
    );
    const { [MANGLED_KEY]: _dropped, ...rest } = obj;
    return rest;
  }
  return obj;
}
