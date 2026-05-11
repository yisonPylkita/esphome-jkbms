// SPDX-License-Identifier: MIT
//
// Shared HA REST client. Reads HA_URL + TOKEN from globals defined by
// each dashboard's app.js (which carries the deploy-substituted token).
// All endpoints return JSON; non-OK responses throw with the HTTP code.

async function _haFetch(path, opts = {}) {
  const r = await fetch(`${HA_URL}${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.status === 204 ? null : r.json();
}

const haGetState = (entityId) => _haFetch(`/api/states/${entityId}`);
const haGetAllStates = () => _haFetch('/api/states');
const haCallService = (domain, service, data) =>
  _haFetch(`/api/services/${domain}/${service}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
async function haHistory(entityId, fromDate, toDate) {
  const q = new URLSearchParams({
    filter_entity_id: entityId,
    end_time: toDate.toISOString(),
    minimal_response: 'true',
  });
  const raw = await _haFetch(`/api/history/period/${fromDate.toISOString()}?${q}`);
  return Array.isArray(raw[0]) ? raw[0] : [];
}
const haLogbook = (entityId, fromDate, toDate) => {
  const q = new URLSearchParams({ entity: entityId, end_time: toDate.toISOString() });
  return _haFetch(`/api/logbook/${fromDate.toISOString()}?${q}`);
};

if (typeof module !== 'undefined') {
  module.exports = { haGetState, haGetAllStates, haCallService, haHistory, haLogbook };
}
