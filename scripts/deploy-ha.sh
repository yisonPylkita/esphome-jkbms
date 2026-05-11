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
# Single deploy id stamped into every dashboard's `installAutoUpdate(...)`
# call. The version.json we push at the end of the deploy carries the
# same string; each dashboard polls /local/version.json once a minute
# and `location.reload()`s itself if the id changes.
DEPLOY_ID="${GIT_COMMIT}${GIT_DIRTY}-$(date -u +%s)"

declare -a BUILT_PAIRS=()
# Source layout (component-style folders under dashboard/):
#   dashboard/bms/index.html       → /config/www/bms-integrated.html
#   dashboard/alarm/index.html     → /config/www/alarm.html
#   dashboard/advanced/index.html  → /config/www/bms-dashboard.html
# Each folder owns its own style.css and app.js; the minifier inlines them
# (along with lib/*.js shared helpers) into the single deployed HTML.
for entry in "bms:bms-integrated.html" "advanced:bms-dashboard.html" "alarm:alarm.html" "history:alarm-history.html"; do
  folder="${entry%%:*}"
  outname="${entry##*:}"
  src="$DASHBOARD_DIR/$folder/index.html"
  if [ ! -f "$src" ]; then
    echo "ERROR: missing source $src" >&2; exit 1
  fi
  before=$(/usr/bin/wc -c < "$src")
  src_hash="$(sha256 "$src" | cut -c1-8)"
  STAMP="${GIT_BRANCH} · ${GIT_COMMIT}${GIT_DIRTY} · src ${src_hash} · ${BUILD_TIME}"
  # Run the minifier first (inlines style.css + app.js + lib/*.js), THEN
  # substitute the token + build-stamp placeholders. The token placeholder
  # lives in app.js (not index.html) since the split, so substitution must
  # happen against the inlined output, not the bare source HTML.
  .venv/bin/python "$MINIFY" --source-dir "$DASHBOARD_DIR/$folder" < "$src" \
    | /usr/bin/sed -e "s|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|$HA_TOKEN|" \
                   -e "s|__BUILD_STAMP__|${STAMP}|" \
                   -e "s|__DEPLOY_ID__|${DEPLOY_ID}|g" > "$WORK/$outname"
  after=$(/usr/bin/wc -c < "$WORK/$outname")
  printf '   built %-30s %d -> %d bytes (%d%%)  stamp=%s\n' \
    "$folder/index.html → $outname" "$before" "$after" $((after * 100 / before)) "$src_hash"
  BUILT_PAIRS+=("$WORK/$outname=/config/www/$outname")
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
  # Helpers presence — packages-style (one file per concern).
  echo
  echo "→ Helper packages on remote..."
  remote_pkgs="$($SSH 'ls /config/packages/ 2>/dev/null' || true)"
  for f in jk_alarm.yaml; do
    if printf '%s\n' "$remote_pkgs" | grep -qx "$f"; then
      echo "   = $f present"
    else
      echo "   ! $f MISSING (deploy would push it)"
    fi
  done
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

# ---- 3a. version.json — the manifest each dashboard polls once a
#          minute to decide whether to reload itself. Always one short
#          file, deployId matches the value baked into every dashboard
#          via the __DEPLOY_ID__ sed substitution above.
cat > "$WORK/version.json" <<EOF
{"deployId":"${DEPLOY_ID}","deployedAt":"${BUILD_TIME}","branch":"${GIT_BRANCH}","commit":"${GIT_COMMIT}${GIT_DIRTY}"}
EOF
echo "→ Pushing version.json to /config/www/..."
$SCP "$WORK/version.json" "$HA_USER@$HA_HOST:/config/www/version.json"

# ---- 3b. Favicon (vertical-battery SVG used by all three dashboards). ----
if [ -f "$HERE/dashboard/favicon.svg" ]; then
  echo "→ Pushing favicon.svg to /config/www/..."
  $SCP "$HERE/dashboard/favicon.svg" "$HA_USER@$HA_HOST:/config/www/favicon.svg"
fi

# ---- 4. Fonts (mirror — remove anything on the box that isn't local) ----
echo "→ Pushing fonts to /config/www/fonts/..."
$SSH "mkdir -p /config/www/fonts"
$SCP "$HERE/dashboard/fonts/"*.woff2 "$HERE/dashboard/fonts/"*.txt "$HA_USER@$HA_HOST:/config/www/fonts/"
LOCAL_LIST="$(cd "$HERE/dashboard/fonts" && ls -1 | tr '\n' '|' | sed 's/|$//')"
$SSH "cd /config/www/fonts && for f in *; do echo \"\$f\" | grep -qxE '$LOCAL_LIST' || rm -f -- \"\$f\"; done"

# ---- 5. HA helpers via /config/packages/ (idempotent + clean merging) ----
# YAML doesn't merge duplicate top-level keys — appending separate
# `input_boolean:` blocks would silently drop earlier ones. Use HA's
# `packages` mechanism instead: each helper file lives in /config/packages/
# and HA merges them per-domain, so multiple helper bundles can coexist
# without conflict.
echo "→ Ensuring 'homeassistant.packages' directive in configuration.yaml..."
if ! $SSH "grep -q 'packages:.*include_dir_named packages' /config/configuration.yaml"; then
  $SSH "(printf '\nhomeassistant:\n  packages: !include_dir_named packages\n') >> /config/configuration.yaml"
  echo "  added homeassistant.packages directive"
else
  echo "  directive already present"
fi

echo "→ Pushing helper packages to /config/packages/..."
$SSH "mkdir -p /config/packages"
$SCP "$HERE/homeassistant/alarm-helpers.yaml"  "$HA_USER@$HA_HOST:/config/packages/jk_alarm.yaml"

# ---- 6. Validate config before reloading. ----
echo "→ Validating HA config..."
$SSH "ha core check" >/dev/null

# ---- 7. Reload helper domains (no full restart needed for input_*). ----
echo "→ Reloading helper domains..."
for d in input_boolean input_number input_text input_select; do
  /usr/bin/curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
    "http://$HA_HOST:8123/api/services/$d/reload" -o /dev/null -w "  %{http_code} $d\n"
done

# ---- 8. Verify ----
echo "→ Verifying alarm helpers landed..."
ALARM_COUNT=$(/usr/bin/curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://$HA_HOST:8123/api/states" \
  | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for e in d if 'alarm' in e['entity_id']))")
echo "  $ALARM_COUNT alarm_* entities present"

echo
echo "✓ Deploy complete. Dashboards at:"
echo "    http://$HA_HOST:8123/local/bms-integrated.html"
echo "    http://$HA_HOST:8123/local/bms-dashboard.html"
echo "    http://$HA_HOST:8123/local/alarm.html"
echo
echo "Reminder: on a fresh HA install run \`just restore\` first — it"
echo "imports homeassistant/node-red/flows.json among other things."
