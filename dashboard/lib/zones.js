// SPDX-License-Identifier: MIT
//
// Pure SOC banding helpers — testable from Node, included in the browser
// at deploy time by scripts/minify-html.py (which inlines `<script src=>`
// tags for files under dashboard/lib/).
//
// Four-tier SOC banding:
//   low  < 20%   red    — critical, stop using
//   warn < 40%   amber  — approaching low, plan to recharge
//   mid  < 70%   cyan   — normal operating range
//   high ≥ 70%   green  — well charged

function tickFillColor(t) {
  if (t < 0.20) return 'var(--bms-red)';
  if (t < 0.40) return 'var(--bms-amber)';
  if (t < 0.70) return 'var(--bms-cyan)';
  return 'var(--bms-green)';
}

function socZone(soc) {
  if (soc < 20) return 'low';
  if (soc < 40) return 'warn';
  if (soc < 70) return 'mid';
  return 'high';
}

if (typeof module !== 'undefined') module.exports = { tickFillColor, socZone };
