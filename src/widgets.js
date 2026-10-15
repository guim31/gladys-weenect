// -----------------------------------------------------------------------------
// The "Weenect trackers" dashboard widget (Gladys 5.1+).
//
// Without a setting, it lists every tracker added to Gladys: zone, battery,
// last position; a tap opens the details and the map link. With one tracker
// chosen in its settings, it shows that tracker with its buttons: map, ring,
// vibrate and super live (asks for a confirmation: it drains the battery).
//
// Budget of the core: 8 components, 2 texts at most. Content pulled by the
// core, cached per (settings, language, units): the texts are localized here
// from the request language. The coordinates only appear in the map link, and
// only in the `full` privacy mode.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from './config.js';
import { MESSAGES, REPORTS, TEXT, formatDate, pick } from './i18n.js';
import { FEATURE } from './tracker.js';
import { WIDGET_KEY } from './service.js';

const TTL_SECONDS = 60;
// A list shows 8 rows at most.
const MAX_ITEMS = 8;

/** Widget action keys: unique within a content. */
export const WIDGET_ACTIONS = { RING: 'ring', VIBRATE: 'vibrate', SUPER_LIVE: 'super_live' };

const languageOf = (request, config) =>
  LANGUAGES.includes(request?.language) ? request.language : (config?.language ?? 'fr');

const batteryColor = (view) =>
  view.battery === null
    ? WIDGET_COLORS.NEUTRAL
    : view.batteryLow
      ? WIDGET_COLORS.DANGER
      : view.battery <= 40
        ? WIDGET_COLORS.WARNING
        : WIDGET_COLORS.SUCCESS;

function zoneText(view, language) {
  if (!view.zoneKnown) {
    return pick(TEXT.unknown, language);
  }
  return view.zone ?? pick(TEXT.outside, language);
}

function statusText(view, language) {
  if (view.superLive) {
    return pick(TEXT.superLive, language);
  }
  return pick(view.online ? TEXT.online : TEXT.offline, language);
}

/** "Zone : Maison" in French, "Zone: Home" elsewhere. */
const labelled = (label, value, language) => `${label}${language === 'fr' ? ' : ' : ': '}${value}`;

const message = (text) => ({ ttl_seconds: TTL_SECONDS, components: [{ type: 'text', text }] });

/** The list of every tracker added to Gladys. */
export function buildListContent(views, language) {
  if (views.length === 0) {
    return message(pick(MESSAGES.noDevice, language));
  }
  return {
    ttl_seconds: TTL_SECONDS,
    components: [
      {
        type: 'card-list',
        display: 'list',
        items: views.slice(0, MAX_ITEMS).map((view) => {
          const lines = [
            labelled(pick(TEXT.zone, language), zoneText(view, language), language),
            labelled(pick(TEXT.status, language), statusText(view, language), language),
          ];
          if (view.at) {
            lines.push(
              labelled(pick(TEXT.lastPosition, language), formatDate(view.at, language), language),
            );
          }
          if (view.accuracy !== null) {
            const meters = Math.round(view.accuracy);
            lines.push(
              labelled(
                pick(TEXT.accuracy, language),
                REPORTS.accuracy[language]({ meters }),
                language,
              ),
            );
          }
          const item = {
            title: view.name,
            subtitle: view.online
              ? zoneText(view, language)
              : `${zoneText(view, language)} · ${pick(TEXT.offline, language)}`,
            description: lines.join('\n'),
          };
          if (view.battery !== null) {
            item.badge = { text: `${Math.round(view.battery)} %`, color: batteryColor(view) };
          }
          if (view.mapUrl) {
            item.links = [{ url: view.mapUrl, label: pick(TEXT.map, language) }];
          }
          return item;
        }),
      },
    ],
  };
}

/** One tracker, with its buttons. */
export function buildTrackerContent(view, language) {
  const rows = [
    { label: pick(TEXT.zone, language), value: zoneText(view, language), icon: 'map-pin' },
    {
      label: pick(TEXT.status, language),
      value: statusText(view, language),
      color: view.online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  ];
  if (view.at) {
    rows.push({
      label: pick(TEXT.lastPosition, language),
      value: formatDate(view.at, language),
      icon: 'clock',
    });
  }
  if (view.accuracy !== null) {
    rows.push({
      label: pick(TEXT.accuracy, language),
      value: REPORTS.accuracy[language]({ meters: Math.round(view.accuracy) }),
      icon: 'crosshair',
    });
  }
  const components = [
    { type: 'text', variant: 'heading', text: view.name },
    {
      type: 'value',
      label: pick(TEXT.battery, language),
      icon: 'battery',
      device_feature: `${view.externalId}:${FEATURE.BATTERY}`,
    },
    { type: 'status', items: rows },
  ];
  if (view.mapUrl) {
    components.push({
      type: 'button',
      label: pick(TEXT.map, language),
      icon: 'map',
      style: 'secondary',
      link: { url: view.mapUrl },
    });
  }
  if (view.canRing) {
    components.push({
      type: 'button',
      label: pick(TEXT.ring, language),
      icon: 'bell',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.RING, params: { tracker: view.id } },
    });
  }
  if (view.canVibrate) {
    components.push({
      type: 'button',
      label: pick(TEXT.vibrate, language),
      icon: 'smartphone',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.VIBRATE, params: { tracker: view.id } },
    });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.superLiveButton, language),
    icon: view.superLive ? 'check-circle' : 'zap',
    style: 'danger',
    action: { key: WIDGET_ACTIONS.SUPER_LIVE, params: { tracker: view.id }, confirm: true },
  });
  return { ttl_seconds: view.superLive ? 10 : TTL_SECONDS, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    /** @param {import('./service.js').WeenectService} service */
    async get(service, request = {}) {
      const language = languageOf(request, service.config);
      await service.ensureData();
      const problem = service.messageFor(language);
      if (problem && service.trackers.size === 0) {
        return message(problem);
      }
      const chosen = request.settings?.tracker;
      if (chosen) {
        const view = service.view(service.trackerIdOf(chosen), language);
        return view
          ? buildTrackerContent(view, language)
          : message(pick(MESSAGES.trackerGone, language));
      }
      if (service.trackers.size === 0) {
        return message(
          pick(service.lastReadAt === null ? MESSAGES.waiting : MESSAGES.noTracker, language),
        );
      }
      return buildListContent(service.views(language), language);
    },

    /** A button of the content: the tracker id comes from the params the content declared. */
    async action(service, { actionKey, params = {} }) {
      switch (actionKey) {
        case WIDGET_ACTIONS.RING:
          return service.ring(params.tracker);
        case WIDGET_ACTIONS.VIBRATE:
          return service.vibrate(params.tracker);
        case WIDGET_ACTIONS.SUPER_LIVE:
          return service.startSuperLive(params.tracker);
        default:
          throw new Error(`Unknown widget action ${actionKey}`);
      }
    },
  },
};
