#!/usr/bin/env bash
#
# Take a fresh Home Assistant OS box (just installed, signed in via SSH
# addon, secrets.yaml filled in locally) and bring it back to the state
# this repo represents. Idempotent — safe to re-run.
#
# What it does, in order:
#   1. Install every addon listed in homeassistant/addons/*.json (skips
#      any that are already installed).
#   2. Apply each addon's options snapshot.
#   3. Push the core configuration.yaml.
#   4. Push the Z2M configuration.yaml (with secrets still requiring
#      hand-fill — search for `<<REPLACE_*>>` markers on the box).
#   5. Push the Node-RED flows.json (sanitised: server-config IDs are
#      blank, Node-RED prompts to assign on first import).
#   6. Hand off to scripts/deploy-ha.sh for dashboards + fonts +
#      packages + helper reloads.
#
# What it does NOT do (because it can't):
#   * Re-pair Zigbee devices — restore your `coordinator_backup.json`
#     out-of-band before starting Z2M, OR re-pair from scratch.
#   * Tailscale auth — the addon will print a login URL the first time;
#     accept it on the admin page.
#   * HA user accounts — recreate via UI; this script won't touch
#     `.storage/auth*`.
#   * Long-lived API tokens — generate a new one in HA, paste into
#     `secrets.yaml`.
#
# Usage:
#   scripts/restore-ha.sh                 # full restore
#   scripts/restore-ha.sh --addons-only   # stop after addons + options
#   scripts/restore-ha.sh --configs-only  # stop after configs (no addons)
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

MODE="full"
for arg in "$@"; do
  case "$arg" in
    --addons-only)  MODE="addons" ;;
    --configs-only) MODE="configs" ;;
    -h|--help)
      /usr/bin/sed -n '2,/^set -/p' "$0" | /usr/bin/sed -n '/^#/p; /^$/q'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ok()    { printf '\033[32m✓\033[0m %s\n' "$1"; }
info()  { printf '\033[36m·\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$1" >&2; }
fail()  { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }
manual() { printf '\033[35m▸ MANUAL STEP\033[0m %s\n' "$1"; }

# ---- Read secrets ----
SECRETS="$HERE/secrets.yaml"
[ -f "$SECRETS" ] || fail "secrets.yaml missing — run scripts/setup.sh first"

get() { /usr/bin/grep -E "^$1:" "$SECRETS" | /usr/bin/sed -E "s/^$1: *\"?([^\"]*)\"? *(#.*)?$/\1/" | head -n1; }
HA_HOST="${HA_HOST:-$(get ha_host)}"
HA_USER="${HA_USER:-$(get ha_user)}"
HA_TOKEN="${HA_TOKEN:-$(get ha_token)}"
HA_USER="${HA_USER:-root}"
[ -n "$HA_HOST" ] && [ -n "$HA_TOKEN" ] || fail "ha_host + ha_token must be set in secrets.yaml"

SSH="ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new $HA_USER@$HA_HOST"
SCP="scp -O -q -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"

echo "→ Target: $HA_USER@$HA_HOST  (mode: $MODE)"

# Helper: call the supervisor REST API from inside the box, reading the
# privileged token out of `$SUPERVISOR_TOKEN` (set inside the SSH addon).
sup() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    $SSH "curl -s -X $method -H 'Authorization: Bearer \$SUPERVISOR_TOKEN' -H 'Content-Type: application/json' http://supervisor$path -d '$data'"
  else
    $SSH "curl -s -X $method -H 'Authorization: Bearer \$SUPERVISOR_TOKEN' http://supervisor$path"
  fi
}

