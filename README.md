# JK BMS over Bluetooth → Home Assistant

ESPHome firmware for an ESP32-C3 that bridges a JK BMS (PB-series, 16-cell
LFP) over Bluetooth Low Energy to Home Assistant, plus three web dashboards
served from HA (main / advanced / alarm), plus a Node-RED flow that runs
the battery-room intrusion alarm.

## What this is

- **`jk-pb-bms.yaml`** — the ESPHome firmware. ESP32-C3 connects to the BMS
  over BLE using the upstream `jk_bms_ble` component (`JK02_32S` protocol)
  and republishes everything to HA via the native API.
- **`dashboard/bms/`** — the **main** dashboard (`index.html` + `style.css` +
  `app.js`). Half-circle SOC gauge, voltage / max temperature in the
  corners, twin power + predicted-runtime readout below a 12-cell
  battery bar. Pitch-black OLED-style design, DSEG7 7-segment digits,
  pure HTML/CSS/JS, no framework dependencies, font self-hosted. Deploy
  bundles the folder into a single `/local/bms-integrated.html`.
- **`dashboard/advanced/`** — diagnostic view. Live entity list, per-cell
  voltages and resistances, 1h/6h/24h/3d/7d history charts for SOC /
  current / power / temperature, polling diagnostics, raw JSON. Deploys
  to `/local/bms-dashboard.html`.
- **`node-red/battery-room-alarm.flow.json`** — battery-room intrusion
  alarm FSM (`disarmed → arming → armed → triggered`) driven by Zigbee
  motion + door sensors, fires the Zigbee siren and a critical-priority
  push notification on trip.
- **`dashboard/alarm/`** — single-purpose alarm dashboard. ARM /
  DISARM buttons, live sensor readouts, auto-arm toggle, advanced
  settings (quiet timer, grace seconds, siren duration). Reachable from
  the main BMS dashboard via the `alarm ›` link. Deploys to
  `/local/alarm.html`.
- **`homeassistant/alarm-helpers.yaml`** — HA helpers (input_boolean /
  input_number / input_select / input_text) consumed by the alarm flow,
  deployed into `/config/packages/jk_alarm.yaml`.
- **`scripts/deploy-ha.sh`** — one-shot deploy / re-deploy to a Home
  Assistant box (substitutes the API token, mirrors fonts, idempotently
  installs helpers, reloads helper domains, runs `ha core check`).
- **`inverter/easun.yaml`** — separate ESP32 firmware for an Easun
  hybrid inverter on the same network. Independent of the BMS work.

## Hardware

- JK-PB2A16S20P (or any JK BMS speaking the `JK02_32S` BLE protocol).
  Pack capacity (Ah) is whatever the BMS firmware was configured with —
  the dashboard reads it at runtime via
  `sensor.jk_pb_bms_total_battery_capacity`, so cell counts / capacities
  are not baked into source.
- ESP32-C3 Super Mini (or any ESP32-C3 board with BLE).
- USB-C cable for power + initial flashing.

That's it — only BLE.

## Setup

### One-shot bootstrap

```
just setup
```

That single command:

- Creates `.venv/` and installs `esphome` into it.
- Downloads a self-contained Node.js 20 binary into `.tools/` (used by
  `just test`). System node is reused if it's already installed and ≥ 18.
- Copies `secrets.yaml.example` → `secrets.yaml` (if missing) and links
  `inverter/secrets.yaml` to it.
- Runs `just check && just test` to validate the bootstrap.

### Prerequisites assumed by `setup.sh`

`git`, `just`, `python3` (≥ 3.10), `curl`, `tar`. macOS (x64 / arm64) and
Linux (x64 / arm64) are supported. Nothing else needs to be on PATH —
Node.js, esphome, and any future tooling are downloaded into the repo.

### Home Assistant deploy target

A reachable HA instance (LAN or Tailscale). The "SSH & Web Terminal"
addon must be enabled, with your local SSH key authorised so
`scripts/deploy-ha.sh` can `scp` / `ssh` without a prompt.

### 1. Find the BMS BLE MAC

Open the JK BMS app on a phone, note the device's Bluetooth name (usually
`JK_BMS_*` or model-named). For first flash, leave `ble_client.mac_address`
in `jk-pb-bms.yaml` as a placeholder; the firmware logs every BLE
advertisement it sees on boot, and the JK MAC is identifiable by name.
Put the real MAC in once you know it.

### 2. Fill in `secrets.yaml`

```
cp secrets.yaml.example secrets.yaml
```

