    // Apply i18n to static markup once on first paint, then again whenever
    // setLang() is called downstream. Build-stamp tooltip is dynamic — its
    // {0} param is the relative source path so the user can sha256sum it.
    document.addEventListener('DOMContentLoaded', () => {
      applyI18n();
      const stamp = document.querySelector('.build-stamp');
      if (stamp) stamp.title = t('buildstamp.title', 'dashboard/alarm.html');
    });

    const HA_URL = '';
    const TOKEN  = 'PASTE_LONG_LIVED_ACCESS_TOKEN_HERE';
    const POLL_MS = 1000;

    const E = {
      state:           'input_select.alarm_state',
      autoArm:         'input_boolean.alarm_auto_arm_enabled',
      quietMin:        'input_number.alarm_arming_quiet_minutes',
      graceSec:        'input_number.alarm_arming_grace_seconds',
      sirenSec:        'input_number.alarm_siren_duration_s',
      reason:          'input_text.alarm_trigger_reason',
      door:            'binary_sensor.battery_room_door_contact',
      motionMain:      'binary_sensor.battery_room_motion_main_occupancy',
      motionAux:       'binary_sensor.battery_room_motion_aux_occupancy',
      siren:           'siren.battery_room_siren',
    };

    const $ = (id) => document.getElementById(id);

    async function getState(id) {
      const r = await fetch(`${HA_URL}/api/states/${id}`, {
        headers: { 'Authorization': 'Bearer ' + TOKEN }, cache: 'no-store',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }
    async function callService(domain, service, data) {
      const r = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }

    // ---- Actions ----
    $('btn-arm').onclick    = () => callService('input_select', 'select_option', { entity_id: E.state, option: 'arming' });
    $('btn-disarm').onclick = () => callService('input_select', 'select_option', { entity_id: E.state, option: 'disarmed' });
    $('switch-autoarm').onclick = (e) => {
      const isOn = e.currentTarget.classList.contains('on');
      callService('input_boolean', isOn ? 'turn_off' : 'turn_on', { entity_id: E.autoArm });
    };

    // Bind advanced inputs — write on change.
    function bindNumber(inputId, entity) {
      const el = $(inputId);
      el.addEventListener('change', () => {
        const v = parseFloat(el.value);
        if (Number.isFinite(v)) callService('input_number', 'set_value', { entity_id: entity, value: v });
      });
    }
    bindNumber('cfg-quiet-min', E.quietMin);
    bindNumber('cfg-grace-sec', E.graceSec);
    bindNumber('cfg-siren-sec', E.sirenSec);

    // ---- Render ----
    function fmtElapsed(ms) {
      const s = Math.max(0, Math.floor(ms / 1000));
      const m = Math.floor(s / 60), sec = s % 60;
      return m > 0 ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
    }
    function setSensor(elId, alertCondition, label) {
      const el = $(elId);
      el.classList.toggle('alert', alertCondition);
      el.classList.toggle('idle',  !alertCondition);
      el.querySelector('.v').textContent = label;
    }

    let _lastEditTs = {};      // throttle: don't overwrite while user is editing
    function safeSetInput(elId, value) {
      const el = $(elId);
      if (document.activeElement === el) return;     // user is editing, skip
      if (Date.now() - (_lastEditTs[elId] || 0) < 1500) return;
      el.value = value;
    }
    for (const id of ['cfg-quiet-min', 'cfg-grace-sec', 'cfg-siren-sec']) {
      $(id).addEventListener('input', () => { _lastEditTs[id] = Date.now(); });
    }

    async function tick() {
      try {
        const [st, autoArm, quiet, grace, siren, reason, door, mMain, mAux, sirenE] = await Promise.all([
          getState(E.state), getState(E.autoArm),
          getState(E.quietMin), getState(E.graceSec), getState(E.sirenSec),
          getState(E.reason).catch(() => null),
          getState(E.door).catch(() => null),
          getState(E.motionMain).catch(() => null),
          getState(E.motionAux).catch(() => null),
          getState(E.siren).catch(() => null),
        ]);
        $('stale').classList.remove('visible');

        // Hero — internal state names (disarmed/arming/armed/triggered) stay
        // English in HA so the FSM and other consumers don't have to deal
        // with localised strings; we map to Polish only on display here.
        const stateVal = st.state;
        const stateName = $('state-name');
        stateName.className = 'state-name ' + stateVal;
        stateName.textContent = t('alarm.state.' + stateVal) || stateVal.toUpperCase();

        // State detail line
        const detail = $('state-detail');
        const stateSinceMs = new Date(st.last_changed || st.last_updated).getTime();
        const elapsedMs = Date.now() - stateSinceMs;
        let detailText = '';
        if (stateVal === 'arming') {
          const targetMs = parseFloat(quiet.state) * 60 * 1000;
          const remaining = Math.max(0, targetMs - elapsedMs);
          detailText = t('alarm.detail.arming', fmtElapsed(remaining));
        } else if (stateVal === 'armed') {
          detailText = t('alarm.detail.armed', fmtElapsed(elapsedMs));
        } else if (stateVal === 'triggered') {
          // Reason is a `·`-joined list of cause keys emitted by the FSM
          // (e.g. "door · motion_main"); translate each via the i18n map.
          const raw = (reason && reason.state) || '';
          const human = raw
            ? raw.split(' · ').map(k => t('alarm.cause.' + k)).join(' · ')
            : '?';
          detailText = t('alarm.detail.triggered', human, fmtElapsed(elapsedMs));
        } else {
          detailText = ' ';                     // nbsp keeps height
        }
        detail.textContent = detailText;

        // Buttons: only enable what's relevant
        $('btn-arm').disabled    = (stateVal !== 'disarmed');
        $('btn-disarm').disabled = (stateVal === 'disarmed');

        // Auto-arm switch
        $('switch-autoarm').classList.toggle('on', autoArm.state === 'on');

        // Sensors
        const dOn = door && door.state === 'on';
        const m1On = mMain && mMain.state === 'on';
        const m2On = mAux && mAux.state === 'on';
        const sOn = sirenE && sirenE.state === 'on';
        setSensor('sensor-door',        dOn,  door  ? t(dOn  ? 'alarm.sensor.door.open'       : 'alarm.sensor.door.closed')  : '--');
        setSensor('sensor-motion-main', m1On, mMain ? t(m1On ? 'alarm.sensor.motion.detected' : 'alarm.sensor.motion.quiet') : '--');
        setSensor('sensor-motion-aux',  m2On, mAux  ? t(m2On ? 'alarm.sensor.motion.detected' : 'alarm.sensor.motion.quiet') : '--');
        setSensor('sensor-siren',       sOn,  sirenE ? t(sOn ? 'alarm.sensor.siren.ringing'   : 'alarm.sensor.siren.idle')   : '--');

        // Advanced inputs
        safeSetInput('cfg-quiet-min', parseFloat(quiet.state));
        safeSetInput('cfg-grace-sec', parseFloat(grace.state));
        safeSetInput('cfg-siren-sec', parseFloat(siren.state));
      } catch (e) {
        console.warn(e);
        $('stale').classList.add('visible');
      }
    }

    tick();
    setInterval(tick, POLL_MS);

    document.addEventListener('keydown', (e) => {
      if (e.target.matches?.('input, textarea, select')) return;
      if (e.key === 'a' || e.key === 'A') location.href = 'bms-integrated.html';
    });
