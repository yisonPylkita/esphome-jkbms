// SPDX-License-Identifier: MIT
//
// Alarm-history dashboard — paired with `dashboard/history/index.html`.
// Reads HA's `/api/logbook/...` + `/api/history/period/...` REST endpoints
// for `alarm_control_panel.battery_room` and `binary_sensor.battery_room_door_contact`
// and renders four widgets:
//   1. stat tiles — armed time, door-open time, trigger / disarm counts
//   2. door Gantt — open/closed bands with day/night shading
//   3. trigger summary cards — one per "triggered" episode
//   4. event list — every arm / disarm event in the range, with user
//
// Token + entity IDs follow the same pattern as the other dashboards.
// USER_MAP (below) hand-maps HA context_user_id UUIDs to friendly labels;
// new family-member accounts show up as a raw 6-char hex prefix until
// added here — see the README "Mapping HA user IDs to friendly names"
// section for how to look up a UUID.

const HA_URL = '';
const TOKEN = 'PASTE_LONG_LIVED_ACCESS_TOKEN_HERE';

const E = {
  // After Phase 2 the canonical alarm state is the alarm_control_panel
  // entity, not the old input_select. Events recorded before that
  // migration live under `input_select.alarm_state` — they're not
  // surfaced here. Old USER_MAP entries are kept (see below) so user
  // attribution on lingering events still renders if HA's recorder
  // ever joins the two histories.
  alarmState: 'alarm_control_panel.battery_room',
  triggerReason: 'input_text.alarm_trigger_reason',
  door: 'binary_sensor.battery_room_door_contact',
};

// alarm_control_panel uses `armed_away` for the armed state and
// `pending` for the entry-delay window before triggered. The old
// FSM had a single `armed`. Canonicalise so the rest of this file
// treats `armed_away` and the legacy `armed` interchangeably, and
// treats `pending` as an alarm-active state (it's already past the
// armed→pending transition by the time it's recorded).
function canonState(s) {
  if (s === 'armed_away') return 'armed';
  if (s === 'pending') return 'armed';
  return s;
}

// Map opaque context_user_ids → friendly labels. Populated empirically
// from the live logbook; tweak as new users appear. The `Node-RED`
// entry is retained so historical events (from before the alarm was
// ported to native HA automations) still render with a readable label.
const USER_MAP = {
  '4eb50da6dc484dd099075a00726c595c': 'panel',
  '452e9d31c726462d967c63e7ff9acaad': 'Node-RED',
};

// Warsaw — same default the BMS dashboard's sun calc uses. Adjust if
// the box ever moves.
const SITE = { lat: 52.2297, lon: 21.0122 };

// HA REST helpers — `haLogbook` and `haHistory` come from lib/ha.js
// (`/api/logbook/<from>?entity=...` for arm/disarm events; the latter
// returns every recorder sample, needed because logbook coalesces
// close-together door flips).

// ---- Time formatters ----

