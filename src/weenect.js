// -----------------------------------------------------------------------------
// Client of the Weenect cloud API (the one the my.weenect.com web app uses).
//
// The API is not documented publicly. The endpoints, headers and payloads come
// from the MIT-licensed `aioweenect` library by Kevin Eifinger (used by the
// Home Assistant `weenect` integration), still on apiv4.weenect.com/v4 in 2026:
//   POST user/login {username, password} -> { access_token, expires_in, ... }
//   GET  mytracker                        -> { items: [tracker], total }
//   GET  mytracker/<id>/zones             -> { items: [zone], total }
//   POST mytracker/<id>/ring | vibrate | position/refresh | st-mode
// Every authenticated call sends `Authorization: JWT <token>`; a 401 means the
// token expired: log in again, once.
//
// No error message carries a secret, an e-mail or a coordinate: only the
// endpoint and the HTTP status. The server's own wording is not kept either
// (it may repeat the e-mail of a refused login).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'weenect-api' });

export const API_BASE_URL = 'https://apiv4.weenect.com/v4/';
const APP_ORIGIN = 'https://my.weenect.com';
const REQUEST_TIMEOUT_MS = 15_000;
// A token is replaced 10 minutes before it expires, and kept 23 h when the
// login does not say how long it lasts.
const EXPIRY_MARGIN_MS = 10 * 60_000;
const DEFAULT_TOKEN_LIFETIME_MS = 23 * 3600_000;

/** Why a call failed: what the caller can do about it differs. */
export const ERROR_KINDS = {
  CREDENTIALS: 'credentials', // login refused: wrong e-mail or password
  RATE_LIMITED: 'rate_limited', // 429: slow down
  NETWORK: 'network', // no answer (DNS, timeout, connection)
  SERVER: 'server', // 5xx
  API: 'api', // another refusal (404 tracker, 403 subscription...)
};

export class WeenectError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message without any secret
   * @param {{ status?: number, retryAfterMs?: number }} [details]
   */
  constructor(kind, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'WeenectError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response) {
  const value = response.headers?.get?.('retry-after');
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export class WeenectClient {
  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {import('./session.js').SessionStore} options.session
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {string} [options.userAgent]
   */
  constructor({ email, password, session, fetch = globalThis.fetch, now = Date.now, userAgent }) {
    this.email = email;
    this.password = password;
    this.session = session;
    this.fetch = fetch;
    this.now = now;
    this.userAgent = userAgent ?? 'gladys-weenect';
    this.token = null;
    this.tokenExpiresAt = 0;
    /** One login at a time: concurrent calls wait for the same one. */
    this.loggingIn = null;
  }

  /** Log in and keep the token (memory and /data). */
  async login() {
    if (!this.loggingIn) {
      this.loggingIn = this.doLogin().finally(() => {
        this.loggingIn = null;
      });
    }
    return this.loggingIn;
  }

  async doLogin() {
    logger.debug('Logging in to Weenect');
    let body;
    try {
      body = await this.send('user/login', {
        method: 'POST',
        json: { username: this.email, password: this.password },
        authenticated: false,
      });
    } catch (err) {
      if (err instanceof WeenectError && [400, 401, 403].includes(err.status)) {
        throw new WeenectError(ERROR_KINDS.CREDENTIALS, 'Weenect refused the e-mail or password', {
          status: err.status,
        });
      }
      throw err;
    }
    const token = body?.access_token;
    if (typeof token !== 'string' || token === '') {
      throw new WeenectError(ERROR_KINDS.API, 'Weenect login answered without a token');
    }
    const lifetime =
      Number.isFinite(body.expires_in) && body.expires_in > 0
        ? body.expires_in * 1000
        : DEFAULT_TOKEN_LIFETIME_MS;
    this.token = token;
    this.tokenExpiresAt = this.now() + lifetime - EXPIRY_MARGIN_MS;
    await this.session?.save(this.email, this.token, this.tokenExpiresAt);
  }

  /** A valid token: the one in memory, the one saved under /data, or a new login. */
  async ensureToken() {
    if (this.token && this.now() < this.tokenExpiresAt) {
      return;
    }
    const saved = await this.session?.load(this.email);
    if (saved && this.now() < saved.expiresAt) {
      this.token = saved.token;
      this.tokenExpiresAt = saved.expiresAt;
      return;
    }
    await this.login();
  }

  /** An authenticated call; logs in again once when the token is refused. */
  async request(path, options = {}) {
    await this.ensureToken();
    try {
      return await this.send(path, options);
    } catch (err) {
      if (err instanceof WeenectError && err.status === 401) {
        logger.debug(`Token refused on ${path}: logging in again`);
        this.token = null;
        await this.session?.clear();
        await this.login();
        return this.send(path, options);
      }
      throw err;
    }
  }

  /** One HTTP exchange. */
  async send(path, { method = 'GET', json, authenticated = true } = {}) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      Origin: APP_ORIGIN,
      'User-Agent': this.userAgent,
      'x-app-type': 'userspace',
      'x-app-user-id': '',
      'x-app-version': '0.1.0',
    };
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      headers.Authorization = `JWT ${this.token}`;
    }
    let response;
    try {
      response = await this.fetch(new URL(path, API_BASE_URL), {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.name);
      throw new WeenectError(ERROR_KINDS.NETWORK, `Weenect unreachable (${reason})`);
    }
    if (response.status === 429) {
      throw new WeenectError(ERROR_KINDS.RATE_LIMITED, `Weenect rate limit on ${path} (HTTP 429)`, {
        status: 429,
        retryAfterMs: retryAfterMs(response),
      });
    }
    if (!response.ok) {
      const kind = response.status >= 500 ? ERROR_KINDS.SERVER : ERROR_KINDS.API;
      throw new WeenectError(kind, `Weenect refused ${method} ${path} (HTTP ${response.status})`, {
        status: response.status,
      });
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      // The commands answer plain text on some firmwares: nothing to read.
      return null;
    }
  }

  /** Every tracker of the account, with its last position. */
  async getTrackers() {
    const body = await this.request('mytracker');
    return Array.isArray(body?.items) ? body.items : [];
  }

  /** The zones (geofences) set up in the Weenect app for one tracker. */
  async getZones(trackerId) {
    const body = await this.request(`mytracker/${encodeURIComponent(trackerId)}/zones`);
    return Array.isArray(body?.items) ? body.items : [];
  }

  ring(trackerId) {
    return this.command(trackerId, 'ring');
  }

  vibrate(trackerId) {
    return this.command(trackerId, 'vibrate');
  }

  /** Ask the tracker for a new position now. */
  refreshPosition(trackerId) {
    return this.command(trackerId, 'position/refresh');
  }

  /** Super live: a position every few seconds for a few minutes (battery hungry). */
  activateSuperLive(trackerId) {
    return this.command(trackerId, 'st-mode');
  }

  async command(trackerId, action) {
    await this.request(`mytracker/${encodeURIComponent(trackerId)}/${action}`, { method: 'POST' });
  }
}
