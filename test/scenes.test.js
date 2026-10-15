// -----------------------------------------------------------------------------
// Scene triggers (a tracker enters or leaves a Weenect zone) and the super
// live scene action. The triggers add what the zone states cannot: one scene
// for any zone or any tracker, the zone and tracker names for a message, the
// map link.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAT, DOG, create, createCloud, createWorld, cycle, discovered } from './helpers/world.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const world = async (t, options) => {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
};

const HOME = { latitude: 45.0001, longitude: 4.0001 };
const AWAY = { latitude: 45.01, longitude: 4.0 };
const NEIGHBOURS = { latitude: 45.003, longitude: 4.0 };

test('the cat leaves home, then comes back: one event each, with the zone and the names', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  assert.deepEqual(w.fake.sceneEvents, [], 'no event at the first reading');

  w.cloud.move('100001', AWAY);
  await cycle(w);
  await cycle(w);
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'zone_exited',
      data: {
        tracker: CAT,
        zone: 'Maison',
        tracker_name: 'Minou',
        battery: 82,
        map_url:
          'https://www.openstreetmap.org/?mlat=45.01000&mlon=4.00000#map=17/45.01000/4.00000',
      },
    },
  ]);

  w.cloud.move('100001', NEIGHBOURS);
  await cycle(w);
  w.cloud.move('100001', HOME);
  await cycle(w);
  assert.deepEqual(
    w.fake.sceneEvents.slice(1).map((e) => [e.key, e.data.zone]),
    [
      ['zone_entered', 'Jardin des voisins'],
      ['zone_exited', 'Jardin des voisins'],
      ['zone_entered', 'Maison'],
    ],
  );
});

test('a position wobbling on the border does not fire again and again', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  // 100 m radius: 95 m, 108 m, 96 m, 112 m from the centre, accuracy 30 m.
  for (const meters of [95, 108, 96, 112]) {
    w.cloud.move('100001', { latitude: 45 + meters / 111_195, longitude: 4, radius: 30 });
    await cycle(w);
  }
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('a zone left while the container was stopped still fires, from what Gladys stored', async (t) => {
  const first = await world(t);
  const device = discovered(first, CAT);
  first.app.stop();
  // Gladys kept "in Maison" as the last value of the zone features.
  const stored = {
    ...device,
    features: device.features.map((f) => ({
      ...f,
      last_value: f.external_id.endsWith(':zone-200001')
        ? 1
        : f.external_id.includes(':zone-')
          ? 0
          : null,
    })),
  };
  const cloud = createCloud();
  cloud.move('100001', AWAY);
  const w = await world(t, { cloud, devices: [stored] });
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => [e.key, e.data.zone]),
    [['zone_exited', 'Maison']],
  );
});

test('every trigger key fired is declared, with its fields and variables', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  w.cloud.move('100001', AWAY);
  await cycle(w);
  w.cloud.move('100001', HOME);
  await cycle(w);
  const fired = new Set(w.fake.sceneEvents.map((e) => e.key));
  assert.deepEqual([...fired].sort(), manifest.scene_triggers.map((tr) => tr.key).sort());
  for (const event of w.fake.sceneEvents) {
    const trigger = manifest.scene_triggers.find((tr) => tr.key === event.key);
    for (const key of [...trigger.fields, ...trigger.variables].map((f) => f.key)) {
      assert.ok(key in event.data, `${event.key}: "${key}" is in the event data`);
    }
    assert.equal(event.data.tracker, CAT, 'the tracker filter matches the device select value');
  }
});

test('super live is a scene action: started on the chosen tracker, never on its own', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  await create(w, DOG);
  for (let i = 0; i < 10; i += 1) {
    w.cloud.move('100001', i % 2 ? AWAY : HOME);
    await cycle(w);
  }
  assert.equal(
    w.cloud.commands.filter((c) => c.command === 'st-mode').length,
    0,
    'zone changes never start it',
  );
  const ack = await w.fake.sceneAction('activate_super_live', { tracker: DOG });
  assert.deepEqual(ack, { success: true });
  assert.deepEqual(w.cloud.commands, [{ tracker: '100002', command: 'st-mode' }]);
  assert.equal(w.fake.lastState(`${DOG}:status`), 'Super live');
});

test('super live on a tracker that is gone fails that action with a readable reason', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('activate_super_live', {
    tracker: 'ext:test-integration:tracker:424242',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /no longer on the Weenect account/);
});
