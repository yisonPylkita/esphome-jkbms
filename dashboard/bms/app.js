// SPDX-License-Identifier: MIT
//
// BMS main dashboard — paired with `dashboard/bms/index.html`.
// Polls 1 Hz against the HA REST API for the JK PB BMS entities,
// drives the gauge / battery bar / topbar / power + prediction
// readout. Token is substituted at deploy time. Shared helpers
// (`t`, `applyI18n`, `predictLinear`, zone tables, etc.) come from
// `dashboard/lib/*.js`, inlined by `scripts/minify-html.py`.

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  const stamp = document.querySelector('.build-stamp');
  if (stamp) stamp.title = t('buildstamp.title', 'dashboard/bms-integrated.html');
});

// ============================================================
// CONFIG
// ============================================================
const HA_URL = '';
const TOKEN = 'PASTE_LONG_LIVED_ACCESS_TOKEN_HERE';
const E_SOC = 'sensor.jk_pb_bms_state_of_charge';
const E_VOLT = 'sensor.jk_pb_bms_total_voltage';
const E_POWER = 'sensor.jk_pb_bms_power';
const E_ONLINE = 'binary_sensor.jk_pb_bms_online_status';
const E_CAP_REM = 'sensor.jk_pb_bms_capacity_remaining';
const E_CAP_TOT = 'sensor.jk_pb_bms_total_battery_capacity';
const E_TEMPS = [
  'sensor.jk_pb_bms_power_tube_temperature',
  'sensor.jk_pb_bms_temperature_sensor_1',
  'sensor.jk_pb_bms_temperature_sensor_2',
  'sensor.jk_pb_bms_temperature_sensor_3',
  'sensor.jk_pb_bms_temperature_sensor_4',
  'sensor.jk_pb_bms_temperature_sensor_5',
];
const POLL_MS = 1000; // 1Hz per design spec
const STALE_MS = 15000;
// ============================================================

const isDemo = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);

// ---- Geometry helpers (mirror bms-gauges.jsx, but in viewBox 0..100 × 0..62) ----
// Gauge canvas is 100 × 62 (the visible band of a 100×100 design canvas
// after cropping the bottom 38%). cx = 50, cy = ~55% of original 100 = 55…
// but inside our 62-tall viewBox, that maps to y = 55 (still within view).
// Arc spans angle 180°→360° (left horizontal → right horizontal, top half).
const G = { cx: 50, cy: 55, r: 44, ticks: 56 };
const ARC_START = 180,
  ARC_END = 360;

function angleAt(t) {
  return ARC_START + (ARC_END - ARC_START) * t;
}
function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
// SOC banding helpers (tickFillColor, socZone) live in lib/zones.js;
// the runtime prediction helpers (predictLinear, fmtPredictionParts,
// roundToGrain, POWER_DEAD_W) live in lib/predict.js. Both are loaded
// via the <script src> tags below this inline script and inlined into
// the deployed HTML by scripts/minify-html.py.

// ---- Gauge — build the inner ring + 56 ticks once ----
function buildGauge() {
  const innerRing = $('gauge-inner');
  const ringR = G.r * 0.78;
  const [sx, sy] = polar(G.cx, G.cy, ringR, ARC_START);
  const [ex, ey] = polar(G.cx, G.cy, ringR, ARC_END);
  innerRing.setAttribute('d', `M ${sx} ${sy} A ${ringR} ${ringR} 0 0 1 ${ex} ${ey}`);

  const tg = $('gauge-ticks');
  for (let i = 0; i < G.ticks; i++) {
    const major = i % 5 === 0;
    const t = i / (G.ticks - 1);
    const a = angleAt(t);
    const len = major ? 8.5 : 6.0;
    const [x1, y1] = polar(G.cx, G.cy, G.r, a);
    const [x2, y2] = polar(G.cx, G.cy, G.r - len, a);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1.toFixed(2));
    line.setAttribute('y1', y1.toFixed(2));
    line.setAttribute('x2', x2.toFixed(2));
    line.setAttribute('y2', y2.toFixed(2));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-width', major ? 0.6 : 0.4);
    line.dataset.major = major ? '1' : '0';
    line.dataset.idx = String(i);
    line.dataset.colorOn = tickFillColor(t);
    tg.appendChild(line);
  }
}