Fill in WiFi creds, ESPHome API encryption key, OTA password, AP password,
the BMS BLE MAC, and the Home Assistant deploy block (`ha_host`, `ha_user`,
`ha_token` — the token comes from HA → Profile → Security → Long-Lived
Access Tokens). The API encryption key is shared between firmware and the
HA integration — generate one with `openssl rand -base64 32`.

### 3. Build + flash

First flash via USB:

```
.venv/bin/esphome run jk-pb-bms.yaml --device /dev/cu.usbmodem*
```

Subsequent updates OTA from the same network:

```
.venv/bin/esphome run jk-pb-bms.yaml
```

### 4. Add to Home Assistant

After the device boots and joins WiFi, HA auto-discovers it. Accept the
discovery; HA asks for the API encryption key — paste the same value
that's in `secrets.yaml`. All entities (SOC, voltage, current, power,
cell voltages, temperatures, balancing, errors) appear under the device.

### 5. Deploy the dashboards + helpers

```
scripts/deploy-ha.sh
```

The script:

1. Reads `ha_host` / `ha_user` / `ha_token` from `secrets.yaml` (env vars
   override them — `HA_HOST=… HA_TOKEN=… scripts/deploy-ha.sh`).
2. Substitutes the token into both dashboards, minifies inline CSS / JS,
   and `scp`s them to `/config/www/`.
3. Mirrors `dashboard/fonts/` to `/config/www/fonts/` (DSEG7 Modern Bold
   self-hosted; no external font CDN at runtime).
4. Pushes `homeassistant/alarm-helpers.yaml` to
   `/config/packages/jk_alarm.yaml` (HA's `packages:` mechanism merges
   the helpers per-domain, idempotent across re-runs).
5. Runs `ha core check` and reloads `input_boolean` / `input_number` /
   `input_text` domains via the HA REST API.

URLs once deployed:

| Page                                  | URL                                          |
| ------------------------------------- | -------------------------------------------- |
| Main                                  | `http://<ha>:8123/local/bms-integrated.html` |
| Diagnostic (history, cells, raw JSON) | `http://<ha>:8123/local/bms-dashboard.html`  |

Press **A** on either page to swap to the other.

### 6. Node-RED alarm flow (optional)

`node-red/battery-room-alarm.flow.json` is the battery-room alarm FSM.
It reads the door + 2 motion sensors, writes `input_select.alarm_state`,
publishes siren start/stop over MQTT, and pushes a critical-priority
alert to every `notify.*` target on a trip.

To import:

1. Open Node-RED in HA → hamburger menu → Import → paste the contents of
   the flow JSON → Import.
2. Each HA node will show "missing config" — open one, pick your existing
   Home Assistant server in the Server dropdown, save. NR auto-applies
   it to the rest.
3. Deploy.

The MQTT publishes use HA's `mqtt.publish` service (no separate broker
config in Node-RED needed). The push notification node calls
`notify.notify`, which broadcasts to every mobile_app integration
registered with HA.

## Project layout

```
.
├── jk-pb-bms.yaml             ESPHome firmware (BLE)
├── secrets.yaml.example       Required secret keys; copy to secrets.yaml
├── secrets.yaml               Real secrets (gitignored)
├── dashboard/
│   ├── bms/                   Main dashboard (index.html + style.css + app.js)
│   ├── alarm/                 Alarm dashboard (index.html + style.css + app.js)
│   ├── advanced/              Diagnostic dashboard (index.html + style.css + app.js)
│   ├── lib/                   Shared pure-function helpers (i18n, predict, fsm…)
│   ├── favicon.svg            PWA icon — vertical battery, dashboard palette
│   └── fonts/                 Self-hosted DSEG7 Modern Bold (OFL 1.1)
├── homeassistant/
│   └── alarm-helpers.yaml     Helpers consumed by the alarm flow
├── node-red/
│   └── battery-room-alarm.flow.json   Battery-room alarm FSM
├── scripts/
│   ├── deploy-ha.sh           One-shot HA deploy
│   ├── fmt.sh                 prettier + ruff format runner
│   ├── check.sh               Validation gates (run by `just check`)
│   ├── test.sh                Node test runner
│   └── minify-html.py         Inline CSS/JS minifier (used by deploy)
└── inverter/
    └── easun.yaml             Easun inverter firmware (unrelated to BMS)
```

