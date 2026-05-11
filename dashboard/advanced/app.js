// ============================================================
// CONFIG. The TOKEN placeholder is substituted at deploy time by
// scripts/deploy-ha.sh from the value in secrets.yaml — don't hand-
// edit this file. ENTITIES below should match the names defined in
// jk-pb-bms.yaml (HA prefixes them with `sensor.jk_pb_bms_`).
// HA_URL stays empty so the page works whether reached via LAN,
// Tailscale magic DNS, or `tailscale serve` HTTPS hostname — all
// requests go to the same origin that served this page.
// ============================================================
const HA_URL = '';
const TOKEN = 'PASTE_LONG_LIVED_ACCESS_TOKEN_HERE';
const ENTITIES = {
  soc: 'sensor.jk_pb_bms_state_of_charge',
  current: 'sensor.jk_pb_bms_current',
  online: 'binary_sensor.jk_pb_bms_online_status',
};
const POLL_MS_ADVANCED = 1000;
const HISTORY_REFRESH_MS = 30000;
const STALE_MS = 15000;
const FEED_MAX = 80;
const HISTORY_ENTITIES = [
  'sensor.jk_pb_bms_state_of_charge',
  'sensor.jk_pb_bms_current',
  'sensor.jk_pb_bms_power',
  'sensor.jk_pb_bms_power_tube_temperature',
  'sensor.jk_pb_bms_temperature_sensor_1',
  'sensor.jk_pb_bms_temperature_sensor_2',
  'sensor.jk_pb_bms_temperature_sensor_3',
  'sensor.jk_pb_bms_temperature_sensor_4',
  'sensor.jk_pb_bms_temperature_sensor_5',
];
const TEMP_HISTORY_ENTITIES = [
  'sensor.jk_pb_bms_power_tube_temperature',
  'sensor.jk_pb_bms_temperature_sensor_1',
  'sensor.jk_pb_bms_temperature_sensor_2',
  'sensor.jk_pb_bms_temperature_sensor_3',
  'sensor.jk_pb_bms_temperature_sensor_4',
  'sensor.jk_pb_bms_temperature_sensor_5',
];
// ============================================================

const isDemo = new URLSearchParams(location.search).has('demo');
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// -------- API --------
async function fetchState(entityId) {
  if (isDemo) return demoState(entityId);
  const r = await fetch(`${HA_URL}/api/states/${entityId}`, {
    headers: { Authorization: 'Bearer ' + TOKEN },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + entityId);
  return r.json();
}

async function fetchAllStates() {
  if (isDemo) return demoAllStates();
  const r = await fetch(`${HA_URL}/api/states`, {
    headers: { Authorization: 'Bearer ' + TOKEN },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' /api/states');
  return r.json();
}

function demoState(id) {
  const t = Date.now() / 1000;
  const soc = Math.round(50 + 30 * Math.sin(t / 30));
  const cur = 8 * Math.sin(t / 8);
  const now = new Date().toISOString();
  const tempBase = 25 + 20 * Math.max(0, Math.sin(t / 60));
  const m = {
    [ENTITIES.soc]: {
      state: String(soc),
      last_updated: now,
      last_changed: now,
      attributes: { unit_of_measurement: '%' },
    },
    [ENTITIES.current]: {
      state: cur.toFixed(2),
      last_updated: now,
      last_changed: now,
      attributes: { unit_of_measurement: 'A' },
    },
    [ENTITIES.online]: { state: 'on', last_updated: now, last_changed: now, attributes: {} },
    'sensor.jk_pb_bms_power_tube_temperature': {
      state: (tempBase + 6).toFixed(1),
      last_updated: now,
      last_changed: now,
      attributes: { unit_of_measurement: '°C' },
    },
    'sensor.jk_pb_bms_temperature_sensor_1': {
      state: tempBase.toFixed(1),
      last_updated: now,
      last_changed: now,
      attributes: { unit_of_measurement: '°C' },
    },
    'sensor.jk_pb_bms_temperature_sensor_2': {
      state: (tempBase - 0.4).toFixed(1),
      last_updated: now,
      last_changed: now,
      attributes: { unit_of_measurement: '°C' },
    },
  };
  return m[id];
}
function demoAllStates() {
  const t = Date.now() / 1000;
  const soc = Math.round(50 + 30 * Math.sin(t / 30));
  const cur = 8 * Math.sin(t / 8);
  const now = new Date().toISOString();
  const mk = (id, st, unit) => ({
    entity_id: id,
    state: String(st),
    last_updated: now,
    last_changed: now,
    attributes: { unit_of_measurement: unit },
  });
  const cells = [];
  for (let i = 1; i <= 16; i++)
    cells.push(
      mk(`sensor.jk_pb_bms_cell_voltage_${i}`, (3.3 + 0.01 * Math.sin(t + i)).toFixed(3), 'V'),
    );
  return [
    mk(ENTITIES.soc, soc, '%'),
    mk(ENTITIES.current, cur.toFixed(2), 'A'),
    mk('sensor.jk_pb_bms_total_voltage', '53.06', 'V'),
    mk('sensor.jk_pb_bms_power', (cur * 53).toFixed(1), 'W'),
    mk('sensor.jk_pb_bms_temperature_sensor_1', '15.0', '°C'),
    mk('sensor.jk_pb_bms_temperature_sensor_2', '14.7', '°C'),
    mk('sensor.jk_pb_bms_power_tube_temperature', '19.0', '°C'),
    mk('sensor.jk_pb_bms_jk_pb_bms_wifi_signal', '-41', 'dBm'),
    mk('sensor.jk_pb_bms_jk_pb_bms_uptime', '1234', 's'),
    mk('sensor.jk_pb_bms_jk_pb_bms_internal_temperature', '48.2', '°C'),
    {
      entity_id: ENTITIES.online,
      state: 'on',
      last_updated: now,
      last_changed: now,
      attributes: {},
    },
    ...cells,
  ];
}

// Keyboard shortcut: A → switch to integrated (normal) view.
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select')) return;
  if (e.key === 'a' || e.key === 'A') location.href = 'bms-integrated.html';
});