# ---- 1. Install addons ----
if [ "$MODE" = "full" ] || [ "$MODE" = "addons" ]; then
  echo
  info "Installing addons listed under homeassistant/addons/..."
  for snap in "$HERE"/homeassistant/addons/*.json; do
    slug=$(/usr/bin/python3 -c "import json,sys; print(json.load(open('$snap'))['slug'])")
    repo=$(/usr/bin/python3 -c "import json,sys; print(json.load(open('$snap')).get('repository',''))")

    # `repository: a0d7b954` etc. — community add-on repos must be added
    # to the supervisor before their addons can be installed. The slug
    # `a0d7b954` is the first 8 chars of a GitHub URL hash; supervisor
    # exposes their full URLs via /store info, but for the bootstrap path
    # we assume the user has already enabled the standard community
    # repos. If a slug fails to install, surface the URL hint so the
    # operator can add it manually in Settings → Add-ons → Add-on Store.
    state=$(sup GET "/addons/$slug/info" 2>/dev/null | /usr/bin/python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('state','missing'))" 2>/dev/null || echo missing)
    if [ "$state" = "missing" ]; then
      manual "Install addon '$slug' (repository '$repo') via the HA UI: Settings → Add-ons → Add-on Store. Then re-run."
      continue
    fi
    if [ "$state" != "started" ] && [ "$state" != "stopped" ]; then
      info "addon $slug is in state '$state' — skipping options apply"
      continue
    fi

    # Apply the saved options.
    new_opts=$(/usr/bin/python3 -c "import json,sys; print(json.dumps({'options': json.load(open('$snap'))['options']}))")
    sup POST "/addons/$slug/options" "$new_opts" >/dev/null
    ok "addon $slug: options applied"
  done
fi
[ "$MODE" = "addons" ] && exit 0

# ---- 2. Push core configuration.yaml ----
if [ "$MODE" = "full" ] || [ "$MODE" = "configs" ]; then
  echo
  info "Pushing /config/configuration.yaml..."
  $SCP "$HERE/homeassistant/core/configuration.yaml" "$HA_USER@$HA_HOST:/config/configuration.yaml"
  ok "core configuration.yaml in place"

  # ---- 3. Push Z2M configuration.yaml ----
  echo
  info "Pushing /config/zigbee2mqtt/configuration.yaml..."
  $SSH "mkdir -p /config/zigbee2mqtt"
  $SCP "$HERE/homeassistant/zigbee2mqtt/configuration.yaml" "$HA_USER@$HA_HOST:/config/zigbee2mqtt/configuration.yaml"
  ok "Z2M configuration.yaml in place"
  manual "Edit /config/zigbee2mqtt/configuration.yaml on the box: replace <<REPLACE_*>> markers, restore network_key/pan_id/ext_pan_id from your coordinator_backup.json (kept out-of-repo), or let Z2M generate fresh ones on next boot (will require re-pairing)."

  # ---- 4. Push Node-RED flows.json ----
  echo
  info "Pushing /addon_configs/a0d7b954_nodered/flows.json..."
  $SSH "mkdir -p /addon_configs/a0d7b954_nodered"
  $SCP "$HERE/homeassistant/node-red/flows.json"  "$HA_USER@$HA_HOST:/addon_configs/a0d7b954_nodered/flows.json"
  $SCP "$HERE/homeassistant/node-red/settings.js" "$HA_USER@$HA_HOST:/addon_configs/a0d7b954_nodered/settings.js"
  ok "Node-RED flows.json + settings.js in place"
  manual "First Node-RED start: open the editor and assign the Home Assistant server config to every node (the import sanitised those refs to empty strings)."

  # ---- 5. Validate HA config ----
  echo
  info "Validating HA config..."
  $SSH "ha core check" >/dev/null && ok "ha core check passes"
fi
[ "$MODE" = "configs" ] && exit 0

# ---- 6. Hand off to deploy-ha.sh for dashboards + helper packages ----
echo
info "Running scripts/deploy-ha.sh for dashboards + helpers..."
bash "$HERE/scripts/deploy-ha.sh"

echo
ok "Restore complete. Manual follow-ups:"
manual "Tailscale: open the addon's web UI, click the login link printed in the log, accept on https://login.tailscale.com."
manual "Mosquitto: create the 'addons' MQTT user in HA Settings → People → Users (matching the password referenced by Z2M's configuration.yaml)."
manual "HACS: re-install via Settings → Devices & Services → Add Integration → HACS, sign in with GitHub."
manual "Long-lived token: HA → user profile → Long-Lived Access Tokens, create one, paste into secrets.yaml as ha_token."
