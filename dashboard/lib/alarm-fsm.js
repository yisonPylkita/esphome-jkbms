// SPDX-License-Identifier: MIT
//
// Battery-room alarm finite-state machine. Pure function — testable from
// Node, also evaluated inside the Node-RED FSM function node (which loads
// it via the deploy-time inline pass).
//
// States:
//   disarmed   sensors are reported but ignored. The only state where
//              the system is "off". Transitions OUT only via auto-arm
//              (when conditions are met) or manual ARM (set externally).
//   arming     waiting for a quiet window. Door must stay closed AND
//              both motion sensors must read no-motion for
//              `armingQuietMinutes`. Any sensor activity resets the timer.
//   armed      the alarm is live. After a brief grace period, any sensor
//              trip moves to `triggered`. Tamper bypasses the grace
//              period — tampering with a sensor is a fast-path threat.
//   triggered  alarm condition met. Siren rings for `sirenDurationS` then
//              quiets, but state stays `triggered` until manually reset
//              (UI writes 'disarmed' to the input_select).
//
// Inputs (single ctx object so the FSM stays pure):
//   ctx.now                  Date.now() in ms
//   ctx.state                current state ('disarmed' | 'arming' | 'armed' | 'triggered')
//   ctx.stateSince           ms timestamp of last state transition
//   ctx.doorOpen             boolean
//   ctx.motionMain           boolean
//   ctx.motionAux            boolean
//   ctx.tamper               boolean — OR of every available tamper sensor
//   ctx.sensorsAvailable     boolean — false if ANY required sensor reads
//                            'unavailable' or 'unknown'; gates auto-arm so
//                            the system never arms with a blind sensor
//   ctx.autoArmEnabled       boolean — input_boolean.alarm_auto_arm_enabled
//   ctx.armingQuietMinutes   number  — minutes of quiet before auto-arm
//   ctx.armingGraceSeconds   number  — leeway after armed before any motion trips
//   ctx.sirenDurationS       number  — siren ring duration
//
// Returns:
//   { state, stateSince, sirenOn, triggerReason, transitioned }
//
// `transitioned` is true on any state change vs ctx.state — caller uses
// it to fire one-shot side effects (push notification, set input_text,
// publish MQTT siren start, etc.).
//
// Manual arm/disarm is handled OUTSIDE the FSM by writing the desired
// state directly to input_select.alarm_state. The next FSM tick will
// continue from whatever state is set there. This keeps the FSM
// unaware of UI and avoids "manual" vs "auto" branch logic inside it.

function stepAlarm(ctx) {
  const motion = !!(ctx.motionMain || ctx.motionAux);
  const door = !!ctx.doorOpen;
  const tamper = !!ctx.tamper;
  // Default true when the caller hasn't wired the availability check —
  // keeps the FSM backward-compatible with older flow snapshots.
  const sensorsAvailable = ctx.sensorsAvailable !== false;

  let state = ctx.state || 'disarmed';
  let stateSince = ctx.stateSince || ctx.now;
  let triggerReason = ctx.triggerReason || '';

  const set = (s, reason) => {
    state = s;
    stateSince = ctx.now;
    if (reason !== undefined) triggerReason = reason;
  };

  switch (state) {
    case 'disarmed': {
      // Auto-arm: once auto-arm is enabled and the room is quiet
      // (door closed + no motion + no tamper) AND every sensor reports
      // a real value, start the arming countdown. Manual arm (UI
      // button) sets state directly so doesn't need a branch here.
      if (ctx.autoArmEnabled && !door && !motion && !tamper && sensorsAvailable) {
        set('arming');
      }
      break;
    }
    case 'arming': {
      // Tamper during arming → straight to triggered. Someone is
      // messing with a sensor before the system fully arms; treat as
      // hostile.
      if (tamper) {
        set('triggered', 'tamper');
        break;
      }
      if (door || motion) {
        // Reset the timer — the room isn't actually quiet yet.
        stateSince = ctx.now;
        break;
      }
      const elapsedMs = ctx.now - stateSince;
      const requiredMs = (ctx.armingQuietMinutes || 5) * 60 * 1000;
      if (elapsedMs >= requiredMs) set('armed');
      break;
    }
    case 'armed': {
      // Tamper bypasses the grace period. Door + motion respect grace
      // (someone walking out shouldn't self-trigger). Tampering is
      // always intentional.
      if (tamper) {
        set('triggered', 'tamper');
        break;
      }
      const sinceArmedMs = ctx.now - stateSince;
      const graceMs = (ctx.armingGraceSeconds || 10) * 1000;
      if (sinceArmedMs < graceMs) break;

      // Emit cause KEYS (not human strings) so the dashboard + Node-RED
      // push-notification can each localise downstream via the i18n map.
      // Persisted in HA `input_text.alarm_trigger_reason` as well — keys
      // are language-stable, human strings drift.
      const reasons = [];
      if (door) reasons.push('door');
      if (ctx.motionMain) reasons.push('motion_main');
      if (ctx.motionAux) reasons.push('motion_aux');
      if (reasons.length) set('triggered', reasons.join(' · '));
      break;
    }
    case 'triggered': {
      // External (dashboard / HA service) clears this by writing
      // 'disarmed' to the input_select. Latched here on purpose.
      break;
    }
  }

  // Siren is on while state is 'triggered' AND we're within
  // sirenDurationS of when we entered the state. Beyond that, state
  // remains 'triggered' (visual alert latched) but the siren goes quiet.
  let sirenOn = false;
  if (state === 'triggered') {
    const sirenMs = (ctx.sirenDurationS || 60) * 1000;
    sirenOn = ctx.now - stateSince < sirenMs;
  }

  return {
    state,
    stateSince,
    sirenOn,
    triggerReason,
    transitioned: state !== (ctx.state || 'disarmed'),
  };
}

if (typeof module !== 'undefined') module.exports = { stepAlarm };
