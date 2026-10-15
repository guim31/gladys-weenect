// -----------------------------------------------------------------------------
// The Weenect service: reads the account, publishes the devices and their
// states, fires the zone scene triggers and runs the commands.
//
// One API call (GET mytracker) returns every tracker with its last position,
// so a refresh cycle is one call for the whole account, plus one call per
// tracker every 30 minutes for its zones (they change rarely).
//
// Refresh pace (Gladys#3198: the core cannot be trusted to poll): the
// container reads the account by itself every `refresh_interval`, and every
// 10 s while a super live started from Gladys runs. The core's onPoll is a
// fallback that only reads when the timer has not for 90 % of a period. The
// timer only reads while at least one tracker is added to Gladys: the core
// drops the states of a device it does not know.
//
// Privacy: the coordinates are read, used to compute the zones, and published
// only in the `full` mode. They are never logged, at any level.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { createHash } from 'node:crypto';
import { isConfigured, refreshPeriodMs, sharesCoordinates } from './config.js';
import { mapUrl } from './geo.js';
import { MESSAGES, REPORTS, report, pick } from './i18n.js';
import { createIssueLog } from './issues.js';
import { SessionStore } from './session.js';
import {
  COMMANDS,
  DEVICE_TYPE,
  FEATURE,
  buildDevice,
  buildStates,
  locate,
  parseTracker,
  parseZone,
  trackerIdOf,
  zoneFeatureKey,
} from './tracker.js';
import { ERROR_KINDS, WeenectClient, WeenectError } from './weenect.js';

const logger = createLogger({ name: 'weenect' });

/** Scene trigger keys: published, never renamed. */
export const TRIGGERS = { ZONE_ENTERED: 'zone_entered', ZONE_EXITED: 'zone_exited' };
/** Widget key: published, never renamed. */
export const WIDGET_KEY = 'trackers';

export const TIMINGS = {
  // The zones are read again past this age.
  zonesMaxAgeMs: 30 * 60_000,
  // Weenect's super live sends positions for about 5 minutes.
  superLiveMs: 5 * 60_000,
  superLivePeriodMs: 10_000,
  // A 429 without Retry-After pauses the reads this long.
  rateLimitPauseMs: 5 * 60_000,
  // Unchanged values are sent again this often (Gladys says "no recent
  // value" past 48 h).
  heartbeatMs: 6 * 3600_000,
};

const secretFingerprint = (config) =>
  createHash('sha256').update(`${config.email}\n${config.password}`).digest('hex');

/** A command or a read refused by the user's own setup: answered, not thrown. */
export class UserFacingError extends Error {
  constructor(messages) {
    super(messages.en);
    this.messages = messages;
  }
}