function updateGauge(soc) {
  const active = Math.round((soc / 100) * G.ticks);
  const ticks = $('gauge-ticks').children;
  for (let i = 0; i < ticks.length; i++) {
    const on = i < active;
    ticks[i].setAttribute('stroke', on ? ticks[i].dataset.colorOn : 'rgba(56,200,255,0.32)');
  }
}

// ---- Battery bar — 12 cells, zone-tinted ----
const SEGMENTS = 12;
function buildBatteryBar() {
  const frame = $('battery-frame');
  frame.innerHTML = '';
  for (let i = 0; i < SEGMENTS; i++) {
    const c = document.createElement('div');
    c.className = 'battery-cell';
    c.dataset.idx = String(i);
    // each cell's "zone" by position — same 4-tier banding as the gauge
    const cellT = i / SEGMENTS;
    c.dataset.zone = cellT < 0.2 ? 'low' : cellT < 0.4 ? 'warn' : cellT < 0.7 ? 'mid' : 'high';
    frame.appendChild(c);
  }
}
function updateBatteryBar(soc) {
  const filled = Math.round((soc / 100) * SEGMENTS);
  const cells = $('battery-frame').children;
  for (let i = 0; i < cells.length; i++) {
    const on = i < filled;
    const z = cells[i].dataset.zone;
    cells[i].className = on ? `battery-cell on-${z}` : 'battery-cell';
  }
  const z = socZone(soc);
  $('battery-frame').className = `battery-frame ${z === 'mid' ? '' : z}`;
  $('battery-nub').className = `battery-nub ${z === 'mid' ? '' : z}`;
}

// ---- SOC readout (SVG text) — digits + ghost "88" backplate.
//      Zone colour: red < 20, amber 20-40, cyan 40-70, green ≥ 70.
let _lastSoc = NaN;
function updateSocReadout(soc) {
  _lastSoc = soc;
  const v = String(Math.max(0, Math.min(100, Math.round(soc))));
  const digits = $('soc-digits');
  const ghost = $('soc-ghost');
  digits.textContent = v;
  ghost.textContent = '8'.repeat(v.length);
  // DSEG7's "1" glyph fills only the right ~⅓ of its character cell —
  // it has empty advance to the LEFT of the strokes. text-anchor=middle
  // centres the *advance* box (including that empty space), so any
  // value with a leading "1" (1, 10..19, 100) reads visually shifted
  // right of the gauge axis. The geometric correction is the same
  // regardless of total digit count: the visible-ink centroid is
  // 0.325 × cell_width to the right of the advance centre, so we
  // shift by -0.325 × cell_width to bring it on-axis.
  // (Browsers' getBBox() on <text> returns the advance box, not the
  // ink box, so we can't measure dynamically — the offset is hardcoded
  // from the DSEG7 glyph metrics.)
  const ADVANCE_W = 12.5; // ≈ DSEG7 cell width at font-size=24 in viewBox units
  const ONE_INK_FRAC = 0.65; // empty advance to the LEFT of the "1" stroke (≈ 65% of cell)
  if (v[0] === '1') {
    const shift = (-ONE_INK_FRAC * ADVANCE_W) / 2;
    digits.setAttribute('transform', `translate(${shift} 0)`);
  } else {
    digits.removeAttribute('transform');
  }
  const z = socZone(soc);
  const colorClass =
    z === 'low' ? 'soc-red' : z === 'warn' ? 'soc-amber' : z === 'high' ? 'soc-green' : 'soc-cyan';
  digits.setAttribute('class', `soc-svg-text ${colorClass}`);
  ghost.setAttribute('class', `soc-svg-text soc-ghost ${z}`);
}

