#!/usr/bin/env bash
#
# Integration test for the pure-HA alarm package (Phase 2 build —
# alarm_control_panel.manual as the state machine).
#
# Drives the live Home Assistant instance via REST: pokes binary_sensor
# states, calls alarm_control_panel services, asserts the resulting
# panel state. Acts as the spec — every behaviour the alarm must
# honour (auto-arm path, disturbance reset, entry-delay grace, trigger
# reason aggregation, latched-triggered, sensor-availability gating,
# manual disarm side-effects) is one or more assertions here.
#
# Side-effects (siren, push) are stubbed by flipping
# `input_boolean.alarm_test_mode` on — the destructive automations
# log to `input_text.alarm_test_log` instead of firing real services.
# No siren wails, no phones get paged.
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
PANEL="alarm_control_panel.battery_room"
PASS=0
FAIL=0

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; FAIL=$((FAIL+1)); }

# ---- Helpers: REST primitives -----------------------------------------------

state_of() {
  /usr/bin/curl -fsS -H "Authorization: Bearer $HA_TOKEN" "$BASE/states/$1" \
    | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin)['state'])"
}

set_state() {
  local entity="$1" value="$2"
  /usr/bin/curl -fsS -X POST -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"state\": \"$value\"}" \
    "$BASE/states/$entity" >/dev/null
}

call_service() {
  local domain="$1" service="$2" payload="$3"
  /usr/bin/curl -fsS -X POST -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$BASE/services/$domain/$service" >/dev/null
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

# Panel service shortcuts.
arm_away() {
  call_service alarm_control_panel alarm_arm_away "{\"entity_id\":\"$PANEL\"}"
}
disarm() {
  call_service alarm_control_panel alarm_disarm "{\"entity_id\":\"$PANEL\"}"
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

wait_for_state() {
  local entity="$1" want="$2" timeout="$3"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ "$(state_of "$entity")" = "$want" ]; then return 0; fi
    sleep 0.2
  done
  return 1
}

settle() { sleep 0.3; }

# ---- Test harness setup -----------------------------------------------------

echo "→ HA target: $HA_HOST"
echo

# Engage test mode (siren / push route to alarm_test_log) and shorten
# the quiet-hold window. delay_time (entry-delay grace) is baked into
# alarm_control_panel YAML at 10 s so tests do wait ~11 s per trigger.
set_boolean input_boolean.alarm_test_mode on
set_number input_number.alarm_test_quiet_seconds 3

reset_state() {
  # Quiet the sensors before disarming so the auto-arm template trigger
  # doesn't immediately re-evaluate while we're mid-setup.
  set_state binary_sensor.battery_room_door_contact off
  set_state binary_sensor.battery_room_motion_main_occupancy off
  set_state binary_sensor.battery_room_motion_aux_occupancy off
  set_text input_text.alarm_test_log ""
  set_text input_text.alarm_trigger_reason ""
  set_boolean input_boolean.alarm_auto_arm_enabled on
  disarm
  settle
}

# ---- Scenario 1: auto-arm — disarmed → armed_away after quiet hold ----------
reset_state
if wait_for_state "$PANEL" armed_away 8; then
  ok "1. auto-arm fires after quiet_seconds=3 elapses"
else
  fail "1. auto-arm did not fire (state=$(state_of "$PANEL"))"
fi

# ---- Scenario 2: door open blocks auto-arm ----------------------------------
reset_state
disarm; settle
set_state binary_sensor.battery_room_door_contact on
sleep 5
assert_state "$PANEL" disarmed "2. door open blocks auto-arm"

# ---- Scenario 3: motion blocks auto-arm -------------------------------------
reset_state
disarm; settle
set_state binary_sensor.battery_room_motion_main_occupancy on
sleep 5
assert_state "$PANEL" disarmed "3a. motion_main blocks auto-arm"

reset_state
disarm; settle
set_state binary_sensor.battery_room_motion_aux_occupancy on
sleep 5
assert_state "$PANEL" disarmed "3b. motion_aux blocks auto-arm"

# ---- Scenario 4: auto-arm disabled keeps it disarmed ------------------------
reset_state
disarm; settle
set_boolean input_boolean.alarm_auto_arm_enabled off
sleep 5
assert_state "$PANEL" disarmed "4. auto-arm off blocks auto-arm"
set_boolean input_boolean.alarm_auto_arm_enabled on

# ---- Scenario 5: disturbance during quiet-hold restarts the timer -----------
reset_state
disarm; settle
sleep 1
set_state binary_sensor.battery_room_motion_main_occupancy on
sleep 0.5
set_state binary_sensor.battery_room_motion_main_occupancy off
sleep 1
# Still in disarmed because the for: window restarted; verify it's not
# yet armed_away.
assert_state "$PANEL" disarmed "5. quiet-hold restarts on disturbance"
# Eventually it should arm after another full quiet_seconds.
if wait_for_state "$PANEL" armed_away 6; then
  ok "5b. recovers and arms after disturbance clears"
else
  fail "5b. did not arm after disturbance cleared (state=$(state_of "$PANEL"))"
fi

# ---- Scenario 6: manual arm via service call --------------------------------
reset_state
arm_away
settle
assert_state "$PANEL" armed_away "6. manual arm_away service call honoured"

# ---- Scenario 7: armed_away → pending → triggered, reason captured ----------
# delay_time is 10 s; wait 11 to clear the entry delay.
reset_state
arm_away; settle
set_state binary_sensor.battery_room_door_contact on
# Within delay_time we should be in `pending`.
if wait_for_state "$PANEL" pending 2; then
  ok "7. armed_away → pending on door open"
else
  fail "7. did not enter pending (state=$(state_of "$PANEL"))"
fi
# After delay_time we transition to triggered.
if wait_for_state "$PANEL" triggered 13; then
  ok "7b. pending → triggered after delay_time"
else
  fail "7b. did not enter triggered (state=$(state_of "$PANEL"))"
fi
reason=$(state_of input_text.alarm_trigger_reason)
case "$reason" in *door*) ok "7c. trigger reason carries 'door' (got: $reason)" ;;
                  *) fail "7c. expected 'door' in reason, got: $reason" ;;