export class WeenectService {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {SessionStore} [options.session]
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers] run the refresh timer
   * @param {() => number} [options.now]
   * @param {object} [options.timings]
   */
  constructor({ gladys, session, fetch, timers = true, now = Date.now, timings = {} }) {
    this.gladys = gladys;
    this.session = session ?? new SessionStore();
    this.fetchImpl = fetch;
    this.timers = timers;
    this.now = now;
    this.timings = { ...TIMINGS, ...timings };
    this.issues = createIssueLog(logger);
    this.config = null;
    this.client = null;
    this.resetData();
    this.timer = null;
    this.stopped = true;
    this.inFlight = null;
    this.lastReadAt = null;
    this.pausedUntil = 0;
    this.blockedCredentials = null;
    this.status = null;
    this.discoverySignature = null;
  }

  resetData() {
    /** @type {Map<string, ReturnType<typeof parseTracker>>} */
    this.trackers = new Map();
    /** @type {Map<string, { zones: Array, at: number }>} */
    this.zones = new Map();
    /** Zones each tracker was in at the last reading. */
    this.inside = new Map();
    /** Last known online flag, for the lifecycle log lines. */
    this.online = new Map();
    /** Super live started from Gladys, until when. */
    this.superLiveUntil = new Map();
  }

  // --- Lifecycle --------------------------------------------------------------

  /** First start, or a new configuration: read everything, publish, then run the timer. */
  async start(config) {
    const accountChanged =
      !this.config ||
      this.config.email !== config.email ||
      this.config.password !== config.password;
    this.config = config;
    this.stopped = false;
    if (accountChanged) {
      this.resetData();
      this.discoverySignature = null;
      this.blockedCredentials = null;
      this.pausedUntil = 0;
      this.client = isConfigured(config)
        ? new WeenectClient({
            email: config.email,
            password: config.password,
            session: this.session,
            fetch: this.fetchImpl,
            now: this.now,
          })
        : null;
    }
    if (!this.client) {
      logger.info('Not configured yet: waiting for the Weenect e-mail and password');
      await this.setStatus(false, MESSAGES.notConfigured);
      this.schedule();
      return;
    }
    await this.refresh({ force: true, zones: true });
    await this.publishDiscovered();
    this.schedule();
  }

  /** Gladys came back (reconnection): publish everything again. */
  async resync(config) {
    this.status = null;
    this.discoverySignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.start(config);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  // --- Timer --------------------------------------------------------------------

  superLiveRunning(trackerId) {
    const until = this.superLiveUntil.get(trackerId);
    if (until === undefined) {
      return false;
    }
    if (this.now() < until) {
      return true;
    }
    this.superLiveUntil.delete(trackerId);
    return false;
  }

  /** Forget the super lives that are over; true when one just ended. */
  expireSuperLive() {
    let ended = false;
    for (const id of [...this.superLiveUntil.keys()]) {
      ended = !this.superLiveRunning(id) || ended;
    }
    return ended;
  }

  /** The current period: faster while a super live runs. */
  periodMs() {
    const anySuperLive = [...this.superLiveUntil.keys()].some((id) => this.superLiveRunning(id));
    return anySuperLive ? this.timings.superLivePeriodMs : refreshPeriodMs(this.config);
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timers || this.stopped) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.tick();
      } finally {
        this.schedule();
      }
    }, this.periodMs());
  }

  /** One timer tick: read the account, unless the core's poll just did. */
  async tick() {
    if (this.expireSuperLive()) {
      // The status goes back to online now, not at the next read.
      await this.publishStates();
    }
    if (!this.hasCreatedTrackers()) {
      logger.debug('No tracker added to Gladys yet: nothing to refresh');
      return;
    }
    await this.refresh({ minGap: 0.5 });
  }

  /** The core's onPoll (fallback): reads only when the timer has not for 90 % of a period. */
  async pollFromCore(device) {
    if (trackerIdOf(this.gladys, device.external_id) === null) {
      logger.debug(`onPoll ignored for ${device.external_id}`);
      return;
    }
    await this.refresh({ minGap: 0.9 });
  }

  hasCreatedTrackers() {
    return this.createdTrackerIds().size > 0;
  }

  createdTrackerIds() {
    const ids = new Set();
    for (const device of this.gladys.devices ?? []) {
      const id = trackerIdOf(this.gladys, device.external_id);
      if (id !== null) {
        ids.add(id);
      }
    }
    return ids;
  }

  // --- Reading ------------------------------------------------------------------

  /**
   * Read the account and publish what changed. Never throws: a failure is
   * logged once while it lasts and reported in the connection status.
   * @param {{ force?: boolean, zones?: boolean, minGap?: number }} [options]
   * @returns {Promise<boolean>} the account was read
   */
  async refresh({ force = false, zones = false, minGap = 0 } = {}) {
    if (this.inFlight) {
      if (!force) {
        return this.inFlight;
      }
      await this.inFlight.catch(() => {});
    }
    if (!this.client || this.stopped) {
      return false;
    }
    if (this.blockedCredentials === secretFingerprint(this.config)) {
      logger.debug('Credentials refused earlier: waiting for a new configuration');
      return false;
    }
    if (!force && this.now() < this.pausedUntil) {
      logger.debug('Weenect asked to slow down: read postponed');
      return false;
    }
    if (
      !force &&
      this.lastReadAt !== null &&
      this.now() - this.lastReadAt < this.periodMs() * minGap
    ) {
      logger.debug(`Read ${this.now() - this.lastReadAt} ms ago: skipped`);
      return false;
    }
    this.lastReadAt = this.now();
    this.inFlight = this.read({ zones }).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async read({ zones: forceZones }) {
    let raw;
    try {
      raw = await this.client.getTrackers();
    } catch (err) {
      await this.onReadError(err);
      return false;
    }
    const first = this.trackers.size === 0 && this.status !== true;
    const trackers = new Map(raw.map((item) => [String(item.id), parseTracker(item)]));
    this.trackers = trackers;
    for (const tracker of trackers.values()) {
      await this.readZones(tracker, forceZones);
    }
    for (const id of [...this.zones.keys()]) {
      if (!trackers.has(id)) {
        this.zones.delete(id);
      }
    }
    if (this.issues.isFailing('read')) {
      this.issues.ok('read', 'Weenect answers again');
    } else if (first) {
      logger.info(`Connected to Weenect: ${trackers.size} tracker(s)`);
    }
    logger.debug(`Read cycle: ${trackers.size} tracker(s)`);
    await this.setStatus(true);
    await this.publishDiscoveredIfChanged();
    await this.publishStates();
    return true;
  }

  async readZones(tracker, force) {
    const known = this.zones.get(tracker.id);
    if (!force && known && this.now() - known.at < this.timings.zonesMaxAgeMs) {
      return;
    }
    try {
      const zones = (await this.client.getZones(tracker.id)).map(parseZone).filter(Boolean);
      this.zones.set(tracker.id, { zones, at: this.now() });
      this.issues.ok(`zones:${tracker.id}`, `Zones of ${tracker.name} read again`);
    } catch (err) {
      // The last known zones stay in use; tried again at the next cycle.
      this.issues.fail(
        `zones:${tracker.id}`,
        `Reading the zones of ${tracker.name} failed: ${err.message}`,
      );
      if (known) {
        known.at = this.now() - this.timings.zonesMaxAgeMs;
      }
    }
  }

  zonesOf(trackerId) {
    return this.zones.get(trackerId)?.zones ?? [];
  }

  async onReadError(err) {
    if (!(err instanceof WeenectError)) {
      this.issues.fail('read', `Reading Weenect failed: ${err.message}`);
      return;
    }
    if (err.kind === ERROR_KINDS.CREDENTIALS) {
      // No new attempt with the same credentials: a loop of refused logins
      // could lock the account.
      this.blockedCredentials = secretFingerprint(this.config);
      logger.error(
        'Weenect refused the e-mail or password: no new attempt until the configuration changes',
      );
      await this.setStatus(false, MESSAGES.credentialsRefused);
      return;
    }
    if (err.kind === ERROR_KINDS.RATE_LIMITED) {
      this.pausedUntil = this.now() + (err.retryAfterMs ?? this.timings.rateLimitPauseMs);
      this.issues.fail('read', `Weenect asked to slow down: reads paused (${err.message})`);
      await this.setStatus(false, MESSAGES.rateLimited);
      return;
    }
    this.issues.fail('read', `Reading Weenect failed: ${err.message}`);
    await this.setStatus(false, MESSAGES.unreachable);
  }

  async setStatus(connected, message) {
    const key = connected ? true : JSON.stringify(message);
    if (this.status === key) {
      return;
    }
    this.status = key;
    try {
      await this.gladys.setConnectionStatus(connected, connected ? undefined : message);
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  // --- Publishing -------------------------------------------------------------

  buildDevices() {
    return [...this.trackers.values()].map((tracker) =>
      buildDevice(this.gladys, tracker, this.zonesOf(tracker.id), this.config.language),
    );
  }

  /** Publish the discovered devices (the Discover tab). */
  async publishDiscovered() {
    if (!this.client || this.trackers.size === 0) {
      return;
    }
    const devices = this.buildDevices();
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoverySignature = JSON.stringify(devices);
      this.issues.ok('discovery', 'Publishing the devices works again');
    } catch (err) {
      this.issues.fail('discovery', `Publishing the devices failed: ${err.message}`);
    }
  }

  /** A tracker or a zone appeared, was renamed or removed: publish the list again. */
  async publishDiscoveredIfChanged() {
    if (this.discoverySignature === null) {
      return; // start() publishes once the first read is done
    }
    if (JSON.stringify(this.buildDevices()) !== this.discoverySignature) {
      logger.info('The trackers or their zones changed: devices published again');
      await this.publishDiscovered();
    }
  }

  /** States of the trackers added to Gladys, zone events, lifecycle lines. */
  async publishStates({ only } = {}) {
    const created = this.createdTrackerIds();
    const states = [];
    for (const tracker of this.trackers.values()) {
      const zones = this.zonesOf(tracker.id);
      const previous = this.previousInside(tracker.id, zones);
      const location = locate(tracker, zones, previous);
      if (location.known) {
        await this.fireZoneEvents(tracker, zones, previous, location.inside);
        this.inside.set(tracker.id, location.inside);
      }
      this.logOnlineChange(tracker);
      if (created.has(tracker.id) && (only === undefined || only === tracker.id)) {
        states.push(
          ...buildStates(this.gladys, tracker, zones, location, {
            config: this.config,
            superLive: this.superLiveRunning(tracker.id),
          }),
        );
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      this.issues.ok('states', 'Publishing the states works again');
      if (count > 0) {
        logger.debug(`${count} state(s) published`);
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      }
    } catch (err) {
      this.issues.fail('states', `Publishing the states failed: ${err.message}`);
    }
  }

  /**
   * The zones a tracker was in: the last reading, or after a restart what
   * Gladys last stored (so a zone left while the container was down still
   * fires its trigger), or nothing (first reading: no event).
   */
  previousInside(trackerId, zones) {
    if (this.inside.has(trackerId)) {
      return this.inside.get(trackerId);
    }
    const device = (this.gladys.devices ?? []).find(
      (d) => trackerIdOf(this.gladys, d.external_id) === trackerId,
    );
    if (!device || !Array.isArray(device.features)) {
      return undefined;
    }
    const ids = this.gladys.externalIds(DEVICE_TYPE, trackerId);
    const byId = new Map(device.features.map((f) => [f.external_id, f]));
    const stored = zones.filter((zone) => byId.has(ids.feature(zoneFeatureKey(zone.id))));
    if (
      stored.length === 0 ||
      stored.some((z) => !Number.isFinite(byId.get(ids.feature(zoneFeatureKey(z.id))).last_value))
    ) {
      return undefined;
    }
    return new Set(
      stored
        .filter((zone) => byId.get(ids.feature(zoneFeatureKey(zone.id))).last_value === 1)
        .map((zone) => zone.id),
    );
  }

  async fireZoneEvents(tracker, zones, previous, inside) {
    if (previous === undefined) {
      return;
    }
    const device = this.gladys.externalIds(DEVICE_TYPE, tracker.id).device;
    // The zones left first, then the zones entered: the order things happened.
    const changes = [
      ...zones.filter((zone) => previous.has(zone.id) && !inside.has(zone.id)),
      ...zones.filter((zone) => !previous.has(zone.id) && inside.has(zone.id)),
    ];
    for (const zone of changes) {
      const key = inside.has(zone.id) ? TRIGGERS.ZONE_ENTERED : TRIGGERS.ZONE_EXITED;
      logger.debug(`${tracker.name}: ${key} (zone ${zone.id})`);
      try {
        await this.gladys.publishSceneEvent(key, {
          tracker: device,
          zone: zone.name,
          tracker_name: tracker.name,
          battery: tracker.position?.battery ?? null,
          map_url:
            sharesCoordinates(this.config) && tracker.position?.valid
              ? mapUrl(tracker.position)
              : null,
        });
        this.issues.ok('events', 'Scene events are accepted again');
      } catch (err) {
        this.issues.fail('events', `A zone scene event was refused: ${err.message}`);
      }
    }
  }

  logOnlineChange(tracker) {
    const online = tracker.position?.online;
    if (online === null || online === undefined) {
      return;
    }
    const before = this.online.get(tracker.id);
    this.online.set(tracker.id, online);
    if (before !== undefined && before !== online) {
      logger.info(`${tracker.name} is ${online ? 'back online' : 'offline'}`);
    }
  }

  // --- Gladys events ------------------------------------------------------------

  /** The user added a tracker: send all its states now (the SDK forgot them). */
  async onDeviceCreated(device) {
    const id = trackerIdOf(this.gladys, device.external_id);
    if (id === null) {
      return;
    }
    if (this.trackers.size === 0 || this.lastReadAt === null) {
      await this.refresh({ force: true });
    }
    await this.publishStates({ only: id });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The Discover tab asks again: read the trackers and their zones now. */
  async scan() {
    await this.refresh({ force: true, zones: true });
    await this.publishDiscovered();
  }

  // --- Commands -----------------------------------------------------------------

  /** The tracker of a device external id or a Weenect id; throws a user-facing error. */
  async trackerFor(idOrExternalId) {
    const id =
      trackerIdOf(this.gladys, idOrExternalId) ?? (idOrExternalId ? String(idOrExternalId) : null);
    if (!this.client) {
      throw new UserFacingError(MESSAGES.notConfigured);
    }
    if (this.trackers.size === 0) {
      await this.refresh({ force: true });
    }
    const tracker = id === null ? undefined : this.trackers.get(id);
    if (!tracker) {
      throw new UserFacingError(MESSAGES.trackerGone);
    }
    return tracker;
  }

  async runCommand(tracker, method) {
    try {
      await this.client[method](tracker.id);
    } catch (err) {
      if (err instanceof WeenectError && err.kind === ERROR_KINDS.CREDENTIALS) {
        throw new UserFacingError(MESSAGES.credentialsRefused);
      }
      throw new UserFacingError(report(REPORTS.commandFailed, { reason: err.message }));
    }
  }

  /** A button feature pressed (dashboard, scene): ring, vibrate, ask for a position. */
  async setValue(device, feature, value) {
    const trackerId = trackerIdOf(this.gladys, device.external_id);
    const key = feature.external_id.slice(
      this.gladys.externalIds(DEVICE_TYPE, trackerId ?? '').device.length + 1,
    );
    const method = COMMANDS[key];
    if (!method) {
      throw new Error(`${feature.external_id} cannot be set`);
    }
    if (Number(value) !== 1) {
      return; // a push button only acts on 1
    }
    const tracker = await this.trackerFor(device.external_id);
    logger.info(`${tracker.name}: ${key} requested`);
    try {
      await this.runCommand(tracker, method);
    } catch (err) {
      throw new Error(err.messages ? err.messages.en : err.message, { cause: err });
    }
    if (key === FEATURE.REFRESH) {
      // The new position arrives within a minute: read sooner than usual.
      this.lastReadAt = null;
    }
  }

  async ring(idOrExternalId) {
    const tracker = await this.trackerFor(idOrExternalId);
    logger.info(`${tracker.name}: ring requested`);
    await this.runCommand(tracker, 'ring');
    return report(REPORTS.ringSent, { name: tracker.name });
  }

  async vibrate(idOrExternalId) {
    const tracker = await this.trackerFor(idOrExternalId);
    logger.info(`${tracker.name}: vibration requested`);
    await this.runCommand(tracker, 'vibrate');
    return report(REPORTS.vibrateSent, { name: tracker.name });
  }

  /** Super live: never started by the integration itself, only by a user or a scene. */
  async startSuperLive(idOrExternalId) {
    const tracker = await this.trackerFor(idOrExternalId);
    logger.info(`${tracker.name}: super live requested`);
    await this.runCommand(tracker, 'activateSuperLive');
    this.superLiveUntil.set(tracker.id, this.now() + this.timings.superLiveMs);
    await this.publishStates({ only: tracker.id });
    this.schedule(); // the faster pace starts now
    return report(REPORTS.superLiveStarted, { name: tracker.name });
  }

  /** "Test the connection" action: a real login and read, even after a refusal. */
  async testConnection() {
    if (!this.client) {
      return MESSAGES.notConfigured;
    }
    this.blockedCredentials = null;
    let trackers;
    try {
      await this.client.login();
      trackers = await this.client.getTrackers();
    } catch (err) {
      if (err instanceof WeenectError && err.kind === ERROR_KINDS.CREDENTIALS) {
        this.blockedCredentials = secretFingerprint(this.config);
        await this.setStatus(false, MESSAGES.credentialsRefused);
        return MESSAGES.credentialsRefused;
      }
      return report(REPORTS.failed, { reason: err.message });
    }
    logger.info(`Connection test: ${trackers.length} tracker(s)`);
    await this.refresh({ force: true, zones: true });
    await this.publishDiscovered();
    if (trackers.length === 0) {
      return MESSAGES.noTracker;
    }
    const names = trackers.map((t) => parseTracker(t).name).join(', ');
    return report(REPORTS.connected, { count: trackers.length, names });
  }

  // --- Views for the widget and the scenes ----------------------------------------

  /** What the widget shows of one tracker; the coordinates only in `full` mode. */
  view(trackerId, language) {
    const tracker = this.trackers.get(trackerId);
    if (!tracker) {
      return null;
    }
    const zones = this.zonesOf(trackerId);
    const inside = this.inside.get(trackerId);
    const current = zones
      .filter((zone) => inside?.has(zone.id))
      .sort((a, b) => a.radius - b.radius)[0];
    const position = tracker.position;
    return {
      id: tracker.id,
      externalId: this.gladys.externalIds(DEVICE_TYPE, tracker.id).device,
      name: tracker.name,
      zoneKnown: inside !== undefined,
      zone: current?.name ?? null,
      battery: position?.battery ?? null,
      batteryLow:
        position?.battery !== null && position?.battery !== undefined
          ? position.battery <= tracker.batteryThreshold
          : false,
      online: Boolean(position) && position.online !== false,
      superLive: this.superLiveRunning(tracker.id),
      at: position?.at ?? null,
      accuracy: position?.valid ? position.accuracy : null,
      mapUrl: sharesCoordinates(this.config) && position?.valid ? mapUrl(position) : null,
      canRing: tracker.capabilities === null || tracker.capabilities.has('ringing'),
      canVibrate: tracker.capabilities === null || tracker.capabilities.has('vibrate'),
      language,
    };
  }

  /** The trackers added to Gladys (all of them when none is yet), sorted by name. */
  views(language) {
    const created = this.createdTrackerIds();
    return [...this.trackers.values()]
      .filter((tracker) => created.has(tracker.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tracker) => this.view(tracker.id, language));
  }

  /** The widget needs data: read once if nothing was read yet. */
  async ensureData() {
    if (this.client && this.lastReadAt === null) {
      await this.refresh({ force: true });
    }
  }

  trackerIdOf(externalId) {
    return trackerIdOf(this.gladys, externalId);
  }

  get configured() {
    return Boolean(this.client);
  }

  get credentialsRefused() {
    return this.config !== null && this.blockedCredentials === secretFingerprint(this.config);
  }

  get unreachable() {
    return this.issues.isFailing('read');
  }

  messageFor(language) {
    if (!this.client) {
      return pick(MESSAGES.notConfigured, language);
    }
    if (this.credentialsRefused) {
      return pick(MESSAGES.credentialsRefused, language);
    }
    if (this.unreachable) {
      return pick(MESSAGES.unreachable, language);
    }
    return null;
  }
}
