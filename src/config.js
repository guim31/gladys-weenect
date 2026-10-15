// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. This module gives the defaults (they
// MUST match the manifest, test/manifest.test.js checks it) and normalizes the
// received object, so the rest of the code never deals with `undefined` or
// with a value outside the declared options.
// -----------------------------------------------------------------------------

/** Languages of the texts the container produces (feature names, widget, messages). */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * What reaches Gladys about where a tracker is:
 *  - `full`: the coordinates (text feature, map link), the zones, the accuracy;
 *  - `zones_only`: the zones only. The coordinates are still read from
 *    Weenect (the zones are computed from them, inside the container), but
 *    they never leave the container: no state, no map link, no scene variable.
 */
export const PRIVACY_MODES = ['full', 'zones_only'];

/** Seconds between two reads of the Weenect account (manifest `select`, strings). */
export const REFRESH_INTERVALS = ['30', '60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  privacy: 'full',
  refresh_interval: '60',
  language: 'fr',
};

const oneOf = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? String(value) : fallback;

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    email: typeof raw.email === 'string' ? raw.email.trim() : DEFAULT_CONFIG.email,
    password: typeof raw.password === 'string' ? raw.password : DEFAULT_CONFIG.password,
    privacy: oneOf(raw.privacy, PRIVACY_MODES, DEFAULT_CONFIG.privacy),
    refresh_interval: oneOf(
      raw.refresh_interval,
      REFRESH_INTERVALS,
      DEFAULT_CONFIG.refresh_interval,
    ),
    language: oneOf(raw.language, LANGUAGES, DEFAULT_CONFIG.language),
  };
}

/** Both credentials are filled in. */
export function isConfigured(config) {
  return config.email !== '' && config.password !== '';
}

/** The refresh period, in milliseconds. */
export function refreshPeriodMs(config) {
  return Number(config.refresh_interval) * 1000;
}

/** The coordinates may leave the container. */
export function sharesCoordinates(config) {
  return config.privacy === 'full';
}
