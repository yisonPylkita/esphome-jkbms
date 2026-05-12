# AGENTS.md — repo tooling map for AI agents (and new humans)

This doc is the one-shot orientation for working in this repo. If you're
an LLM coding agent (Claude Code, Cursor, Aider, anything) or a new
contributor, read this first — it's a tighter, denser starting point
than the user-facing `README.md`.

## What this repo is

A self-hosted battery monitoring + intrusion alarm system for a JK PB-series
LFP pack. Three deliverables: ESPHome firmware that bridges the BMS to
Home Assistant over BLE, four `/local/*.html` dashboards served from HA,
and an HA package (`homeassistant/alarm-helpers.yaml`) that runs a
2-state alarm panel with Zigbee sensors + siren. Everything ships via
one `just deploy`.

## How to do common things

Twelve workflows. Each is one paragraph, terse on purpose. Where a
subagent exists for the workflow, the agent name is in **bold**.

### Deploy a YAML change

`just deploy`. The recipe runs `just check && just test` first, then
`scripts/deploy-ha.sh`. The deploy script substitutes secrets into
dashboards, minifies + inlines lib/\_.js, scp's everything to
`/config/www/`, pushes the alarm package to `/config/packages/`,
reloads `input\__`+`automation`, runs `ha core check`. If you edited
`homeassistant/core/configuration.yaml`or the`alarm_control_panel:`block of`alarm-helpers.yaml`, also `ssh root@<ha> ha core restart`
afterwards — those don't reload at runtime. Subagent:
\*\*`ha-deploy-verify`\*\*.

### OTA-flash the BMS firmware

The BMS device is on the user's LAN, not directly reachable from this
machine. So: `.venv/bin/esphome compile jk-pb-bms.yaml`, then push the
build artefact + the standalone `espota2_standalone.py` to the HA box
via `scp`, then run the standalone uploader from inside the HA box
(which IS on the LAN). The pattern is captured in
`scripts/ping-siren.py`'s sibling work — see commit history for the
canonical incantation. Subagent: **`esphome-ota`**.

### Debug "siren not firing" reports

Three layers to check, in order: (1) HA's automation actually ran —
look at `automation.jk_alarm_intrusion_response` last_triggered.
(2) HA's service call shape — `siren.turn_on` needs `tone:` set for
Tuya/Aqara sirens, silent without it. (3) Zigbee downlink — run
`just ping-siren`. < 95% success = mesh problem (add a router /
re-pair / move device closer). Subagent: **`zigbee-mesh-doctor`**.

### Debug "dashboard shows no data" reports

First check the long-lived HA token is still valid: `curl -H
"Authorization: Bearer $(grep ha_token secrets.yaml | …)"
.../api/states/sensor.foo`. 401 = token was revoked from
`.storage/auth`; mint a new one in HA UI, paste into `secrets.yaml`,
`just deploy`. Other 401-not-revoked cases: HA's `http.trusted_proxies`
doesn't include the request's source. Dashboard HTML loading (200) but
no data updating = entity polls returning 401, see token path.
Subagent: **`ha-live-debug`**.

### Run the alarm integration test

`just test-alarm`. Drives the live HA via REST: pokes sensor states
(`POST /api/states/<binary_sensor>`), calls
`alarm_control_panel.alarm_arm_away`/`alarm_disarm`, asserts
post-conditions. Side-effects (siren, push) routed to
`input_text.alarm_test_log` via `input_boolean.alarm_test_mode` so it's
safe to run while the real alarm is in service.

### Audit the recorder database

SSH to HA, `ls -lh /config/home-assistant_v2.db*`. Then `sqlite3
-readonly`, query `dbstat` for table sizes + `states` joined with
`states_meta` for top entities by row count. The JK BMS cell voltages
are typically the firehose — with the ESPHome throttle filters in
`jk-pb-bms.yaml`, they should produce ~55 events/min total across all
16 cells (not 480+). If higher, the firmware isn't running the throttled
build — re-OTA. Subagent: **`recorder-housekeeper`**.

### Rotate the HA token

HA UI → user profile (top-left avatar) → Security → Long-Lived Access
Tokens → Create. Paste into `secrets.yaml` as `ha_token: "…"`. Then
`just deploy` — re-bakes the token into every dashboard. Old token's
refresh_token_id stays in `.storage/auth` until you delete it from the
same UI; no urgency.

### Inspect a Z2M device's MQTT activity

SSH to HA, `ls -dt /config/zigbee2mqtt/log/*/ | head -1` → latest log
dir. `tail -f $dir/log.log | grep <friendly_name>` watches the
device. Failed downlink shows as `Publish 'set' ... to '<dev>' failed:
... (Delivery failed for '<nwkAddr>')`. Successful set shows as `MQTT
publish: topic 'zigbee2mqtt/<dev>', payload '{…}'`.

### Read HA's error log

