#!/usr/bin/env bash
#
# Integration test for the pure-HA alarm package.
#
# Drives the live Home Assistant instance via REST: pokes input_select /
# binary_sensor states, waits for the automations to fire, asserts the
# resulting state. Acts as the spec — every scenario the FSM must honour
# (auto-arm path, disturbance reset, grace suppression, trigger reason
# aggregation, latched-triggered, sensor-availability gating, manual
# disarm side-effects) is one or more assertions here.
#
# Side-effects (siren, push) are stubbed: each test flips
# `input_boolean.alarm_test_mode` on, so the automations write to
# `input_text.alarm_test_log` instead of firing real services. No siren
# wails, no phone pages.
#
# Usage:
#   scripts/test-alarm-ha.sh             # full suite against secrets.yaml's HA
#   HA_HOST=… HA_TOKEN=… scripts/test-alarm-ha.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HERE/secrets.yaml"

get() {
  [ -f "$SECRETS" ] || return 0
  /usr/bin/grep -E "^$1:" "$SECRETS" | /usr/bin/sed -E "s/^$1: *\"?([^\"]*)\"? *(#.*)?$/\1/" | head -n1
}

HA_HOST="${HA_HOST:-$(get ha_host)}"
HA_TOKEN="${HA_TOKEN:-$(get ha_token)}"
if [ -z "${HA_HOST:-}" ] || [ -z "${HA_TOKEN:-}" ]; then
  echo "ERROR: ha_host and ha_token must be set." >&2
  exit 1
fi

BASE="http://$HA_HOST:8123/api"
PASS=0
FAIL=0

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; FAIL=$((FAIL+1)); }

# ---- Helpers: REST primitives -----------------------------------------------

# Read an entity's current state. Trims surrounding quotes.
state_of() {
  /usr/bin/curl -fsS -H "Authorization: Bearer $HA_TOKEN" "$BASE/states/$1" \
    | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['state'])"
}

# Force an entity to a specific state. For binary_sensors HA only accepts
# this on virtual entities, but we use it on the real Zigbee ones — they
# get overwritten until the next physical event. That's exactly what we
# want for integration tests.
set_state() {
  local entity="$1" value="$2"
  /usr/bin/curl -fsS -X POST -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"state\": \"$value\"}" \
    "$BASE/states/$entity" >/dev/null
}

# Call a service via REST. e.g.: call_service input_select select_option \
#   '{"entity_id":"input_select.alarm_state","option":"disarmed"}'
call_service() {
  local domain="$1" service="$2" payload="$3"
  /usr/bin/curl -fsS -X POST -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$BASE/services/$domain/$service" >/dev/null
}

set_select() {
  call_service input_select select_option \
    "{\"entity_id\":\"$1\",\"option\":\"$2\"}"
}

set_boolean() {
  local s="off"; [ "$2" = "on" ] && s="turn_on" || s="turn_off"
  call_service input_boolean "$s" "{\"entity_id\":\"$1\"}"
}

set_number() {
  call_service input_number set_value "{\"entity_id\":\"$1\",\"value\":$2}"
}

set_text() {
  call_service input_text set_value "{\"entity_id\":\"$1\",\"value\":\"$2\"}"
}

# ---- Helpers: assertions ----------------------------------------------------

assert_state() {
  local entity="$1" want="$2" label="$3"
  local got; got=$(state_of "$entity")
  if [ "$got" = "$want" ]; then
    ok "$label: $entity = $want"
  else
    fail "$label: $entity expected '$want' but got '$got'"
  fi
}

# Wait up to N seconds for entity to reach a target state. Polls every
# 200 ms. Returns 0 on hit, 1 on timeout. Used for `for:`-gated
# transitions (arming → armed, …) so we don't sleep blindly.
wait_for_state() {
  local entity="$1" want="$2" timeout="$3"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$(state_of "$entity")" = "$want" ]; then return 0; fi
    sleep 0.2
  done
  return 1
}

# Tiny settle period so HA's event loop processes the state write before
# we ask about derived state. 0.3 s is enough in practice.
settle() { sleep 0.3; }

# ---- Test harness setup -----------------------------------------------------

echo "→ HA target: $HA_HOST"
echo

# Engage test mode (siren / push side-effects log to alarm_test_log) and
# shorten the FSM's wait windows so the suite finishes in seconds.
set_boolean input_boolean.alarm_test_mode on
set_number input_number.alarm_test_quiet_seconds 3
set_number input_number.alarm_test_grace_seconds 1

# All scenarios start from a clean slate.
reset_state() {
  # Quiet the sensors first so the disarmed→arming auto-arm trigger
  # doesn't fire while we're setting up.
  set_state binary_sensor.battery_room_door_contact off
  set_state binary_sensor.battery_room_motion_main_occupancy off
  set_state binary_sensor.battery_room_motion_aux_occupancy off
  set_text input_text.alarm_test_log ""
  set_text input_text.alarm_trigger_reason ""
  set_boolean input_boolean.alarm_auto_arm_enabled on
  set_select input_select.alarm_state disarmed
  settle
}

# ---- Scenario 1: disarmed → arming (room quiet + auto-arm on) ---------------
reset_state
# Sensors already off, auto-arm on, state disarmed — the template trigger
# should re-evaluate and we land in arming within one tick.
if wait_for_state input_select.alarm_state arming 5; then
  ok "1. disarmed → arming when room quiet AND auto-arm enabled"
else
  fail "1. disarmed → arming did not fire (state=$(state_of input_select.alarm_state))"
fi

# ---- Scenario 2: disarmed stays disarmed when door open ---------------------
reset_state
set_state binary_sensor.battery_room_door_contact on
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "2. door open blocks auto-arm"

