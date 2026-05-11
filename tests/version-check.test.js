// SPDX-License-Identifier: MIT
const { test } = require('node:test');
const assert = require('node:assert');
const { compareDeployId, installVersionCheck } = require('../dashboard/lib/version-check.js');

// ---- compareDeployId pure unit tests ----

test('matching ids → match', () => {
  assert.strictEqual(compareDeployId('abc1234', { deployId: 'abc1234' }), 'match');
});

test('different ids → mismatch', () => {
  assert.strictEqual(compareDeployId('abc1234', { deployId: 'def5678' }), 'mismatch');
});

test('unsubstituted placeholder treated as match (dev mode)', () => {
  // Local file:// dev: the deploy script never ran, baked id is still
  // the literal placeholder. Must NOT trigger a reload loop.
  assert.strictEqual(compareDeployId('__DEPLOY_ID__', { deployId: 'abc1234' }), 'match');
});

test('empty baked id → match (guards against undefined)', () => {
  assert.strictEqual(compareDeployId('', { deployId: 'abc1234' }), 'match');
});

test('null payload → unknown', () => {
  assert.strictEqual(compareDeployId('abc1234', null), 'unknown');
});

test('non-object payload → unknown', () => {
  assert.strictEqual(compareDeployId('abc1234', 'not-json'), 'unknown');
});

test('missing deployId field → unknown', () => {
  assert.strictEqual(compareDeployId('abc1234', { foo: 'bar' }), 'unknown');
});

test('empty server deployId → unknown', () => {
  assert.strictEqual(compareDeployId('abc1234', { deployId: '' }), 'unknown');
});

// ---- installVersionCheck integration tests ----
// Drive the poller with injected fetch + setInterval so we control the
// timeline deterministically.

function harness(overrides = {}) {
  const calls = { fetch: [], reload: 0 };
  let nextTick = null;
  const fakeFetch = async (url, opts) => {
    calls.fetch.push({ url, opts });
    return overrides.response || { ok: true, json: async () => ({ deployId: 'abc1234' }) };
  };
  const fakeWin = {
    setInterval: (fn, _ms) => {
      nextTick = fn;
    },
    fetch: fakeFetch,
    location: {
      reload: () => {
        calls.reload++;
      },
    },
  };
  return {
    calls,
    win: fakeWin,
    runTick: async () => {
      if (nextTick) await nextTick();
    },
  };
}

test('first tick: matching ids → no reload', async () => {
  const h = harness();
  installVersionCheck('abc1234', { window: h.win, intervalMs: 60_000 });
  await h.runTick();
  assert.strictEqual(h.calls.reload, 0);
});

test('first tick: mismatch → exactly one reload', async () => {
  const h = harness({
    response: { ok: true, json: async () => ({ deployId: 'NEW_VER' }) },
  });
  installVersionCheck('abc1234', { window: h.win, intervalMs: 60_000 });
  await h.runTick();
  assert.strictEqual(h.calls.reload, 1);
});

test('fetch failure → no reload (network blip recoverable)', async () => {
  const failing = {
    setInterval: (fn) => {
      failing._tick = fn;
    },
    fetch: async () => {
      throw new Error('network down');
    },
    location: { reload: () => failing._reloaded++ },
  };
  failing._reloaded = 0;
  installVersionCheck('abc1234', { window: failing, intervalMs: 60_000 });
  await failing._tick();
  assert.strictEqual(failing._reloaded, 0);
});

test('non-ok response → no reload', async () => {
  const h = harness({
    response: { ok: false, status: 500, json: async () => ({}) },
  });
  installVersionCheck('abc1234', { window: h.win, intervalMs: 60_000 });
  await h.runTick();
  assert.strictEqual(h.calls.reload, 0);
});

test('idempotent install — second call is a no-op', async () => {
  const h = harness();
  installVersionCheck('abc1234', { window: h.win });
  const before = h.calls.fetch.length;
  // A second install should NOT register a second poller against the
  // same id — verified by checking we don't double-call setInterval.
  let intervals = 0;
  h.win.setInterval = () => intervals++;
  installVersionCheck('abc1234', { window: h.win });
  assert.strictEqual(intervals, 0);
});

test('cache-busts the request (?t=...) and asks for no-store', async () => {
  const h = harness();
  installVersionCheck('abc1234', { window: h.win });
  await h.runTick();
  assert.strictEqual(h.calls.fetch.length, 1);
  const { url, opts } = h.calls.fetch[0];
  assert.match(url, /\/local\/version\.json\?t=\d+/);
  assert.deepStrictEqual(opts, { cache: 'no-store' });
});
