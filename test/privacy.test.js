// -----------------------------------------------------------------------------
// The position is sensitive. In the "Zones only" mode, the coordinates are
// read from Weenect to compute the zones and never leave the container: no
// state, no widget link, no scene variable, no log line (at any level). In
// every mode, no log line carries a coordinate, the e-mail, the password or
// the token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAT, CREDENTIALS, DOG, captureLogs, create, createWorld, cycle } from './helpers/world.js';

const ZONES_ONLY = { ...CREDENTIALS, privacy: 'zones_only' };
// Every way a coordinate of the fixtures or of the moves could be written.
const COORDINATE = /45[.,]0\d{2}|4[.,]0[0-9]{2,}|45\.01\b|4\.03\b/;

async function journey(t, config) {
  const w = await createWorld({ config });
  t.after(() => w.app.stop());
  await create(w, CAT);
  await create(w, DOG);
  w.cloud.move('100001', { latitude: 45.01, longitude: 4.0 });
  await cycle(w);
  w.cloud.move('100001', { latitude: 45.0001, longitude: 4.0001 });
  await cycle(w);
  return w;
}

test('zones only: no coordinate reaches Gladys, the zones still work', async (t) => {
  const w = await journey(t, ZONES_ONLY);
  const received = JSON.stringify({
    states: w.fake.states,
    devices: w.fake.discoveredDevices,
    events: w.fake.sceneEvents,
    list: await w.fake.widgetGet('trackers', { settings: {}, language: 'fr' }),
    one: await w.fake.widgetGet('trackers', { settings: { tracker: CAT }, language: 'fr' }),
  });
  assert.doesNotMatch(received, COORDINATE);
  assert.doesNotMatch(received, /openstreetmap/);
  assert.equal(w.fake.lastState(`${CAT}:position`), 'Masquée');
  assert.equal(w.fake.lastState(`${CAT}:zone`), 'Maison');
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => [e.key, e.data.zone, e.data.map_url]),
    [
      ['zone_exited', 'Maison', null],
      ['zone_entered', 'Maison', null],
    ],
  );
});

test('switching to zones only overwrites the coordinates Gladys kept', async (t) => {
  const w = await journey(t, CREDENTIALS);
  assert.match(w.fake.lastState(`${CAT}:position`), /^45\.00010, 4\.00010$/);
  assert.match(JSON.stringify(w.fake.states), COORDINATE, 'the guard does see coordinates');
  await w.fake.configUpdated(ZONES_ONLY);
  assert.equal(w.fake.lastState(`${CAT}:position`), 'Masquée');
  assert.equal(w.fake.lastState(`${DOG}:position`), 'Masquée');
});

for (const config of [CREDENTIALS, ZONES_ONLY]) {
  test(`no coordinate nor secret in the logs, even in debug (${config.privacy ?? 'full'})`, async (t) => {
    const lines = captureLogs(t, 'debug');
    const w = await journey(t, config);
    await w.fake.action('test_connection', {});
    await w.fake.widgetAction('trackers', 'ring', { tracker: '100001' }, { settings: {} });
    w.cloud.failure = 'network';
    await cycle(w);
    w.cloud.failure = null;
    w.cloud.validTokens.clear();
    await cycle(w);
    w.cloud.password = 'changed';
    w.cloud.validTokens.clear();
    await w.fake.action('test_connection', {});
    assert.ok(lines.length > 10, 'debug shows the cycles');
    const all = lines.map((line) => line.text).join('\n');
    assert.doesNotMatch(all, COORDINATE);
    for (const secret of [CREDENTIALS.email, CREDENTIALS.password, 'eyJ0eXAi', 'JWT ']) {
      assert.ok(!all.includes(secret), `"${secret}" is not logged`);
    }
  });
}
