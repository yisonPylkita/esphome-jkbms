// SPDX-License-Identifier: MIT
//
// Transparent version-mismatch detector.
//
// Each deploy stamps a `deployId` (the git commit hash, plus `+dirty`
// suffix on dirty trees) into the dashboard at build time AND writes
// `/local/version.json` carrying the same id. This module polls
// version.json on a slow cadence and, when the server's id drifts ahead
// of the baked-in one, does a hard `location.reload()` so the user
// always sees the latest code.
//
// Behaviour the user asked for:
//   - No UI. No banner, no toast, no notification.
//   - Reload ONLY when server id differs from baked id (real deploy with
//     code changes — git-commit-derived ids stay stable across same-
//     commit re-deploys, so a no-op deploy does NOT churn open tabs).
//   - After reload the new page has the new baked id, so the next
//     tick matches and there are no further reloads.
//
// Pure-ish on purpose: fetch/document/window/setInterval are all
// injectable so tests can drive the logic with no real timers or DOM.

(function (root) {
  'use strict';

  // Detect mismatch. Returns 'unknown' if response unparseable,
  // 'match' if equal (or if the placeholder was never substituted —
  // happens during local file:// dev), 'mismatch' otherwise.
  function compareDeployId(bakedId, serverPayload) {
    if (!serverPayload || typeof serverPayload !== 'object') return 'unknown';
    const remote = serverPayload.deployId;
    if (typeof remote !== 'string' || !remote) return 'unknown';
    if (!bakedId || bakedId === '__DEPLOY_ID__') return 'match';
    return remote === bakedId ? 'match' : 'mismatch';
  }

  function installVersionCheck(bakedId, opts) {
    const o = opts || {};
    const win = o.window || (typeof window !== 'undefined' ? window : null);
    // Idempotency flag lives on the window: a second install against
    // the same context (dev hot-reload, careless re-init) is a no-op,
    // but tests get a fresh slate by passing a fresh fake `window`.
    if (win && win.__versionCheckInstalled) return;
    if (win) win.__versionCheckInstalled = true;
    const fetchFn = o.fetch || (win && win.fetch ? win.fetch.bind(win) : null);
    const intervalMs = o.intervalMs || 60_000;
    const versionUrl = o.versionUrl || '/local/version.json';
    const reload = o.reload || (() => win && win.location && win.location.reload());
    if (!fetchFn) return;

    async function tick() {
      try {
        // Cache-bust: HA serves /local/* with max-age=2678400 (31 days).
        // Both the no-store hint and the cache-busting query string are
        // needed to defeat all the intermediate caches.
        const r = await fetchFn(versionUrl + '?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (compareDeployId(bakedId, j) === 'mismatch') reload();
      } catch (_) {
        /* network blip — try again next tick */
      }
    }

    // First poll fires after one interval, not immediately, so a
    // freshly-loaded page never reloads itself in the first 60 s.
    if (win && typeof win.setInterval === 'function') {
      win.setInterval(tick, intervalMs);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { compareDeployId, installVersionCheck };
  } else {
    root.compareDeployId = compareDeployId;
    root.installVersionCheck = installVersionCheck;
  }
})(typeof window !== 'undefined' ? window : globalThis);
