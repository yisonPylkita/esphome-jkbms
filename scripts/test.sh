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

# Prefer system node if it's recent enough; otherwise fall back to the
# in-repo binary that scripts/setup.sh downloads. This way both fresh
# clones (no system node) and dev machines (with their own node) just work.
NODE=""
if command -v node >/dev/null 2>&1; then NODE="node";
elif [ -x ".tools/bin/node" ]; then NODE="$(pwd)/.tools/bin/node";
fi
if [ -z "$NODE" ]; then
  printf '\033[33m·\033[0m node not found (run `scripts/setup.sh` to install it locally); skipping unit tests\n'
  exit 0
fi

# `node --test tests/` no-args expansion was dropped in newer node; the
# explicit glob form works in 18, 20, 22, 24+.
exec "$NODE" --test tests/*.test.js