// -------- Advanced view --------
const lastSeen = {}; // entity_id -> last state (for diff detection)
const lastFetchedAt = {}; // entity_id -> Date.now() of most recent poll that included it
const feed = []; // {ts, entity_id, prev, next}
const pollStats = { ok: 0, err: 0, lastLatencyMs: 0, lastFetchAt: null };

// Age column = "time since we last fetched the entity from HA". HA's
// own `last_updated` / `last_changed` / `last_reported` are all
// deduplicated against the value, so a static reading (SOH=100,
// errors=0, balancing=0) shows hours of "age" even though we just
// received it on this very poll. We record fetch time client-side
// instead, which honestly answers "is this data current?".
function ageStrMs(ms) {
  if (!isFinite(ms)) return '?';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm';
  return Math.round(ms / 3600000) + 'h';
}
function ageClassMs(ms) {
  if (!isFinite(ms)) return '';
  if (ms < 5000) return 'fresh';
  if (ms < STALE_MS) return '';
  return 'stale';
}

function diffAndLog(states) {
  const ts = new Date();
  const nowMs = Date.now();
  for (const e of states) {
    const id = e.entity_id;
    if (!id.includes('jk_pb_bms')) continue;
    lastFetchedAt[id] = nowMs; // every poll that includes the entity counts as "fresh"
    const prev = lastSeen[id];
    const next = e.state;
    if (prev !== undefined && prev !== next) {
      feed.unshift({ ts, id, prev, next, unit: (e.attributes || {}).unit_of_measurement || '' });
      if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    }
    lastSeen[id] = next;
  }
}

// `entity` is the raw HA state object (or null/undefined). Age is read
// from our client-side `lastFetchedAt` map, NOT from HA timestamps.
function row(k, v, entity, cls) {
  let ageText = '',
    ageCls = '';
  if (entity && entity.entity_id) {
    const last = lastFetchedAt[entity.entity_id];
    if (last) {
      const ms = Date.now() - last;
      ageText = ageStrMs(ms);
      ageCls = ageClassMs(ms);
    }
  }
  return `<div class="row"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div><div class="age ${ageCls}">${ageText}</div></div>`;
}

