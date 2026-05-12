// SPDX-License-Identifier: MIT
//
// Battery-room alarm dashboard.
//
// Reads the `alarm_control_panel.battery_room` entity (the canonical state
// holder in HA's idiomatic alarm domain) plus the policy helpers
// (`input_boolean.alarm_auto_arm_enabled`, the two `input_number`
// knobs) and the underlying sensors. Writes back through the standard
// `alarm_control_panel.alarm_arm_away` / `alarm_disarm` services.
//
// State translation is local: HA's panel states are the canonical
// English (disarmed / armed_away / pending / triggered) and we map
// them to Polish on display via the `alarm.state.*` i18n keys.

document.addEventListener('DOMContentLoaded', () => {
  applyI18n();
  const stamp = document.querySelector('.build-stamp');
  if (stamp) stamp.title = t('buildstamp.title', 'dashboard/alarm.html');
});

const HA_URL = '';
const TOKEN = 'PASTE_LONG_LIVED_ACCESS_TOKEN_HERE';
const POLL_MS = 1000;

const E = {
  panel: 'alarm_control_panel.battery_room',
  autoArm: 'input_boolean.alarm_auto_arm_enabled',
  quietMin: 'input_number.alarm_arming_quiet_minutes',
  sirenSec: 'input_number.alarm_siren_duration_s',
  reason: 'input_text.alarm_trigger_reason',
  sensorsOk: 'binary_sensor.alarm_sensors_ok',
  sensorsMissing: 'sensor.alarm_sensors_missing',
  door: 'binary_sensor.battery_room_door_contact',
  motionMain: 'binary_sensor.battery_room_motion_main_occupancy',
  motionAux: 'binary_sensor.battery_room_motion_aux_occupancy',
  siren: 'siren.battery_room_siren',
};

// Map panel.state → CSS class for the hero. `armed_away` collapses
// to the existing `armed` class so the green colour and any tooling
// keyed on it keep working; `pending` gets its own urgent style.
function stateClass(panelState) {
  if (panelState === 'armed_away') return 'armed';
  return panelState; // disarmed | arming | pending | triggered
}

// ---- Actions ----
$('btn-arm').onclick = () =>
  haCallService('alarm_control_panel', 'alarm_arm_away', { entity_id: E.panel });
$('btn-disarm').onclick = () =>
  haCallService('alarm_control_panel', 'alarm_disarm', { entity_id: E.panel });
function toggleAutoArm() {
  const el = $('switch-autoarm');
  const isOn = el.classList.contains('on');
  haCallService('input_boolean', isOn ? 'turn_off' : 'turn_on', { entity_id: E.autoArm });
}
$('switch-autoarm').addEventListener('click', toggleAutoArm);
$('switch-autoarm').addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    toggleAutoArm();
  }
});

function bindNumber(inputId, entity) {
  const el = $(inputId);
  el.addEventListener('change', () => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v))
      haCallService('input_number', 'set_value', { entity_id: entity, value: v });
  });
}
bindNumber('cfg-quiet-min', E.quietMin);
bindNumber('cfg-siren-sec', E.sirenSec);

// ---- Render ----
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60),
    sec = s % 60;
  return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}
function setSensor(elId, alertCondition, label) {
  const el = $(elId);
  el.classList.toggle('alert', alertCondition);
  el.classList.toggle('idle', !alertCondition);
  el.querySelector('.v').textContent = label;
}

let _lastEditTs = {};
function safeSetInput(elId, value) {
  const el = $(elId);
  if (document.activeElement === el) return;
  if (Date.now() - (_lastEditTs[elId] || 0) < 1500) return;
  el.value = value;
}
for (const id of ['cfg-quiet-min', 'cfg-siren-sec']) {
  $(id).addEventListener('input', () => {
    _lastEditTs[id] = Date.now();
  });
}

// When the panel is `disarmed` AND every auto-arm precondition is
// currently true, derive how much longer the quiet-hold window has to
// run before the auto-arm automation fires. Mirrors the server-side
// `for:` semantics: the timer starts at the latest last_changed among
// the relevant entities (whichever became "right" most recently).
//
// This is intentionally a UX-only derivation — the actual decision to
// arm is made by HA's automation engine. We just visualise the
// upcoming transition.
function deriveArmingProgress({ panel, autoArm, sensorsOk, door, mMain, mAux, quietMin }) {
  if (!panel || panel.state !== 'disarmed') return null;
  const required = [
    [autoArm, 'on'],
    [sensorsOk, 'on'],
    [door, 'off'],
    [mMain, 'off'],
    [mAux, 'off'],
  ];
  if (required.some(([e, s]) => !e || e.state !== s)) return null;
  const allLastChanged = [panel, autoArm, sensorsOk, door, mMain, mAux]
    .map((e) => new Date(e.last_changed || e.last_updated).getTime())
    .filter(Number.isFinite);
  if (!allLastChanged.length) return null;
  const conditionsTrueSince = Math.max(...allLastChanged);
  const elapsedMs = Date.now() - conditionsTrueSince;
  const targetMs = parseFloat(quietMin.state) * 60 * 1000;
  const remainingMs = Math.max(0, targetMs - elapsedMs);
  return { remainingMs, targetMs };
}

