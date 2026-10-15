// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the service, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { MESSAGES } from './i18n.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WeenectService } from './service.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'weenect-app' });

// An action displays what it resolves, in the user's language, while a thrown
// error shows a single string: the problems of the user's own setup (wrong
// password, tracker removed from the account) are answered, not thrown.
const answered =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.messages) {
        return err.messages;
      }
      throw err;
    }
  };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: session, fetch, timers, now, timings
 */
export function registerHandlers(gladys, options = {}) {
  const service = new WeenectService({ gladys, ...options });

  // Resolved once the service has started: every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): publish everything again.
        await service.resync(config);
        return;
      }
      started = true;
      await service.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => service.scan()));

  gladys.onSetValue(
    whenReady((device, feature, value) => service.setValue(device, feature, value)),
  );

  // The container refreshes by itself (src/service.js); this is the fallback.
  gladys.onPoll(whenReady((device) => service.pollFromCore(device)));

  gladys.onDeviceCreated(whenReady((device) => service.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await service.start(normalizeConfig(newConfig));
    }),
  );

  const actions = {
    test_connection: () => service.testConnection(),
  };
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, whenReady(answered(handler)));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady(async (fields) => {
        try {
          return await handler(service, { fields });
        } catch (err) {
          // A failed scene action shows one string in the scene logs.
          throw new Error(err.messages ? err.messages.en : err.message, { cause: err });
        }
      }),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(service, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady(
        answered((actionKey, params, context = {}) =>
          widget.action(service, { actionKey, params, ...context }),
        ),
      ),
    );
  }

  return {
    service,
    ready,
    stop: () => service.stop(),
  };
}