// ---------- Sticky summary strip ----------
function fmtUptime(s) {
  if (!isFinite(s)) return '?';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
function renderStrip(get) {
  const setVal = (id, txt, cls) => {
    const el = $(id);
    el.textContent = txt;
    el.className = 'val' + (cls ? ' ' + cls : '');
  };
  const num = (e, dec = 1) => {
    if (!e) return NaN;
    const n = parseFloat(e.state);
    return isNaN(n) ? NaN : n;
  };

  const soc = num(get('sensor.jk_pb_bms_state_of_charge'), 0);
  const volt = num(get('sensor.jk_pb_bms_total_voltage'));
  const pwr = num(get('sensor.jk_pb_bms_power'));
  const cur = num(get('sensor.jk_pb_bms_current'));
  const onl = get('binary_sensor.jk_pb_bms_online_status');

  // average across the BMS NTCs for a single representative number
  const tVals = [
    'sensor.jk_pb_bms_temperature_sensor_1',
    'sensor.jk_pb_bms_temperature_sensor_2',
    'sensor.jk_pb_bms_temperature_sensor_3',
    'sensor.jk_pb_bms_temperature_sensor_4',
    'sensor.jk_pb_bms_temperature_sensor_5',
  ]
    .map((id) => num(get(id)))
    .filter((n) => !isNaN(n));
  const tAvg = tVals.length ? tVals.reduce((a, b) => a + b, 0) / tVals.length : NaN;

  const upt = num(get('sensor.jk_pb_bms_jk_pb_bms_uptime'));

  // SOC colour: red <30, amber 30-70, green ≥70 — matches main view.
  const socCls = isNaN(soc) ? '' : soc < 30 ? 'neg' : soc >= 70 ? 'pos' : 'warn';
  const voltCls = isNaN(volt)
    ? ''
    : volt < 48
      ? 'neg'
      : volt > 58
        ? 'neg'
        : volt > 56
          ? 'warn'
          : '';
  const pwrCls = isNaN(pwr) ? '' : pwr > 5 ? 'pos' : pwr < -5 ? 'neg' : '';
  const tempCls = isNaN(tAvg) ? '' : tAvg < 5 ? 'neg' : tAvg > 35 ? 'neg' : tAvg > 30 ? 'warn' : '';
  const linkOk = onl && onl.state === 'on';

  setVal('s-soc', isNaN(soc) ? '--' : `${soc.toFixed(0)} %`, socCls);
  setVal('s-volt', isNaN(volt) ? '--' : `${volt.toFixed(1)} V`, voltCls);
  setVal('s-power', isNaN(pwr) ? '--' : `${pwr >= 0 ? '+' : ''}${pwr.toFixed(0)} W`, pwrCls);
  setVal('s-cur', isNaN(cur) ? '--' : `${cur >= 0 ? '+' : ''}${cur.toFixed(2)} A`, pwrCls);
  setVal('s-temp', isNaN(tAvg) ? '--' : `${tAvg.toFixed(1)} °C`, tempCls);
  setVal('s-link', linkOk ? 'on' : 'off', linkOk ? 'pos' : 'neg');
  setVal('s-up', fmtUptime(upt), '');
}

function renderAdvanced(states, latencyMs) {
  diffAndLog(states);
  const byId = Object.fromEntries(states.map((e) => [e.entity_id, e]));
  const get = (id) => byId[id];
  const stOr = (e, dflt = '--') => (e ? e.state : dflt);
  const numOr = (e, dec = 2) => {
    if (!e) return '--';
    const n = parseFloat(e.state);
    return isNaN(n) ? e.state : n.toFixed(dec);
  };
  const unitOf = (e) => (e ? (e.attributes || {}).unit_of_measurement || '' : '');

  // Sticky summary strip at the top — same data as the body sections,
  // pinned for at-a-glance scanning while scrolling diagnostics below.
  renderStrip(get);

  // Connection
  const wifi = get('sensor.jk_pb_bms_jk_pb_bms_wifi_signal');
  const upt = get('sensor.jk_pb_bms_jk_pb_bms_uptime');
  const itmp = get('sensor.jk_pb_bms_jk_pb_bms_internal_temperature');
  const onl = get(ENTITIES.online);
  const onlState = onl
    ? onl.state === 'on'
      ? '<span class="ok">✓ ON</span>'
      : '<span class="err">✗ OFF</span>'
    : '?';
  const uptHuman = upt ? humanDuration(parseFloat(upt.state)) : '?';
  $('conn').innerHTML =
    row('BMS BLE link', onlState, onl) +
    row('ESP uptime', uptHuman, upt) +
    row('WiFi signal', `${numOr(wifi, 0)} ${unitOf(wifi)}`, wifi) +
    row('Internal temp', `${numOr(itmp, 1)} ${unitOf(itmp)}`, itmp);

  // Live
  const soc = get(ENTITIES.soc);
  const soh = get('sensor.jk_pb_bms_state_of_health');
  const cur = get(ENTITIES.current);
  const tv = get('sensor.jk_pb_bms_total_voltage');
  const pwr = get('sensor.jk_pb_bms_power');
  const cap = get('sensor.jk_pb_bms_capacity_remaining');
  const capT = get('sensor.jk_pb_bms_total_battery_capacity');
  const cyc = get('sensor.jk_pb_bms_charging_cycles');
  const cycCap = get('sensor.jk_pb_bms_total_charging_cycle_capacity');
  const balC = get('sensor.jk_pb_bms_balancing_current');
  const cs =
    get('text_sensor.jk_pb_bms_charge_status') || get('sensor.text_sensor.jk_pb_bms_charge_status');
  const csId = get('sensor.jk_pb_bms_charge_status_id');
  const errB = get('sensor.jk_pb_bms_errors_bitmask');
  const errT = get('text_sensor.jk_pb_bms_errors');
  // Some text_sensor entries actually live under sensor domain in HA when
  // ESPHome publishes them; tolerate both:
  const errText =
    Object.values(byId).find((e) => e.entity_id === 'text_sensor.jk_pb_bms_errors')?.state ?? '';
  const csText =
    Object.values(byId).find((e) => e.entity_id === 'text_sensor.jk_pb_bms_charge_status')?.state ??
    '';
  const curN = cur ? parseFloat(cur.state) : NaN;
  const curCls = isNaN(curN) ? '' : curN > 0.1 ? 'pos' : curN < -0.1 ? 'neg' : '';
  const errN = errB ? parseFloat(errB.state) : NaN;
  const errCls = errN > 0 ? 'err' : 'ok';
  $('live').innerHTML =
    row('SOC', `${numOr(soc, 0)} ${unitOf(soc)}`, soc) +
    row('State of health', `${numOr(soh, 0)} ${unitOf(soh)}`, soh) +
    row('Total voltage', `${numOr(tv, 3)} ${unitOf(tv)}`, tv) +
    row('Current', `${numOr(cur, 3)} ${unitOf(cur)}`, cur, curCls) +
    row('Power', `${numOr(pwr, 1)} ${unitOf(pwr)}`, pwr, curCls) +
    row('Capacity remaining / total', `${numOr(cap, 1)} / ${numOr(capT, 0)} Ah`, cap) +
    row('Cycles · lifetime Ah', `${numOr(cyc, 0)} · ${numOr(cycCap, 0)} Ah`, cyc) +
    row('Balancing current', `${numOr(balC, 3)} ${unitOf(balC)}`, balC) +
    row('Charge status', `${csText || '?'} (id ${numOr(csId, 0)})`, csId) +
    row(
      'Errors',
      `${errText || '(none)'} <span class="${errCls}">[bitmask ${numOr(errB, 0)}]</span>`,
      errB,
      errCls,
    );

  // Cells (voltage + wire resistance) — rendered as horizontal bars
  // mapped over the live min/max so imbalance jumps out visually:
  // bar fill = (v - vMin) / (vMax - vMin) → green at top of pack, amber
  // at bottom, red flagged separately when delta > 50 mV.
  const cellSamples = [];
  for (let i = 1; i <= 16; i++) {
    const cv = get(`sensor.jk_pb_bms_cell_voltage_${i}`);
    const cr = get(`sensor.jk_pb_bms_cell_resistance_${i}`);
    const v = cv ? parseFloat(cv.state) : NaN;
    const r = cr ? parseFloat(cr.state) * 1000 : NaN;
    cellSamples.push({ i, v, r });
  }
  const valid = cellSamples.filter((c) => Number.isFinite(c.v));
  const vMin = valid.length ? Math.min(...valid.map((c) => c.v)) : 0;
  const vMax = valid.length ? Math.max(...valid.map((c) => c.v)) : 1;
  const delta = vMax - vMin;

  // The bar's full-scale span is a fixed minimum window so a balanced
  // pack (≤5 mV total spread) doesn't get visually amplified into
  // looking imbalanced — all cells will then sit near the middle of
  // a wider implied scale. Only when imbalance is real (>30 mV) do we
  // start colour-coding extremes.
  const SCALE_MV = 0.03; // visualisation half-window
  const ALERT_MV = 0.03; // "moderate" imbalance highlight threshold
  const OUTLIER_MV = 0.08; // "bad" imbalance threshold
  const span = Math.max(delta, SCALE_MV);
  const mid = (vMax + vMin) / 2;
  const lo = mid - span / 2;
  let cellsHtml = '';
  for (const c of cellSamples) {
    const pct = Number.isFinite(c.v) ? Math.round(((c.v - lo) / span) * 100) : 0;
    let cls = '';
    if (Number.isFinite(c.v) && delta > ALERT_MV) {
      if (delta > OUTLIER_MV) {
        if (c.v === vMin || c.v === vMax) cls = 'cell-out';
      } else {
        if (c.v === vMin) cls = 'cell-min';
        else if (c.v === vMax) cls = 'cell-max';
      }
    }
    const v = Number.isFinite(c.v) ? c.v.toFixed(3) : '--';
    const r = Number.isFinite(c.r) ? `${c.r.toFixed(1)} mΩ` : '--';
    cellsHtml +=
      `<div class="cell-line ${cls}">` +
      `<div class="idx">${String(c.i).padStart(2, '0')}</div>` +
      `<div class="v">${v}</div>` +
      `<div class="bar" style="--fill: ${Math.max(0, Math.min(100, pct))}%"></div>` +
      `<div class="r">${r}</div>` +
      `</div>`;
  }
  $('cells').innerHTML = cellsHtml;

  // Temperatures (5 BMS NTCs + MOSFET + ESP internal)
  const t1 = get('sensor.jk_pb_bms_temperature_sensor_1');
  const t2 = get('sensor.jk_pb_bms_temperature_sensor_2');
  const t3 = get('sensor.jk_pb_bms_temperature_sensor_3');
  const t4 = get('sensor.jk_pb_bms_temperature_sensor_4');
  const t5 = get('sensor.jk_pb_bms_temperature_sensor_5');
  const tp = get('sensor.jk_pb_bms_power_tube_temperature');
  const heat = get('binary_sensor.jk_pb_bms_heating');
  const heatHtml = heat ? (heat.state === 'on' ? '<span class="ok">ON</span>' : 'off') : '?';
  $('temps').innerHTML =
    row('Sensor 1', `${numOr(t1, 1)} °C`, t1) +
    row('Sensor 2', `${numOr(t2, 1)} °C`, t2) +
    row('Sensor 3', `${numOr(t3, 1)} °C`, t3) +
    row('Sensor 4', `${numOr(t4, 1)} °C`, t4) +
    row('Sensor 5', `${numOr(t5, 1)} °C`, t5) +
    row('MOSFET', `${numOr(tp, 1)} °C`, tp) +
    row('Heater active', heatHtml, heat);

  // Feed
  $('feed').innerHTML =
    feed.length === 0
      ? '<div class="line"><span class="n">(no changes since session start)</span></div>'
      : feed
          .map((f) => {
            const t = `${pad(f.ts.getHours())}:${pad(f.ts.getMinutes())}:${pad(f.ts.getSeconds())}`;
            const shortId = f.id
              .replace('sensor.jk_pb_bms_', '')
              .replace('binary_sensor.jk_pb_bms_', '');
            return `<div class="line"><span class="t">${t}</span><span class="n">${shortId}</span> ${f.prev} → ${f.next} ${f.unit}</div>`;
          })
          .join('');

  // Polling diagnostics
  const lastFetch = pollStats.lastFetchAt
    ? `${pad(pollStats.lastFetchAt.getHours())}:${pad(pollStats.lastFetchAt.getMinutes())}:${pad(pollStats.lastFetchAt.getSeconds())}`
    : '?';
  $('poll').innerHTML =
    row('Endpoint', `${HA_URL || '(same-origin)'}/api/states`) +
    row('Interval', `${POLL_MS_ADVANCED} ms`) +
    row('Last fetch', `${lastFetch} (${latencyMs} ms)`) +
    row(
      'OK / Err (sess.)',
      `${pollStats.ok} / <span class="${pollStats.err ? 'err' : ''}">${pollStats.err}</span>`,
    ) +
    row('Feed entries', `${feed.length} / ${FEED_MAX}`) +
    row('Browser time', new Date().toISOString());

  // Raw + config
  $('raw').textContent = JSON.stringify(
    states.filter((e) => e.entity_id.includes('jk_pb_bms')),
    null,
    2,
  );
  $('cfg').textContent = JSON.stringify(
    {
      HA_URL: HA_URL || '(same-origin)',
      ENTITIES,
      POLL_MS_ADVANCED,
      STALE_MS,
      FEED_MAX,
      isDemo,
      tokenLen: TOKEN.length,
      tokenSet: !TOKEN.startsWith('PASTE_LONG_'),
    },
    null,
    2,
  );
}

function humanDuration(s) {
  if (!isFinite(s)) return '?';
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const out = [];
  if (d) out.push(d + 'd');
  if (h || d) out.push(h + 'h');
  if (m || h || d) out.push(m + 'm');
  out.push(Math.floor(s) + 's');
  return out.join(' ');
}

// -------- History (HA recorder via /api/history/period) --------
let historyHours = parseInt(localStorage.getItem('bms-hist-h') || '24', 10);
let historyCache = null; // { fetchedAt, hours, byEntity }
let historyInflight = null;
let historyLastError = null;

async function fetchHistory(hours) {
  if (isDemo) return demoHistory(hours);
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  // significant_changes_only & no_attributes shrink the JSON dramatically
  // (BMS power changes constantly — a 24h window without these flags
  // returns ~50k samples per entity × 9 entities). With them, a 24h
  // request finishes in well under a second.
  const url =
    `${HA_URL}/api/history/period/${start.toISOString()}` +
    `?filter_entity_id=${HISTORY_ENTITIES.join(',')}` +
    `&minimal_response` +
    `&significant_changes_only` +
    `&no_attributes` +
    `&end_time=${end.toISOString()}`;
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + TOKEN },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('history HTTP ' + r.status);
  const arr = await r.json();
  // arr is parallel to filter_entity_id order; sometimes HA returns subset if entity has no data.
  const byEntity = {};
  for (const series of arr) {
    if (!series.length) continue;
    const eid = series[0].entity_id;
    const points = [];
    let prevState = null;
    for (const s of series) {
      // minimal_response: first record has full attributes; subsequent only state + last_changed
      const t = new Date(s.last_changed ?? s.last_updated).getTime();
      const v = parseFloat(s.state);
      if (!isNaN(v) && isFinite(t)) points.push({ t, v });
    }
    byEntity[eid] = points;
  }
  return byEntity;
}

