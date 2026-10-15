// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated Weenect cloud
// (answering the real fixtures, anonymized), a manual clock, a temporary
// /data, and the integration wired on top through registerHandlers.
// Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { SessionStore } from '../../src/session.js';

process.env.LOG_LEVEL ??= 'silent';
// The dates are formatted in the Gladys time zone (TZ, set by the supervisor).
process.env.TZ = 'UTC';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/weenect/${name}`, import.meta.url), 'utf8'));

/** Prefix the SDK fake puts in front of every external id. */
export const ID_PREFIX = 'ext:test-integration:';
export const CAT_ID = '100001';
export const DOG_ID = '100002';
export const CAT = `${ID_PREFIX}tracker:${CAT_ID}`;
export const DOG = `${ID_PREFIX}tracker:${DOG_ID}`;

export const CREDENTIALS = { email: 'owner@example.com', password: 'Sésame-0uvre-toi' };
export const TOKEN = fixture('login.json').access_token;

/**
 * A simulated Weenect cloud, as a `fetch` stub. Mutable: move a tracker,
 * break the network, refuse the password, expire the token.
 */
export function createCloud() {
  const cloud = {
    trackers: structuredClone(fixture('trackers.json').items),
    zones: {
      100001: structuredClone(fixture('zones-100001.json').items),
      100002: structuredClone(fixture('zones-100002.json').items),
    },
    password: CREDENTIALS.password,
    validTokens: new Set(),
    tokenCount: 0,
    /** 'network' | 'server' | 'rate' | null */
    failure: null,
    calls: [],
    commands: [],
    tracker(id) {
      return cloud.trackers.find((tracker) => String(tracker.id) === String(id));
    },
    /** Move a tracker (a new position, dated now). */
    move(id, { latitude, longitude, radius = 12, at = '2026-10-15T09:00:00+00:00' }) {
      Object.assign(cloud.tracker(id).position[0], {
        latitude,
        longitude,
        radius,
        date_tracker: at,
        date_server: at,
      });
    },
    reads: () => cloud.calls.filter((call) => call.path === 'mytracker').length,
    logins: () => cloud.calls.filter((call) => call.path === 'user/login').length,

    async fetch(url, init = {}) {
      const path = new URL(url).pathname.replace(/^\/v4\//, '');
      const method = init.method ?? 'GET';
      cloud.calls.push({ path, method, headers: init.headers, body: init.body });
      if (cloud.failure === 'network') {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const answer = (status, body, headers = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
      });
      if (cloud.failure === 'server') {
        return answer(502, { error: 'Bad gateway' });
      }
      if (cloud.failure === 'rate') {
        return answer(429, { error: 'Too many requests' }, { 'retry-after': '120' });
      }
      if (path === 'user/login' && method === 'POST') {
        const body = JSON.parse(init.body);
        if (body.password !== cloud.password) {
          // The server repeats the e-mail: the integration must not.
          return answer(401, { error: `Invalid credentials for ${body.username}` });
        }
        cloud.tokenCount += 1;
        const token = `${TOKEN}-${cloud.tokenCount}`;
        cloud.validTokens.add(token);
        return answer(200, { ...fixture('login.json'), access_token: token });
      }
      const auth = init.headers?.Authorization ?? '';
      if (!cloud.validTokens.has(auth.replace(/^JWT /, ''))) {
        return answer(401, { error: 'Invalid token' });
      }
      if (path === 'mytracker' && method === 'GET') {
        return answer(200, {
          items: structuredClone(cloud.trackers),
          total: cloud.trackers.length,
        });
      }
      const zones = path.match(/^mytracker\/(\d+)\/zones$/);
      if (zones && method === 'GET') {
        const items = cloud.zones[zones[1]] ?? [];
        return answer(200, { items: structuredClone(items), total: items.length });
      }
      const command = path.match(/^mytracker\/(\d+)\/(ring|vibrate|position\/refresh|st-mode)$/);
      if (command && method === 'POST') {
        if (!cloud.tracker(command[1])) {
          return answer(404, { error: 'Not found' });
        }
        cloud.commands.push({ tracker: command[1], command: command[2] });
        return answer(204);
      }
      return answer(404, { error: 'Not found' });
    },
  };
  cloud.fetch = cloud.fetch.bind(cloud);
  return cloud;
}

/** A manual clock. */
export function createClock(start = Date.parse('2026-10-15T09:00:00Z')) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (credentials by default)
 * @param {object} [options.cloud] from createCloud
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the service's own timer runs (mock the timers)
 * @param {string} [options.dataDir]
 * @param {object} [options.clock] from createClock; null: the real Date.now (mocked timers)
 */
export async function createWorld({
  config = CREDENTIALS,
  cloud = createCloud(),
  devices = [],
  connect = true,
  timers = false,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-weenect-')),
  clock = createClock(),
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const session = new SessionStore(dataDir);
  const app = registerHandlers(gladys, {
    session,
    fetch: cloud.fetch,
    timers,
    now: clock ? clock.now : undefined,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    app,
    service: app.service,
    cloud,
    clock,
    dataDir,
    session,
  };
}

/** The device published for a tracker, from the last discovery list. */
export const discovered = (world, externalId) =>
  world.fake.discoveredDevices.find((device) => device.external_id === externalId);

/** Add a tracker to Gladys, as the user would from the Discover tab. */
export async function create(world, externalId) {
  const device = discovered(world, externalId);
  if (!device) {
    throw new Error(`${externalId} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** Let the reads started by a fired timer run to their end. */
export async function settle() {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** One refresh cycle `ms` later, as the timer would run it. */
export async function cycle(world, ms = 60_000) {
  world.clock.advance(ms);
  await world.service.tick();
}

/**
 * Capture what the integration writes to the console at a level and above
 * (the SDK loggers read LOG_LEVEL at each line).
 */
export function captureLogs(t, level) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  for (const stream of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, stream, (...args) => {
      const text = args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ');
      const match = text.match(/\[(DEBUG|INFO|WARN|ERROR)\]/);
      lines.push({ level: match ? match[1].toLowerCase() : stream, text });
    });
  }
  return lines;
}
