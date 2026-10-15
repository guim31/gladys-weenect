// -----------------------------------------------------------------------------
// The tracker model: what is kept of the API payload, the device structure,
// the states, and where a position is relative to the zones.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { distanceMeters, mapUrl, zonesContaining } from '../src/geo.js';
import {
  FEATURE,
  buildDevice,
  buildStates,
  locate,
  parseTracker,
  parseZone,
  trackerIdOf,
} from '../src/tracker.js';
import './helpers/world.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/weenect/${name}`, import.meta.url), 'utf8'));
const [rawCat, rawDog] = fixture('trackers.json').items;
const catZones = fixture('zones-100001.json').items.map(parseZone);
const gladys = createFakeGladys();
const config = normalizeConfig({ email: 'a@example.com', password: 'x' });
const ids = gladys.externalIds('tracker', '100001');

const statesOf = (states) =>
  Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.text ?? s.state]),
  );

test('only what Gladys shows is kept of the tracker payload', () => {
  const cat = parseTracker(rawCat);
  assert.equal(cat.id, '100001');
  assert.equal(cat.name, 'Minou');
  assert.equal(cat.batteryThreshold, 30);
  assert.deepEqual(cat.position, {
    latitude: 45.0001,
    longitude: 4.0001,
    valid: true,
    accuracy: 12,
    battery: 82,
    online: true,
    at: new Date('2026-10-15T08:29:10Z'),
  });
  const serialized = JSON.stringify({ ...cat, capabilities: [...cat.capabilities] });
  for (const secret of [
    '+33600000000',
    'owner@example.com',
    '350000000000001',
    '8933000000000000',
  ]) {
    assert.ok(!serialized.includes(secret), `${secret} is not kept`);
  }
});

test('a tracker without a position, a name or a fix is still a tracker', () => {
  const bare = parseTracker({ id: 7, name: ' ', position: [] });
  assert.equal(bare.name, 'Weenect 7');
  assert.equal(bare.position, null);
  assert.equal(bare.capabilities, null);
  const noFix = parseTracker({ id: 8, position: [{ latitude: 0, longitude: 0, battery: 50 }] });
  assert.equal(noFix.position.valid, false);
  const naive = parseTracker({ id: 9, position: [{ date_tracker: '2026-10-15T08:00:00' }] });
  assert.equal(naive.position.at.toISOString(), '2026-10-15T08:00:00.000Z', 'naive dates are UTC');
});

test('a zone without a centre or a radius is ignored', () => {
  assert.equal(parseZone({ id: 1, latitude: 45, longitude: 4, distance: 0 }), null);
  assert.equal(parseZone({ id: 1, latitude: null, longitude: 4, distance: 100 }), null);
  assert.deepEqual(parseZone({ id: 3, name: '', latitude: 45, longitude: 4, distance: 80 }), {
    id: '3',
    name: '#3',
    latitude: 45,
    longitude: 4,
    radius: 80,
  });
});

test('the device: one feature per zone, the commands the tracker supports', () => {
  const cat = buildDevice(gladys, parseTracker(rawCat), catZones, 'fr');
  assert.equal(cat.external_id, ids.device);
  assert.equal(cat.name, 'Minou');
  assert.deepEqual(
    cat.features.map((f) => f.external_id.slice(ids.device.length + 1)),
    [
      'position',
      'accuracy',
      'last-position',
      'battery',
      'battery-low',
      'online',
      'status',
      'in-zone',
      'zone',
      'zone-200001',
      'zone-200002',
      'ring',
      'vibrate',
      'refresh',
    ],
  );
  assert.equal(
    cat.features.find((f) => f.external_id.endsWith('zone-200001')).name,
    'Zone : Maison',
  );
  // Rex cannot ring (no "ringing" in its features).
  const dog = buildDevice(gladys, parseTracker(rawDog), [], 'en');
  assert.ok(!dog.features.some((f) => f.external_id.endsWith(':ring')));
  assert.ok(dog.features.some((f) => f.external_id.endsWith(':vibrate')));
  assert.equal(dog.features[0].name, 'Position');
});

