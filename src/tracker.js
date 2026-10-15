// -----------------------------------------------------------------------------
// One Weenect tracker = one Gladys device.
//
// The API answers trackers as big objects (subscription, contacts, SOS phone,
// the owner's address...): only what Gladys shows is kept here, the rest is
// never stored nor logged. The last position comes inside the tracker
// (`position[0]`), with the battery and the online flag.
//
// External ids: `gladys.externalIds('tracker', <Weenect tracker id>)`, the id
// the Weenect cloud gives the tracker (stable, never the name). A zone feature
// is keyed on the Weenect zone id: renaming the zone in the app keeps it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { sharesCoordinates } from './config.js';
import { formatCoordinates, isCoordinate, zonesContaining } from './geo.js';
import { NAMES, TEXT, formatDate, pick } from './i18n.js';

export const DEVICE_TYPE = 'tracker';

/** Feature keys: part of the external ids, never renamed. */
export const FEATURE = {
  POSITION: 'position',
  ACCURACY: 'accuracy',
  LAST_POSITION: 'last-position',
  BATTERY: 'battery',
  BATTERY_LOW: 'battery-low',
  ONLINE: 'online',
  STATUS: 'status',
  IN_ZONE: 'in-zone',
  ZONE: 'zone',
  RING: 'ring',
  VIBRATE: 'vibrate',
  REFRESH: 'refresh',
};

/** The command features, by key, and the client method they call. */
export const COMMANDS = {
  [FEATURE.RING]: 'ring',
  [FEATURE.VIBRATE]: 'vibrate',
  [FEATURE.REFRESH]: 'refreshPosition',
};

export const zoneFeatureKey = (zoneId) => `zone-${zoneId}`;

// Weenect's own "low battery" alert threshold, when the tracker has none.
const DEFAULT_BATTERY_THRESHOLD = 20;
const MAX_ACCURACY_M = 100_000;
const MAX_FEATURE_NAME = 40;

const finite = (value) =>
  value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

function parseDate(value) {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  // The API mixes "2021-04-15T05:53:24+00:00" and naive UTC dates.
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The part of a raw tracker Gladys uses.
 * @param {object} raw an item of GET mytracker
 */
export function parseTracker(raw) {
  const last = Array.isArray(raw.position) ? raw.position[0] : null;
  const latitude = finite(last?.latitude);
  const longitude = finite(last?.longitude);
  const threshold = finite(raw.battery_threshold);
  return {
    id: String(raw.id),
    name:
      typeof raw.name === 'string' && raw.name.trim() !== ''
        ? raw.name.trim()
        : `Weenect ${raw.id}`,
    type: typeof raw.type === 'string' ? raw.type : 'tracker',
    // null: the API did not say, every command is offered.
    capabilities: Array.isArray(raw.features) ? new Set(raw.features) : null,
    batteryThreshold:
      threshold !== null && threshold > 0 && threshold < 100
        ? threshold
        : DEFAULT_BATTERY_THRESHOLD,
    position: last
      ? {
          latitude,
          longitude,
          valid: isCoordinate(latitude, longitude),
          accuracy: finite(last.radius),
          battery: finite(last.battery),
          online: last.is_online === undefined ? null : Boolean(last.is_online),
          at: parseDate(last.date_tracker) ?? parseDate(last.date_server),
        }
      : null,
  };
}

/**
 * The part of a raw zone the container uses.
 * @param {object} raw an item of GET mytracker/<id>/zones
 */
export function parseZone(raw) {
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const radius = finite(raw.distance);
  if (!isCoordinate(latitude, longitude) || radius === null || radius <= 0) {
    return null;
  }
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : `#${raw.id}`,
    latitude,
    longitude,
    radius,
  };
}

const truncate = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** "Zone : Maison", unique on the device even when two zones share a name. */
function zoneFeatureNames(zones, language) {
  const prefix = `${NAMES[language].zonePrefix}${language === 'fr' ? ' : ' : ': '}`;
  const counts = new Map();
  for (const zone of zones) {
    counts.set(zone.name, (counts.get(zone.name) ?? 0) + 1);
  }
  return new Map(
    zones.map((zone) => {
      const suffix = counts.get(zone.name) > 1 ? ` #${zone.id}` : '';
      const room = MAX_FEATURE_NAME - prefix.length - suffix.length;
      return [zone.id, `${prefix}${truncate(zone.name, room)}${suffix}`];
    }),
  );
}

const sensor = (name, externalId, category, type, extra = {}) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const text = (name, externalId) =>
  // min/max are NOT NULL in Gladys, text features included (422 otherwise).
  sensor(name, externalId, CATEGORIES.TEXT, TYPES.TEXT.TEXT, { keep_history: false, max: 0 });

const command = (name, externalId) =>
  sensor(name, externalId, CATEGORIES.BUTTON, TYPES.BUTTON.PUSH, {
    read_only: false,
    keep_history: false,
  });

