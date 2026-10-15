// -----------------------------------------------------------------------------
// Probe of the real Weenect API, for a machine with network access (the
// development sessions cannot reach apiv4.weenect.com).
//
//   node scripts/probe.mjs
//       Logs in with a made-up account: checks that the API answers where the
//       client expects it, and how it refuses a wrong password (status, shape).
//
//   WEENECT_EMAIL=... WEENECT_PASSWORD=... node scripts/probe.mjs
//       With a real account: also reads the trackers and their zones, and
//       prints their SHAPE only (field names, enum values, counts).
//
// Read-only: no command is sent (no ring, no vibration, no super live), no
// file is written. Nothing sensitive is printed: no e-mail, password, token,
// name, id, coordinate, phone number nor address — only counts, field names
// and the values of technical enums (tracker type, tracking mode...).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { API_BASE_URL, ERROR_KINDS, WeenectClient, WeenectError } from '../src/weenect.js';
import { parseTracker, parseZone } from '../src/tracker.js';

const email =
  process.env.WEENECT_EMAIL || `gladys-probe-${randomBytes(4).toString('hex')}@example.com`;
const password = process.env.WEENECT_PASSWORD || randomBytes(12).toString('base64url');
const realAccount = Boolean(process.env.WEENECT_EMAIL && process.env.WEENECT_PASSWORD);

const say = (...args) => console.log(...args);
const keys = (value) =>
  value && typeof value === 'object' ? Object.keys(value).sort().join(', ') : typeof value;

// A session that lives in memory only.
const memorySession = {
  saved: null,
  async load() {
    return this.saved;
  },
  async save(_email, token, expiresAt) {
    this.saved = { token, expiresAt };
  },
  async clear() {
    this.saved = null;
  },
};

async function rawLogin() {
  // The same request as the client, to see the refusal as it comes.
  const response = await fetch(new URL('user/login', API_BASE_URL), {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Origin: 'https://my.weenect.com',
      'User-Agent': 'gladys-weenect-probe',
      'x-app-type': 'userspace',
      'x-app-user-id': '',
      'x-app-version': '0.1.0',
    },
    body: JSON.stringify({ username: email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body,
    length: text.length,
  };
}

say(`API: ${API_BASE_URL}`);
say(
  `Account: ${realAccount ? 'real (from WEENECT_EMAIL / WEENECT_PASSWORD)' : 'made-up, a refusal is expected'}`,
);

// 1. The login, raw.
try {
  const login = await rawLogin();
  say(
    `\n1. POST user/login -> HTTP ${login.status} (${login.type ?? 'no content type'}, ${login.length} bytes)`,
  );
  say(`   body fields: ${keys(login.body)}`);
  if (login.status !== 200 && login.body && typeof login.body === 'object') {
    for (const [key, value] of Object.entries(login.body)) {
      if (typeof value === 'string') {
        say(`   ${key}: "${value.replaceAll(email, '<e-mail>').slice(0, 120)}"`);
      }
    }
  }
  if (login.status === 200) {
    say(`   expires_in: ${login.body?.expires_in}`);
  }
} catch (err) {
  say(`\n1. POST user/login failed: ${err.name} ${err.cause?.code ?? err.message}`);
  process.exit(2);
}

// 2. The client's reading of the same answer.
const client = new WeenectClient({
  email,
  password,
  session: memorySession,
  userAgent: 'gladys-weenect-probe',
});
let trackers;
try {
  trackers = await client.getTrackers();
  say(`\n2. Client: logged in, GET mytracker -> ${trackers.length} tracker(s)`);
} catch (err) {
  if (err instanceof WeenectError) {
    say(`\n2. Client: ${err.kind} (HTTP ${err.status ?? '-'}) "${err.message}"`);
    if (!realAccount) {
      const expected = err.kind === ERROR_KINDS.CREDENTIALS;
      say(
        expected
          ? '   OK: the made-up account is refused as wrong credentials.'
          : '   UNEXPECTED: a wrong password should be a credentials error.',
      );
      process.exit(expected ? 0 : 1);
    }
  } else {
    say(`\n2. Client: ${err.name} ${err.message}`);
  }
  process.exit(1);
}

// 3. The shape of the trackers and zones (real account only).
const enums = (name, values) =>
  say(`   ${name}: ${[...new Set(values.map((v) => JSON.stringify(v)))].join(' | ')}`);
const raw = trackers;
say('\n3. Trackers');
say(`   tracker fields: ${keys(raw[0])}`);
enums(
  'type',
  raw.map((t) => t.type),
);
enums(
  'features',
  raw.map((t) => t.features),
);
enums(
  'freq_mode',
  raw.map((t) => t.freq_mode),
);
enums(
  'last_freq_mode',
  raw.map((t) => t.last_freq_mode),
);
enums(
  'sensor_mode',
  raw.map((t) => t.sensor_mode),
);
enums(
  'battery_threshold',
  raw.map((t) => t.battery_threshold),
);
enums(
  'has a position',
  raw.map((t) => Array.isArray(t.position) && t.position.length > 0),
);
const positions = raw.map((t) => t.position?.[0]).filter(Boolean);
if (positions.length > 0) {
  say(`   position fields: ${keys(positions[0])}`);
  enums(
    'position.type',
    positions.map((p) => p.type),
  );
  enums(
    'position.is_online',
    positions.map((p) => p.is_online),
  );
  enums(
    'position.valid_signal',
    positions.map((p) => p.valid_signal),
  );
  enums(
    'position.geofence_name is set',
    positions.map((p) => p.geofence_name !== null && p.geofence_name !== undefined),
  );
  enums(
    'position.radius (accuracy, m)',
    positions.map((p) => p.radius),
  );
  enums(
    'position dates parse',
    raw.map((t) => parseTracker(t).position?.at instanceof Date),
  );
}
for (const [index, tracker] of raw.entries()) {
  const parsed = parseTracker(tracker);
  const zones = await client.getZones(parsed.id);
  say(
    `   tracker #${index + 1}: ${zones.length} zone(s), ${zones.map(parseZone).filter(Boolean).length} usable`,
  );
  if (zones[0]) {
    say(`     zone fields: ${keys(zones[0])}`);
    enums(
      '     zone.mode',
      zones.map((z) => z.mode),
    );
    enums(
      '     zone.active',
      zones.map((z) => z.active),
    );
    enums(
      '     zone.distance (radius, m)',
      zones.map((z) => z.distance),
    );
  }
}
say('\nDone: read-only, nothing was sent to the trackers.');
