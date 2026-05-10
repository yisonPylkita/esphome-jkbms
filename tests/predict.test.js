// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const {
  POWER_DEAD_W,
  predictLinear,
  fmtPredictionParts,
  roundToGrain,
} = require('../dashboard/lib/predict.js');

const NOW = new Date('2026-05-10T12:00:00Z').getTime();

test('predictLinear — discharging projects to empty', () => {
  // 50 % of 14400 Wh = 7200 Wh. At -1000 W: 7200 / 1000 = 7.2 h = 25920 s.
  const r = predictLinear(50, 14400, -1000, NOW);
  assert.strictEqual(r.kind, 'empty');
  const expected = NOW + 25920 * 1000;
  assert.ok(Math.abs(r.when.getTime() - expected) < 1000);
});

test('predictLinear — charging projects to full', () => {
  // 50 % of 14400 Wh full = 7200 Wh remaining capacity. At +1000 W: 7.2 h.
  const r = predictLinear(50, 14400, 1000, NOW);
  assert.strictEqual(r.kind, 'full');
  const expected = NOW + 25920 * 1000;
  assert.ok(Math.abs(r.when.getTime() - expected) < 1000);
});

test('predictLinear — idle (|W| below dead-band) returns null', () => {
  assert.strictEqual(predictLinear(50, 14400,  POWER_DEAD_W - 0.1, NOW), null);
  assert.strictEqual(predictLinear(50, 14400, -POWER_DEAD_W + 0.1, NOW), null);
  assert.strictEqual(predictLinear(50, 14400, 0,                   NOW), null);
});

test('predictLinear — invalid inputs return null', () => {
  assert.strictEqual(predictLinear(NaN, 14400,  100, NOW), null);
  assert.strictEqual(predictLinear(50,  NaN,    100, NOW), null);
  assert.strictEqual(predictLinear(50,  -1,     100, NOW), null);
  assert.strictEqual(predictLinear(50,  0,      100, NOW), null);
  assert.strictEqual(predictLinear(50,  14400,  NaN, NOW), null);
});

test('predictLinear — at 100% charging or 0% discharging the maths is degenerate', () => {
  // Battery already full → no time to "full".
  assert.strictEqual(predictLinear(100, 14400,  500, NOW), null);
  // Battery already empty → no time to "empty".
  assert.strictEqual(predictLinear(0,   14400, -500, NOW), null);
});

test('fmtPredictionParts — same calendar day uses caller-supplied "today" label (default Polish)', () => {
  const now = new Date('2026-05-10T08:00:00');
  const target = new Date('2026-05-10T22:30:00');
  const parts = fmtPredictionParts(target, now);
  assert.strictEqual(parts.day, 'Dziś');
  assert.match(parts.hhmm, /\d{1,2}[:.]\d{2}/);
});

test('fmtPredictionParts — next calendar day uses caller-supplied "tomorrow" label', () => {
  const now = new Date('2026-05-10T22:00:00');
  const target = new Date('2026-05-11T07:15:00');
  assert.strictEqual(fmtPredictionParts(target, now).day, 'Jutro');
});

test('fmtPredictionParts — English locale + labels honoured via opts', () => {
  const now = new Date('2026-05-10T08:00:00');
  const target = new Date('2026-05-10T22:30:00');
  const parts = fmtPredictionParts(target, now, { locale: 'en-GB', today: 'Today', tomorrow: 'Tomorrow' });
  assert.strictEqual(parts.day, 'Today');
});

test('fmtPredictionParts — within a week = locale-derived weekday short (PL)', () => {
  const now = new Date('2026-05-10T08:00:00');         // Sunday
  const target = new Date('2026-05-13T08:00:00');      // Wednesday
  const day = fmtPredictionParts(target, now).day;
  assert.notStrictEqual(day, 'Dziś');
  assert.notStrictEqual(day, 'Jutro');
  assert.ok(day.length > 0 && day.length <= 8);        // pl weekday short e.g. "śr."
});

test('roundToGrain — snaps to nearest N-minute boundary', () => {
  const grain = 5;
  const base = new Date('2026-05-10T07:00:00Z').getTime();
  // 07:02 → 07:00, 07:03 → 07:05, 07:07 → 07:05, 07:08 → 07:10
  const cases = [
    [ 2, 0],
    [ 3, 5],
    [ 7, 5],
    [ 8,10],
  ];
  for (const [inMin, outMin] of cases) {
    const rounded = roundToGrain(new Date(base + inMin * 60 * 1000), grain);
    const offsetMin = (rounded.getTime() - base) / 60000;
    assert.strictEqual(offsetMin, outMin, `${inMin}m → expected ${outMin}m, got ${offsetMin}m`);
  }
});