function demoHistory(hours) {
  const out = {};
  const end = Date.now();
  const start = end - hours * 3600 * 1000;
  const samples = Math.min(800, hours * 60); // ~1 per minute
  for (const eid of HISTORY_ENTITIES) {
    const arr = [];
    for (let i = 0; i < samples; i++) {
      const t = start + (i / samples) * (end - start);
      const ph = t / 1000 / 600; // slow phase
      let v;
      if (eid.endsWith('state_of_charge')) v = 50 + 25 * Math.sin(ph);
      else if (eid.endsWith('current')) v = 8 * Math.sin(ph * 3) + (Math.random() < 0.02 ? -25 : 0);
      else v = 53 * (8 * Math.sin(ph * 3) + (Math.random() < 0.02 ? -25 : 0));
      arr.push({ t, v });
    }
    out[eid] = arr;
  }
  return out;
}

// Sunrise / sunset / night-band helpers (sunTimesFor, nightIntervals,
// WARSAW_LAT, WARSAW_LON) live in lib/sun.js. They're loaded via the
// <script src> tag higher up the body and inlined into the deployed
// HTML by scripts/minify-html.py.

function bucketize(samples, nBuckets, startMs, endMs) {
  const buckets = Array.from({ length: nBuckets }, (_, i) => ({
    t: startMs + ((i + 0.5) * (endMs - startMs)) / nBuckets,
    min: Infinity,
    max: -Infinity,
    sum: 0,
    count: 0,
  }));
  const bw = (endMs - startMs) / nBuckets;
  for (const s of samples) {
    if (s.t < startMs || s.t > endMs) continue;
    const idx = Math.min(nBuckets - 1, Math.max(0, Math.floor((s.t - startMs) / bw)));
    const b = buckets[idx];
    if (s.v < b.min) b.min = s.v;
    if (s.v > b.max) b.max = s.v;
    b.sum += s.v;
    b.count++;
  }
  // Forward-fill ONLY after the first real sample. Buckets before
  // the first datum stay null so the chart doesn't draw a line where
  // history doesn't exist (e.g. select 7d window when device is 1h old).
  let carry = NaN;
  for (const b of buckets) {
    if (b.count > 0) {
      b.avg = b.sum / b.count;
      carry = b.avg;
    } else if (!isNaN(carry)) {
      b.avg = carry;
      b.min = carry;
      b.max = carry;
    } else {
      b.avg = null;
      b.min = null;
      b.max = null;
    }
  }
  return buckets;
}

