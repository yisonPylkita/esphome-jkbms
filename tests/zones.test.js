// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { socZone, tickFillColor } = require('../dashboard/lib/zones.js');

test('socZone — exact thresholds', () => {
  assert.strictEqual(socZone(0),    'low');
  assert.strictEqual(socZone(19.99),'low');
  assert.strictEqual(socZone(20),   'warn');
  assert.strictEqual(socZone(39.99),'warn');
  assert.strictEqual(socZone(40),   'mid');
  assert.strictEqual(socZone(69.99),'mid');
  assert.strictEqual(socZone(70),   'high');
  assert.strictEqual(socZone(100),  'high');
});

test('tickFillColor — same banding scaled to 0..1', () => {
  assert.strictEqual(tickFillColor(0.00), 'var(--bms-red)');
  assert.strictEqual(tickFillColor(0.19), 'var(--bms-red)');
  assert.strictEqual(tickFillColor(0.20), 'var(--bms-amber)');
  assert.strictEqual(tickFillColor(0.39), 'var(--bms-amber)');
  assert.strictEqual(tickFillColor(0.40), 'var(--bms-cyan)');
  assert.strictEqual(tickFillColor(0.69), 'var(--bms-cyan)');
  assert.strictEqual(tickFillColor(0.70), 'var(--bms-green)');
  assert.strictEqual(tickFillColor(1.00), 'var(--bms-green)');
});