# ---- Scenario 3: disarmed stays disarmed when motion detected ---------------
reset_state
set_state binary_sensor.battery_room_motion_main_occupancy on
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "3a. motion_main blocks auto-arm"

reset_state
set_state binary_sensor.battery_room_motion_aux_occupancy on
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "3b. motion_aux blocks auto-arm"

# ---- Scenario 4: disarmed stays disarmed when auto-arm disabled -------------
reset_state
set_boolean input_boolean.alarm_auto_arm_enabled off
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "4. auto-arm off blocks auto-arm"

# ---- Scenario 5: arming → armed after quiet period --------------------------
reset_state
# Sit in arming, wait the configured 3-second test window + a small
# margin for the trigger fire.
if wait_for_state input_select.alarm_state armed 8; then
  ok "5. arming → armed after quiet_seconds=3 elapses"
else
  fail "5. arming → armed did not fire (state=$(state_of input_select.alarm_state))"
fi

# ---- Scenario 6: arming holds when disturbed mid-window ---------------------
reset_state
wait_for_state input_select.alarm_state arming 5 || true
sleep 1               # ~1/3 into the 3 s quiet window
set_state binary_sensor.battery_room_motion_main_occupancy on
sleep 0.5
set_state binary_sensor.battery_room_motion_main_occupancy off
# After the disturbance, we should still be in `arming` for at least
# another quiet_seconds. Check that we are not yet in armed.
sleep 1
assert_state input_select.alarm_state arming "6. arming holds when disturbed mid-window"
# And after another full quiet window, we land in armed.
if wait_for_state input_select.alarm_state armed 6; then
  ok "6b. arming → armed eventually after disturbance clears"
else
  fail "6b. arming → armed did not recover (state=$(state_of input_select.alarm_state))"
fi

# ---- Scenario 7: armed grace suppresses immediate trigger -------------------
reset_state
set_select input_select.alarm_state armed       # just entered armed
sleep 0.3
set_state binary_sensor.battery_room_motion_main_occupancy on  # within grace
sleep 0.3
assert_state input_select.alarm_state armed "7. grace period suppresses trigger"

# ---- Scenario 8: armed → triggered on door after grace ---------------------
reset_state
set_select input_select.alarm_state armed
sleep 2     # > grace_seconds=1
set_state binary_sensor.battery_room_door_contact on
settle
assert_state input_select.alarm_state triggered "8. armed → triggered on door"
reason=$(state_of input_text.alarm_trigger_reason)
case "$reason" in *door*) ok "8b. triggerReason contains 'door' (got: $reason)" ;;
                  *) fail "8b. triggerReason missing 'door' (got: $reason)" ;;
esac

# ---- Scenario 9: armed → triggered on aux motion, reason key ---------------
reset_state
set_select input_select.alarm_state armed
sleep 2
set_state binary_sensor.battery_room_motion_aux_occupancy on
settle
assert_state input_select.alarm_state triggered "9. armed → triggered on motion_aux"
reason=$(state_of input_text.alarm_trigger_reason)
case "$reason" in *motion_aux*) ok "9b. triggerReason contains 'motion_aux' (got: $reason)" ;;
                  *) fail "9b. triggerReason missing 'motion_aux' (got: $reason)" ;;
esac

# ---- Scenario 10: triggered is latched — sensors quieting does NOT clear ---
reset_state
set_select input_select.alarm_state armed
sleep 2
set_state binary_sensor.battery_room_door_contact on
settle
assert_state input_select.alarm_state triggered "10a. entered triggered"
set_state binary_sensor.battery_room_door_contact off
set_state binary_sensor.battery_room_motion_main_occupancy off
set_state binary_sensor.battery_room_motion_aux_occupancy off
sleep 1
assert_state input_select.alarm_state triggered "10b. triggered latched after sensors quiet"

# ---- Scenario 11: side-effect logging in test mode --------------------------
# After the latest trigger, the test log should carry the push + siren
# events from when we entered `triggered` in scenario 10.
log=$(state_of input_text.alarm_test_log)
case "$log" in *push:*|*siren_on:*) ok "11. side-effects logged in test mode (last entry: $log)" ;;
               *) fail "11. expected push/siren_on in test log, got: $log" ;;
esac

# ---- Scenario 12: manual disarm clears reason + logs siren_off --------------
# Hold the door 'on' across the disarm so auto-arm doesn't immediately
# re-fire and steal the assertion window. The disarm side-effects
# (reason clear, siren_off log) still fire on the state transition.
set_state binary_sensor.battery_room_door_contact on
settle
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "12. manual disarm honoured"
assert_state input_text.alarm_trigger_reason "" "12b. disarm clears reason"
log=$(state_of input_text.alarm_test_log)
case "$log" in *siren_off*) ok "12c. siren_off logged on disarm" ;;
               *) fail "12c. expected siren_off in test log, got: $log" ;;
esac
set_state binary_sensor.battery_room_door_contact off

# ---- Scenario 13: sensor-availability gating --------------------------------
reset_state
set_state binary_sensor.battery_room_door_contact unavailable
set_select input_select.alarm_state disarmed
settle
assert_state input_select.alarm_state disarmed "13. unavailable sensor blocks auto-arm"
set_state binary_sensor.battery_room_door_contact off    # restore
sleep 1

# ---- Teardown ---------------------------------------------------------------
set_boolean input_boolean.alarm_test_mode off
set_state binary_sensor.battery_room_door_contact off
set_state binary_sensor.battery_room_motion_main_occupancy off
set_state binary_sensor.battery_room_motion_aux_occupancy off
set_select input_select.alarm_state disarmed

echo
echo "─────────────────────────────"
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
