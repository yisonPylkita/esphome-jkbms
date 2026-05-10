# JK BMS over Bluetooth → Home Assistant

ESPHome firmware for an ESP32-C3 that bridges a JK BMS (PB-series, 16-cell
LFP) over Bluetooth Low Energy to Home Assistant, plus two web dashboards
served from HA, plus a Node-RED flow that drives a solar-surplus heater
from the BMS feed.

## What this is

- **`jk-pb-bms.yaml`** — the ESPHome firmware. ESP32-C3 connects to the BMS
  over BLE using the upstream `jk_bms_ble` component (`JK02_32S` protocol)
  and republishes everything to HA via the native API.
- **`dashboard/bms-integrated.html`** — the **main** dashboard. Half-circle
  SOC gauge, voltage / max temperature in the corners, twin power +
  predicted-runtime readout below a 12-cell battery bar. Pitch-black
  OLED-style design, DSEG7 7-segment digits, pure HTML/CSS/JS, no
  framework dependencies, font self-hosted.
- **`dashboard/dashboard.html`** — diagnostic / advanced view. Live entity
  list, per-cell voltages and resistances, 1h/6h/24h/3d/7d history charts
  for SOC / current / power / temperature, polling diagnostics, raw JSON.
- **`node-red/heater-control.flow.json`** — solar-surplus heater FSM
  (`idle → probe → run → backoff`) driven by BMS charging / discharging
  state, sun elevation, and tunable thresholds. Imports into Node-RED.
- **`homeassistant/heater-helpers.yaml`** — `input_boolean` /
  `input_number` / `input_text` helpers consumed by the Node-RED flow,
  appended to `/config/configuration.yaml` automatically by the deploy
  script on first run.
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
4. Idempotently appends `homeassistant/heater-helpers.yaml` to
   `/config/configuration.yaml` (keyed off a marker comment so re-runs
   are safe).
5. Runs `ha core check` and reloads `input_boolean` / `input_number` /
   `input_text` domains via the HA REST API.

URLs once deployed:

| Page | URL |
|---|---|
| Main | `http://<ha>:8123/local/bms-integrated.html` |
| Diagnostic (history, cells, raw JSON) | `http://<ha>:8123/local/bms-dashboard.html` |

Press **A** on either page to swap to the other.

### 6. Node-RED heater control (optional)

The flow drives `input_boolean.heater_request` based on BMS state, sun
elevation, and tunable thresholds. Once the helpers exist (after step 5):

1. Open Node-RED in HA → hamburger menu → Import → paste the contents of
   `node-red/heater-control.flow.json` → Import.
2. Each HA node will show "missing config" — open one, pick your existing
   Home Assistant server in the Server dropdown, save. NR auto-applies
   it to the rest.
3. Deploy.

The heater output is `input_boolean.heater_request`. Wire your real relay
behind a normal HA automation that follows it.

## Project layout

```
.
├── jk-pb-bms.yaml             ESPHome firmware (BLE)
├── secrets.yaml.example       Required secret keys; copy to secrets.yaml
├── secrets.yaml               Real secrets (gitignored)
├── dashboard/
│   ├── bms-integrated.html    Main dashboard
│   ├── dashboard.html         Diagnostic dashboard
│   └── fonts/                 Self-hosted DSEG7 Modern Bold (OFL 1.1)
├── homeassistant/
│   └── heater-helpers.yaml    Helpers consumed by the Node-RED flow
├── node-red/
│   └── heater-control.flow.json   Solar-surplus heater FSM
├── scripts/
│   ├── deploy-ha.sh           One-shot HA deploy
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

## Licence

- Repository configuration: MIT (see `LICENSE`).
- The `jk_bms_ble` ESPHome component fetched at build time from
  `syssi/esphome-jk-bms` is Apache-2.0 (see `LICENSES/Apache-2.0.txt`).
- DSEG7 Modern Bold (`dashboard/fonts/DSEG7Modern-Bold.woff2`) is
  SIL Open Font License 1.1 (see `dashboard/fonts/DSEG-LICENSE.txt`).
