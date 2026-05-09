#!/usr/bin/env bash
#
# Deploy dashboards + fonts + HA helpers to a fresh (or re-flashed) Home
# Assistant box. Idempotent — safe to re-run.
#
# Reads ha_host / ha_user / ha_token from secrets.yaml unless overridden via
# environment variables (HA_HOST, HA_USER, HA_TOKEN). secrets.yaml is gitignored;
# see secrets.yaml.example for the keys.
#
# Usage:   scripts/deploy-ha.sh
# Or:      HA_HOST=100.x.x.x HA_TOKEN=eyJ... scripts/deploy-ha.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HERE/secrets.yaml"

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

echo "→ Target: $HA_USER@$HA_HOST"

# ---- 1. Dashboards (with token substituted) ----
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MINIFY="$HERE/scripts/minify-html.py"
for src in "$HERE/dashboard/bms-integrated.html" "$HERE/dashboard/dashboard.html"; do
  name="$(basename "$src")"
  # Substitute the HA token, then minify inline <style>/<script> blocks.
  # Hand-written source stays readable; deploy ships compact bytes.
  before=$(/usr/bin/wc -c < "$src")
  /usr/bin/sed "s|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|$HA_TOKEN|" "$src" \
    | /usr/bin/python3 "$MINIFY" > "$WORK/$name"
  after=$(/usr/bin/wc -c < "$WORK/$name")
  printf '   minified %-26s %d -> %d bytes (%d%%)\n' "$name" "$before" "$after" $((after * 100 / before))
done

echo "→ Pushing dashboards to /config/www/..."
$SCP "$WORK/bms-integrated.html" "$HA_USER@$HA_HOST:/config/www/bms-integrated.html"
$SCP "$WORK/dashboard.html"      "$HA_USER@$HA_HOST:/config/www/bms-dashboard.html"

# ---- 2. Fonts (mirror — remove anything on the box that isn't local) ----
echo "→ Pushing fonts to /config/www/fonts/..."
$SSH "mkdir -p /config/www/fonts"
# Push everything we have first.
$SCP "$HERE/dashboard/fonts/"*.woff2 "$HERE/dashboard/fonts/"*.txt "$HA_USER@$HA_HOST:/config/www/fonts/"
# Compute a keep-list and prune stragglers so the remote mirrors local.
LOCAL_LIST="$(cd "$HERE/dashboard/fonts" && ls -1 | tr '\n' '|' | sed 's/|$//')"
$SSH "cd /config/www/fonts && for f in *; do echo \"\$f\" | grep -qxE '$LOCAL_LIST' || rm -f -- \"\$f\"; done"

# ---- 3. HA helpers (idempotent — keyed on a marker comment) ----
# Use plain `grep` / `cat` — HA OS ships BusyBox under /bin, not /usr/bin.
# The marker also matches the manually-named "heater_request" so we don't
# double-append if helpers were added by hand on an earlier deploy.
MARKER="# === jk-pb-bms helpers (managed by scripts/deploy-ha.sh) ==="
echo "→ Ensuring HA helpers are present in configuration.yaml..."
if $SSH "grep -q 'heater_request' /config/configuration.yaml"; then
  echo "  helpers already present, skipping"
else
  $SCP "$HERE/homeassistant/heater-helpers.yaml" "$HA_USER@$HA_HOST:/tmp/_jk_helpers.yaml"
  $SSH "(printf '\n%s\n' '$MARKER'; cat /tmp/_jk_helpers.yaml) >> /config/configuration.yaml && rm /tmp/_jk_helpers.yaml"
  echo "  appended"
fi

# Validate config before reloading.
echo "→ Validating HA config..."
$SSH "ha core check" >/dev/null

# Reload helper domains (no full restart needed for input_*).
echo "→ Reloading helper domains..."
for d in input_boolean input_number input_text; do
  /usr/bin/curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" \
    "http://$HA_HOST:8123/api/services/$d/reload" -o /dev/null -w "  %{http_code} $d\n"
done

# ---- 4. Verify ----
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
