// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, PRIVACY_MODES, REFRESH_INTERVALS } from '../src/config.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { TRIGGERS, WIDGET_KEY } from '../src/service.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (key) => manifest.config_schema.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('identity: name, image, cover, cloud transport, categories', () => {
  assert.equal(manifest.name, 'Weenect');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-weenect:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-weenect/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['security', 'services']);
  assert.equal(manifest.location, undefined, 'the house location is not needed');
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(handlerKeys('sceneAction:').sort(), keysOf(manifest.scene_actions).sort());
});

test('the scene triggers the code fires are the declared ones', () => {
  // Fired with their fields and variables: see test/scenes.test.js.
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
});

test('every widget has its handlers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widgetAction:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field('privacy')), PRIVACY_MODES);
  assert.deepEqual(optionValues(field('refresh_interval')), REFRESH_INTERVALS);
  assert.deepEqual(optionValues(field('language')), LANGUAGES);
  assert.equal(field('language').default, 'fr');
  assert.equal(field('password').type, 'secret');
});

test('no secret field in an action, a scene or a widget (unfillable there)', () => {
  const outsideConfig = allFields.filter((entry) => !manifest.config_schema.includes(entry));
  for (const entry of outsideConfig) {
    assert.notEqual(entry.type, 'secret', entry.key);
  }
  for (const action of manifest.actions) {
    // An action applies no default and requires the required fields (422).
    for (const entry of action.fields ?? []) {
      assert.ok(!(entry.required && entry.default !== undefined), `${action.key}.${entry.key}`);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.ok(dynamic.length >= 4);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('the trigger filters are filterable types (no boolean)', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const entry of trigger.fields) {
      assert.ok(['string', 'number', 'select', 'multi_select'].includes(entry.type), entry.key);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('field placeholders are multi-language objects', () => {
  for (const entry of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof entry.placeholder, 'object', `field "${entry.key}": placeholder`);
    assert.ok(entry.placeholder.en, `field "${entry.key}": placeholder needs an English text`);
  }
});

test('the configuration says the integration is not affiliated with Weenect', () => {
  const intro = manifest.config_schema.find((entry) => entry.type === 'section');
  assert.match(intro.description.en, /Not affiliated with Weenect/);
  assert.match(intro.description.fr, /non affiliée à Weenect/);
});