// Merge several bucket arrays (one per entity) into one bucket array
// representing the per-bucket worst-case (max across entities) value.
// Used for the temperature chart — there are 6 temp sensors and we want
// to show the hottest one at each moment in time.
function mergeMaxBuckets(arrs) {
  if (!arrs.length) return [];
  const N = arrs[0].length;
  const out = [];
  for (let i = 0; i < N; i++) {
    let maxAvg = -Infinity,
      maxMax = -Infinity,
      minMin = Infinity;
    let any = false;
    for (const arr of arrs) {
      const b = arr[i];
      if (!b || b.avg === null || b.avg === undefined) continue;
      any = true;
      if (b.avg > maxAvg) maxAvg = b.avg;
      if (b.max > maxMax) maxMax = b.max;
      if (b.min < minMin) minMin = b.min;
    }
    const t = arrs[0][i]?.t;
    out.push(
      any
        ? { t, avg: maxAvg, max: maxMax, min: minMin, count: 1 }
        : { t, avg: null, max: null, min: null, count: 0 },
    );
  }
  return out;
}

function drawChart(canvas, buckets, opts = {}) {
  const dpr = devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  // Layout can sometimes call us with a not-yet-measured canvas (cssW = 0
  // on initial paint before flexbox settles). Skipping the draw and
  // relying on the ResizeObserver below to fire a redraw once the canvas
  // gets a real width avoids the "blank charts until you click a range
  // button" symptom.
  if (cssW === 0 || cssH === 0) return;
  if (canvas.width !== Math.round(cssW * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const hasData = buckets.some((b) => b.avg !== null);
  if (!buckets.length || !hasData) {
    ctx.fillStyle = '#555';
    ctx.font = '11px ui-monospace';
    ctx.fillText('no data in this window', 6, cssH / 2 + 4);
    return;
  }
  const padX = 4,
    padY = 6;
  const W = cssW - padX * 2,
    H = cssH - padY * 2;

  // Day/night shading. The chart background is black, so we paint
  // *day* with a warm yellow tint (sun overhead) and leave nights as
  // the default black. Plus thin vertical markers on each transition
  // so the boundary is unambiguous even at low opacity.
  if (opts.nights && opts.startMs && opts.endMs && opts.endMs > opts.startMs) {
    const xFromMs = (ms) => padX + ((ms - opts.startMs) / (opts.endMs - opts.startMs)) * W;

    // Day = the complement of all night intervals within [startMs, endMs].
    // Build a simple swept list of disjoint day-bands.
    const sortedNights = opts.nights.slice().sort((a, b) => a.start - b.start);
    const days = [];
    let cursor = opts.startMs;
    for (const n of sortedNights) {
      if (n.start > cursor) days.push({ start: cursor, end: Math.min(n.start, opts.endMs) });
      cursor = Math.max(cursor, n.end);
      if (cursor >= opts.endMs) break;
    }
    if (cursor < opts.endMs) days.push({ start: cursor, end: opts.endMs });

    ctx.fillStyle = 'rgba(255, 200, 80, 0.06)';
    for (const d of days) {
      const x1 = Math.max(padX, xFromMs(d.start));
      const x2 = Math.min(padX + W, xFromMs(d.end));
      if (x2 > x1) ctx.fillRect(x1, padY, x2 - x1, H);
    }

    // Subtle vertical hairlines on every sunrise/sunset transition that
    // falls inside the visible window — gives a hard edge that reads
    // even when the warm fill is faint.
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.30)';
    ctx.lineWidth = 1;
    const transitions = new Set();
    for (const n of sortedNights) {
      if (n.start > opts.startMs && n.start < opts.endMs) transitions.add(n.start);
      if (n.end > opts.startMs && n.end < opts.endMs) transitions.add(n.end);
    }
    for (const t of transitions) {
      const x = xFromMs(t);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, padY);
      ctx.lineTo(x + 0.5, padY + H);
      ctx.stroke();
    }

    // Sun / moon glyph anchored to the right edge of each band wider
    // than 22 px. Pinned to the top so it never sits on top of the
    // line data; right-aligned so it labels the *most recent* end of
    // each phase.
    ctx.font = '16px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    const glyphY = padY + 1;
    const drawGlyph = (band, glyph, color) => {
      const x1 = Math.max(padX, xFromMs(band.start));
      const x2 = Math.min(padX + W, xFromMs(band.end));
      if (x2 - x1 < 22) return;
      ctx.fillStyle = color;
      ctx.fillText(glyph, x2 - 4, glyphY);
    };
    for (const d of days) drawGlyph(d, '☀', 'rgba(255, 200, 80, 0.7)');
    for (const n of sortedNights) drawGlyph(n, '☾', 'rgba(180, 200, 255, 0.6)');
  }

  let yMin = Infinity,
    yMax = -Infinity;
  for (const b of buckets) {
    if (b.min !== null && isFinite(b.min)) yMin = Math.min(yMin, b.min);
    if (b.max !== null && isFinite(b.max)) yMax = Math.max(yMax, b.max);
  }
  if (opts.zeroLine) {
    yMin = Math.min(yMin, 0);
    yMax = Math.max(yMax, 0);
  }
  if (opts.fixedMin !== undefined) yMin = opts.fixedMin;
  if (opts.fixedMax !== undefined) yMax = opts.fixedMax;
  if (yMin === yMax) yMax = yMin + 1;
  const ySpan = yMax - yMin;
  const xy = (i, v) => [
    padX + (buckets.length === 1 ? W / 2 : (i / (buckets.length - 1)) * W),
    padY + H - ((v - yMin) / ySpan) * H,
  ];

  // shade leading "no data" region in dark grey
  const firstIdx = buckets.findIndex((b) => b.avg !== null);
  if (firstIdx > 0) {
    const [xEnd] = xy(firstIdx, yMin);
    ctx.fillStyle = '#161616';
    ctx.fillRect(padX, padY, xEnd - padX, H);
    ctx.fillStyle = '#444';
    ctx.font = '10px ui-monospace';
    const label = 'no data yet';
    const tw = ctx.measureText(label).width;
    if (xEnd - padX > tw + 8) ctx.fillText(label, padX + 4, padY + 12);
  }

  // zero line
  if (opts.zeroLine && yMin < 0 && yMax > 0) {
    const [, zy] = xy(0, 0);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, zy);
    ctx.lineTo(padX + W, zy);
    ctx.stroke();
  }

  // min/max band — draw as separate runs separated by null gaps
  if (opts.band) {
    ctx.fillStyle = opts.bandColor || 'rgba(74, 222, 128, 0.18)';
    let runStart = -1;
    for (let i = 0; i <= buckets.length; i++) {
      const inRun = i < buckets.length && buckets[i].avg !== null;
      if (inRun && runStart < 0) runStart = i;
      if (!inRun && runStart >= 0) {
        const end = i - 1;
        ctx.beginPath();
        for (let k = runStart; k <= end; k++) {
          const [x, y] = xy(k, buckets[k].max);
          if (k === runStart) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let k = end; k >= runStart; k--) {
          const [x, y] = xy(k, buckets[k].min);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        runStart = -1;
      }
    }
  }

  // avg line — same run-segmentation
  ctx.strokeStyle = opts.lineColor || '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let inRun = false;
  buckets.forEach((b, i) => {
    if (b.avg === null) {
      inRun = false;
      return;
    }
    const [x, y] = xy(i, b.avg);
    if (!inRun) {
      ctx.moveTo(x, y);
      inRun = true;
    } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function refreshHistoryIfStale() {
  const now = Date.now();
  if (
    historyCache &&
    historyCache.hours === historyHours &&
    now - historyCache.fetchedAt < HISTORY_REFRESH_MS
  )
    return;
  if (historyInflight) return historyInflight;
  historyInflight = (async () => {
    try {
      const byEntity = await fetchHistory(historyHours);
      historyCache = { fetchedAt: Date.now(), hours: historyHours, byEntity };
      historyLastError = null;
    } catch (e) {
      historyLastError = e.message || String(e);
    } finally {
      historyInflight = null;
    }
  })();
  return historyInflight;
}

function renderHistory() {
  const meta = $('chart-meta');
  if (!historyCache) {
    meta.textContent = historyLastError
      ? `history error: ${historyLastError}`
      : 'fetching history…';
    return;
  }
  const { byEntity, fetchedAt, hours } = historyCache;
  const end = Date.now();
  const start = end - hours * 3600 * 1000;
  const N = 180; // bucket resolution

  const buckets = (eid) => bucketize(byEntity[eid] ?? [], N, start, end);

  const socB = buckets('sensor.jk_pb_bms_state_of_charge');
  const curB = buckets('sensor.jk_pb_bms_current');
  const pwrB = buckets('sensor.jk_pb_bms_power');

  // Temperature: bucket each sensor, then per-bucket take the MAX across
  // all 6 sensors (worst-case temp at each instant). Band = lowest min /
  // highest max observed across sensors.
  const tempArrs = TEMP_HISTORY_ENTITIES.map((eid) => buckets(eid));
  const tempB = mergeMaxBuckets(tempArrs);

  // Day/night band passed to every chart so the time axis is legible
  // (e.g. you can immediately see overnight discharge vs daytime PV).
  const nights = nightIntervals(start, end, WARSAW_LAT, WARSAW_LON);
  const baseOpts = { startMs: start, endMs: end, nights };
  drawChart($('chart-soc'), socB, {
    ...baseOpts,
    lineColor: '#4ade80',
    fixedMin: 0,
    fixedMax: 100,
  });
  drawChart($('chart-current'), curB, {
    ...baseOpts,
    band: true,
    bandColor: 'rgba(251, 191, 36, 0.18)',
    lineColor: '#fbbf24',
    zeroLine: true,
  });
  drawChart($('chart-power'), pwrB, {
    ...baseOpts,
    band: true,
    bandColor: 'rgba(251, 191, 36, 0.18)',
    lineColor: '#fbbf24',
    zeroLine: true,
  });
  drawChart($('chart-temp'), tempB, {
    ...baseOpts,
    band: true,
    bandColor: 'rgba(96, 165, 250, 0.18)',
    lineColor: '#60a5fa',
  });

  const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
  const fmt = (n, dec = 1) => (isFinite(n) ? n.toFixed(dec) : '--');
  const lastSoc = last(byEntity['sensor.jk_pb_bms_state_of_charge'] ?? []);
  const lastCur = last(byEntity['sensor.jk_pb_bms_current'] ?? []);
  const lastPwr = last(byEntity['sensor.jk_pb_bms_power'] ?? []);
  // Live max temperature across all 6 sensors
  const lastTemps = TEMP_HISTORY_ENTITIES.map((eid) => last(byEntity[eid] ?? []))
    .filter(Boolean)
    .map((p) => p.v);
  const lastTmax = lastTemps.length ? Math.max(...lastTemps) : NaN;
  $('chart-soc-cur').textContent = lastSoc ? `${fmt(lastSoc.v, 0)} %` : '--';
  $('chart-current-cur').textContent = lastCur ? `${fmt(lastCur.v, 2)} A` : '--';
  $('chart-power-cur').textContent = lastPwr ? `${fmt(lastPwr.v, 0)} W` : '--';
  $('chart-temp-cur').textContent = isFinite(lastTmax) ? `${fmt(lastTmax, 1)} °C` : '--';

  const ago = Math.round((Date.now() - fetchedAt) / 1000);
  const totalPoints = Object.values(byEntity).reduce((s, a) => s + a.length, 0);
  meta.textContent = `${hours}h window · ${totalPoints} samples · ${N} buckets · refreshed ${ago}s ago`;
}

// range buttons
document.querySelectorAll('#range-buttons button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const h = parseInt(btn.dataset.h, 10);
    if (h === historyHours) return;
    historyHours = h;
    localStorage.setItem('bms-hist-h', String(h));
    document
      .querySelectorAll('#range-buttons button')
      .forEach((b) => b.classList.toggle('active', parseInt(b.dataset.h, 10) === h));
    historyCache = null;
    refreshHistoryIfStale().then(renderHistory);
  });
});
// Set initial active button
document
  .querySelectorAll('#range-buttons button')
  .forEach((b) => b.classList.toggle('active', parseInt(b.dataset.h, 10) === historyHours));

