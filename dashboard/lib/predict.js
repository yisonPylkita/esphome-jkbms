// SPDX-License-Identifier: MIT
//
// Battery runtime prediction — pure functions, testable from Node. Included
// in the browser at deploy time by scripts/minify-html.py.

const POWER_DEAD_W = 5;        // idle threshold (W)

// Linear projection. Sustained 1 h mean power is treated as the constant
// forward rate. Returns when the pack would hit empty (0 %) or full (100 %)
// at that rate, or null if the rate is below the idle threshold or input
// is invalid. Direction is determined by the sign of avgPowerW.
//
// `now` defaults to Date.now() for production use; tests can pin it.
function predictLinear(socPct, capacityFullWh, avgPowerW, now = Date.now()) {
  if (!Number.isFinite(socPct) || !Number.isFinite(capacityFullWh) || capacityFullWh <= 0) return null;
  if (!Number.isFinite(avgPowerW) || Math.abs(avgPowerW) < POWER_DEAD_W) return null;
  const energyWh = (socPct / 100) * capacityFullWh;
  let secs;
  let kind;
  if (avgPowerW < 0) {
    kind = 'empty';
    secs = (energyWh / Math.abs(avgPowerW)) * 3600;
  } else {
    kind = 'full';
    secs = ((capacityFullWh - energyWh) / avgPowerW) * 3600;
  }
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return { kind, when: new Date(now + secs * 1000) };
}

// Compact time format for the twin layout: big seg-digits show only the
// hh:mm; the day name lives in the small unit suffix beside it. `now`
// defaults to current wall clock; tests can pin it.
function fmtPredictionParts(d, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayKey = (x) => Math.floor((new Date(x.getFullYear(), x.getMonth(), x.getDate()) - startOfToday) / 86400000);
  const k = dayKey(d);
  const hhmm = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  let day;
  if      (k === 0) day = 'Dziś';
  else if (k === 1) day = 'Jutro';
  else if (k <= 6)  day = d.toLocaleDateString('pl-PL', { weekday: 'short' });
  else              day = d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  return { hhmm, day };
}

function roundToGrain(d, grainMin) {
  const ms = grainMin * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

if (typeof module !== 'undefined') module.exports = { POWER_DEAD_W, predictLinear, fmtPredictionParts, roundToGrain };
