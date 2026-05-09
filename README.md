# JK BMS over Bluetooth → Home Assistant

ESPHome firmware for an ESP32-C3 that bridges a JK BMS (PB-series, 16-cell
LFP) over Bluetooth Low Energy to Home Assistant, plus two web dashboards
served from HA.

## What this is

- **`jk-pb-bms.yaml`** — the ESPHome firmware. ESP32-C3 connects to the BMS
  over BLE using the upstream `jk_bms_ble` component (`JK02_32S` protocol)
  and republishes everything to HA via the native API.
- **`dashboard/bms-integrated.html`** — the **main** dashboard. Half-circle
  SOC gauge, voltage, max temperature, signed power, 12-cell battery bar.
  Pitch-black OLED-style design, DSEG7 7-segment digits, pure HTML/CSS/JS
  with zero framework dependencies.
- **`dashboard/dashboard.html`** — diagnostic / advanced view. Live entity
  list, per-cell voltages and resistances, 1h/6h/24h/3d/7d history charts
  for SOC / current / power / temperature, polling diagnostics, raw JSON.
- **`inverter/easun.yaml`** — separate ESP32 firmware for an Easun
  hybrid inverter on the same network. Independent of the BMS work.

## Hardware

- JK-PB2A16S20P (16-cell LFP, 200 A) — any JK BMS running firmware that
  speaks the `JK02_32S` BLE protocol works.
- ESP32-C3 Super Mini (or any ESP32-C3 board with BLE).
- USB-C cable for power + initial flashing.

That's it — only BLE.

## Setup

### Prerequisites

- Python 3.10+ in a venv with esphome installed:
  ```
  python3 -m venv .venv
  .venv/bin/pip install esphome
  ```
- A Home Assistant instance (any flavour).

### 1. Pull submodule (BLE component)

```
git submodule update --init
```

`vendor/esphome-jk-bms` is pinned for offline reference; the YAML pulls
the same component from GitHub at compile time.

### 2. Find the BMS BLE MAC

Open the JK BMS app on a phone, note the device's Bluetooth name (usually
`JK_BMS_*` or model-named). For first flash, leave `ble_client.mac_address`
in `jk-pb-bms.yaml` as a placeholder; the firmware logs every BLE
advertisement it sees on boot, and the JK MAC is identifiable by name.
Put the real MAC in once you know it.

### 3. Fill in `secrets.yaml`

Copy the template:

```
cp secrets.yaml.example secrets.yaml
```

Fill in WiFi creds, ESPHome API encryption key, OTA password, AP password.
The encryption key is shared between the firmware and the HA integration —
generate one with `openssl rand -base64 32`.

### 4. Build + flash

First flash via USB:

```
.venv/bin/esphome run jk-pb-bms.yaml --device /dev/cu.usbmodem*
```

Subsequent updates OTA from the same network:

```
.venv/bin/esphome run jk-pb-bms.yaml
```

### 5. Add to Home Assistant

After the device boots and joins WiFi, HA auto-discovers it. Accept the
discovery; HA asks for the API encryption key — paste the same value
that's in `secrets.yaml`. All entities (SOC, voltage, current, power,
cell voltages, temperatures, balancing, errors) appear under the device.

### 6. Deploy the dashboards

Each `*.local.html` file is a working copy of its template with the HA
long-lived access token substituted in. Local copies are gitignored.

```
# Generate an HA long-lived token: Profile → Security → Long-Lived Access Tokens.
# Then, for each dashboard:
cp dashboard/bms-integrated.html dashboard/bms-integrated.local.html
$EDITOR dashboard/bms-integrated.local.html
#   replace PASTE_LONG_LIVED_ACCESS_TOKEN_HERE with the real token
scp dashboard/bms-integrated.local.html root@<ha-ip>:/config/www/bms-integrated.html

cp dashboard/dashboard.html dashboard/dashboard.local.html
$EDITOR dashboard/dashboard.local.html
scp dashboard/dashboard.local.html root@<ha-ip>:/config/www/bms-dashboard.html
```

URLs once deployed:

| Page | URL |
|---|---|
| Main (customer-facing) | `http://<ha>:8123/local/bms-integrated.html` |
| Diagnostic (history, cells, raw JSON) | `http://<ha>:8123/local/bms-dashboard.html` |

Press **A** on either page to swap to the other.

## Project layout

```
.
├── jk-pb-bms.yaml         ESPHome firmware (BLE)
├── secrets.yaml.example   Required secret keys; copy to secrets.yaml
├── secrets.yaml           Real secrets (gitignored)
├── dashboard/
│   ├── bms-integrated.html   Main dashboard
│   └── dashboard.html        Diagnostic dashboard
├── inverter/
│   └── easun.yaml         Easun inverter firmware (unrelated to BMS)
└── vendor/
    └── esphome-jk-bms/    syssi/esphome-jk-bms submodule (BLE component)
```

## Dashboard architecture

Both dashboards are single-file vanilla web apps. They poll the HA REST
API at `${HA_URL}/api/states/<entity_id>` with a Bearer token. Same-origin
fetches when served from HA's `/local/` path. Refresh cadence: 1 Hz on
the main view, 1 Hz on the diagnostic view.

Tokens never enter the repo. Each `*.html` template carries the literal
placeholder `PASTE_LONG_LIVED_ACCESS_TOKEN_HERE`; you make a local
`.local.html` copy with your token and deploy that. The `.gitignore`
blocks `dashboard/*.local.html`.

## Licence

- Repository configuration: MIT (see `LICENSE`).
- The `jk_bms_ble` ESPHome component pulled at build time from
  `syssi/esphome-jk-bms` is Apache-2.0 (see `LICENSES/Apache-2.0.txt`).
