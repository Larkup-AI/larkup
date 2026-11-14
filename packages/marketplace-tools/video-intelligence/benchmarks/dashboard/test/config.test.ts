import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMode } from '../lib/server/config.js';
test('unconfigured dashboards never default to illustrative scores', () => {
  assert.equal(parseMode(undefined), 'proxy');
  assert.equal(parseMode(''), 'proxy');
  assert.equal(parseMode('unknown'), 'proxy');
});
test('fixtures require explicit mock mode; offline remains real-data mode', () => {
  assert.equal(parseMode('mock'), 'mock');
  assert.equal(parseMode('offline'), 'offline');
  assert.equal(parseMode('proxy'), 'proxy');
});