/**
 * The discovery payload of a tracker.
 * @param {object} gladys GladysIntegration
 * @param {ReturnType<typeof parseTracker>} tracker
 * @param {Array<ReturnType<typeof parseZone>>} zones
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, tracker, zones, language = 'fr') {
  const ids = gladys.externalIds(DEVICE_TYPE, tracker.id);
  const names = NAMES[language] ?? NAMES.en;
  const zoneNames = zoneFeatureNames(zones, NAMES[language] ? language : 'en');
  const features = [
    text(names.position, ids.feature(FEATURE.POSITION)),
    sensor(
      names.accuracy,
      ids.feature(FEATURE.ACCURACY),
      CATEGORIES.DISTANCE_SENSOR,
      TYPES.SENSOR.DECIMAL,
      { unit: UNITS.M, max: MAX_ACCURACY_M },
    ),
    text(names.lastPosition, ids.feature(FEATURE.LAST_POSITION)),
    sensor(names.battery, ids.feature(FEATURE.BATTERY), CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER, {
      unit: UNITS.PERCENT,
      max: 100,
    }),
    sensor(
      names.batteryLow,
      ids.feature(FEATURE.BATTERY_LOW),
      CATEGORIES.BATTERY_LOW,
      TYPES.SENSOR.BINARY,
    ),
    sensor(
      names.online,
      ids.feature(FEATURE.ONLINE),
      CATEGORIES.PRESENCE_SENSOR,
      TYPES.SENSOR.BINARY,
    ),
    text(names.status, ids.feature(FEATURE.STATUS)),
    sensor(
      names.inZone,
      ids.feature(FEATURE.IN_ZONE),
      CATEGORIES.PRESENCE_SENSOR,
      TYPES.SENSOR.BINARY,
    ),
    text(names.zone, ids.feature(FEATURE.ZONE)),
    ...zones.map((zone) =>
      sensor(
        zoneNames.get(zone.id),
        ids.feature(zoneFeatureKey(zone.id)),
        CATEGORIES.PRESENCE_SENSOR,
        TYPES.SENSOR.BINARY,
      ),
    ),
  ];
  const can = (capability) => tracker.capabilities === null || tracker.capabilities.has(capability);
  if (can('ringing')) {
    features.push(command(names.ring, ids.feature(FEATURE.RING)));
  }
  if (can('vibrate')) {
    features.push(command(names.vibrate, ids.feature(FEATURE.VIBRATE)));
  }
  features.push(command(names.refresh, ids.feature(FEATURE.REFRESH)));
  return {
    name: tracker.name,
    external_id: ids.device,
    model: `Weenect ${tracker.type}`,
    // The container refreshes by itself (src/poller.js); the core's poll is
    // the fallback, once a minute at most (GladysAssistant/Gladys#3198).
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    params: [{ name: 'TRACKER_TYPE', value: tracker.type }],
    features,
  };
}

/**
 * Where the tracker is relative to its zones, from its last position.
 * @returns {{ known: boolean, inside: Set<string>, current: object|null }}
 *   `known: false` when the position has no usable coordinates (keep the
 *   previous zone states); `current` is the most precise zone it is in.
 */
export function locate(tracker, zones, previouslyInside) {
  const position = tracker.position;
  if (!position?.valid) {
    return { known: false, inside: previouslyInside ?? new Set(), current: null };
  }
  const inside = zonesContaining(position, zones, previouslyInside);
  const current =
    zones.filter((zone) => inside.has(zone.id)).sort((a, b) => a.radius - b.radius)[0] ?? null;
  return { known: true, inside, current };
}

/**
 * The states of a tracker, in the publishChangedStates format.
 * @param {object} gladys
 * @param {ReturnType<typeof parseTracker>} tracker
 * @param {Array} zones
 * @param {ReturnType<typeof locate>} location
 * @param {object} options
 * @param {object} options.config normalized config (privacy, language)
 * @param {boolean} options.superLive super live started from Gladys and still running
 */
export function buildStates(gladys, tracker, zones, location, { config, superLive }) {
  const ids = gladys.externalIds(DEVICE_TYPE, tracker.id);
  const language = config.language;
  const states = [];
  const number = (key, state) =>
    state !== null &&
    state !== undefined &&
    states.push({ device_feature_external_id: ids.feature(key), state });
  const words = (key, value) =>
    states.push({ device_feature_external_id: ids.feature(key), text: value });

  const position = tracker.position;
  if (!sharesCoordinates(config)) {
    // Also overwrites the coordinates a previous `full` mode left in Gladys.
    words(FEATURE.POSITION, pick(TEXT.hidden, language));
  } else if (position?.valid) {
    words(FEATURE.POSITION, formatCoordinates(position));
  }
  if (position?.valid && position.accuracy !== null) {
    number(FEATURE.ACCURACY, Math.min(MAX_ACCURACY_M, Math.max(0, position.accuracy)));
  }
  if (position?.at) {
    words(FEATURE.LAST_POSITION, formatDate(position.at, language));
  }
  if (position?.battery !== null && position?.battery !== undefined) {
    const battery = Math.round(Math.min(100, Math.max(0, position.battery)));
    number(FEATURE.BATTERY, battery);
    number(FEATURE.BATTERY_LOW, battery <= tracker.batteryThreshold ? 1 : 0);
  }
  if (position?.online !== null && position?.online !== undefined) {
    number(FEATURE.ONLINE, position.online ? 1 : 0);
  }
  words(FEATURE.STATUS, pick(statusText(tracker, superLive), language));
  if (location.known) {
    number(FEATURE.IN_ZONE, location.inside.size > 0 ? 1 : 0);
    words(FEATURE.ZONE, location.current ? location.current.name : pick(TEXT.outside, language));
    for (const zone of zones) {
      number(zoneFeatureKey(zone.id), location.inside.has(zone.id) ? 1 : 0);
    }
  }
  return states;
}

/** Online, offline, or super live (as far as Gladys knows: started from Gladys). */
export function statusText(tracker, superLive) {
  if (superLive) {
    return TEXT.superLive;
  }
  return tracker.position && tracker.position.online !== false ? TEXT.online : TEXT.offline;
}

/** The Weenect tracker id of one of our device external ids, or null. */
export function trackerIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}
