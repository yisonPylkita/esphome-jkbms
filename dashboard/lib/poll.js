// SPDX-License-Identifier: MIT
//
// Standard polling controller. Starts a setInterval and registers a
// visibilitychange listener that re-invokes the callback the moment
// the tab becomes visible again (fixes the 1-second-of-stale-state on
// phone unlock).

function startPolling(fn, intervalMs) {
  fn();
  const handle = setInterval(fn, intervalMs);
  const onVis = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener('visibilitychange', onVis);
  // Returned canceller for symmetry; nothing uses it today but tests will.
  return () => {
    clearInterval(handle);
    document.removeEventListener('visibilitychange', onVis);
  };
}

if (typeof module !== 'undefined') module.exports = { startPolling };
