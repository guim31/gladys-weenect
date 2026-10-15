// -----------------------------------------------------------------------------
// Where a tracker is, relative to its Weenect zones.
//
// The Weenect API lists the zones of a tracker (centre and radius, set up in
// the app) but does not say whether the tracker is inside one: the container
// computes it from the last position, which never leaves the container in the
// `zones_only` privacy mode.
//
// A position is a circle (the `radius` the API gives is its accuracy): near
// the border of a zone, two readings can fall on each side. To avoid a zone
// that flaps at every reading, a tracker inside a zone only leaves it once it
// is farther than the radius plus a margin (its accuracy, 25 to 100 m).
// -----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;
const MIN_EXIT_MARGIN_M = 25;
const MAX_EXIT_MARGIN_M = 100;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isCoordinate = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180 &&
  // 0,0 is what a tracker without a fix reports, never a real position here.
  !(latitude === 0 && longitude === 0);

/**
 * The ids of the zones the position is in.
 * @param {{ latitude: number, longitude: number, accuracy: number|null }} position
 * @param {Array<{ id: string, latitude: number, longitude: number, radius: number }>} zones
 * @param {Set<string>} [previouslyInside] zones the tracker was in at the previous reading
 * @returns {Set<string>}
 */
export function zonesContaining(position, zones, previouslyInside = new Set()) {
  const inside = new Set();
  const margin = Math.min(
    MAX_EXIT_MARGIN_M,
    Math.max(MIN_EXIT_MARGIN_M, Number.isFinite(position.accuracy) ? position.accuracy : 0),
  );
  for (const zone of zones) {
    const distance = distanceMeters(position, zone);
    const limit = previouslyInside.has(zone.id) ? zone.radius + margin : zone.radius;
    if (distance <= limit) {
      inside.add(zone.id);
    }
  }
  return inside;
}

/** OpenStreetMap link centred on a position (https, no tracking parameter). */
export function mapUrl({ latitude, longitude }) {
  const lat = latitude.toFixed(5);
  const lon = longitude.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

/** "45.76400, 4.83570": the text of the position feature. */
export function formatCoordinates({ latitude, longitude }) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
