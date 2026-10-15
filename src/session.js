// -----------------------------------------------------------------------------
// The Weenect session token, kept under /data.
//
// The API answers a login with a JWT valid 24 hours. Keeping it across
// restarts spares a login at each start of the container (and the account
// lock a burst of logins could cause). The file holds the token and a hash of
// the account e-mail, never the e-mail nor the password: a token saved for
// another account is ignored. The rootfs is read-only: /data is the only
// writable place, and a session that cannot be saved stays in memory.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'weenect-session' });

const FILE_NAME = 'weenect-session.json';

/** A short, one-way fingerprint of the account (the e-mail is never stored). */
export function accountKey(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 16);
}

export class SessionStore {
  /** @param {string} [dir] where to keep the file (DATA_DIR, /data by default) */
  constructor(dir = process.env.DATA_DIR || '/data') {
    this.path = join(dir, FILE_NAME);
    this.dir = dir;
    /** @type {{ account: string, token: string, expiresAt: number } | null | undefined} */
    this.cache = undefined;
  }

  /** The saved session of this account, or null. */
  async load(email) {
    if (this.cache === undefined) {
      try {
        const saved = JSON.parse(await readFile(this.path, 'utf8'));
        this.cache =
          typeof saved?.token === 'string' && Number.isFinite(saved?.expiresAt) ? saved : null;
      } catch {
        this.cache = null;
      }
    }
    return this.cache && this.cache.account === accountKey(email) ? this.cache : null;
  }

  /** Remember a session (on disk when /data is writable). */
  async save(email, token, expiresAt) {
    this.cache = { account: accountKey(email), token, expiresAt };
    await this.write(this.cache);
  }

  /** Forget the session (refused token, new account). */
  async clear() {
    this.cache = null;
    await this.write({});
  }

  async write(content) {
    try {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(content), { mode: 0o600 });
      await rename(tmp, this.path);
    } catch (err) {
      // Never fatal: the session lives on in memory.
      logger.debug(`Session not saved under ${this.dir} (${err.code ?? err.message})`);
    }
  }
}
