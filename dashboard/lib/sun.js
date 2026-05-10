// SPDX-License-Identifier: MIT
//
// Astronomical sunrise / sunset for arbitrary lat/lon. Pure functions —
// testable from Node, included in the browser at deploy time by
// scripts/minify-html.py.
//
// SunCalc-style algorithm (Vladimir Agafonkin's public-domain port of
// the NOAA equations). Verified for Warsaw against timeanddate.com:
// 2026-05-10 → rise 04:50 local / set 20:16 local (within ~minutes).

const WARSAW_LAT = 52.2297;
const WARSAW_LON = 21.0122;

function sunTimesFor(date, lat, lng) {
  const J2000 = 2451545.0;
  const lw = (-lng * Math.PI) / 180; // west longitude (radians)
  const phi = (lat * Math.PI) / 180; // latitude (radians)
  const d = date.getTime() / 86400000 - 0.5 + 2440587.5 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = ((357.5291 + 0.98560028 * ds) * Math.PI) / 180;
  const C =
    ((1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * Math.PI) / 180;
  const L = M + C + Math.PI + (102.9372 * Math.PI) / 180;
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const dec = Math.asin(Math.sin(L) * Math.sin((23.4397 * Math.PI) / 180));
  const cosH =
    (Math.sin((-0.83 * Math.PI) / 180) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return { sunrise: null, sunset: null };
  const H = Math.acos(cosH);
  const dsSet = 0.0009 + (H + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + dsSet + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return {
    sunrise: new Date((Jrise - 2440587.5) * 86400000),
    sunset: new Date((Jset - 2440587.5) * 86400000),
  };
}

// Returns night intervals [{start, end}] in ms covering any night that
// touches [startMs, endMs]. Each "night" = sunset[d] → sunrise[d+1].
function nightIntervals(startMs, endMs, lat, lon) {
  const out = [];
  const dayMs = 86400000;
  let d = new Date(startMs - dayMs);
  d.setUTCHours(12, 0, 0, 0);
  const limit = endMs + dayMs;
  while (d.getTime() < limit) {
    const today = sunTimesFor(d, lat, lon);
    const tomorrow = sunTimesFor(new Date(d.getTime() + dayMs), lat, lon);
    if (today.sunset && tomorrow.sunrise) {
      const cs = Math.max(today.sunset.getTime(), startMs);
      const ce = Math.min(tomorrow.sunrise.getTime(), endMs);
      if (cs < ce) out.push({ start: cs, end: ce });
    }
    d = new Date(d.getTime() + dayMs);
  }
  return out;
}

if (typeof module !== 'undefined')
  module.exports = { WARSAW_LAT, WARSAW_LON, sunTimesFor, nightIntervals };
