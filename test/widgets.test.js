// -----------------------------------------------------------------------------
// The "Weenect trackers" widget: every content is rendered as sent (the SDK's
// validateWidgetContent returns no problem: budget, vocabulary, bounds), its
// device-bound tile points to a feature the device really has, and its
// buttons reach the tracker.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import {
  CAT,
  CREDENTIALS,
  DOG,
  create,
  createCloud,
  createWorld,
  discovered,
} from './helpers/world.js';

const world = async (t, options) => {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
};

async function content(w, settings = {}, language = 'fr') {
  const ack = await w.fake.widgetGet('trackers', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const texts = (c) => JSON.stringify(c);

test('every content fits the core vocabulary and budget, in every language', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  await create(w, DOG);
  for (const language of LANGUAGES) {
    for (const settings of [{}, { tracker: CAT }, { tracker: DOG }]) {
      assert.deepEqual(
        validateWidgetContent(await content(w, settings, language)),
        [],
        `${language} ${JSON.stringify(settings)}`,
      );
    }
  }
});

test('the list: one row per tracker added to Gladys, zone, battery, map link', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  await create(w, DOG);
  const [list] = (await content(w)).components;
  assert.equal(list.type, 'card-list');
  const [minou, rex] = list.items;
  assert.equal(minou.title, 'Minou');
  assert.equal(minou.subtitle, 'Maison');
  assert.deepEqual(minou.badge, { text: '82 %', color: 'success' });
  assert.match(minou.links[0].url, /^https:\/\/www\.openstreetmap\.org\//);
  assert.match(minou.description, /Dernière position : 15\/10 08:29/);
  assert.equal(rex.subtitle, 'Hors zone · Hors ligne');
  assert.equal(rex.badge.color, 'danger', 'low battery');
});

test('one tracker: its live battery tile is a feature of its device', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  const c = await content(w, { tracker: CAT }, 'en');
  const featureIds = new Set(discovered(w, CAT).features.map((f) => f.external_id));
  const tiles = c.components.filter((component) => component.device_feature);
  assert.ok(tiles.length > 0);
  for (const tile of tiles) {
    assert.ok(featureIds.has(tile.device_feature), tile.device_feature);
  }
  const buttons = c.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.label),
    ['Map', 'Ring', 'Vibrate', 'Super live'],
  );
  assert.equal(buttons[3].action.confirm, true, 'super live asks first');
  // A button opening a form needs Gladys 5.2.0 (#3168): the manifest asks 5.1.0.
  assert.ok(buttons.every((b) => b.action?.fields === undefined));
  // Rex cannot ring: no ring button.
  const rex = await content(w, { tracker: DOG }, 'en');
  assert.ok(!rex.components.some((b) => b.action?.key === 'ring'));
});

test('the buttons ring, vibrate and start super live, with a toast', async (t) => {
  const w = await world(t);
  await create(w, CAT);
  const ring = await w.fake.widgetAction(
    'trackers',
    'ring',
    { tracker: '100001' },
    { settings: { tracker: CAT } },
  );
  assert.equal(ring.data.message.fr, 'Minou sonne.');
  await w.fake.widgetAction('trackers', 'vibrate', { tracker: '100001' }, { settings: {} });
  const live = await w.fake.widgetAction(
    'trackers',
    'super_live',
    { tracker: '100001' },
    { settings: {} },
  );
  assert.match(live.data.message.de, /Super-Live auf Minou/);
  assert.deepEqual(
    w.cloud.commands.map((c) => c.command),
    ['ring', 'vibrate', 'st-mode'],
  );
  const shown = await content(w, { tracker: CAT });
  assert.match(texts(shown), /check-circle/, 'super live running: shown by the icon');
  assert.equal(shown.ttl_seconds, 10);
});

test('the empty states say what to do', async (t) => {
  const notConfigured = await world(t, { config: {} });
  assert.match(texts(await content(notConfigured)), /e-mail et le mot de passe/);

  const none = await world(t);
  assert.match(texts(await content(none, {}, 'en')), /Add your trackers to Gladys first/);

  const cloud = createCloud();
  cloud.password = 'nope';
  const refused = await world(t, { cloud, config: CREDENTIALS });
  assert.match(texts(await content(refused, {}, 'es')), /Weenect rechaza/);

  const gone = await world(t);
  assert.match(
    texts(await content(gone, { tracker: 'ext:test-integration:tracker:1' })),
    /plus sur le compte/,
  );
});
