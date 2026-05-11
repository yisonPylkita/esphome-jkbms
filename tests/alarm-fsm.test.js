// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { stepAlarm } = require('../dashboard/lib/alarm-fsm.js');

const MIN = 60 * 1000;
const SEC = 1000;

function ctx(over = {}) {
  return {
    now: 1_000_000,
    state: 'disarmed',
    stateSince: 1_000_000,
    doorOpen: false,
    motionMain: false,
    motionAux: false,
    tamper: false,
    sensorsAvailable: true,
    autoArmEnabled: true,
    armingQuietMinutes: 5,
    armingGraceSeconds: 10,
    sirenDurationS: 60,
    triggerReason: '',
    ...over,
  };
}

test('disarmed → arming when room is quiet AND auto-arm enabled', () => {
  const r = stepAlarm(ctx({ state: 'disarmed' }));
  assert.strictEqual(r.state, 'arming');
  assert.strictEqual(r.transitioned, true);
});

test('disarmed stays disarmed when door open', () => {
  const r = stepAlarm(ctx({ state: 'disarmed', doorOpen: true }));
  assert.strictEqual(r.state, 'disarmed');
});

test('disarmed stays disarmed when motion detected', () => {
  const r = stepAlarm(ctx({ state: 'disarmed', motionMain: true }));
  assert.strictEqual(r.state, 'disarmed');
  const r2 = stepAlarm(ctx({ state: 'disarmed', motionAux: true }));
  assert.strictEqual(r2.state, 'disarmed');
});

test('disarmed stays disarmed when auto-arm disabled', () => {
  const r = stepAlarm(ctx({ state: 'disarmed', autoArmEnabled: false }));
  assert.strictEqual(r.state, 'disarmed');
});

test('arming → armed after quiet period elapses', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 5 * MIN + 1,
    }),
  );
  assert.strictEqual(r.state, 'armed');
});

test('arming holds during the quiet window', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 4 * MIN,
    }),
  );
  assert.strictEqual(r.state, 'arming');
});

test('arming resets timer when motion happens (stays in arming)', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 2 * MIN,
      motionMain: true,
    }),
  );
  assert.strictEqual(r.state, 'arming');
  assert.strictEqual(r.stateSince, t0 + 2 * MIN);
});

test('arming resets timer when door opens (stays in arming)', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 2 * MIN,
      doorOpen: true,
    }),
  );
  assert.strictEqual(r.state, 'arming');
  assert.strictEqual(r.stateSince, t0 + 2 * MIN);
});

test('arming respects auto-arm-disabled by NOT progressing (timer freezes once we noticed via test of disarmed)', () => {
  // Note: arming doesn't observe autoArmEnabled — it's only a guard on
  // the disarmed→arming entry. Once in arming, we honour the timer.
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 6 * MIN,
      autoArmEnabled: false,
    }),
  );
  assert.strictEqual(r.state, 'armed');
});

test('armed: grace period suppresses immediate trigger', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'armed',
      stateSince: t0,
      now: t0 + 5 * SEC, // inside 10 s grace
      motionMain: true,
    }),
  );
  assert.strictEqual(r.state, 'armed');
});

test('armed → triggered on door open after grace, reason carries key', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'armed',
      stateSince: t0,
      now: t0 + 30 * SEC,
      doorOpen: true,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.match(r.triggerReason, /\bdoor\b/);
});

test('armed → triggered on aux motion after grace, reason carries key', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'armed',
      stateSince: t0,
      now: t0 + 30 * SEC,
      motionAux: true,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.match(r.triggerReason, /\bmotion_aux\b/);
});

test('armed → triggered combines cause keys when multiple sensors trip simultaneously', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'armed',
      stateSince: t0,
      now: t0 + 30 * SEC,
      doorOpen: true,
      motionMain: true,
      motionAux: true,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.match(r.triggerReason, /\bdoor\b/);
  assert.match(r.triggerReason, /\bmotion_main\b/);
  assert.match(r.triggerReason, /\bmotion_aux\b/);
});

test('triggered: siren on within siren_duration window', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'triggered',
      stateSince: t0,
      now: t0 + 30 * SEC,
      sirenDurationS: 60,
    }),
  );
  assert.strictEqual(r.sirenOn, true);
});

test('triggered: siren quiets after siren_duration but state stays triggered', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'triggered',
      stateSince: t0,
      now: t0 + 90 * SEC,
      sirenDurationS: 60,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.strictEqual(r.sirenOn, false);
});

test('triggered is latched — sensors going quiet do NOT clear it', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'triggered',
      stateSince: t0,
      now: t0 + 5 * MIN,
      doorOpen: false,
      motionMain: false,
      motionAux: false,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
});

test('manual disarm: external sets state=disarmed → FSM honours it', () => {
  // External writer sets state to 'disarmed' (e.g. user clicks DISARM).
  // FSM treats it as ground truth and continues from there.
  const r = stepAlarm(ctx({ state: 'disarmed', doorOpen: true }));
  // door is open → can't auto-arm → stays disarmed
  assert.strictEqual(r.state, 'disarmed');
});

// ---- Tamper (fast-path threat) ----

test('armed + tamper → triggered immediately, bypasses grace', () => {
  const t0 = 1_000_000;
  // Within grace window (5 s after entering armed).
  const r = stepAlarm(
    ctx({
      state: 'armed',
      stateSince: t0,
      now: t0 + 5 * SEC,
      tamper: true,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.strictEqual(r.triggerReason, 'tamper');
});

test('arming + tamper → triggered (sensor messed with mid-arm)', () => {
  const t0 = 1_000_000;
  const r = stepAlarm(
    ctx({
      state: 'arming',
      stateSince: t0,
      now: t0 + 2 * MIN,
      tamper: true,
    }),
  );
  assert.strictEqual(r.state, 'triggered');
  assert.strictEqual(r.triggerReason, 'tamper');
});

test('disarmed + tamper → stays disarmed (tamper is only armed-state threat)', () => {
  const r = stepAlarm(ctx({ state: 'disarmed', tamper: true }));
  assert.strictEqual(r.state, 'disarmed');
});

// ---- Unavailable-sensor refusal ----

test('disarmed + sensorsAvailable=false → refuses auto-arm', () => {
  // Otherwise-quiet room, but one of the sensors reads "unavailable".
  // We must NOT auto-arm — would arm with a blind sensor.
  const r = stepAlarm(ctx({ state: 'disarmed', sensorsAvailable: false }));
  assert.strictEqual(r.state, 'disarmed');
});

test('disarmed + sensorsAvailable=true → auto-arms as usual', () => {
  const r = stepAlarm(ctx({ state: 'disarmed', sensorsAvailable: true }));
  assert.strictEqual(r.state, 'arming');
});

test('sensorsAvailable defaults to true (backward compat)', () => {
  // Older Node-RED flow snapshots may not set this field.
  const c = ctx({ state: 'disarmed' });
  delete c.sensorsAvailable;
  const r = stepAlarm(c);
  assert.strictEqual(r.state, 'arming');
});
