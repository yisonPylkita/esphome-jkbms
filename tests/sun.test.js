// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { sunTimesFor, nightIntervals, WARSAW_LAT, WARSAW_LON } = require('../dashboard/lib/sun.js');

// Reference times from timeanddate.com for Warsaw (52.2297 N, 21.0122 E).
// Algorithm is approximate (no atmospheric refraction nuances) — we accept
// up to 20 minutes of drift, which is more than enough for chart shading.
const REF = [
  // [iso-noon-utc, expected-rise-utc-iso, expected-set-utc-iso]
  ['2026-01-01T12:00:00Z', '2026-01-01T06:46:00Z', '2026-01-01T14:33:00Z'],
  ['2026-05-10T12:00:00Z', '2026-05-10T02:50:00Z', '2026-05-10T18:33:00Z'],
  ['2026-06-21T12:00:00Z', '2026-06-21T02:14:00Z', '2026-06-21T19:01:00Z'],
  ['2026-12-21T12:00:00Z', '2026-12-21T06:43:00Z', '2026-12-21T14:25:00Z'],
];

test('sunTimesFor — Warsaw rise/set within 20 min of reference', () => {
  for (const [noon, ref_rise, ref_set] of REF) {
    const { sunrise, sunset } = sunTimesFor(new Date(noon), WARSAW_LAT, WARSAW_LON);
    const dRise = Math.abs(sunrise.getTime() - new Date(ref_rise).getTime()) / 60000;
    const dSet = Math.abs(sunset.getTime() - new Date(ref_set).getTime()) / 60000;
    assert.ok(dRise < 20, `${noon}: sunrise off by ${dRise.toFixed(1)} min`);
    assert.ok(dSet < 20, `${noon}: sunset  off by ${dSet.toFixed(1)} min`);
  }
});

test('sunTimesFor — sunrise is always before sunset on the same day', () => {
  for (const [noon] of REF) {
    const { sunrise, sunset } = sunTimesFor(new Date(noon), WARSAW_LAT, WARSAW_LON);
    assert.ok(sunrise < sunset, `${noon}: rise must precede set`);
  }
});

test('nightIntervals — 24 h window contains exactly one night', () => {
  const end = new Date('2026-05-10T12:00:00Z').getTime();
  const start = end - 24 * 3600 * 1000;
  const nights = nightIntervals(start, end, WARSAW_LAT, WARSAW_LON);
  assert.strictEqual(nights.length, 1, `expected 1 night, got ${nights.length}`);
  // Each night ends at sunrise, starts at sunset — must lie inside [start,end]
  for (const n of nights) {
    assert.ok(n.start >= start && n.start < end);
    assert.ok(n.end > start && n.end <= end);
    assert.ok(n.end > n.start);
  }
});

test('nightIntervals — 7 d window contains 7 night bands', () => {
  const end = new Date('2026-05-10T12:00:00Z').getTime();
  const start = end - 7 * 24 * 3600 * 1000;
  const nights = nightIntervals(start, end, WARSAW_LAT, WARSAW_LON);
  assert.strictEqual(nights.length, 7);
});

test('nightIntervals — 1 h window during day returns no nights', () => {
  // Midday Warsaw, May → fully daytime.
  const end = new Date('2026-05-10T12:00:00Z').getTime();
  const start = end - 3600 * 1000;
  const nights = nightIntervals(start, end, WARSAW_LAT, WARSAW_LON);
  assert.strictEqual(nights.length, 0);
});

test('nightIntervals — clipped to window bounds, no overflow', () => {
  const end = new Date('2026-05-10T12:00:00Z').getTime();
  const start = end - 24 * 3600 * 1000;
  for (const n of nightIntervals(start, end, WARSAW_LAT, WARSAW_LON)) {
    assert.ok(n.start >= start);
    assert.ok(n.end <= end);
  }
});
