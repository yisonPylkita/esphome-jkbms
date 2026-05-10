// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { T, t, getLang, setLang } = require('../dashboard/lib/i18n.js');

test('every PL key has an EN counterpart and vice versa', () => {
  const pl = Object.keys(T.pl).sort();
  const en = Object.keys(T.en).sort();
  const onlyInPl = pl.filter(k => !T.en[k]);
  const onlyInEn = en.filter(k => !T.pl[k]);
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
  setLang('zz');                       // unknown — must keep current
  assert.strictEqual(t('alarm.btnArm'), 'ARM');
  setLang('pl');                       // restore for other tests
});

test('positional {0}/{1} substitution', () => {
  setLang('pl');
  assert.match(t('alarm.detail.armed', '5m 03s'), /uzbrojony od 5m 03s/);
  assert.match(t('alarm.detail.triggered', 'otwarcie drzwi', '12s'), /otwarcie drzwi · 12s temu/);
});

test('cause keys translate to user strings in both languages', () => {
  setLang('pl');
  assert.strictEqual(t('alarm.cause.door'),        'otwarcie drzwi');
  assert.strictEqual(t('alarm.cause.motion_main'), 'ruch (główny)');
  setLang('en');
  assert.strictEqual(t('alarm.cause.door'),        'door opened');
  assert.strictEqual(t('alarm.cause.motion_main'), 'motion (main)');
  setLang('pl');
});

test('missing key falls back to itself, not undefined', () => {
  const v = t('nonexistent.key.does.not.exist');
  assert.strictEqual(typeof v, 'string');
  assert.ok(v.length > 0);
});