async function tick() {
  try {
    const [
      panel,
      autoArm,
      quiet,
      siren,
      reason,
      sensorsOk,
      sensorsMissing,
      door,
      mMain,
      mAux,
      sirenE,
    ] = await Promise.all([
      haGetState(E.panel),
      haGetState(E.autoArm),
      haGetState(E.quietMin),
      haGetState(E.sirenSec),
      haGetState(E.reason).catch(() => null),
      haGetState(E.sensorsOk).catch(() => null),
      haGetState(E.sensorsMissing).catch(() => null),
      haGetState(E.door).catch(() => null),
      haGetState(E.motionMain).catch(() => null),
      haGetState(E.motionAux).catch(() => null),
      haGetState(E.siren).catch(() => null),
    ]);
    $('stale').classList.remove('visible');

    // Sensor-degraded banner — true when any required sensor is
    // unavailable. The label comes from `sensor.alarm_sensors_missing`
    // which produces the list of which sensors are missing in Polish.
    const degraded = sensorsOk && sensorsOk.state === 'off';
    const banner = $('sensor-status');
    if (banner) {
      const msg = degraded && sensorsMissing ? `czujnik niedostępny: ${sensorsMissing.state}` : '';
      banner.textContent = msg;
      banner.classList.toggle('visible', !!msg);
    }

    const stateVal = panel.state;
    const stateName = $('state-name');
    // CSS class for colour / animation — collapse armed_away → armed.
    stateName.className = 'state-name ' + stateClass(stateVal);
    // Display label — `alarm.state.*` keys are keyed on the panel's
    // canonical state names; `armed_away` and `armed` both fall back
    // to the same Polish "UZBROJONY" via the i18n table.
    stateName.textContent = t('alarm.state.' + stateVal) || stateVal.toUpperCase();

    // Detail line. We distinguish three info contexts:
    //   1. About to arm — countdown derived from auto-arm preconditions.
    //   2. Pending — panel's entry-delay countdown to triggered.
    //   3. Armed — how long the alarm has been armed.
    //   4. Triggered — humanised reason + how long ago.
    const detail = $('state-detail');
    let detailText = ' ';
    const arming = deriveArmingProgress({
      panel,
      autoArm,
      sensorsOk,
      door,
      mMain,
      mAux,
      quietMin: quiet,
    });
    const stateSinceMs = new Date(panel.last_changed || panel.last_updated).getTime();
    const elapsedMs = Date.now() - stateSinceMs;
    if (arming && arming.remainingMs > 0) {
      // Visually emulate the "arming" state class so the eye picks up
      // that something is happening, even though the panel itself is
      // still `disarmed`.
      stateName.classList.add('arming');
      detailText = t('alarm.detail.arming', fmtElapsed(arming.remainingMs));
    } else if (stateVal === 'pending') {
      // Panel's entry-delay window: a sensor went on while armed; the
      // user has `delay_time` seconds to disarm before triggered.
      detailText = t('alarm.detail.pending', fmtElapsed(elapsedMs));
    } else if (stateVal === 'armed_away') {
      detailText = t('alarm.detail.armed', fmtElapsed(elapsedMs));
    } else if (stateVal === 'triggered') {
      const raw = (reason && reason.state) || '';
      const human = raw
        ? raw
            .split(' · ')
            .map((k) => t('alarm.cause.' + k))
            .join(' · ')
        : '?';
      detailText = t('alarm.detail.triggered', human, fmtElapsed(elapsedMs));
    }
    detail.textContent = detailText;

    // Buttons: ARM is only meaningful when fully disarmed; DISARM is
    // meaningful in every non-disarmed state, including `pending`.
    $('btn-arm').disabled = stateVal !== 'disarmed';
    $('btn-disarm').disabled = stateVal === 'disarmed';

    const autoOn = autoArm.state === 'on';
    $('switch-autoarm').classList.toggle('on', autoOn);
    $('switch-autoarm').setAttribute('aria-checked', String(autoOn));

    const dOn = door && door.state === 'on';
    const m1On = mMain && mMain.state === 'on';
    const m2On = mAux && mAux.state === 'on';
    const sOn = sirenE && sirenE.state === 'on';
    setSensor(
      'sensor-door',
      dOn,
      door ? t(dOn ? 'alarm.sensor.door.open' : 'alarm.sensor.door.closed') : '--',
    );
    setSensor(
      'sensor-motion-main',
      m1On,
      mMain ? t(m1On ? 'alarm.sensor.motion.detected' : 'alarm.sensor.motion.quiet') : '--',
    );
    setSensor(
      'sensor-motion-aux',
      m2On,
      mAux ? t(m2On ? 'alarm.sensor.motion.detected' : 'alarm.sensor.motion.quiet') : '--',
    );
    setSensor(
      'sensor-siren',
      sOn,
      sirenE ? t(sOn ? 'alarm.sensor.siren.ringing' : 'alarm.sensor.siren.idle') : '--',
    );

    safeSetInput('cfg-quiet-min', parseFloat(quiet.state));
    safeSetInput('cfg-siren-sec', parseFloat(siren.state));
  } catch (e) {
    console.warn(e);
    $('stale').classList.add('visible');
  }
}

startPolling(tick, POLL_MS);

document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select')) return;
  if (e.key === 'a' || e.key === 'A') location.href = 'bms-integrated.html';
});
