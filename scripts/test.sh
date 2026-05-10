#!/usr/bin/env bash
#
# Pure-function unit tests for the dashboard's extracted helpers
# (dashboard/lib/*.js). Uses Node's built-in test runner — no npm,
# no package.json, no devDependencies.
#
# Used by:  just test  · CI · scripts/deploy-ha.sh --check-only
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

if ! command -v node >/dev/null 2>&1; then
  printf '\033[33m·\033[0m node not on PATH; skipping unit tests\n'
  exit 0
fi

# `node --test tests/` no-args expansion was dropped in newer node; the
# explicit glob form works in 18, 20, 22, 24+.
exec node --test tests/*.test.js
