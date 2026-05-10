#!/usr/bin/env bash
#
# Deploy dashboards + fonts + HA helpers to a fresh (or re-flashed) Home
# Assistant box. Idempotent — safe to re-run.
#
# Reads ha_host / ha_user / ha_token from secrets.yaml unless overridden via
# environment variables (HA_HOST, HA_USER, HA_TOKEN). secrets.yaml is gitignored;
# see secrets.yaml.example for the keys.
#
# Usage:
#   scripts/deploy-ha.sh                # full deploy (gated on check + test)
#   scripts/deploy-ha.sh --check-only   # run check + test, do not deploy
#   scripts/deploy-ha.sh --dry-run      # substitute, minify, hash, diff vs remote, no scp/ssh writes
#   scripts/deploy-ha.sh --skip-checks  # full deploy without check/test (rare; for emergencies)
#
# Or:      HA_HOST=100.x.x.x HA_TOKEN=eyJ... scripts/deploy-ha.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HERE/secrets.yaml"

MODE="deploy"          # deploy | check-only | dry-run
SKIP_CHECKS="0"
for arg in "$@"; do
  case "$arg" in
    --check-only)  MODE="check-only" ;;
    --dry-run)     MODE="dry-run" ;;
    --skip-checks) SKIP_CHECKS="1" ;;
    -h|--help)
      /usr/bin/sed -n '2,/^set -/p' "$0" | /usr/bin/sed -n '/^#/p; /^$/q'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ---- 0. Always run check + test first, unless explicitly skipped. ----
if [ "$SKIP_CHECKS" = "0" ]; then
  bash "$HERE/scripts/check.sh"
  bash "$HERE/scripts/test.sh"
fi
if [ "$MODE" = "check-only" ]; then
  echo
  echo "✓ check-only mode — nothing deployed."
  exit 0
fi

# Tiny YAML scalar reader — handles `key: "value"` and `key: value`.
get() {
  [ -f "$SECRETS" ] || return 0
  /usr/bin/grep -E "^$1:" "$SECRETS" | /usr/bin/sed -E "s/^$1: *\"?([^\"]*)\"? *(#.*)?$/\1/" | head -n1
}

HA_HOST="${HA_HOST:-$(get ha_host)}"
HA_USER="${HA_USER:-$(get ha_user)}"
HA_TOKEN="${HA_TOKEN:-$(get ha_token)}"
HA_USER="${HA_USER:-root}"

if [ -z "${HA_HOST:-}" ] || [ -z "${HA_TOKEN:-}" ]; then
  echo "ERROR: ha_host and ha_token must be set in secrets.yaml or env." >&2
  echo "       See secrets.yaml.example." >&2
  exit 1
fi

SSH="ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $HA_USER@$HA_HOST"
SCP="scp -O -q -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

# Portable SHA-256: macOS ships `shasum` (perl-based), Linux ships `sha256sum`
# (coreutils). Pick whichever is on PATH; both print "<hash>  <file>".
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$@" | /usr/bin/awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$@" | /usr/bin/awk '{print $1}'; }
else
  echo "ERROR: neither sha256sum nor shasum found on PATH" >&2; exit 1
fi

echo "→ Target: $HA_USER@$HA_HOST  (mode: $MODE)"

# ---- 1. Build dashboards (token substitution + minify + lib/ inline) ----
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MINIFY="$HERE/scripts/minify-html.py"
DASHBOARD_DIR="$HERE/dashboard"

# Build metadata — baked into the advanced dashboard's `__BUILD_STAMP__`
# placeholder so you can confirm at a glance which commit / source-file
# content is currently deployed. Source hash is computed BEFORE any
# substitutions, so it matches `sha256sum dashboard/dashboard.html` run
# locally on a clean working tree.
GIT_BRANCH="$(cd "$HERE" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_COMMIT="$(cd "$HERE" && git rev-parse --short=8 HEAD 2>/dev/null || echo unknown)"
if [ -n "$(cd "$HERE" && git status --porcelain 2>/dev/null)" ]; then
  GIT_DIRTY="+dirty"
else
  GIT_DIRTY=""
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%MZ)"

declare -a BUILT_PAIRS=()
for src in "$DASHBOARD_DIR/bms-integrated.html" "$DASHBOARD_DIR/dashboard.html"; do
  name="$(basename "$src")"
  before=$(/usr/bin/wc -c < "$src")
  src_hash="$(sha256 "$src" | cut -c1-8)"
  STAMP="${GIT_BRANCH} · ${GIT_COMMIT}${GIT_DIRTY} · src ${src_hash} · ${BUILD_TIME}"
  /usr/bin/sed -e "s|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|$HA_TOKEN|" \
               -e "s|__BUILD_STAMP__|${STAMP}|" "$src" \
    | /usr/bin/python3 "$MINIFY" --source-dir "$DASHBOARD_DIR" > "$WORK/$name"
  after=$(/usr/bin/wc -c < "$WORK/$name")
  printf '   built %-26s %d -> %d bytes (%d%%)  stamp=%s\n' \
    "$name" "$before" "$after" $((after * 100 / before)) "$src_hash"
  # Map source name -> deployed remote filename.
  case "$name" in
    bms-integrated.html) remote="/config/www/bms-integrated.html" ;;
    dashboard.html)      remote="/config/www/bms-dashboard.html"  ;;
  esac
  BUILT_PAIRS+=("$WORK/$name=$remote")