// ---- TopBar updates with color thresholds ----
function tempColorClass(t) {
  // <5 red, 5-10 amber, 10-30 cyan, >30 amber, >35 red
  if (isNaN(t)) return '';
  if (t < 5) return 'warn';
  if (t < 10) return 'alert';
  if (t > 35) return 'warn';
  if (t > 30) return 'alert';
  return '';
}
function voltageColorClass(v) {
  // 16S LFP: <48 red, 48-50 amber, 50-56 cyan, 56-58 amber, >58 red
  if (isNaN(v)) return '';
  if (v < 48) return 'warn';
  if (v < 50) return 'alert';
  if (v > 58) return 'warn';
  if (v > 56) return 'alert';
  return '';
}

// ---- Power readout. Three states: idle (cyan, |W| ≤ POWER_DEAD_W),
//      charging (green), discharging (red). Colour is the only
//      direction signal — no plus/minus sign. POWER_DEAD_W is defined
//      in lib/predict.js (= 5 W).
function updatePower(power) {
  const inner = $('power-row-inner');
  const num = $('power-num');
  const flowPath = $('flow-path');
  if (isNaN(power)) {
    inner.className = 'bottom-cell power idle';
    num.textContent = '---';
    return;
  }
  const w = Math.round(Math.abs(power));
  num.textContent = String(w);
  let state, flow;
  if (power > POWER_DEAD_W) {
    state = 'charging';
    flow = 'M3 11l5-5 5 5M3 7l5-5 5 5';
  } else if (power < -POWER_DEAD_W) {
    state = 'discharging';
    flow = 'M3 5l5 5 5-5M3 9l5 5 5-5';
  } else {
    state = 'idle';
    flow = 'M3 8h10';
  }
  inner.className = 'bottom-cell power ' + state;
  flowPath.setAttribute('d', flow);
}

// ============================================================
// BATTERY TIME PREDICTION — linear projection from the rolling 1-hour
// mean power. Daytime usage is irrelevant to "when will I run out at
// night" because PV is replenishing while the user freely consumes; at
// night the user organically moderates loads and the 1h mean reflects
// actual sustained draw. We deliberately do NOT use a multi-day hour-
// of-day pattern: it would be biased by daytime "free energy" behaviour
// that doesn't carry over once the sun is down.
// ============================================================
const PRED_AVG_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling mean
const _recentBuf = []; // ring of {t, p}

function pushRecent(p) {
  const now = Date.now();
  _recentBuf.push({ t: now, p });
  while (_recentBuf.length && now - _recentBuf[0].t > PRED_AVG_WINDOW_MS) _recentBuf.shift();
}
function recentAvg(windowMs) {
  const cutoff = Date.now() - windowMs;
  const recent = _recentBuf.filter((s) => s.t >= cutoff);
  if (!recent.length) return NaN;
  return recent.reduce((s, x) => s + x.p, 0) / recent.length;
}

// The 1h-mean rate jitters slightly each second, so the projected hh:mm
// wobbles ±1 min and the readout becomes flashy. Tame it two ways:
//  • Round the displayed minute to a 5-minute grain (roundToGrain in lib/predict.js).
//  • Throttle DOM updates to one per ~15 s — but force-refresh on
//    direction change (charging ↔ discharging) so the colour flip
//    is immediate.
const PRED_DOM_REFRESH_MS = 15 * 1000;
const PRED_TIME_GRAIN_MIN = 5;
// At ≥ 99 % SOC, any draw below this threshold is treated as the inverter's
// idle / parasitic baseline (not a real load). Projecting it out to "empty
// in 24 h" just confuses the reader — better to show "spoczynek" until a
// real load picks up.
const PRED_FULL_HOLD_W = 200;
let _lastPredOut = { ts: 0, dir: '', kind: '', big: '', sub: '', lbl: '' };

