// SPDX-License-Identifier: MIT
//
// installAutoUpdate() is the function that decides to reload every
// open dashboard tab. Coverage for the four paths that matter:
//   1) baked-deploy-id placeholder → no-op
//   2) same deploy id → no reload
//   3) different deploy id → location.reload()
//   4) fetch failure (network blip / non-OK) → swallowed, no reload
const { test } = require('node:test');
const assert = require('node:assert');

// Each test re-imports the lib so module-level state (_autoUpdatePending)
// doesn't leak between tests.
function freshLib() {
  delete require.cache[require.resolve('../dashboard/lib/auto-update.js')];
  return require('../dashboard/lib/auto-update.js');
}

// Hold references to the originals so we can restore (Node provides
// fetch / setTimeout / setInterval / console as globals; location does
// not exist by default).
const originals = {
  fetch: globalThis.fetch,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
  console: globalThis.console,
};

function setupMocks(fetchImpl) {
  const state = {
    timeoutFn: null,
    timeoutMs: null,
    intervalFn: null,
    intervalMs: null,
    fetchCalls: 0,
    reloadCalls: 0,
  };
  globalThis.fetch = async (...args) => {
    state.fetchCalls++;
    return fetchImpl(...args);
  };
  globalThis.setTimeout = (fn, ms) => {
    state.timeoutFn = fn;
    state.timeoutMs = ms;
    return 1;
  };
  globalThis.setInterval = (fn, ms) => {
    state.intervalFn = fn;
    state.intervalMs = ms;
    return 2;
  };
  // `location` is read as a global by the lib. Use defineProperty because
  // Node ≥ 21 exposes a getter-only `location` on globalThis.
  Object.defineProperty(globalThis, 'location', {
    value: {
      reload: () => {
        state.reloadCalls++;
      },
    },
    writable: true,
    configurable: true,
  });
  // Silence the lib's `console.info` / `console.warn` so test output stays clean.
  globalThis.console = { ...originals.console, info: () => {}, warn: () => {} };
  return state;
}

function restoreMocks() {
  globalThis.fetch = originals.fetch;
  globalThis.setTimeout = originals.setTimeout;
  globalThis.setInterval = originals.setInterval;
  globalThis.console = originals.console;
  if (originals.location) {
    Object.defineProperty(globalThis, 'location', originals.location);
  } else {
    delete globalThis.location;
  }
}

test('placeholder deployId is a no-op (no fetch, no schedule)', () => {
  const state = setupMocks(async () => {
    throw new Error('fetch should not be called');
  });
  try {
    freshLib().installAutoUpdate('__DEPLOY_ID__');
    assert.strictEqual(state.timeoutFn, null);
    assert.strictEqual(state.intervalFn, null);
    assert.strictEqual(state.fetchCalls, 0);
  } finally {
    restoreMocks();
  }
});

test('empty deployId is a no-op', () => {
  const state = setupMocks(async () => ({}));
  try {
    freshLib().installAutoUpdate('');
    assert.strictEqual(state.timeoutFn, null);
    assert.strictEqual(state.intervalFn, null);
  } finally {
    restoreMocks();
  }
});

test('undefined deployId is a no-op', () => {
  const state = setupMocks(async () => ({}));
  try {
    freshLib().installAutoUpdate(undefined);
    assert.strictEqual(state.timeoutFn, null);
    assert.strictEqual(state.intervalFn, null);
  } finally {
    restoreMocks();
  }
});

test('real deployId schedules both a one-shot and an interval tick', () => {
  const state = setupMocks(async () => ({
    ok: true,
    json: async () => ({ deployId: 'abc' }),
  }));
  try {
    freshLib().installAutoUpdate('abc');
    assert.strictEqual(typeof state.timeoutFn, 'function');
    assert.strictEqual(typeof state.intervalFn, 'function');
    assert.strictEqual(state.intervalMs, 60_000);
  } finally {
    restoreMocks();
  }
});

test('same deployId → no reload', async () => {
  const state = setupMocks(async () => ({
    ok: true,
    json: async () => ({ deployId: 'abc' }),
  }));
  try {
    freshLib().installAutoUpdate('abc');
    await state.timeoutFn();
    assert.strictEqual(state.fetchCalls, 1);
    assert.strictEqual(state.reloadCalls, 0);
  } finally {
    restoreMocks();
  }
});

test('different deployId → exactly one reload', async () => {
  const state = setupMocks(async () => ({
    ok: true,
    json: async () => ({ deployId: 'def' }),
  }));
  try {
    freshLib().installAutoUpdate('abc');
    await state.timeoutFn();
    assert.strictEqual(state.reloadCalls, 1);
  } finally {
    restoreMocks();
  }
});

test('fetch rejects → no reload, no unhandled throw', async () => {
  const state = setupMocks(async () => {
    throw new Error('network');
  });
  try {
    freshLib().installAutoUpdate('abc');
    await state.timeoutFn(); // must not throw
    assert.strictEqual(state.reloadCalls, 0);
  } finally {
    restoreMocks();
  }
});

test('non-OK HTTP response → no reload', async () => {
  const state = setupMocks(async () => ({
    ok: false,
    status: 503,
    json: async () => {
      throw new Error('should not be parsed');
    },
  }));
  try {
    freshLib().installAutoUpdate('abc');
    await state.timeoutFn();
    assert.strictEqual(state.reloadCalls, 0);
  } finally {
    restoreMocks();
  }
});

test('falsy remote deployId → no reload (defensive against bad version.json)', async () => {
  const state = setupMocks(async () => ({
    ok: true,
    json: async () => ({ deployId: '' }),
  }));
  try {
    freshLib().installAutoUpdate('abc');
    await state.timeoutFn();
    assert.strictEqual(state.reloadCalls, 0);
  } finally {
    restoreMocks();
  }
});

test('getAutoUpdatePending: false before tick, true after a reload-triggering tick', async () => {
  const state = setupMocks(async () => ({
    ok: true,
    json: async () => ({ deployId: 'def' }),
  }));
  try {
    const lib = freshLib();
    lib.installAutoUpdate('abc');
    assert.strictEqual(lib.getAutoUpdatePending(), false);
    await state.timeoutFn();
    assert.strictEqual(lib.getAutoUpdatePending(), true);
  } finally {
    restoreMocks();
  }
});
