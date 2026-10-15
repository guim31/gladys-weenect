# Weenect for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows
**Weenect** GPS trackers — for cats, dogs, children and seniors: which zone they are in (home,
garden, school…), their battery and last position, and makes them ring or vibrate. The
equivalent of the Home Assistant community integration
[`hass-weenect`](https://github.com/eifinger/hass-weenect).

> **Developed without the hardware: feedback welcome.** The integration is covered by automated
> tests (real Weenect API answers published by `aioweenect`, anonymized, and the SDK's fake
> Gladys), but has not yet run against a real Weenect account nor in a real Gladys installation.
> Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-weenect/issues).
>
> Community project, **not affiliated with Weenect**. Weenect is a trademark of its owner.

## Features

- **One device per tracker**: **Position** (text, with its **accuracy** in metres and the time of
  the **last position**), **Battery** (%), **Low battery** (at the threshold set in the Weenect
  app), **Online**, **Status** (online, offline, super live), **In a zone**, **Current zone**, and
  one **Zone: …** presence feature per zone drawn in the Weenect app.
- **Commands** (push buttons, usable in scenes): **Ring**, **Vibrate** (when the model supports
  them), **Ask for a position**.
- **Scene triggers** _Weenect tracker enters a zone_ / _leaves a zone_ (the classic: the cat left
  the garden), filtered by tracker and zone name, with the tracker name, the zone, the battery and
  a map link as variables.
- **Scene action** _Start Weenect super live_: a position every few seconds for about 5 minutes.
  Battery hungry, so it is only ever started explicitly (a scene or the widget, with a
  confirmation), never by the integration nor through a device feature.
- **Dashboard widget** _Weenect trackers_: every tracker with its zone, battery and last position
  (map link), or one tracker with its buttons.
- **Privacy**: a "Zones only" mode where the coordinates never leave the container (zones are
  computed inside it); no coordinate, e-mail, password or token in the logs, at any level.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Weenect tracker with an active subscription, and the e-mail and password of the Weenect
  account (an account created through Google or Apple needs a password set first).
- Internet access from the Gladys machine (`apiv4.weenect.com`).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-weenect` (or install it from the catalog once it is listed).
2. In **Configuration**, enter the Weenect e-mail and password, choose the privacy mode and the
   refresh interval, then press **Test the connection**.
3. Open the **Discover** tab and press **Add to Gladys** on your trackers.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTPS (JWT)──▶ apiv4.weenect.com/v4  (the API of the Weenect web app)
      │ SDK (WebSocket + host API)        GET  mytracker               every refresh (whole account)
      ▼                                   GET  mytracker/<id>/zones    every 30 minutes per tracker
Gladys core                               POST mytracker/<id>/ring | vibrate | position/refresh | st-mode
```

- **One call per refresh** for the whole account (every tracker comes with its last position),
  every minute by default (30 s to 10 min), every 10 s during a super live started from Gladys.
  Weenect publishes no quota: 30 s is the fastest, like the Home Assistant integration. A `429`
  pauses the reads for its `Retry-After` (5 minutes by default); a refused password stops the
  logins until the configuration changes (a login loop could lock the account).
- **The container refreshes by itself** (Gladys#3198: the core cannot be trusted to poll); the
  devices are still published with `should_poll: true` every minute so that the core's `onPoll`
  takes over if the timer ever stalls. Only the changes are published, and every value again
  every 6 hours.
- **Zones**: the API lists the zones of a tracker (centre and radius) but not whether the tracker
  is in one. The container computes it from the last position, with a margin to leave a zone (the
  accuracy, 25 to 100 m) so that a position on the border does not flap.
- **Position on a map**: the map of Gladys 5.2 shows users, houses and Gladys zones only, not
  devices. The position is a text feature (no history kept by Gladys) and the map opens through
  an OpenStreetMap link.
- The Weenect session token (24 h) is kept in `/data/weenect-session.json` (mode 0600) with a
  hash of the e-mail, never the e-mail nor the password.

## Limitations

- **Developed without the hardware**: see above. The Weenect API is not public and may change.
- Gladys only knows about super live when it was started from Gladys; its length (about
  5 minutes) is an estimate.
- The zone computed by Gladys may differ by a few metres from the alerts of the Weenect app.
- Tracking mode, zones, SOS contacts and SOS button stay in the Weenect app.
- A new zone needs the **Update** button of the Discover tab to get its feature.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: the SDK's fake Gladys and a simulated Weenect cloud
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
node scripts/probe.mjs   # tries the real API with a fake account (read-only, see the script)
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → service, configuration action
src/service.js        reads, states, zone triggers, commands, refresh timer, connection status
src/weenect.js        Weenect API client (login, token, trackers, zones, commands)
src/session.js        session token under /data
src/tracker.js        Gladys device of a tracker (features, names, states)
src/geo.js            distances, zones, map link
src/scenes.js         scene action (super live)
src/widgets.js        dashboard widget
src/i18n.js           texts sent from the container, four languages
src/issues.js         repeated failures logged once
src/config.js         configuration defaults and normalization
scripts/probe.mjs     real-API probe for a machine with network access
```

Versions are published by the **Release** workflow (Actions → Release): never edit `version` by
hand.

## Credits

- [`aioweenect`](https://github.com/eifinger/aioweenect) (MIT, Kevin Eifinger): the endpoints,
  headers and payloads of the Weenect API; its test fixtures, anonymized, are the fixtures of this
  repository.
- [`hass-weenect`](https://github.com/eifinger/hass-weenect) (MIT, Kevin Stillhammer,
  @eifinger): what Home Assistant users expect from a Weenect integration (sensors, buttons, super
  live, 30-second refresh).
- [OpenStreetMap](https://www.openstreetmap.org) for the map links.

Not affiliated with Weenect, nor with Home Assistant.

## License

Apache-2.0, see [LICENSE](LICENSE).