The `jk_bms_ble` ESPHome component is fetched from
[`syssi/esphome-jk-bms`](https://github.com/syssi/esphome-jk-bms) at
compile time via the `external_components` block in `jk-pb-bms.yaml`.
The pin is a specific commit hash — bump it deliberately if you want a
newer revision.

## Dashboard architecture

Both dashboards are single-file vanilla web apps. They poll the HA REST
API at `${HA_URL}/api/states/<entity_id>` with a Bearer token, same-origin
when served from HA's `/local/` path. Refresh cadence: 1 Hz.

The main dashboard's runtime prediction uses a rolling 1-hour mean of the
BMS power signal, projected linearly to either "until empty" (discharging)
or "until full" (charging). The 1-hour window deliberately avoids being
biased by daytime "free energy" usage that doesn't carry over once the
sun is down — rate at any given moment reflects sustained consumption,
not instantaneous spikes.

Tokens never enter the repo. Each `*.html` template carries the literal
placeholder `PASTE_LONG_LIVED_ACCESS_TOKEN_HERE`; `scripts/deploy-ha.sh`
substitutes it at deploy time. `.gitignore` blocks `dashboard/*.local.html`.

## Disaster recovery — bring up a brand-new HA box from this repo

Everything the live HA OS box needs is mirrored under `homeassistant/`,
sanitised so secrets don't ride along:

```
homeassistant/
├── core/
│   ├── configuration.yaml          /config/configuration.yaml
│   └── HA_VERSION                  noted as "tested with"
├── packages/jk_alarm.yaml          (still at homeassistant/alarm-helpers.yaml)
├── addons/
│   ├── 5c53de3b_esphome.json       Add-on options snapshot
│   ├── 45df7312_zigbee2mqtt.json
│   ├── a0d7b954_nodered.json
│   ├── a0d7b954_ssh.json
│   ├── a0d7b954_tailscale.json
│   ├── cb646a50_get.json           HACS install helper (one-shot)
│   └── core_mosquitto.json
├── zigbee2mqtt/
│   └── configuration.yaml          Z2M config — secrets stripped
└── node-red/
    ├── flows.json                  Full flows (server-config IDs blanked)
    ├── settings.js
    └── package.json
```

To restore from scratch:

1. Flash Home Assistant OS to your SBC, complete first-boot.
2. Install the Advanced SSH & Web Terminal add-on from the community
   repo, set up an SSH key, **disable Protection mode** (so the addon
   can reach the Supervisor API).
3. Clone this repo, run `scripts/setup.sh`, fill in `secrets.yaml`
   (especially `ha_host`, `ha_user`, `ha_token`).
4. `just restore` — installs each add-on (or prompts you to add the
   community repo for ones it can't auto-find), applies every saved
   options snapshot, pushes the core configuration, Z2M config, and
   Node-RED flows, then hands off to `just deploy` for the dashboards.

What `just restore` cannot automate (it'll print `▸ MANUAL STEP` lines
where these come up):

- **Zigbee mesh state.** `coordinator_backup.json` is the only thing
  that lets you rejoin already-paired devices without re-pairing — and
  it contains the network key, so it's deliberately kept out of the
  repo. Back it up out-of-band (e.g. a 1Password attachment); on a
  fresh box, drop it into `/config/zigbee2mqtt/` before Z2M's first
  start. Otherwise re-pair every device.
- **Tailscale auth.** Open the Tailscale add-on web UI; the log prints
  a one-time login URL.
- **HA users + long-lived tokens.** Recreate via Settings → People; mint
  a new long-lived token in the user profile and paste into
  `secrets.yaml` as `ha_token`.
- **Mosquitto MQTT user.** Settings → People → Users → create the
  account whose password Z2M's `configuration.yaml` references.
- **HACS.** Re-add via Settings → Devices & Services → Add Integration
  → HACS; sign in with GitHub.

Add-on options are applied via the Supervisor REST API
(`POST /addons/<slug>/options`). The Supervisor token used for that
call lives inside the SSH addon's container as `$SUPERVISOR_TOKEN`, so
you never need to expose it from the box.

## Licence

Everything authored in this repo is **MIT** (see `LICENSE`). Third-party
dependencies retain their own licenses where required:

- The DSEG7 Modern Bold font (`dashboard/fonts/DSEG7Modern-Bold.woff2`)
  ships with its own license under the SIL Open Font License 1.1, kept
  alongside the font file at `dashboard/fonts/DSEG-LICENSE.txt` (OFL §3
  requires it to travel with the font).
- The `jk_bms_ble` ESPHome component referenced by
  `external_components:` in `jk-pb-bms.yaml` is fetched from
  [`syssi/esphome-jk-bms`](https://github.com/syssi/esphome-jk-bms) at
  build time. It's Apache-2.0; that license attaches to the binary that
  ESPHome compiles, not to anything checked in here.