esac

# ---- Scenario 8: triggered is latched — sensor clearing doesn't disarm -----
set_state binary_sensor.battery_room_door_contact off
set_state binary_sensor.battery_room_motion_main_occupancy off
set_state binary_sensor.battery_room_motion_aux_occupancy off
sleep 2
assert_state "$PANEL" triggered "8. triggered latched after sensors quiet"

# ---- Scenario 9: side-effects logged in test mode ---------------------------
log=$(state_of input_text.alarm_test_log)
case "$log" in *push:*|*siren_on:*) ok "9. side-effects logged (last entry: $log)" ;;
               *) fail "9. expected push/siren_on in test log, got: $log" ;;
esac

# ---- Scenario 10: manual disarm clears state + reason + logs siren_off -----
# Hold a sensor on so auto-arm doesn't immediately re-fire after disarm.
set_state binary_sensor.battery_room_door_contact on
settle
disarm
settle
assert_state "$PANEL" disarmed "10. manual disarm honoured"
assert_state input_text.alarm_trigger_reason "" "10b. disarm clears reason"
log=$(state_of input_text.alarm_test_log)
case "$log" in *siren_off*) ok "10c. siren_off logged on disarm" ;;
               *) fail "10c. expected siren_off in test log, got: $log" ;;
esac
set_state binary_sensor.battery_room_door_contact off

# ---- Scenario 11: sensor-availability gating --------------------------------
reset_state
disarm; settle
set_state binary_sensor.battery_room_door_contact unavailable
sleep 5
assert_state "$PANEL" disarmed "11. unavailable sensor blocks auto-arm"
# `binary_sensor.alarm_sensors_ok` should report off.
assert_state binary_sensor.alarm_sensors_ok off "11b. alarm_sensors_ok reflects unavailable sensor"
set_state binary_sensor.battery_room_door_contact off
sleep 1
assert_state binary_sensor.alarm_sensors_ok on "11c. alarm_sensors_ok recovers when sensor returns"

# ---- Scenario 12: pending → disarmed during entry delay ----------------
# User has delay_time seconds to disarm before the siren fires.
reset_state
arm_away; settle
set_state binary_sensor.battery_room_motion_aux_occupancy on
wait_for_state "$PANEL" pending 2 || fail "12-setup. failed to enter pending"
# Disarm during the entry-delay window.
sleep 2  # part-way through the 10s delay
set_state binary_sensor.battery_room_motion_aux_occupancy off
disarm
settle
assert_state "$PANEL" disarmed "12. disarm during entry delay returns to disarmed (no trigger)"
log=$(state_of input_text.alarm_test_log)
# Should have logged siren_off (from disarm cleanup) but NOT siren_on
# (because we never crossed into triggered).
case "$log" in *siren_on*) fail "12b. siren_on logged even though we never triggered (got: $log)" ;;
               *) ok "12b. no siren_on logged — early disarm prevented trigger" ;;
esac

# ---- Teardown ---------------------------------------------------------------
set_boolean input_boolean.alarm_test_mode off
set_state binary_sensor.battery_room_door_contact off
set_state binary_sensor.battery_room_motion_main_occupancy off
set_state binary_sensor.battery_room_motion_aux_occupancy off
disarm

echo
echo "─────────────────────────────"
printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