function updatePrediction(soc, capRemAh, capTotAh, voltV, signedPowerW) {
  const cell = $('prediction-cell');
  const label = $('pred-label');
  const time = $('pred-time');
  const day = $('pred-day');

  // Compute the desired output first; only commit to DOM if it actually
  // changed *and* enough time has passed (or direction flipped).
  let dir = '',
    kind = '',
    lbl = '—',
    big = '--:--',
    sub = '—';

  if (!Number.isFinite(soc) || !Number.isFinite(voltV)) {
    // leave defaults
  } else if (!Number.isFinite(signedPowerW) || Math.abs(signedPowerW) < POWER_DEAD_W) {
    dir = 'idle';
    lbl = t('bms.idle');
  } else if (soc >= 99 && Math.abs(signedPowerW) < PRED_FULL_HOLD_W) {
    // At ≥ 99 % SOC, a small residual draw (inverter idle, internal
    // consumption, balancing current) projects ~24 h into the future
    // and isn't actionable — the pack will just sit at "full" while
    // that trickle runs. Suppress the prediction; show plain idle.
    dir = 'idle';
    lbl = t('bms.idle');
  } else {
    let capacityFullWh = NaN;
    if (Number.isFinite(capTotAh) && capTotAh > 0) {
      capacityFullWh = capTotAh * voltV;
    } else if (Number.isFinite(capRemAh) && soc > 1) {
      capacityFullWh = (capRemAh * voltV) / (soc / 100);
    }
    if (Number.isFinite(capacityFullWh)) {
      const buf1h = recentAvg(PRED_AVG_WINDOW_MS);
      const ratePowerW = Number.isFinite(buf1h) ? buf1h : signedPowerW;
      const result = predictLinear(soc, capacityFullWh, ratePowerW);
      if (!result) {
        dir = ratePowerW > 0 ? 'charging' : 'discharging';
        lbl = t(ratePowerW > 0 ? 'bms.charging' : 'bms.discharging');
        sub = t('bms.steady');
      } else {
        dir = result.kind === 'empty' ? 'discharging' : 'charging';
        kind = result.kind;
        lbl = t(result.kind === 'empty' ? 'bms.toEmpty' : 'bms.toFull');
        const rounded = roundToGrain(result.when, PRED_TIME_GRAIN_MIN);
        const parts = fmtPredictionParts(rounded, new Date(), {
          locale: getLang() === 'en' ? 'en-GB' : 'pl-PL',
          today: t('bms.predict.today'),
          tomorrow: t('bms.predict.tomorrow'),
        });
        big = parts.hhmm;
        sub = parts.day;
      }
    }
  }

  const now = Date.now();
  const directionChanged = dir !== _lastPredOut.dir || kind !== _lastPredOut.kind;
  const stale = now - _lastPredOut.ts >= PRED_DOM_REFRESH_MS;
  const sameAsLast =
    lbl === _lastPredOut.lbl && big === _lastPredOut.big && sub === _lastPredOut.sub;

  if (sameAsLast && !directionChanged) {
    _lastPredOut.ts = now; // still considered "fresh"
    return;
  }
  if (!directionChanged && !stale) return;

  cell.classList.remove('charging', 'discharging', 'idle');
  if (dir) cell.classList.add(dir);
  label.textContent = lbl;
  time.textContent = big;
  day.textContent = sub;
  _lastPredOut = { ts: now, dir, kind, lbl, big, sub };
}