function fmtHM(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtClock(d) {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(d, now = new Date()) {
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? fmtClock(d)
    : d.toLocaleString('pl-PL', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function userLabel(uid) {
  if (!uid) return t('history.event.user.automation');
  return USER_MAP[uid] || uid.slice(0, 6);
}

// ---- Range selection ----

const RANGE_MS = {
  day: 24 * 3600 * 1000,
  week: 7 * 24 * 3600 * 1000,
  month: 30 * 24 * 3600 * 1000,
};
let _activeRange = 'day';

function rangeBounds(rangeKey) {
  const now = new Date();
  const span = RANGE_MS[rangeKey] || RANGE_MS.day;
  const from = new Date(now.getTime() - span);
  return { from, to: now, span };
}

// ---- Renderers ----

function renderEvents(logbook) {
  const list = $('event-list');
  list.innerHTML = '';
  const events = logbook.filter((e) => e.entity_id === E.alarmState).reverse(); // newest first
  if (events.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('history.empty.events');
    list.appendChild(li);
    return;
  }
  for (const e of events) {
    const li = document.createElement('li');
    li.className = 'event-row';
    const stateKey = `history.event.${e.state}`;
    const stateLabel = t(stateKey) || e.state;
    li.innerHTML = `
      <span class="event-when">${fmtDateTime(new Date(e.when))}</span>
      <span class="event-state ${e.state}">${stateLabel}</span>
      <span class="event-user">${t('history.event.by')} ${userLabel(e.context_user_id)}</span>
    `;
    list.appendChild(li);
  }
}

function renderTriggers(logbook, reasonLogbook) {
  const card = $('trigger-list');
  card.innerHTML = '';
  // Pair each "triggered" → next "disarmed" (or now). Reason at
  // trigger time comes from the input_text.alarm_trigger_reason
  // logbook entry — the `capture trigger reason` automation writes
  // it on the panel's `pending` transition, so it lands shortly
  // before the `triggered` state event.
  const alarmEvents = logbook.filter((e) => e.entity_id === E.alarmState);
  const triggers = [];
  for (let i = 0; i < alarmEvents.length; i++) {
    if (alarmEvents[i].state !== 'triggered') continue;
    const t0 = new Date(alarmEvents[i].when);
    const next = alarmEvents.slice(i + 1).find((e) => e.state === 'disarmed');
    const disarmed = next ? new Date(next.when) : null;
    // Reason write happens on the panel's armed→pending transition
    // (~delay_time seconds before triggered), so widen the search
    // window to ±15 s and pick the closest sample. The legacy ±5 s
    // worked when Node-RED wrote both within milliseconds of each
    // other; the new flow has the entry-delay gap in between.
    const reasonEntry = reasonLogbook
      .filter((e) => e.entity_id === E.triggerReason && Math.abs(new Date(e.when) - t0) < 15000)
      .sort((a, b) => Math.abs(new Date(a.when) - t0) - Math.abs(new Date(b.when) - t0))[0];
    const reason = reasonEntry?.state || '';
    // Time-armed-before-trip: find the previous armed event (either
    // the panel's `armed_away` or the legacy `armed`) before t0.
    const armed = [...alarmEvents.slice(0, i)]
      .reverse()
      .find((e) => canonState(e.state) === 'armed');
    triggers.push({
      at: t0,
      reason,
      armedAt: armed ? new Date(armed.when) : null,
      disarmedAt: disarmed,
      disarmedBy: next ? userLabel(next.context_user_id) : null,
    });
  }
  if (triggers.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = t('history.empty.triggers');
    card.appendChild(div);
    return;
  }
  for (const tr of triggers.reverse()) {
    const div = document.createElement('div');
    div.className = 'trigger';
    // Reason may be in the new key-token form ("door · motion_aux")
    // OR the legacy human-string form ("ruch (zapasowy)") from before
    // the FSM was switched to emit cause keys. Translate keys; pass
    // legacy strings through unchanged.
    const causes = tr.reason
      ? tr.reason
          .split(' · ')
          .map((k) => {
            const translated = t('alarm.cause.' + k);
            return translated.startsWith('alarm.cause.') ? k : translated;
          })
          .join(' · ')
      : '?';
    const armedFor = tr.armedAt ? t('history.trigger.armedFor', fmtHM(tr.at - tr.armedAt)) : '';
    const sirenRan = tr.disarmedAt
      ? t('history.trigger.sirenRan', fmtHM(tr.disarmedAt - tr.at))
      : '';
    const disarmText = tr.disarmedAt
      ? t('history.trigger.disarmedBy', tr.disarmedBy, fmtHM(tr.disarmedAt - tr.at))
      : t('history.trigger.notDisarmed');
    div.innerHTML = `
      <div class="trigger-when">${fmtDateTime(tr.at)} · <span class="trigger-cause">${causes}</span></div>
      <div class="trigger-meta">
        ${armedFor ? `<span>${armedFor}</span>` : ''}
        ${sirenRan ? `<span>${sirenRan}</span>` : ''}
        <span>${disarmText}</span>
      </div>
    `;
    card.appendChild(div);
  }
}

// Build a flat list of intervals [{from, to, state}] from a recorder
// history array. State for an interval = the value reported at its
// start; the next sample's `last_changed` ends it.
function toIntervals(samples, from, to) {
  if (samples.length === 0) return [];
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    const start = new Date(samples[i].last_changed || samples[i].when);
    const end =
      i + 1 < samples.length ? new Date(samples[i + 1].last_changed || samples[i + 1].when) : to;
    if (end <= from || start >= to) continue;
    out.push({
      from: start < from ? from : start,
      to: end > to ? to : end,
      state: samples[i].state,
    });
  }
  return out;
}

function renderDoorGantt(history, from, to) {
  const svg = $('door-gantt');
  svg.innerHTML = '';
  const w = 1000;
  const h = 80;
  const span = to - from;
  const xOf = (d) => ((d - from) / span) * w;

  // Night shading first (bottom layer).
  const oneDayMs = 24 * 3600 * 1000;
  const days = Math.ceil(span / oneDayMs) + 1;
  for (let i = -1; i < days; i++) {
    const dayStart = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const { sunrise: rise, sunset: set } = sunTimesFor(dayStart, SITE.lat, SITE.lon);
    // Two night bands per day: midnight-rise, set-midnight(next).
    const bands = [
      { a: new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()), b: rise },
      { a: set, b: new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1) },
    ];
    for (const b of bands) {
      const a = b.a < from ? from : b.a;
      const z = b.b > to ? to : b.b;
      if (z <= a) continue;
      const x = xOf(a);
      const ww = xOf(z) - x;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', 0);
      rect.setAttribute('width', Math.max(0, ww));
      rect.setAttribute('height', h);
      rect.setAttribute('fill', 'rgba(255,255,255,0.05)');
      svg.appendChild(rect);
    }
  }

  // Door state intervals on top.
  const intervals = toIntervals(history, from, to);
  for (const iv of intervals) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const x = xOf(iv.from);
    const ww = xOf(iv.to) - x;
    rect.setAttribute('x', x);
    rect.setAttribute('y', 10);
    rect.setAttribute('width', Math.max(0.5, ww));
    rect.setAttribute('height', h - 20);
    rect.setAttribute('fill', iv.state === 'on' ? 'var(--door-open)' : 'var(--door-closed)');
    if (iv.state === 'on') rect.setAttribute('rx', 2);
    svg.appendChild(rect);
  }

  // Axis labels: 5 evenly-spaced ticks below the SVG.
  const axis = $('door-axis');
  axis.innerHTML = '';
  const ticks = 5;
  for (let i = 0; i < ticks; i++) {
    const at = new Date(from.getTime() + (span * i) / (ticks - 1));
    const span_el = document.createElement('span');
    span_el.textContent =
      span > oneDayMs * 2
        ? at.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
        : fmtClock(at);
    axis.appendChild(span_el);
  }
}

