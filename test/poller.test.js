// -----------------------------------------------------------------------------
// The container refreshes by itself (Gladys#3198: the core does not poll a
// device created without should_poll, and keeps the poll fields of its
// creation). These tests run the real timer under mocked time: the states
// follow the Weenect account without a single onPoll from the core, the
// core's onPoll is only a fallback, and super live speeds the reads up.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAT, DOG, create, createWorld, settle } from './helpers/world.js';

async function setup(t, { config } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-15T09:00:00Z') });
  const world = await createWorld({ timers: true, clock: null, ...(config ? { config } : {}) });
  t.after(() => world.app.stop());
  return world;
}

async function tick(t, ms) {
  t.mock.timers.tick(ms);
  await settle();
}

test('the states follow the account without any onPoll from the core', async (t) => {
  const world = await setup(t);
  await create(world, CAT);
  const readsAtStart = world.cloud.reads();
  assert.equal(world.fake.lastState(`${CAT}:zone`), 'Maison');

  world.cloud.move('100001', { latitude: 45.01, longitude: 4.0 });
  await tick(t, 60_000);
  assert.equal(world.cloud.reads(), readsAtStart + 1, 'read once after one period');
  assert.equal(world.fake.lastState(`${CAT}:zone`), 'Hors zone');
  assert.equal(world.fake.lastState(`${CAT}:in-zone`), 0);

  await tick(t, 60_000);
  assert.equal(world.cloud.reads(), readsAtStart + 2);
  assert.equal(
    world.fake.requests.filter((r) => r.path === '/state' && r.status === 200).length,
    2,
    'the second cycle changed nothing: nothing sent',
  );
});

test('nothing is read while no tracker is added to Gladys', async (t) => {
  const world = await setup(t);
  const reads = world.cloud.reads();
  await tick(t, 5 * 60_000);
  assert.equal(world.cloud.reads(), reads);
  assert.equal(world.fake.states.length, 0);
});

test("the core's onPoll is a fallback: never a second read in the same period", async (t) => {
  const world = await setup(t);
  const device = await create(world, CAT);
  await tick(t, 60_000);
  const reads = world.cloud.reads();
  // The core polls every minute (and every device): already read.
  t.mock.timers.tick(10_000);
  assert.deepEqual(await world.fake.poll(device), { success: true });
  assert.deepEqual(await world.fake.poll(await create(world, DOG)), { success: true });
  assert.equal(world.cloud.reads(), reads);
  // The timer stalls: the core takes over, once a period.
  world.service.timers = false;
  world.service.schedule();
  t.mock.timers.tick(50_000);
  await world.fake.poll(device);
  assert.equal(world.cloud.reads(), reads + 1);
  t.mock.timers.tick(30_000);
  await world.fake.poll(device);
  assert.equal(world.cloud.reads(), reads + 1);
});

test('the refresh interval of the configuration sets the pace', async (t) => {
  const world = await setup(t, {
    config: { email: 'owner@example.com', password: 'Sésame-0uvre-toi', refresh_interval: '300' },
  });
  await create(world, CAT);
  const reads = world.cloud.reads();
  await tick(t, 240_000);
  assert.equal(world.cloud.reads(), reads);
  await tick(t, 60_000);
  assert.equal(world.cloud.reads(), reads + 1);
});

test('super live reads every 10 s for 5 minutes, then the usual pace again', async (t) => {
  const world = await setup(t);
  await create(world, CAT);
  await world.fake.sceneAction('activate_super_live', { tracker: CAT });
  assert.equal(world.fake.lastState(`${CAT}:status`), 'Super live');
  const reads = world.cloud.reads();
  await tick(t, 10_000);
  await tick(t, 10_000);
  await tick(t, 10_000);
  assert.equal(world.cloud.reads(), reads + 3);
  for (let i = 0; i < 30; i += 1) {
    await tick(t, 10_000);
  }
  assert.equal(world.fake.lastState(`${CAT}:status`), 'En ligne', 'over after 5 minutes');
  const after = world.cloud.reads();
  for (let i = 0; i < 18; i += 1) {
    await tick(t, 10_000);
  }
  assert.equal(world.cloud.reads(), after + 3, 'back to one read a minute');
});

test('the zones are read again every 30 minutes, not at every cycle', async (t) => {
  const world = await setup(t);
  await create(world, CAT);
  const zoneReads = () => world.cloud.calls.filter((c) => c.path.endsWith('/zones')).length;
  const start = zoneReads();
  for (let i = 0; i < 29; i += 1) {
    await tick(t, 60_000);
  }
  assert.equal(zoneReads(), start);
  await tick(t, 60_000);
  assert.equal(zoneReads(), start + 2, 'both trackers, once');
});

test('an unchanged value is sent again within 12 hours (heartbeat)', async (t) => {
  const world = await setup(t);
  await create(world, CAT);
  const batteries = () =>
    world.fake.states.filter((s) => s.device_feature_external_id === `${CAT}:battery`).length;
  assert.equal(batteries(), 1);
  for (let i = 0; i < 12 * 60; i += 1) {
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.ok(batteries() >= 2, 'the battery was sent again');
});