// ---- HA fetch ----
async function fetchState(id) {
  if (isDemo) return demoState(id);
  const r = await fetch(`${HA_URL}/api/states/${id}`, {
    headers: { Authorization: 'Bearer ' + TOKEN },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function demoState(id) {
  const t = Date.now() / 1000;
  // ?soc=N pins SOC to a fixed value (testing visual centering at
  // edge cases like 1, 11, 100). Default oscillates 20..80.
  const socOverride = new URLSearchParams(location.search).get('soc');
  const soc = socOverride !== null ? parseFloat(socOverride) : 50 + 30 * Math.sin(t / 30);
  const v = 53 + Math.sin(t / 40);
  const cur = 8 * Math.sin(t / 8);
  const pwr = cur * v;
  const now = new Date().toISOString();
  const map = {
    [E_SOC]: { state: soc.toFixed(1), last_updated: now },
    [E_VOLT]: { state: v.toFixed(2), last_updated: now },
    [E_POWER]: { state: pwr.toFixed(1), last_updated: now },
    [E_ONLINE]: { state: 'on', last_updated: now },
    [E_CAP_REM]: { state: ((soc / 100) * 280).toFixed(2), last_updated: now },
    [E_CAP_TOT]: { state: '280', last_updated: now },
  };
  for (const e of E_TEMPS) map[e] = { state: '17.0', last_updated: now };
  return map[id];
}

async function tick() {
  try {
    const tempPromises = E_TEMPS.map((id) => fetchState(id).catch(() => null));
    const [s, v, p, o, cr, ct, ...temps] = await Promise.all([
      fetchState(E_SOC),
      fetchState(E_VOLT),
      fetchState(E_POWER),
      fetchState(E_ONLINE),
      fetchState(E_CAP_REM).catch(() => null),
      fetchState(E_CAP_TOT).catch(() => null),
      ...tempPromises,
    ]);
    const soc = parseFloat(s.state);
    const volt = parseFloat(v.state);
    const power = parseFloat(p.state);
    const online = o.state === 'on';
    const capRemAh = cr ? parseFloat(cr.state) : NaN;
    const capTotAh = ct ? parseFloat(ct.state) : NaN;
    const tVals = temps
      .filter((x) => x && !isNaN(parseFloat(x.state)))
      .map((x) => parseFloat(x.state));
    // Average across all reporting sensors. The pack is small enough that
    // any one probe drifts ±2 °C from the rest depending on placement;
    // mean is more representative than max for a steady-state readout.
    const tAvg = tVals.length ? tVals.reduce((s, v) => s + v, 0) / tVals.length : NaN;

    // Staleness: triggers the NO-LINK overlay if EITHER the BMS link
    // is reported down OR voltage hasn't been pushed in > 5 s. We use
    // voltage's last_updated because total_voltage jitters on every BMS
    // notification while idle power can dedupe to a flat 0 W and never
    // refresh its own last_updated.
    const STALE_GRACE_MS = 5000;
    const voltAgeMs = Date.now() - new Date(v.last_updated).getTime();
    const stale = !online || isNaN(soc) || voltAgeMs > STALE_GRACE_MS;
    $('stale').classList.toggle('visible', stale);

    if (!isNaN(soc)) {
      updateGauge(soc);
      updateBatteryBar(soc);
      updateSocReadout(soc);
    }

    // top-left: voltage
    const vNum = $('volt-num');
    const vUnit = $('volt-unit');
    const vCls = voltageColorClass(volt);
    vNum.textContent = isNaN(volt) ? '--.-' : volt.toFixed(1);
    vNum.className = 'seg top-num' + (vCls ? ' ' + vCls : '');
    vUnit.className = 'top-unit'; // re-derived through CSS sibling chain

    // top-right: temperature (mean across all reporting sensors)
    const tNum = $('temp-num');
    const tUnit = $('temp-unit');
    const tCls = tempColorClass(tAvg);
    tNum.textContent = isNaN(tAvg) ? '--.-' : tAvg.toFixed(1);
    tNum.className = 'seg top-num' + (tCls ? ' ' + tCls : '');
    tUnit.className = 'top-unit';

    // Power readout — colour signals direction (cyan idle, green up,
    // red down). The bolt icon pulses when actively charging.
    updatePower(power);
    const charging = !isNaN(power) && power > POWER_DEAD_W;
    $('bolt-icon').style.animation = charging ? 'bms-pulse 1.6s ease-in-out infinite' : '';

    // Time-to-empty / time-to-full prediction (rolling 1h mean).
    if (!isNaN(power)) pushRecent(power);
    updatePrediction(soc, capRemAh, capTotAh, volt, power);
  } catch (e) {
    console.error(e);
    $('stale').classList.add('visible');
  }
}

// pulse keyframes (added once)
const styleSheet = document.styleSheets[0];
try {
  styleSheet.insertRule(
    '@keyframes bms-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
    styleSheet.cssRules.length,
  );
} catch {}

buildGauge();
buildBatteryBar();
tick();
setInterval(tick, POLL_MS);

// Re-measure %-glyph position once DSEG7 web font is loaded — first paint
// happens against the monospace fallback (narrower), so getBBox returns a
// shorter width and the % glyph lands too close to the digits. After fonts
// load we reposition with the correct metrics.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (!isNaN(_lastSoc)) updateSocReadout(_lastSoc);
  });
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

// Keyboard shortcut: A → advanced view.
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select')) return;
  if (e.key === 'a' || e.key === 'A') location.href = 'bms-dashboard.html';
});