done

# ---- 2. Dry-run: hash everything, fetch remote hashes, print diff. ----
if [ "$MODE" = "dry-run" ]; then
  echo
  echo "→ Hashing local builds and fetching remote hashes..."
  for pair in "${BUILT_PAIRS[@]}"; do
    local_path="${pair%=*}"
    remote_path="${pair#*=}"
    local_hash="$(sha256 "$local_path")"
    remote_hash="$($SSH "sha256sum $remote_path 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo "<missing>")"
    if [ "$local_hash" = "$remote_hash" ]; then
      printf '   = %-30s (unchanged)\n' "$(basename "$remote_path")"
    else
      printf '   ! %-30s local=%s remote=%s\n' \
        "$(basename "$remote_path")" "${local_hash:0:12}" "${remote_hash:0:12}"
    fi
  done
  # Font mirror diff.
  echo
  echo "→ Font directory diff..."
  remote_fonts="$($SSH 'ls /config/www/fonts/ 2>/dev/null' || true)"
  local_fonts="$(cd "$HERE/dashboard/fonts" && /bin/ls)"
  /usr/bin/diff <(printf '%s\n' "$local_fonts") <(printf '%s\n' "$remote_fonts") \
    | /usr/bin/sed 's/^/   /' || true
  # Helpers presence.
  echo
  echo "→ Helpers section in remote configuration.yaml..."
  if $SSH "grep -q 'heater_request' /config/configuration.yaml"; then
    echo "   = helpers already present (deploy would skip the append)"
  else
    echo "   ! helpers MISSING (deploy would append homeassistant/heater-helpers.yaml)"
  fi
  echo
  echo "✓ dry-run complete — nothing was changed on the remote."
  exit 0
fi

# ---- 3. Push dashboards. ----
echo "→ Pushing dashboards to /config/www/..."
for pair in "${BUILT_PAIRS[@]}"; do
  local_path="${pair%=*}"
  remote_path="${pair#*=}"
  $SCP "$local_path" "$HA_USER@$HA_HOST:$remote_path"
done

# ---- 4. Fonts (mirror — remove anything on the box that isn't local) ----
echo "→ Pushing fonts to /config/www/fonts/..."
$SSH "mkdir -p /config/www/fonts"
$SCP "$HERE/dashboard/fonts/"*.woff2 "$HERE/dashboard/fonts/"*.txt "$HA_USER@$HA_HOST:/config/www/fonts/"
LOCAL_LIST="$(cd "$HERE/dashboard/fonts" && ls -1 | tr '\n' '|' | sed 's/|$//')"
$SSH "cd /config/www/fonts && for f in *; do echo \"\$f\" | grep -qxE '$LOCAL_LIST' || rm -f -- \"\$f\"; done"

# ---- 5. HA helpers (idempotent — keyed on a marker comment) ----
MARKER="# === jk-pb-bms helpers (managed by scripts/deploy-ha.sh) ==="
echo "→ Ensuring HA helpers are present in configuration.yaml..."
if $SSH "grep -q 'heater_request' /config/configuration.yaml"; then
  echo "  helpers already present, skipping"
else
  $SCP "$HERE/homeassistant/heater-helpers.yaml" "$HA_USER@$HA_HOST:/tmp/_jk_helpers.yaml"
  $SSH "(printf '\n%s\n' '$MARKER'; cat /tmp/_jk_helpers.yaml) >> /config/configuration.yaml && rm /tmp/_jk_helpers.yaml"
  echo "  appended"
fi

# ---- 6. Validate config before reloading. ----
echo "→ Validating HA config..."
$SSH "ha core check" >/dev/null

# ---- 7. Reload helper domains (no full restart needed for input_*). ----
echo "→ Reloading helper domains..."
for d in input_boolean input_number input_text; do
  /usr/bin/curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
    "http://$HA_HOST:8123/api/services/$d/reload" -o /dev/null -w "  %{http_code} $d\n"
done

# ---- 8. Verify ----
echo "→ Verifying entities..."
HEATER_COUNT=$(/usr/bin/curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://$HA_HOST:8123/api/states" \
  | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for e in d if 'heater' in e['entity_id']))")
echo "  $HEATER_COUNT heater_* entities present"

echo
echo "✓ Deploy complete. Dashboards at:"
echo "    http://$HA_HOST:8123/local/bms-integrated.html"
echo "    http://$HA_HOST:8123/local/bms-dashboard.html"
echo
echo "Reminder: import node-red/heater-control.flow.json into Node-RED if"
echo "this is a fresh HA install."
