// SPDX-License-Identifier: MIT
//
// Self-update poller. Every dashboard bakes its build-time deploy ID
// into a placeholder; once a minute it fetches `/local/version.json`
// (no-store + cache-bust query string, so the 31-day `/local/` cache
// HA serves with doesn't apply) and compares. If the server's ID is
// different from the baked one, the page reloads itself.
//
// Usage (from each dashboard's index.html):
//   <script src="../lib/auto-update.js"></script>
//   <script>installAutoUpdate('__DEPLOY_ID__');</script>
//
// The `__DEPLOY_ID__` placeholder is substituted at deploy time by
// scripts/deploy-ha.sh — the same `sed` pass that fills in the auth
// token and the build stamp. If it stays unsubstituted (e.g. loading
// the source HTML directly without running the deploy pipeline), the
// poller stays inert.

const _AUTO_UPDATE_POLL_MS = 60 * 1000;

// True when the page is no longer the "current" deploy. Toggled by
// the polling loop; observable from `getAutoUpdatePending()` if a
// future banner UI wants to react before location.reload() fires.
let _autoUpdatePending = false;

async function _fetchDeployId() {
  // Cache-bust on URL AND headers — the URL ensures we never get a
  // matched entry from disk cache; `no-store` ensures we don't pollute
  // it on the way back.
  const url = `version.json?_=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const v = await r.json();
  return v.deployId;
}

function installAutoUpdate(localDeployId) {
  // A literal placeholder means the deploy script didn't substitute
  // it. Skip — there's no meaningful comparison to make.
  if (!localDeployId || localDeployId.startsWith('__') || localDeployId.endsWith('__')) {
    return;
  }

  async function tick() {
    try {
      const remoteId = await _fetchDeployId();
      if (remoteId && remoteId !== localDeployId) {
        _autoUpdatePending = true;
        // Reload immediately. The user picked "immediate reload" so
        // the dashboard always reflects the latest deploy within ~60
        // seconds of `just deploy` finishing.
        console.info(`[auto-update] new deploy ${remoteId} (have ${localDeployId}); reloading…`);
        // location.reload() bypasses the disk cache for the page
        // itself; CSS / app.js / etc. still come from cache, but the
        // HTML is what carries the inlined-by-deploy bundle so a
        // reload of just the HTML is enough.
        location.reload();
      }
    } catch (err) {
      // Network blip / supervisor restart / brief HA outage — just
      // try again next interval. Don't surface to the user.
      console.warn('[auto-update] poll failed:', err);
    }
  }

  // First check on the next event-loop tick (gives the rest of the
  // page time to initialise its own pollers), then on a steady
  // interval.
  setTimeout(tick, 1000);
  setInterval(tick, _AUTO_UPDATE_POLL_MS);
}

function getAutoUpdatePending() {
  return _autoUpdatePending;
}

if (typeof module !== 'undefined') {
  module.exports = { installAutoUpdate, getAutoUpdatePending };
}
