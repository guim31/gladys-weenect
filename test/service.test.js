// -----------------------------------------------------------------------------
// The service end to end, on the SDK's fake Gladys and the simulated Weenect
// cloud: discovery, states when a tracker is added, commands, configuration
// changes, and the failures the user must be told about.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAT,
  CREDENTIALS,
  DOG,
  create,
  createCloud,
  createWorld,
  cycle,
  discovered,
} from './helpers/world.js';

const world = async (t, options) => {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
};

test('at start: connected, both trackers in the Discover tab, no state yet', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Minou', 'Rex'],
  );
  assert.equal(w.fake.states.length, 0, 'nothing added to Gladys yet');
});

test('a tracker added to Gladys gets all its states at once, and the widget is nudged', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  assert.equal(w.fake.lastState(`${CAT}:battery`), 82);
  assert.equal(w.fake.lastState(`${CAT}:zone`), 'Maison');
  assert.equal(w.fake.lastState(`${DOG}:battery`), undefined, 'Rex was not added');
  assert.ok(w.fake.widgetRefreshes.includes('trackers'));
  // Deleted and added again: everything is sent again (the SDK forgot it).
  const before = w.fake.states.length;
  await w.fake.deviceCreated(discovered(w, CAT));
  assert.ok(w.fake.states.length - before >= 10);
});

test('not configured: says so, reads nothing', async (t) => {
  const cloud = createCloud();
  const w = await world(t, { config: {}, cloud });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /e-mail et le mot de passe/);
  assert.equal(cloud.calls.length, 0);
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Enter the e-mail/);
});

test('a refused password: told once, no new login until the configuration changes', async (t) => {
  const cloud = createCloud();
  cloud.password = 'changed in the app';
  const w = await world(t, { cloud });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /refused the e-mail or password/);
  const logins = cloud.logins();
  for (let i = 0; i < 5; i += 1) {
    await cycle(w);
    await w.service.refresh({ force: true });
  }
  assert.equal(cloud.logins(), logins, 'no login loop that could lock the account');

  // The user types the new password.
  await w.fake.configUpdated({ ...CREDENTIALS, password: 'changed in the app' });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(cloud.logins(), logins + 1);
});

test('"Test the connection" answers with the trackers found', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Connecté à Weenect : 2 traceur(s) (Minou, Rex).');
  w.cloud.password = 'wrong';
  w.cloud.validTokens.clear();
  const refused = await w.fake.action('test_connection', {});
  assert.match(refused.data.message.de, /Weenect lehnt die E-Mail oder das Passwort ab/);
});

test('Weenect unreachable: the status says so, then comes back', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  w.cloud.failure = 'network';
  await cycle(w);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /injoignable/);
  w.cloud.failure = null;
  await cycle(w);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a rate limit pauses the reads for the time Weenect asks', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  w.cloud.failure = 'rate';
  await cycle(w);
  assert.match(w.fake.connectionStatus.message.en, /slow down/);
  w.cloud.failure = null;
  const calls = w.cloud.calls.length;
  await cycle(w, 60_000);
  assert.equal(w.cloud.calls.length, calls, 'paused (Retry-After: 120 s)');
  await cycle(w, 61_000);
  assert.ok(w.cloud.calls.length > calls);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the buttons of the device ring, vibrate and ask for a position', async (t) => {
  const w = await world(t);
  const device = await create(w, CAT);
  const feature = (key) => device.features.find((f) => f.external_id === `${CAT}:${key}`);
  assert.deepEqual(await w.fake.setValue(device, feature('ring'), 1), { success: true });
  assert.deepEqual(await w.fake.setValue(device, feature('vibrate'), 1), { success: true });
  assert.deepEqual(await w.fake.setValue(device, feature('refresh'), 1), { success: true });
  assert.deepEqual(await w.fake.setValue(device, feature('ring'), 0), { success: true });
  assert.deepEqual(
    w.cloud.commands.map((c) => c.command),
    ['ring', 'vibrate', 'position/refresh'],
  );
  const battery = await w.fake.setValue(device, feature('battery'), 1);
  assert.equal(battery.success, false);
});

test('a command refused by Weenect fails with a readable message', async (t) => {
  const w = await world(t);
  const device = await create(w, CAT);
  w.cloud.failure = 'server';
  const ack = await w.fake.setValue(
    device,
    device.features.find((f) => f.external_id === `${CAT}:ring`),
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /Weenect refused the command/);
});

test('a zone added in the Weenect app: the device is published again with it', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  w.cloud.zones[100001].push({
    ...w.cloud.zones[100001][0],
    id: 200009,
    name: 'École',
    latitude: 45.05,
    longitude: 4.05,
  });
  await w.fake.scanRequest();
  const cat = discovered(w, CAT);
  assert.ok(cat.features.some((f) => f.external_id === `${CAT}:zone-200009`));
});

test('a tracker removed from the account disappears from the Discover tab', async (t) => {
  const w = await world(t);
  await create(w, DOG);
  w.cloud.trackers = w.cloud.trackers.filter((tracker) => tracker.id !== 100002);
  await cycle(w);
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Minou'],
  );
  const ack = await w.fake.widgetAction(
    'trackers',
    'vibrate',
    { tracker: '100002' },
    { settings: {} },
  );
  assert.match(ack.data.message.fr, /plus sur le compte/);
});

test('a reconnection publishes everything again', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  await w.gladys.disconnect();
  const before = w.fake.states.length;
  await w.gladys.connect();
  assert.ok(w.fake.states.length - before >= 10, 'every state sent again');
  assert.equal(w.fake.discoveredDevices.length, 2);
});

test('feature names follow the language of the configuration', async (t) => {
  const w = await world(t, { config: { ...CREDENTIALS, language: 'es' } });
  const cat = discovered(w, CAT);
  assert.equal(cat.features.find((f) => f.external_id === `${CAT}:battery`).name, 'Batería');
  assert.equal(
    cat.features.find((f) => f.external_id === `${CAT}:zone-200001`).name,
    'Zona: Maison',
  );
});
