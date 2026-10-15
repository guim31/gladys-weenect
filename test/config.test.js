import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isConfigured,
  normalizeConfig,
  refreshPeriodMs,
  sharesCoordinates,
} from '../src/config.js';

test('defaults: French, coordinates shared, one read a minute', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
  assert.equal(refreshPeriodMs(normalizeConfig()), 60_000);
  assert.equal(sharesCoordinates(normalizeConfig()), true);
  assert.equal(isConfigured(normalizeConfig()), false);
});

test('values outside the declared options fall back to the defaults', () => {
  const config = normalizeConfig({
    email: '  owner@example.com ',
    password: 'p',
    privacy: 'everything',
    refresh_interval: 5,
    language: 'it',
  });
  assert.equal(config.email, 'owner@example.com');
  assert.equal(config.privacy, 'full');
  assert.equal(config.refresh_interval, '60');
  assert.equal(config.language, 'fr');
  assert.equal(isConfigured(config), true);
});

test('a number from the form is accepted as its option', () => {
  assert.equal(normalizeConfig({ refresh_interval: 300 }).refresh_interval, '300');
  assert.equal(sharesCoordinates(normalizeConfig({ privacy: 'zones_only' })), false);
});
