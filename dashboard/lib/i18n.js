// SPDX-License-Identifier: MIT
//
// Tiny i18n layer. Default Polish (the dashboards in /local/ are for the
// owner's father); English maintained alongside as a fallback / for the
// diagnostic dashboard. Language is picked from `<html lang>` at module
// load time.
//
// Static text in templates: `<span data-i18n="key"></span>` + `applyI18n()`
// once on DOMContentLoaded. Dynamic text in JS: `t('key')` or
// `t('key', param0, param1)` (positional `{0}` / `{1}` substitution).

const T = {
  pl: {
    // ---- BMS main dashboard ----
    'bms.appTitle': 'BMS',
    'bms.stale': 'BMS — BRAK POŁĄCZENIA',
    'bms.power': 'moc',
    'bms.idle': 'spoczynek',
    'bms.charging': 'ładowanie',
    'bms.discharging': 'rozładowanie',
    'bms.steady': 'stabilnie',
    'bms.toEmpty': 'do rozładowania',
    'bms.toFull': 'do naładowania',
    'bms.alarmLink': 'alarm ›',
    'bms.alarmTitle': 'Alarm akumulatorów',
    'bms.alarmAria': 'Otwórz panel alarmu',
    'bms.advLink': 'diag ›',
    'bms.advTitle': 'Diagnostyka (po angielsku)',
    'bms.advAria': 'Otwórz diagnostykę',
    'bms.predict.today': 'Dziś',
    'bms.predict.tomorrow': 'Jutro',

    // ---- Alarm dashboard ----
    'alarm.docTitle': 'Alarm akumulatorów',
    'alarm.appTitle': 'Alarm',
    'alarm.haStale': 'HA — BRAK POŁĄCZENIA',
    'alarm.location': 'pomieszczenie akumulatorów',
    'alarm.btnArm': 'UZBRÓJ',
    'alarm.btnDisarm': 'ROZBRÓJ',
    'alarm.sensor.door': 'drzwi',
    'alarm.sensor.motionMain': 'ruch (główny)',
    'alarm.sensor.motionAux': 'ruch (zapasowy)',
    'alarm.sensor.siren': 'syrena',
    'alarm.sensor.door.open': 'OTWARTE',
    'alarm.sensor.door.closed': 'zamknięte',
    'alarm.sensor.motion.detected': 'RUCH',
    'alarm.sensor.motion.quiet': 'cisza',
    'alarm.sensor.siren.ringing': 'DZWONI',
    'alarm.sensor.siren.idle': 'spoczynek',
    'alarm.autoarm.label': 'auto-uzbrajanie',
    'alarm.autoarm.hint': 'wyłącz, gdy pracujesz w pomieszczeniu',
    'alarm.autoarm.aria': 'auto-uzbrajanie włączone',
    'alarm.adv.summary': 'ustawienia zaawansowane',
    'alarm.adv.quiet.name': 'czas ciszy do uzbrojenia (min)',
    'alarm.adv.quiet.desc':
      'ile minut zamkniętych drzwi i braku ruchu jest wymagane przed auto-uzbrojeniem',
    'alarm.adv.grace.name': 'karencja po uzbrojeniu (s)',
    'alarm.adv.grace.desc':
      'ile sekund po uzbrojeniu czujniki są ignorowane (czas na opuszczenie pomieszczenia)',
    'alarm.adv.siren.name': 'czas trwania syreny (s)',
    'alarm.adv.siren.desc':
      'jak długo dzwoni syrena po wyzwoleniu; stan alarmu pozostaje aktywny aż do rozbrojenia',
    'alarm.toggle.main.text': '‹ główny',
    'alarm.toggle.main.title': 'Wróć do panelu głównego',
    'alarm.state.disarmed': 'ROZBROJONY',
    'alarm.state.arming': 'UZBRAJANIE',
    'alarm.state.armed': 'UZBROJONY',
    'alarm.state.triggered': 'ALARM',
    'alarm.detail.arming': 'uzbrojenie za {0} — musi panować cisza',
    'alarm.detail.armed': 'uzbrojony od {0}',
    'alarm.detail.triggered': '{0} · {1} temu',
    'alarm.cause.door': 'otwarcie drzwi',
    'alarm.cause.motion_main': 'ruch (główny)',
    'alarm.cause.motion_aux': 'ruch (zapasowy)',

    // ---- Build stamp tooltip (shared, {0} = source filename) ----
    'buildstamp.title':
      'Identyfikator wersji panelu (porównaj z `sha256sum {0}` lokalnie, aby zweryfikować wdrożenie)',
  },

  en: {
    'bms.appTitle': 'BMS',
    'bms.stale': 'BMS — NO LINK',
    'bms.power': 'power',
    'bms.idle': 'idle',
    'bms.charging': 'charging',
    'bms.discharging': 'discharging',
    'bms.steady': 'steady',
    'bms.toEmpty': 'to empty',
    'bms.toFull': 'to full',
    'bms.alarmLink': 'alarm ›',
    'bms.alarmTitle': 'Battery-room alarm',
    'bms.alarmAria': 'Open alarm dashboard',
    'bms.advLink': 'diag ›',
    'bms.advTitle': 'Diagnostics',
    'bms.advAria': 'Open diagnostics',
    'bms.predict.today': 'Today',
    'bms.predict.tomorrow': 'Tomorrow',

    'alarm.docTitle': 'Battery-room alarm',
    'alarm.appTitle': 'Alarm',
    'alarm.haStale': 'HA — NO LINK',
    'alarm.location': 'battery room',
    'alarm.btnArm': 'ARM',
    'alarm.btnDisarm': 'DISARM',
    'alarm.sensor.door': 'door',
    'alarm.sensor.motionMain': 'motion (main)',
    'alarm.sensor.motionAux': 'motion (aux)',
    'alarm.sensor.siren': 'siren',
    'alarm.sensor.door.open': 'OPEN',
    'alarm.sensor.door.closed': 'closed',
    'alarm.sensor.motion.detected': 'MOTION',
    'alarm.sensor.motion.quiet': 'quiet',
    'alarm.sensor.siren.ringing': 'RINGING',
    'alarm.sensor.siren.idle': 'idle',
    'alarm.autoarm.label': 'auto-arm',
    'alarm.autoarm.hint': 'disable when working in the room',
    'alarm.autoarm.aria': 'auto-arm enabled',
    'alarm.adv.summary': 'advanced settings',
    'alarm.adv.quiet.name': 'arming quiet window (min)',
    'alarm.adv.quiet.desc': 'minutes of closed door and no motion required before auto-arm',
    'alarm.adv.grace.name': 'post-arm grace (s)',
    'alarm.adv.grace.desc':
      'seconds after arming during which sensors are ignored (time to leave the room)',
    'alarm.adv.siren.name': 'siren duration (s)',
    'alarm.adv.siren.desc':
      'how long the siren rings after a trip; alarm state stays latched until disarmed',
    'alarm.toggle.main.text': '‹ main',
    'alarm.toggle.main.title': 'Back to main dashboard',
    'alarm.state.disarmed': 'DISARMED',
    'alarm.state.arming': 'ARMING',
    'alarm.state.armed': 'ARMED',
    'alarm.state.triggered': 'TRIGGERED',
    'alarm.detail.arming': 'arming in {0} — needs quiet',
    'alarm.detail.armed': 'armed for {0}',
    'alarm.detail.triggered': '{0} · {1} ago',
    'alarm.cause.door': 'door opened',
    'alarm.cause.motion_main': 'motion (main)',
    'alarm.cause.motion_aux': 'motion (aux)',

    'buildstamp.title': 'Build identifier (compare with `sha256sum {0}` locally to verify deploy)',
  },
};

function _detectLang() {
  const html = typeof document !== 'undefined' ? document.documentElement.lang : '';
  const lang = (html || '').toLowerCase().slice(0, 2);
  return T[lang] ? lang : 'pl';
}

let _lang = _detectLang();
function getLang() {
  return _lang;
}
function setLang(lang) {
  if (T[lang]) {
    _lang = lang;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      applyI18n();
    }
  }
}

function t(key, ...params) {
  const tbl = T[_lang] || T.pl;
  let s = tbl[key];
  if (s === undefined) {
    if (typeof console !== 'undefined') console.warn('[i18n] missing key:', key, '@', _lang);
    s = T.pl[key] ?? key;
  }
  if (params.length) s = s.replace(/\{(\d+)\}/g, (_, i) => params[+i] ?? '');
  return s;
}

// Walk the DOM once and substitute text for elements carrying:
//   data-i18n="key"             → element.textContent
//   data-i18n-title="key"       → element.title
//   data-i18n-aria="key"        → element.aria-label
function applyI18n(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]'))
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
}

if (typeof module !== 'undefined') module.exports = { T, t, getLang, setLang, applyI18n };