`ssh root@<ha> ha core logs 2>&1 | tail -200 | grep -iE
'error|warning|deprecat'`. Or via REST: `GET /api/error_log` (200 when
working, 404 indicates HA core isn't fully booted). Authentication
failures show as `WARNING ... Login attempt or request with invalid
authentication from <ip>`.

### Check what's deployed vs what's local

`just dry-run`. Builds the dashboards as if for deploy, sha256's each,
fetches the remote sha256 via SSH+sha256sum, prints a per-file
match/mismatch table. Doesn't push. Use before a `just deploy` if
you're worried something was changed manually on the HA side.

### Restart HA core remotely

`curl -X POST -H "Authorization: Bearer $HA_TOKEN"
http://$HA_HOST:8123/api/services/homeassistant/restart` returns 504
(HA closes the HTTP connection during restart — expected). Then poll
`http://$HA_HOST:8123/api/config` until it returns 200, typically
30-60 s. Or `ssh root@<ha> "ha core restart"`.

### Work with the SSH tunnel pattern

For devices on the user's LAN that aren't directly Tailscale-reachable
(the BMS ESP32-C3, the Zigbee siren, etc.), the HA box is the proxy.
For TCP services on those devices, `ssh -fN -L <local>:<lan-ip>:<port>
root@<ha-box>` creates a forward. The classic gotcha: ssh tunnels can
break some protocols (ESPHome's OTA does NOT work through a generic
SSH `-L` tunnel — its handshake gets reset). For those, the answer
is to copy a small helper script onto the HA box and run it from
there directly.

## File map

```
.
├── jk-pb-bms.yaml                 ESPHome firmware (BLE → BMS)
├── homeassistant/
│   ├── alarm-helpers.yaml         The entire alarm system (helpers +
│   │                              template panel + automations).
│   │                              Deploys to /config/packages/jk_alarm.yaml.
│   ├── core/configuration.yaml    /config/configuration.yaml mirror
│   ├── addons/*.json              Per-addon options snapshots (restore)
│   └── zigbee2mqtt/configuration.yaml  Z2M config (secrets stripped)
├── dashboard/
│   ├── bms/         Main BMS dashboard (single-file vanilla HTML/CSS/JS)
│   ├── alarm/       Alarm panel dashboard
│   ├── advanced/    Diagnostic dashboard
│   ├── history/     Alarm-history dashboard
│   ├── lib/         Shared pure-function JS (i18n, predict, sun, zones,
│   │                version-check). Inlined at deploy time.
│   ├── fonts/       DSEG7 self-hosted (OFL 1.1)
│   └── favicon.svg
├── tests/                         Node-driven unit tests for dashboard/lib/*
├── scripts/
│   ├── setup.sh                   First-time bootstrap (uv + node)
│   ├── deploy-ha.sh               One-shot HA deploy
│   ├── restore-ha.sh              Disaster recovery
│   ├── check.sh                   Validation gates (just check)
│   ├── fmt.sh                     prettier + ruff
│   ├── test.sh                    Node test runner (just test)
│   ├── test-alarm-ha.sh           Live HA integration test (just test-alarm)
│   ├── ping-siren.py              Zigbee downlink probe (just ping-siren)
│   └── minify-html.py             Inline CSS/JS minifier
├── inverter/easun.yaml            Easun inverter firmware (unrelated)
├── secrets.yaml                   Gitignored. ha_host/token/wifi/etc.
├── secrets.yaml.example           Canonical key list
├── justfile                       Tooling entry point (`just` to list)
├── pyproject.toml                 Python dev deps (uv + ruff + ty)
├── uv.lock
├── .python-version                3.14
├── package.json                   Tiny — prettier consumers
├── package-lock.json
├── README.md                      User-facing docs
├── AGENTS.md                      This file
└── .claude/agents/                Subagent definitions (tracked)
```

## Gotchas list

Every entry below cost real debugging time at some point. Read once,
save weeks later.

### Home Assistant / Recorder

- **`siren.turn_on` needs `tone:` set** for Tuya/Aqara sirens. Without
  it, HA's assumed_state flips to `on` but the device plays nothing
  (the converter writes `mode=0` = silent to the IAS WD cluster).
- **Tuya/Aqara siren volume defaults to mute** after re-pair. Always
  set `select.battery_room_siren_volume` to `"high"` before turn_on
  in the automation.
- **`trigger_time: 0` in `alarm_control_panel.manual` disables the
  triggered state entirely** (the HA docs say it "disables auto-
  disarm" — empirically wrong). Use `trigger_time: 86400` if you
  want effectively-infinite triggered duration.
- **`recorder:` config requires full HA core restart** to reload.
  `homeassistant.reload_core_config` doesn't touch the recorder.
- **`alarm_control_panel:` YAML at top level requires full HA core
  restart** to reload. The `template:` alarm panel reloads via
  `template.reload`, which is one reason we use the template one.
- **HA long-lived tokens can silently vanish from `.storage/auth`**.
  Symptom: 401 on every `/api/*` request including from your own
  browser-loaded dashboards. Fix: HA UI → Profile → Security →
  create new LLAT → paste into `secrets.yaml` → `just deploy`.
- **HA's entity `last_updated` only bumps on state CHANGE**. With
  source-throttled sensors (the JK BMS cell voltages, etc.) a
  healthy sensor's `last_updated` can be many seconds stale. Don't
  use `last_updated` for "is the device alive" checks; use the
  entity's domain-level health signal (`binary_sensor.*_online`,
  `state == 'unavailable'`, or HA's catch-block on REST fail).
- **`code_arm_required` defaults to `true` on `template:`
  alarm_control_panel**. Without `code_arm_required: false`,
  `alarm_arm_away` returns 500 with `ServiceValidationError`. Also
  set `code_format: no_code` to suppress the PIN-entry dialog in the
  mobile widget.
- **Template trigger `for:` duration is locked in at the
  template-true transition**. If the template was already true when
  you change an input that the duration template references, the
  existing `for:` timer keeps the old value. To reset: force the
  template false → true again (toggle one of its inputs).
- **HA's `alarm_control_panel.manual` always exposes every arm
  mode** (Home/Away/Night/Vacation/Custom) in the mobile-app native
  widget — no way to restrict via the platform config. Use a
  `template:` alarm panel instead; it advertises only the arm modes
  whose actions you defined.

### Zigbee2MQTT

- **`linkquality < 150` on a Router-class device is bad.**
  End-devices < 50 is bad. Run `just ping-siren` to confirm actual
  delivery rates rather than trusting the linkquality figure (which
  is uplink-only). 0% delivery with `~8 ms` latencies = device's
  parent router has marked it unreachable; needs power-cycle / re-
  pair / mesh extension.
- **`assumed_state: true` on Z2M-exposed sirens** means HA reports
  state based on what it commanded, not what the device confirmed.
  A successful service call doesn't prove the siren made noise.
  Always verify via the device or via `just ping-siren`.
- **Z2M end-devices are "sticky" to their parent router.** Adding a
  new router to the mesh doesn't automatically attract them.
  Re-pair or power-cycle the end-device to force fresh parent
  selection.

### ESPHome firmware

- **The BMS device's IP is LAN-only**, not directly reachable from a
  Tailscale-only client. ESPHome's TCP-based OTA does NOT survive a
  generic `ssh -L` forward — the handshake gets reset. Solution:
  push a standalone `espota2.py` to the HA box and run it from
  there. See `esphome-ota` subagent and recent commit history.
- **The `jk_bms_ble` external component is fetched at compile time**
  from `syssi/esphome-jk-bms` at a pinned commit. Bumping the pin is
  deliberate — don't auto-update.
- **Per-entity `filters: [throttle, delta]` are critical** for cell
  voltages and resistances. Without them, the recorder gets 1.3M
  state events per day per pack. The current YAML bakes the filters
  in; if you re-derive the firmware from a template, port them.

### Networking

- **Tailscale Serve provides HTTPS at port 443**
  (`share_homeassistant: serve` in the addon options). Use
  `https://<host>.ts.net/local/...`, NOT `http://<host>:8123/...`.
  The :8123 form leaks the Bearer token in cleartext.
- **The HA-box itself does NOT have a Tailscale IP on its host
  network namespace** — Tailscale runs inside the addon container.
  HA sees client Tailscale IPs (100.64.0.0/10) via the
  `advertise_routes: local_subnets` + subnet-route mechanism.

### Dashboards

- **`HA_URL = ''` is intentional** in every dashboard's `app.js` —
  requests go to the same origin that served the page. Don't bake
  a host. This is what makes the dashboard work over LAN HTTP,
  Tailscale HTTPS, and any future routing without rebuilding.
- **The minifier inlines `<script src="../lib/*.js">` + `<link
rel="stylesheet">`** at deploy time. Don't reference external
  stylesheets or scripts; everything in `dashboard/lib/` is
  expected to be self-contained.

## Subagent index

Tracked under `.claude/agents/`. Each is a Claude Code subagent
definition — invoke via the Agent tool. Reach for these when the
task has the "spans 4 tools, has 3 gotchas" character; for one-shot
file edits or simple queries, use the main agent directly.

| Subagent                   | When to use                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ha-live-debug`**        | Anything on the live HA box is misbehaving — 401s, missing entities, broken automations, weird Z2M state. Has the auth flow + log paths + REST surfaces baked in.                                       |
| **`esphome-ota`**          | Need to push new firmware to the BMS ESP32-C3. Handles the build, the SSH-tunnel-via-HA-box dance, and the standalone espota2 invocation.                                                               |
| **`ha-deploy-verify`**     | After editing YAML/JS, want to ship + verify. Runs check + test + deploy + integration test, parses each gate's output, reports green or specifies what broke.                                          |
| **`zigbee-mesh-doctor`**   | Investigating siren / motion / door sensor unreachability. Wraps `just ping-siren`, parses Z2M logs, reads device types and linkquality, recommends "add router" vs "re-pair" vs "device hardware bad". |
| **`recorder-housekeeper`** | Auditing or cleaning up HA's SQLite recorder. Knows the schema, the top-N-entities query, and the HA-must-be-stopped-for-DELETE+VACUUM constraint.                                                      |
