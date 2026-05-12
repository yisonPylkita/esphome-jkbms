# JK BMS over Bluetooth → Home Assistant

ESPHome firmware for an ESP32-C3 that bridges a JK BMS (PB-series, 16-cell
LFP) over Bluetooth Low Energy to Home Assistant, plus four web dashboards
served from HA (bms / alarm / advanced / history), plus a battery-room
intrusion alarm expressed entirely as Home Assistant automations.

![Main BMS dashboard — half-circle SOC gauge, 12-cell battery bar, power + runtime prediction](docs/screenshots/dashboard-main.png)

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
  current / power / temperature, polling diagnostics, raw JSON. English
  only — deliberate choice for the developer-facing view. Deploys to
  `/local/bms-dashboard.html`.
- **`dashboard/alarm/`** — single-purpose alarm dashboard. ARM /
  DISARM buttons, live sensor readouts, auto-arm toggle, advanced
  settings (quiet timer, grace seconds, siren duration). Reachable from
  the main BMS dashboard via the `alarm ›` link. Deploys to
  `/local/alarm.html`.
- **`dashboard/history/`** — alarm history dashboard. Event log with
  door open/closed timeline, trigger summary cards, stat tiles for
  armed time / door-open time / trigger + disarm counts; reachable from
  the alarm dashboard via the `historia ›` link. Deploys to
  `/local/alarm-history.html`.
- **`homeassistant/alarm-helpers.yaml`** — the entire alarm system as a
  single HA package, built around the idiomatic
  `alarm_control_panel.manual` platform: helpers (policy knobs +
  test-mode toggle), the panel itself (`alarm_control_panel.battery_room`),
  two `template:` derived sensors (`binary_sensor.alarm_sensors_ok` +
  `sensor.alarm_sensors_missing`), and a small set of automations
  (auto-arm policy, sensor → panel trigger bridge, side-effects, push
  notification action callbacks). Deploys to
  `/config/packages/jk_alarm.yaml`. Integration-tested by
  `scripts/test-alarm-ha.sh` — see "Testing the alarm" below.
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

- Runs `uv sync --all-groups`, which downloads Python 3.14 (per
  `.python-version`), creates `.venv/`, and installs the dev toolchain
  (`esphome`, `ruff`, `ty`) from `uv.lock`. No system Python required.
- Downloads a self-contained Node.js 20 binary into `.tools/` (used by
  `just test`). System node is reused if it's already installed and ≥ 18.
- Copies `secrets.yaml.example` → `secrets.yaml` (if missing) and links
  `inverter/secrets.yaml` to it.
- Runs `just check && just test` to validate the bootstrap.

### Prerequisites