function renderStats(alarmHistory, doorHistory, from, to) {
  // armed time = total time in any "alarm active" state (armed_away,
  // pending entry-delay, or triggered). `arming` is excluded — that's
  // the legacy FSM warmup window, no longer a real panel state but
  // may appear in pre-Phase-2 recorder data.
  const alarmIv = toIntervals(alarmHistory, from, to);
  let armedMs = 0;
  let disarmCount = 0;
  let triggerCount = 0;
  let prevState = null;
  for (const iv of alarmIv) {
    const s = canonState(iv.state);
    if (s === 'armed' || s === 'triggered') {
      armedMs += iv.to - iv.from;
    }
    if (s === 'triggered' && prevState !== 'triggered') triggerCount++;
    if (s === 'disarmed' && prevState !== 'disarmed' && prevState !== null) disarmCount++;
    prevState = s;
  }

  // door-open time
  const doorIv = toIntervals(doorHistory, from, to);
  let openMs = 0;
  for (const iv of doorIv) if (iv.state === 'on') openMs += iv.to - iv.from;

  $('stat-armed').textContent = fmtHM(armedMs);
  $('stat-door-open').textContent = fmtHM(openMs);
  $('stat-triggers').textContent = String(triggerCount);
  $('stat-disarms').textContent = String(disarmCount);
}

// ---- Main load cycle ----

async function load() {
  const { from, to } = rangeBounds(_activeRange);
  try {
    const [alarmLog, reasonLog, alarmHistRaw, doorHistRaw] = await Promise.all([
      haLogbook(E.alarmState, from, to),
      haLogbook(E.triggerReason, from, to),
      haHistory(E.alarmState, from, to),
      haHistory(E.door, from, to),
    ]);
    renderStats(alarmHistRaw, doorHistRaw, from, to);
    renderDoorGantt(doorHistRaw, from, to);
    renderTriggers(alarmLog, reasonLog);
    renderEvents(alarmLog);
  } catch (err) {
    console.error('[history] load failed:', err);
  }
}

// ---- Wire up ----

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  const stamp = document.querySelector('.build-stamp');
  if (stamp) stamp.title = t('buildstamp.title', 'dashboard/history/index.html');

  for (const btn of document.querySelectorAll('.range-tab')) {
    btn.addEventListener('click', () => {
      _activeRange = btn.dataset.range;
      for (const b of document.querySelectorAll('.range-tab')) {
        b.classList.toggle('on', b === btn);
      }
      load();
    });
  }
  // Light refresh every 30 s so the dashboard reflects new events
  // without a page reload. `startPolling` also re-fires on tab visibility,
  // so swiping back from a backgrounded tab shows current state immediately.
  startPolling(load, 30 * 1000);
});
