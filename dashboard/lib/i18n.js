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
//
// To add a third language, extend `T` with a new top-level key (e.g. `de`,
// `fr`); `_detectLang` already auto-accepts any key present in `T` that
// matches the first two chars of `<html lang="...">`. Strings missing from
// a non-default language fall back to PL (the user's father is the primary
// user). Setting `lang` via the URL is not currently supported —
// `<html lang="...">` is read once on script-load.

const T = {
  pl: {
    // ---- BMS main dashboard ----
    'bms.appTitle': 'BMS',
    'bms.stale': 'BMS — BRAK POŁĄCZENIA',
    'bms.power': 'moc',
    'bms.idle': 'spoczynek',
    'bms.charging': 'ładowanie',
    'bms.discharging': 'rozładowywanie', // matches the gerund form of "ładowanie"
    'bms.steady': 'stabilnie',
    'bms.toEmpty': 'do rozładowania',
    'bms.toFull': 'do naładowania',
    'bms.alarmLink': 'alarm ›',
    // "Alarm akumulatorów" alone is ambiguous (could mean a battery-fault
    // alarm). Clarify it's the alarm guarding the battery ROOM.
    'bms.alarmTitle': 'Alarm pomieszczenia akumulatorów',
    'bms.alarmAria': 'Otwórz panel alarmu',
    'bms.advLink': 'diag ›',
    'bms.advTitle': 'Diagnostyka (po angielsku)',
    'bms.advAria': 'Otwórz diagnostykę',
    'bms.predict.today': 'Dziś',
    'bms.predict.tomorrow': 'Jutro',

    // ---- Alarm dashboard ----
    'alarm.docTitle': 'Alarm pomieszczenia akumulatorów',
    'alarm.appTitle': 'Alarm',
    'alarm.haStale': 'HA — BRAK POŁĄCZENIA',
    'alarm.location': 'pomieszczenie akumulatorów',
    'alarm.btnArm': 'UZBRÓJ',
    'alarm.btnDisarm': 'ROZBRÓJ',
    'alarm.sensor.door': 'drzwi',
    'alarm.sensor.motionMain': 'ruch (główny)',
    // `pomocniczy` ("auxiliary") matches the role of a secondary
    // coverage sensor better than `zapasowy` ("spare / on standby").
    'alarm.sensor.motionAux': 'ruch (pomocniczy)',
    'alarm.sensor.siren': 'syrena',
    'alarm.sensor.door.open': 'OTWARTE',
    'alarm.sensor.door.closed': 'zamknięte',
    'alarm.sensor.motion.detected': 'RUCH',
    // "cisza" reads as acoustic silence; for a PIR sensor "spokój"
    // (calm / no activity) is the right register.
    'alarm.sensor.motion.quiet': 'spokój',
    // A siren wails, it doesn't ring — and what the user wants to know
    // is whether it's on, not the verb for its sound. "WŁĄCZONA" is
    // unambiguous; matches "wyłączona" for the off state.
    'alarm.sensor.siren.ringing': 'WŁĄCZONA',
    'alarm.sensor.siren.idle': 'wyłączona',
    'alarm.autoarm.label': 'auto-uzbrajanie',
    // "kiedy jesteś w pomieszczeniu" is broader than "pracujesz" — covers
    // any time the user is inside, not just working.
    'alarm.autoarm.hint': 'wyłącz, kiedy jesteś w pomieszczeniu',
    'alarm.autoarm.aria': 'auto-uzbrajanie włączone',
    'alarm.adv.summary': 'ustawienia zaawansowane',
    'alarm.adv.quiet.name': 'okres ciszy przed uzbrojeniem (min)',
    // Grammar fix: previous version mixed singular agreement with plural
    // `minut` and put `wymagane` in the wrong case.
    'alarm.adv.quiet.desc':
      'liczba minut zamkniętych drzwi i braku ruchu wymaganych przed auto-uzbrojeniem',
    // "karencja" is legal/medical jargon. The alarm-domain Polish term
    // for the exit-delay grace window is "czas wyjścia".
    'alarm.adv.grace.name': 'czas wyjścia (s)',
    'alarm.adv.grace.desc':
      'ile sekund po uzbrojeniu czujniki są ignorowane (czas na opuszczenie pomieszczenia)',
    'alarm.adv.siren.name': 'czas pracy syreny (s)',
    'alarm.adv.siren.desc':
      'jak długo wyje syrena po wyzwoleniu; alarm pozostaje aktywny aż do rozbrojenia',
    'alarm.toggle.main.text': '‹ główny',
    'alarm.toggle.main.title': 'Wróć do panelu głównego',
    'alarm.state.disarmed': 'ROZBROJONY',
    'alarm.state.arming': 'UZBRAJANIE',
    'alarm.state.armed': 'UZBROJONY',
    'alarm.state.triggered': 'ALARM',
    'alarm.detail.arming': 'uzbrojenie za {0} — musi być cicho',
    'alarm.detail.armed': 'uzbrojony od {0}',
    'alarm.detail.triggered': '{0} · {1} temu',
    'alarm.cause.door': 'otwarcie drzwi',
    'alarm.cause.motion_main': 'ruch (główny)',
    'alarm.cause.motion_aux': 'ruch (pomocniczy)',
    'alarm.sensor.unavailable': 'czujnik niedostępny',
    'alarm.history.link': 'historia ›',
    'alarm.history.linkTitle': 'Historia uzbrojeń i alarmów',

    // ---- History dashboard ----
    'history.docTitle': 'Historia alarmu',
    'history.appTitle': 'Historia',
    'history.range.day': 'dzisiaj',
    'history.range.week': '7 dni',
    'history.range.month': '30 dni',
    'history.section.stats': 'podsumowanie',
    'history.section.door': 'historia drzwi',
    'history.section.events': 'uzbrojenia i rozbrojenia',
    'history.section.triggers': 'alarmy',
    'history.stat.armedTime': 'czas uzbrojenia',
    'history.stat.doorOpenTime': 'drzwi otwarte',
    'history.stat.triggerCount': 'wyzwolenia alarmu',
    'history.stat.disarmCount': 'rozbrojenia',
    'history.event.armed': 'uzbrojony',
    'history.event.arming': 'rozpoczęto uzbrajanie',
    'history.event.disarmed': 'rozbrojony',
    'history.event.triggered': 'alarm wyzwolony',
    'history.event.unknown': 'inny stan',
    'history.event.by': 'przez',
    'history.event.user.unknown': 'nieznany',
    'history.event.user.dashboard': 'panel',
    'history.event.user.automation': 'automatyzacja',
    'history.trigger.armedFor': 'po {0} od uzbrojenia',
    'history.trigger.sirenRan': 'syrena wyła {0}',
    'history.trigger.disarmedBy': 'rozbrojono przez {0} po {1}',
    'history.trigger.notDisarmed': 'nie rozbrojono',
    'history.empty.events': 'brak zdarzeń w wybranym zakresie',
    'history.empty.triggers': 'żadnych wyzwoleń alarmu w tym okresie — dobrze 🙂',
    'history.door.open': 'otwarte',
    'history.door.closed': 'zamknięte',
    'history.door.night': 'noc',
    'history.toggle.alarm.text': '‹ alarm',
    'history.toggle.alarm.title': 'Wróć do panelu alarmu',

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
    'alarm.sensor.unavailable': 'sensor unavailable',
    'alarm.history.link': 'history ›',
    'alarm.history.linkTitle': 'Arm / disarm / trigger history',

    'history.docTitle': 'Alarm history',
    'history.appTitle': 'History',
    'history.range.day': 'today',
    'history.range.week': '7 days',
    'history.range.month': '30 days',
    'history.section.stats': 'summary',
    'history.section.door': 'door timeline',
    'history.section.events': 'arm / disarm log',
    'history.section.triggers': 'triggers',
    'history.stat.armedTime': 'armed for',
    'history.stat.doorOpenTime': 'door open',
    'history.stat.triggerCount': 'alarm trips',
    'history.stat.disarmCount': 'disarms',
    'history.event.armed': 'armed',
    'history.event.arming': 'arming started',
    'history.event.disarmed': 'disarmed',
    'history.event.triggered': 'alarm triggered',
    'history.event.unknown': 'other state',
    'history.event.by': 'by',
    'history.event.user.unknown': 'unknown',
    'history.event.user.dashboard': 'dashboard',
    'history.event.user.automation': 'automation',
    'history.trigger.armedFor': '{0} after arming',
    'history.trigger.sirenRan': 'siren ran for {0}',
    'history.trigger.disarmedBy': 'disarmed by {0} after {1}',
    'history.trigger.notDisarmed': 'not disarmed',
    'history.empty.events': 'no events in this range',
    'history.empty.triggers': 'no alarm trips in this window — good 🙂',
    'history.door.open': 'open',
    'history.door.closed': 'closed',
    'history.door.night': 'night',
    'history.toggle.alarm.text': '‹ alarm',
    'history.toggle.alarm.title': 'Back to alarm dashboard',

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
