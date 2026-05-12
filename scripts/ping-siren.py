#!/usr/bin/env python3
"""Zigbee downlink reliability test for the battery-room siren.

Fires idempotent `set` commands at the device's `light` attribute
(already OFF, no acoustic side-effect) and scans the Z2M log for
delivery success vs. "Publish 'set' ... failed" errors. Same downlink
path that `siren.turn_on` uses, so the pass/fail rate is a faithful
representation of how reliable real alarm fires will be.

Designed to run *on the HA box itself* — needs direct access to the
Z2M log file and the MQTT broker the Z2M addon uses. Push with:

    scp scripts/ping-siren.py root@<ha>:/tmp/ &&
        ssh root@<ha> 'python3 /tmp/ping-siren.py 36 5'

Usage:  python3 ping-siren.py [TOTAL=30] [GAP_SECONDS=5]

Healthy result: success rate ≥ 95 %, avg latency < 500 ms.
0 % with ~8 ms latencies means the device has dropped off the mesh and
needs a power-cycle (and possibly a re-pair) — no amount of automation
hedging will recover from that state.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

DEVICE = "battery_room_siren"
TOTAL = int(sys.argv[1]) if len(sys.argv) > 1 else 30
GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

# Z2M's MQTT credentials, lifted from its own configuration.yaml. The
# `addons` user is the standard Z2M↔Mosquitto bridge identity on
# Home Assistant OS — same creds Z2M itself uses.
Z2M_CONF = Path("/config/zigbee2mqtt/configuration.yaml").read_text()


def _conf(key: str) -> str:
    for line in Z2M_CONF.splitlines():
        if line.strip().startswith(f"{key}:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError(f"missing {key} in zigbee2mqtt configuration.yaml")


MQTT_USER = _conf("user")
MQTT_PASS = _conf("password")

log_dirs = sorted(Path("/config/zigbee2mqtt/log").iterdir(), key=lambda p: p.stat().st_mtime)
log_file = log_dirs[-1] / "log.log"
log_size = log_file.stat().st_size
print(f"Z2M log: {log_file}")
print(f"Testing {DEVICE} downlink — {TOTAL} attempts, {GAP}s apart\n")


def publish(topic: str, payload: str) -> None:
    subprocess.run(
        [
            "mosquitto_pub",
            "-h",
            "core-mosquitto",
            "-p",
            "1883",
            "-u",
            MQTT_USER,
            "-P",
            MQTT_PASS,
            "-t",
            topic,
            "-m",
            payload,
        ],
        check=False,
        timeout=5,
    )


def read_new_log() -> str:
    global log_size
    sz = log_file.stat().st_size
    if sz <= log_size:
        return ""
    with log_file.open("rb") as f:
        f.seek(log_size)
        chunk = f.read().decode("utf-8", errors="replace")
    log_size = sz
    return chunk


# Drain pre-existing log noise so we only see this run's entries.
read_new_log()

ok = 0
fail = 0
latencies_ok: list[int] = []

for i in range(1, TOTAL + 1):
    t0 = time.monotonic()
    publish(f"zigbee2mqtt/{DEVICE}/set", '{"light":"OFF"}')

    deadline = t0 + GAP - 0.5
    result: str | None = None
    while time.monotonic() < deadline:
        new = read_new_log()
        if new:
            if f"to '{DEVICE}' failed" in new:
                result = "FAIL"
                break
            # Success: Z2M re-publishes the device state on the device
            # topic. Match on the device topic + a known attribute.
            if f"zigbee2mqtt/{DEVICE}'" in new and '"light"' in new:
                result = "OK"
                break
        time.sleep(0.2)

    lat_ms = int((time.monotonic() - t0) * 1000)
    if result == "OK":
        ok += 1
        latencies_ok.append(lat_ms)
        print(f"  [{i:2d}/{TOTAL}] OK    latency={lat_ms:4d}ms")
    else:
        fail += 1
        reason = "Zigbee_delivery_failed" if result == "FAIL" else "no_response_within_window"
        print(f"  [{i:2d}/{TOTAL}] FAIL  latency={lat_ms:4d}ms reason={reason}")

    remain = GAP - (time.monotonic() - t0)
    if remain > 0:
        time.sleep(remain)

print("\n─────────────────────────────")
print(f"  total: {TOTAL}")
print(f"  ok:    {ok}")
print(f"  fail:  {fail}")
if ok > 0:
    avg = sum(latencies_ok) // ok
    print(f"  success rate: {ok * 100 // TOTAL}%")
    print(f"  latency (ok only): avg={avg}ms  min={min(latencies_ok)}ms  max={max(latencies_ok)}ms")
else:
    print("  success rate: 0%")

state = json.loads(Path("/config/zigbee2mqtt/state.json").read_text())
print(f"\nDevice state at end of test: {state.get('0xa4c1388fb2a89f51')}")
