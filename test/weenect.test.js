// -----------------------------------------------------------------------------
// The Weenect API client, against the simulated cloud (real payloads of the
// aioweenect fixtures, anonymized): login, token kept under /data and reused,
// expired token, refused password, network failures. No error message
// carries the e-mail, the password or the token.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_BASE_URL, ERROR_KINDS, WeenectClient, WeenectError } from '../src/weenect.js';
import { SessionStore } from '../src/session.js';
import { CREDENTIALS, createClock, createCloud } from './helpers/world.js';

function setup({
  cloud = createCloud(),
  dir = mkdtempSync(join(tmpdir(), 'weenect-')),
  clock = createClock(),
} = {}) {
  const session = new SessionStore(dir);
  const client = new WeenectClient({ ...CREDENTIALS, session, fetch: cloud.fetch, now: clock.now });
  return { cloud, dir, clock, session, client };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected a rejection');
}

test('the API is the one aioweenect uses', () => {
  assert.equal(API_BASE_URL, 'https://apiv4.weenect.com/v4/');
});

test('logs in once, then reads the trackers with the JWT', async () => {
  const { cloud, client } = setup();
  const trackers = await client.getTrackers();
  assert.deepEqual(
    trackers.map((tracker) => tracker.name),
    ['Minou', 'Rex'],
  );
  await client.getZones('100001');
  assert.equal(cloud.logins(), 1);
  const [login, read] = cloud.calls;
  assert.equal(login.method, 'POST');
  assert.deepEqual(JSON.parse(login.body), {
    username: CREDENTIALS.email,
    password: CREDENTIALS.password,
  });
  assert.equal(login.headers.Origin, 'https://my.weenect.com');
  assert.equal(login.headers.Authorization, undefined, 'no token on the login');
  assert.match(read.headers.Authorization, /^JWT /);
});

test('the token is kept under /data without the e-mail nor the password, and reused', async () => {
  const { cloud, dir, client } = setup();
  await client.getTrackers();
  const file = join(dir, 'weenect-session.json');
  const content = readFileSync(file, 'utf8');
  assert.ok(!content.includes(CREDENTIALS.email));
  assert.ok(!content.includes(CREDENTIALS.password));
  assert.equal(statSync(file).mode & 0o777, 0o600);

  // A restart: a new client, the same /data.
  const again = setup({ cloud, dir });
  await again.client.getTrackers();
  assert.equal(cloud.logins(), 1, 'no new login after a restart');
});

test('a token saved for another account is ignored', async () => {
  const { cloud, dir, client } = setup();
  await client.getTrackers();
  const other = new WeenectClient({
    email: 'someone.else@example.com',
    password: CREDENTIALS.password,
    session: new SessionStore(dir),
    fetch: cloud.fetch,
  });
  await other.getTrackers();
  assert.equal(cloud.logins(), 2);
});

test('an expired token: logs in again, once, and retries', async () => {
  const { cloud, client, clock } = setup();
  await client.getTrackers();
  cloud.validTokens.clear(); // the server forgot it
  await client.getTrackers();
  assert.equal(cloud.logins(), 2);
  // Past its lifetime, the token is replaced before the call.
  clock.advance(24 * 3600_000);
  await client.getTrackers();
  assert.equal(cloud.logins(), 3);
  assert.equal(cloud.calls.filter((call) => call.path === 'mytracker').length, 4);
});

test('concurrent calls share one login', async () => {
  const { cloud, client } = setup();
  await Promise.all([client.getTrackers(), client.getZones('100001'), client.getZones('100002')]);
  assert.equal(cloud.logins(), 1);
});

test('a refused password is a credentials error that names nobody', async () => {
  const cloud = createCloud();
  cloud.password = 'another one';
  const { client } = setup({ cloud });
  const err = await rejection(client.getTrackers());
  assert.ok(err instanceof WeenectError);
  assert.equal(err.kind, ERROR_KINDS.CREDENTIALS);
  assert.ok(!err.message.includes(CREDENTIALS.email));
  assert.ok(!err.message.includes(CREDENTIALS.password));
});

test('network, server and rate-limit failures are told apart', async () => {
  const { cloud, client } = setup();
  cloud.failure = 'network';
  assert.equal((await rejection(client.getTrackers())).kind, ERROR_KINDS.NETWORK);
  cloud.failure = 'server';
  const server = await rejection(client.getTrackers());
  assert.equal(server.kind, ERROR_KINDS.SERVER);
  assert.equal(server.status, 502);
  cloud.failure = 'rate';
  const rate = await rejection(client.getTrackers());
  assert.equal(rate.kind, ERROR_KINDS.RATE_LIMITED);
  assert.equal(rate.retryAfterMs, 120_000);
});

test('the commands post to the endpoints of the Weenect app', async () => {
  const { cloud, client } = setup();
  await client.ring('100001');
  await client.vibrate('100001');
  await client.refreshPosition('100001');
  await client.activateSuperLive('100001');
  assert.deepEqual(
    cloud.commands.map((c) => c.command),
    ['ring', 'vibrate', 'position/refresh', 'st-mode'],
  );
  const err = await rejection(client.ring('999'));
  assert.equal(err.kind, ERROR_KINDS.API);
  assert.equal(err.status, 404);
});

test('a /data that cannot be written keeps the session in memory', async () => {
  const cloud = createCloud();
  // A path below a regular file: every write fails (ENOTDIR), like a read-only rootfs.
  const file = join(mkdtempSync(join(tmpdir(), 'weenect-')), 'file');
  writeFileSync(file, '');
  const session = new SessionStore(join(file, 'data'));
  const client = new WeenectClient({ ...CREDENTIALS, session, fetch: cloud.fetch });
  await client.getTrackers();
  await client.getTrackers();
  assert.equal(cloud.logins(), 1);
});
