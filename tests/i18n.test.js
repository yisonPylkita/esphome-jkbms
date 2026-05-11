// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { T, t, getLang, setLang, applyI18n } = require('../dashboard/lib/i18n.js');
const { fakeElement, fakeDocument } = require('./_dom-mock.js');

test('every PL key has an EN counterpart and vice versa', () => {
  const pl = Object.keys(T.pl).sort();
  const en = Object.keys(T.en).sort();
  const onlyInPl = pl.filter((k) => !T.en[k]);
  const onlyInEn = en.filter((k) => !T.pl[k]);
  assert.deepStrictEqual(onlyInPl, [], `PL has keys missing in EN: ${onlyInPl.join(', ')}`);
  assert.deepStrictEqual(onlyInEn, [], `EN has keys missing in PL: ${onlyInEn.join(', ')}`);
});

test('default lang is pl (no DOM in Node)', () => {
  assert.strictEqual(getLang(), 'pl');
  assert.strictEqual(t('alarm.btnArm'), 'UZBRÓJ');
});

test('setLang switches lookups; unknown lang ignored', () => {
  setLang('en');
  assert.strictEqual(t('alarm.btnArm'), 'ARM');
  setLang('zz'); // unknown — must keep current
  assert.strictEqual(t('alarm.btnArm'), 'ARM');
  setLang('pl'); // restore for other tests
});

test('positional {0}/{1} substitution', () => {
  setLang('pl');
  assert.match(t('alarm.detail.armed', '5m 03s'), /uzbrojony od 5m 03s/);
  assert.match(t('alarm.detail.triggered', 'otwarcie drzwi', '12s'), /otwarcie drzwi · 12s temu/);
});

test('cause keys translate to user strings in both languages', () => {
  setLang('pl');
  assert.strictEqual(t('alarm.cause.door'), 'otwarcie drzwi');
  assert.strictEqual(t('alarm.cause.motion_main'), 'ruch (główny)');
  setLang('en');
  assert.strictEqual(t('alarm.cause.door'), 'door opened');
  assert.strictEqual(t('alarm.cause.motion_main'), 'motion (main)');
  setLang('pl');
});

test('missing key falls back to itself, not undefined', () => {
  const v = t('nonexistent.key.does.not.exist');
  assert.strictEqual(typeof v, 'string');
  assert.ok(v.length > 0);
});

// ---- applyI18n (DOM walker) ----

test('applyI18n: data-i18n hydrates textContent (PL)', () => {
  setLang('pl');
  const el = fakeElement({ dataset: { i18n: 'alarm.btnArm' } });
  const root = fakeDocument({ '[data-i18n]': [el] });
  applyI18n(root);
  assert.strictEqual(el.textContent, 'UZBRÓJ');
});

test('applyI18n: data-i18n-title hydrates .title', () => {
  setLang('pl');
  const el = fakeElement({ dataset: { i18nTitle: 'alarm.toggle.main.title' } });
  const root = fakeDocument({ '[data-i18n-title]': [el] });
  applyI18n(root);
  assert.strictEqual(el.title, 'Wróć do panelu głównego');
});

test('applyI18n: data-i18n-aria sets aria-label attribute', () => {
  setLang('pl');
  const el = fakeElement({ dataset: { i18nAria: 'bms.alarmAria' } });
  const root = fakeDocument({ '[data-i18n-aria]': [el] });
  applyI18n(root);
  assert.strictEqual(el.getAttribute('aria-label'), 'Otwórz panel alarmu');
});

test('applyI18n: multiple elements with same key get the same text', () => {
  setLang('pl');
  const a = fakeElement({ dataset: { i18n: 'alarm.btnArm' } });
  const b = fakeElement({ dataset: { i18n: 'alarm.btnArm' } });
  const root = fakeDocument({ '[data-i18n]': [a, b] });
  applyI18n(root);
  assert.strictEqual(a.textContent, 'UZBRÓJ');
  assert.strictEqual(b.textContent, 'UZBRÓJ');
});

test('applyI18n: missing key falls back to the key string itself', () => {
  setLang('pl');
  const key = 'this.key.does.not.exist';
  const el = fakeElement({ dataset: { i18n: key } });
  const root = fakeDocument({ '[data-i18n]': [el] });
  applyI18n(root);
  assert.strictEqual(el.textContent, key);
});

test('applyI18n: null root is a no-op (does not throw)', () => {
  assert.doesNotThrow(() => applyI18n(null));
});

test('applyI18n: handles all three attribute kinds in one walk', () => {
  setLang('pl');
  const textEl = fakeElement({ dataset: { i18n: 'alarm.btnArm' } });
  const titleEl = fakeElement({ dataset: { i18nTitle: 'alarm.toggle.main.title' } });
  const ariaEl = fakeElement({ dataset: { i18nAria: 'bms.alarmAria' } });
  const root = fakeDocument({
    '[data-i18n]': [textEl],
    '[data-i18n-title]': [titleEl],
    '[data-i18n-aria]': [ariaEl],
  });
  applyI18n(root);
  assert.strictEqual(textEl.textContent, 'UZBRÓJ');
  assert.strictEqual(titleEl.title, 'Wróć do panelu głównego');
  assert.strictEqual(ariaEl.getAttribute('aria-label'), 'Otwórz panel alarmu');
});