// Redraw charts when each canvas is actually measured. Observing the
// canvases individually (rather than the parent view) means we get a
// real "first measurement" callback even on the initial load, which
// previously caused charts to render blank until the user clicked a
// range button to force a manual redraw.
const chartObserver = new ResizeObserver(() => {
  if (historyCache) renderHistory();
});
['#chart-soc', '#chart-current', '#chart-power', '#chart-temp'].forEach((sel) => {
  const el = document.querySelector(sel);
  if (el) chartObserver.observe(el);
});

// Kick off the first history fetch immediately rather than waiting for
// the first 1 Hz state poll — saves up to a second of perceived latency.
refreshHistoryIfStale()
  .then(renderHistory)
  .catch(() => renderHistory());

// -------- Tick --------
let timer = null;

async function tick() {
  const t0 = performance.now();
  try {
    const all = await fetchAllStates();
    const latency = Math.round(performance.now() - t0);
    pollStats.ok++;
    pollStats.lastLatencyMs = latency;
    pollStats.lastFetchAt = new Date();
    renderAdvanced(all, latency);
    refreshHistoryIfStale()
      .then(renderHistory)
      .catch(() => renderHistory());
  } catch (e) {
    pollStats.err++;
    console.error(e);
    const ts = new Date();
    feed.unshift({ ts, id: '__error', prev: '', next: e.message || String(e), unit: '' });
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
  }
  schedule();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, POLL_MS_ADVANCED);
}

tick();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (timer) clearTimeout(timer);
    tick();
  }
});