`git`, `just`, `uv` (Astral's Python package + version manager), `curl`,
`tar`. macOS (x64 / arm64) and Linux (x64 / arm64) are supported. No
system Python needed — `uv` downloads the right interpreter into
`.venv/` itself. Install `uv` with
`curl -LsSf https://astral.sh/uv/install.sh | sh` if you don't already
have it.

The Python version is pinned by `.python-version` (currently `3.14`).
Bumping Python means editing four files in lockstep: `.python-version`,
`requires-python` in `pyproject.toml`, `target-version` in
`[tool.ruff]`, and `python-version` in `[tool.ty.environment]`.

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
just deploy
```

The recipe runs `just check && just test` first, then invokes
`scripts/deploy-ha.sh`. The script:

1. Reads `ha_host` / `ha_user` / `ha_token` from `secrets.yaml` (env vars
   override them — `HA_HOST=… HA_TOKEN=… just deploy`).
2. Substitutes the token + build stamp + deploy id into each dashboard,
   minifies inline CSS / JS (and inlines `dashboard/lib/*.js`), then
   `scp`s them to `/config/www/`.
3. Mirrors `dashboard/fonts/` to `/config/www/fonts/` (DSEG7 Modern Bold
   self-hosted; no external font CDN at runtime).
4. Pushes `homeassistant/alarm-helpers.yaml` to
   `/config/packages/jk_alarm.yaml` (HA's `packages:` mechanism merges
   the helpers per-domain, idempotent across re-runs).
5. Writes `/config/www/version.json` carrying the build's `deployId`;
   every running dashboard polls it once a minute and transparently
   hard-reloads itself iff the id has changed (see "Version sync" below).
6. Runs `ha core check` and reloads `input_boolean` / `input_number` /
   `input_text` domains via the HA REST API.

Other useful deploy modes:

- `just dry-run` (`scripts/deploy-ha.sh --dry-run`) — build everything,
  hash local vs. remote, print a diff, write nothing.
- `just check-only` (`scripts/deploy-ha.sh --check-only`) — run
  `check + test` against the deploy target without pushing.
- `scripts/deploy-ha.sh --skip-checks` — full deploy without
  `check + test` (emergencies only).

URLs once deployed:

| Page          | URL                                          |
| ------------- | -------------------------------------------- |
| Main BMS      | `http://<ha>:8123/local/bms-integrated.html` |
| Alarm         | `http://<ha>:8123/local/alarm.html`          |
| Alarm history | `http://<ha>:8123/local/alarm-history.html`  |
| Diagnostic    | `http://<ha>:8123/local/bms-dashboard.html`  |

For remote access the canonical entry point is the Tailscale-served
HTTPS hostname (e.g. `https://fotowoltaika.tailaa1b4.ts.net/local/...`);
the LAN URL above is the fallback. Each dashboard bakes `HA_URL = ''`
so requests go to the same origin that served the page — meaning every
HA-routable URL (LAN IP, Tailscale magic DNS, `tailscale serve`
HTTPS hostname) works without rebuilding.

Press **A** on the main page to swap to advanced; the `alarm ›`
link goes to the alarm dashboard, which has its own `historia ›` to
the history view.

### 6. Alarm — pure Home Assistant package

The whole alarm system lives in `homeassistant/alarm-helpers.yaml`,
deployed by `just deploy` to `/config/packages/jk_alarm.yaml`. The
canonical state holder is `alarm_control_panel.battery_room` — HA's
first-class alarm entity, which means the iOS / Android mobile apps
render it natively (lock-screen alarm widget, alarm-domain
notifications, native arm / disarm tiles). Note: edits to the
`alarm_control_panel:` block require `ha core restart` (not just
`automation.reload`) — that part of HA's config doesn't have a
runtime-reload path.

State machine — what each panel state means here:

```
disarmed   ─[auto-arm: conditions hold for `quiet_minutes`]→ armed_away
disarmed   ─[user clicks ARM]→                                armed_away
armed_away ─[any wired sensor opens]→                         pending
pending    ─[no disarm during `delay_time` (10 s)]→           triggered
*          ─[user clicks DISARM]→                             disarmed
```

The auto-arm policy is one automation (template trigger with `for:`
over the quiet-window); the sensor → panel bridge is another
automation (state trigger calling `alarm_control_panel.alarm_trigger`).
The dashboard's ARM / DISARM buttons call the standard panel services
directly.

Sensor health is declarative: `binary_sensor.alarm_sensors_ok` is a
`template:` sensor that's `on` iff every wired sensor reports a real
state (not unavailable / unknown). `sensor.alarm_sensors_missing`
emits the Polish label list for the dashboard banner. The auto-arm
automation gates on `alarm_sensors_ok` — refusing to arm with a blind
sensor — but manual arm via the panel service ignores it.

Push notifications include actionable lock-screen buttons (DISARM,
SILENCE) wired via `mobile_app_notification_action` events.
`authentication_required: true` on the destructive button forces a
Face ID / passcode unlock before the disarm fires.

### Testing the alarm

`scripts/test-alarm-ha.sh` (or `just test-alarm`) drives the live HA
instance via REST: pokes sensor states, calls
`alarm_control_panel.alarm_arm_away` / `alarm_disarm`, asserts the
resulting panel state. Every behaviour the alarm must honour (auto-arm
path, disturbance mid-arming, entry-delay grace, trigger-reason
aggregation, latched-triggered, sensor-availability gating, manual
disarm side-effects) is one or more assertions here — this script
is the spec.

Destructive side-effects are stubbed by flipping
`input_boolean.alarm_test_mode` on — the siren and push automations
write to `input_text.alarm_test_log` instead of calling
`siren.turn_on` / `notify.alarm_recipients`. Production sirens stay
quiet, phones stay silent.

The same primitives work interactively in the HA UI:

- **Developer Tools → States** — overwrite any binary*sensor or
  input*\*; the automations re-evaluate on the synthetic value.
- **Developer Tools → Services** — fire any service with any payload.
- **Automation Traces** (next to each automation in the UI) — the last
  five runs are persisted with a full step-by-step trace: which
  trigger fired, what each condition evaluated to, every action's
  variables.
- **"Run actions"** button — execute the action sequence without
  satisfying the trigger; useful when verifying side-effect chains.

## Project layout

```
.
├── jk-pb-bms.yaml             ESPHome firmware (BLE)
├── Justfile                   Tooling entry point (`just` lists recipes)
├── pyproject.toml             Python dev deps (esphome, ruff, ty) via uv
├── uv.lock                    Locked Python deps
├── .python-version            Python version pin for uv
├── package.json               Tiny JS metadata (prettier config consumers)
├── secrets.yaml.example       Required secret keys; copy to secrets.yaml
├── secrets.yaml               Real secrets (gitignored)
├── dashboard/
│   ├── bms/                   Main dashboard (index.html + style.css + app.js)
│   ├── alarm/                 Alarm dashboard (index.html + style.css + app.js)
│   ├── advanced/              Diagnostic dashboard (index.html + style.css + app.js)
│   ├── history/               Alarm-history dashboard (index.html + style.css + app.js)
│   ├── lib/                   Shared pure-function helpers
│   │   ├── i18n.js                Polish ↔ English string table
│   │   ├── predict.js             Rolling-mean power → runtime projection
│   │   ├── sun.js                 Sunrise/sunset (for the history Gantt shading)
│   │   ├── zones.js               SOC / V / T zone tables
│   │   └── version-check.js       /local/version.json poller → hard reload on commit drift
│   ├── favicon.svg            PWA icon — vertical battery, dashboard palette
│   └── fonts/                 Self-hosted DSEG7 Modern Bold (OFL 1.1)
├── homeassistant/
│   ├── alarm-helpers.yaml     Alarm package (helpers + automations + side-effects)
│   ├── core/                  /config/configuration.yaml + HA_VERSION
│   ├── addons/                Per-addon options snapshots (.json)
│   └── zigbee2mqtt/           Z2M configuration.yaml (secrets stripped)
├── tests/                     Node-driven unit tests for dashboard/lib/*
├── scripts/
│   ├── setup.sh               Bootstrap (uv sync + node download)
│   ├── deploy-ha.sh           One-shot HA deploy
│   ├── restore-ha.sh          Disaster recovery
│   ├── fmt.sh                 prettier + ruff format runner
│   ├── check.sh               Validation gates (run by `just check`)
│   ├── test.sh                Node test runner
│   ├── test-alarm-ha.sh       Integration test for the alarm against live HA
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

All four dashboards are single-file vanilla web apps. They poll the HA
REST API at `${HA_URL}/api/states/<entity_id>` with a Bearer token,
same-origin when served from HA's `/local/` path. Refresh cadence: 1 Hz.

The main dashboard's runtime prediction uses a rolling 1-hour mean of the
BMS power signal, projected linearly to either "until empty" (discharging)
or "until full" (charging). The 1-hour window deliberately avoids being
biased by daytime "free energy" usage that doesn't carry over once the
sun is down — rate at any given moment reflects sustained consumption,
not instantaneous spikes.

Tokens never enter the repo. Each `*.html` template carries the literal
placeholder `PASTE_LONG_LIVED_ACCESS_TOKEN_HERE`; `scripts/deploy-ha.sh`
substitutes it at deploy time. `.gitignore` blocks `dashboard/*.local.html`.

### Version sync

Each deploy bakes a `deployId` (the short git commit hash, plus `+dirty`
on uncommitted trees) into every dashboard and mirrors it into
`/local/version.json`. Each running dashboard polls that manifest every
60 s and, on a real mismatch, transparently hard-reloads itself. The id
is commit-derived (no timestamp), so re-deploying the same commit is a
no-op for open tabs — only an actual code change triggers a reload.
After the reload the new page's baked id matches the server's; no
further reloads until the next deploy. Implementation:
`dashboard/lib/version-check.js`. There is no banner — the reload is
silent.

### i18n

Dashboards default to Polish (`<html lang="pl">`); English translations
are maintained as a fallback. Strings live in `dashboard/lib/i18n.js`
(`T.pl` + `T.en` maps). Static template text uses `data-i18n="key"`,
`data-i18n-title="key"`, `data-i18n-aria="key"` attributes; `applyI18n()`
rewrites them at `DOMContentLoaded`. Dynamic strings in JS use
`t('key', ...args)` with positional `{0}` / `{1}` substitution. To add a
third language, extend the `T` table with a new top-level key (e.g.
`de`, `fr`); `_detectLang` accepts any key in `T` whose first two chars
match `<html lang="...">`. The diagnostic dashboard (`dashboard/advanced/`)
is deliberately English-only.

### Adding a push-notification target

The alarm-trigger and low-battery automations both call
`notify.alarm_recipients`, a notification **group** defined in
`homeassistant/alarm-helpers.yaml`. To add a third family member's
phone, edit the group's `services:` list:

```yaml
notify:
  - platform: group
    name: alarm_recipients
    services:
      - service: mobile_app_wojciechs_iphone
      - service: mobile_app_iphone_grzegorz
      - service: mobile_app_NEW_DEVICE # ← add here
```

Then `just deploy` (pushes the updated helpers) and restart HA core
(notify groups are registered at startup; `homeassistant.reload_core_config`
is enough).

### Sensor health: unavailable + low battery

Two layers, both declarative:

- **Unavailable sensor.** `binary_sensor.alarm_sensors_ok` is a
  `template:` sensor that's `on` iff every wired sensor reports a
  real state (not `unavailable` / `unknown`). The auto-arm automation
  gates on it — refusing to arm with a blind sensor.
  `sensor.alarm_sensors_missing` exposes the Polish label list; the
  alarm dashboard reads both and shows the amber banner. Once a
  sensor recovers, both clear automatically.
- **Low battery.** A separate HA automation in `alarm-helpers.yaml`
  watches the per-device `*_battery_low` binary sensors with a 5-min
  debounce and pushes to `notify.alarm_recipients` when one trips.

### Mapping HA user IDs to friendly names

The alarm-history dashboard shows `przez panel` / `przez automatyzacja`
etc. based on a hardcoded `USER_MAP` in `dashboard/history/app.js`. New
family-member HA accounts show up as raw 6-char hex prefixes until
added. To resolve: open `dashboard/history/app.js`, add the user's full
UUID → friendly-label mapping to `USER_MAP`, then re-deploy. Find the
UUID via HA → Settings → People → Users → click user → the URL
contains it. The legacy `Node-RED` entry is retained so events recorded
before the alarm was ported to native HA still render with a readable
label.

## `just` recipes

Run `just` with no arguments to print the recipe list. Highlights:

- `just setup` — first-time bootstrap (uv sync + node download).
- `just fmt` — format every supported file (prettier + ruff).
- `just check` — every validation gate (formatter, JSON, esphome
  config, HTML parse, link integrity, minifier round-trip, secrets scan).
- `just test-alarm` — drive the live HA alarm through every panel
  transition via REST. Side-effects routed to a log entity so it's
  safe to run while the real alarm is in service.
- `just test` — Node-driven unit tests against `dashboard/lib/*.js`.
- `just ci` — `fmt-check + check + test`, what CI runs.
- `just deploy` — `check + test` then push to HA.
- `just dry-run` — build + hash + diff vs. remote, no writes.
- `just restore` — disaster recovery (see below).

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
│   ├── a0d7b954_ssh.json
│   ├── a0d7b954_tailscale.json
│   ├── cb646a50_get.json           HACS install helper (one-shot)
│   └── core_mosquitto.json
└── zigbee2mqtt/
    └── configuration.yaml          Z2M config — secrets stripped
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
   options snapshot, pushes the core configuration and Z2M config,
   then hands off to `just deploy` for the dashboards + alarm package.

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
- **Z2M `<<REPLACE_*>>` secret markers** in
  `/config/zigbee2mqtt/configuration.yaml` — hand-fill the MQTT
  password and (optional) network key / pan_id before Z2M's first
  start.

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
