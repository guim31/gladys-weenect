// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle
// (start, connection, a tracker going offline or coming back, Weenect lost
// and back, one line per user action), never a line per read cycle; a failure
// that repeats at every cycle is logged once, plus one line when it is over.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAT, DOG, captureLogs, create, createWorld, cycle } from './helpers/world.js';

async function worldWithTrackers(t) {
  const w = await createWorld();
  t.after(() => w.app.stop());
  await create(w, CAT);
  await create(w, DOG);
  return w;
}

const strip = (lines) => lines.map((line) => line.text.replace(/^\[[^\]]+\] /, ''));

test('a normal read cycle writes nothing at info', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 5; i += 1) {
    w.cloud.tracker(100001).position[0].battery -= 1;
    await cycle(w);
  }
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the cycles', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'debug');
  await cycle(w);
  await cycle(w);
  assert.equal(lines.filter((line) => /Read cycle: 2 tracker/.test(line.text)).length, 2);
});

test('Weenect lost at every cycle: one warning, then one line when it is back', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  w.cloud.failure = 'network';
  for (let i = 0; i < 4; i += 1) {
    await cycle(w);
  }
  w.cloud.failure = null;
  await cycle(w);
  await cycle(w);
  assert.deepEqual(strip(lines), [
    '[WARN] [weenect] Reading Weenect failed: Weenect unreachable (ECONNREFUSED)',
    '[INFO] [weenect] Weenect answers again',
  ]);
});

test('a tracker going offline and coming back is one info line each', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  w.cloud.tracker(100001).position[0].is_online = false;
  await cycle(w);
  await cycle(w);
  w.cloud.tracker(100001).position[0].is_online = true;
  await cycle(w);
  assert.deepEqual(strip(lines), [
    '[INFO] [weenect] Minou is offline',
    '[INFO] [weenect] Minou is back online',
  ]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 3; i += 1) {
    w.cloud.tracker(100001).position[0].battery -= 1;
    await cycle(w);
  }
  publish.mock.restore();
  await cycle(w);
  assert.deepEqual(strip(lines), [
    '[WARN] [weenect] Publishing the states failed: Gladys unreachable',
    '[INFO] [weenect] Publishing the states works again',
  ]);
});

test('a user action is one info line', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  await w.fake.widgetAction('trackers', 'ring', { tracker: '100001' }, { settings: {} });
  assert.deepEqual(strip(lines), ['[INFO] [weenect] Minou: ring requested']);
});

test('a moving tracker is not logged at info (its zones neither)', async (t) => {
  const w = await worldWithTrackers(t);
  const lines = captureLogs(t, 'info');
  w.cloud.move('100001', { latitude: 45.01, longitude: 4.0 });
  await cycle(w);
  assert.deepEqual(lines, []);
});