test('zone feature names stay unique and fit 40 characters', () => {
  const zones = [
    { id: '1', name: 'École', latitude: 45, longitude: 4, radius: 50 },
    { id: '2', name: 'École', latitude: 46, longitude: 4, radius: 50 },
    {
      id: '3',
      name: 'Chez papi et mamie, au bout du chemin des vignes',
      latitude: 47,
      longitude: 4,
      radius: 50,
    },
  ];
  const device = buildDevice(gladys, parseTracker(rawCat), zones, 'de');
  const names = device.features.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('Zone: École #1') && names.includes('Zone: École #2'));
  assert.ok(
    names.every((name) => name.length <= 40),
    names.join(' | '),
  );
});

test('the states: position, accuracy, battery, zones', () => {
  const cat = parseTracker(rawCat);
  const states = statesOf(
    buildStates(gladys, cat, catZones, locate(cat, catZones), { config, superLive: false }),
  );
  assert.deepEqual(states, {
    position: '45.00010, 4.00010',
    accuracy: 12,
    'last-position': '15/10 08:29',
    battery: 82,
    'battery-low': 0,
    online: 1,
    status: 'En ligne',
    'in-zone': 1,
    zone: 'Maison',
    'zone-200001': 1,
    'zone-200002': 0,
  });
  for (const value of Object.values(states)) {
    assert.notEqual(value, '', 'a text state is never empty');
  }
});

test('low battery follows the threshold set in the Weenect app', () => {
  const dog = parseTracker(rawDog);
  const states = statesOf(
    buildStates(gladys, dog, [], locate(dog, []), { config, superLive: false }),
  );
  assert.equal(states.battery, 18);
  assert.equal(states['battery-low'], 1, '18 % under the 20 % threshold of Rex');
  assert.equal(states.online, 0);
  assert.equal(states.status, 'Hors ligne');
  assert.equal(states['in-zone'], 0);
  assert.equal(states.zone, 'Hors zone');
});

test('super live shows in the status', () => {
  const cat = parseTracker(rawCat);
  const states = statesOf(
    buildStates(gladys, cat, [], locate(cat, []), {
      config: { ...config, language: 'es' },
      superLive: true,
    }),
  );
  assert.equal(states.status, 'Super live');
});

test('without a usable position, the zone states are left as they were', () => {
  const lost = parseTracker({
    ...rawCat,
    position: [{ ...rawCat.position[0], latitude: 0, longitude: 0 }],
  });
  const location = locate(lost, catZones, new Set(['200001']));
  assert.equal(location.known, false);
  const states = statesOf(
    buildStates(gladys, lost, catZones, location, { config, superLive: false }),
  );
  assert.equal(states['in-zone'], undefined);
  assert.equal(states['zone-200001'], undefined);
  assert.equal(states.position, undefined);
});

test('distances and the zone border: no flapping on a noisy position', () => {
  assert.ok(
    Math.abs(
      distanceMeters({ latitude: 45, longitude: 4 }, { latitude: 45.001, longitude: 4 }) - 111.2,
    ) < 0.5,
  );
  const zone = { id: 'z', latitude: 45, longitude: 4, radius: 100 };
  const at = (meters, accuracy = 30) => ({
    latitude: 45 + meters / 111_195,
    longitude: 4,
    accuracy,
  });
  assert.deepEqual([...zonesContaining(at(90), [zone])], ['z']);
  assert.deepEqual([...zonesContaining(at(110), [zone])], [], 'outside when it was not inside');
  assert.deepEqual(
    [...zonesContaining(at(110), [zone], new Set(['z']))],
    ['z'],
    'still inside: margin',
  );
  assert.deepEqual(
    [...zonesContaining(at(140), [zone], new Set(['z']))],
    [],
    'out past the margin',
  );
  assert.deepEqual(
    [...zonesContaining(at(190, 5000), [zone], new Set(['z']))],
    ['z'],
    'margin capped at 100 m',
  );
  assert.deepEqual([...zonesContaining(at(201, 5000), [zone], new Set(['z']))], []);
});

test('the map link is an https OpenStreetMap link', () => {
  assert.equal(
    mapUrl({ latitude: 45.123456, longitude: 4.5 }),
    'https://www.openstreetmap.org/?mlat=45.12346&mlon=4.50000#map=17/45.12346/4.50000',
  );
});

test('the tracker id of an external id', () => {
  assert.equal(trackerIdOf(gladys, ids.device), '100001');
  assert.equal(trackerIdOf(gladys, ids.feature(FEATURE.BATTERY)), '100001');
  assert.equal(trackerIdOf(gladys, 'ext:other:tracker:1'), null);
  assert.equal(trackerIdOf(gladys, undefined), null);
});
