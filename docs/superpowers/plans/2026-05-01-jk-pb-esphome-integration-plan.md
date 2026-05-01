# JK-PB ESPHome Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working ESPHome configuration that monitors a JK-PB2A16S20P inverter BMS over RS485 from an ESP32-C3 Super Mini and publishes all relevant entities to Home Assistant via the native API.

**Architecture:** Single-file ESPHome YAML, secrets externalised. Reuses upstream `syssi/esphome-jk-bms` external component (`jk_rs485_bms` protocol). MAX3485 transceiver between ESP32-C3 UART0 and the BMS RS485-1 RJ45 port.

**Tech Stack:** ESPHome ≥ 2025.11, ESP-IDF framework, ESP32-C3 Super Mini, MAX3485 transceiver, Home Assistant.

**Reference spec:** [docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md](../specs/2026-05-01-jk-pb-esphome-integration-design.md)

**Note on testing:** ESPHome configurations are not unit-tested. The equivalents of "test → fail → fix → test → pass" used here are `esphome config <file>` (schema/lint) and `esphome compile <file>` (toolchain build). Both are scripted into this plan.

---

## File Structure

| File | Purpose | Created in |
|------|---------|------------|
| `secrets.yaml.example` | Template showing required secret keys, no real values | Task 1 |
| `secrets.yaml` | Real secrets, gitignored, user fills in (developer creates locally) | Task 6 (gated, user input) |
| `jk-pb-bms.yaml` | Main ESPHome config | Tasks 2–5 |
| `README.md` | Quick-start: wiring, BMS protocol setting, build/flash commands | Task 7 |
| `.gitignore` | Already created in initial commit | — |

---

## Task 1: Create `secrets.yaml.example`

**Files:**
- Create: `secrets.yaml.example`

- [ ] **Step 1: Write the file**

```yaml
# Copy to secrets.yaml and fill in values. secrets.yaml is gitignored.

wifi_ssid: "your-wifi-ssid"
wifi_password: "your-wifi-password"

# Generate with:  openssl rand -base64 32
api_encryption_key: "REPLACE_WITH_BASE64_32_BYTES"

# Any non-empty string. Used for ESPHome OTA flashing.
ota_password: "REPLACE_WITH_OTA_PASSWORD"

# Optional: fallback hotspot password when STA fails.
ap_password: "REPLACE_WITH_AP_FALLBACK_PASSWORD"
```

- [ ] **Step 2: Verify file exists**

Run: `ls -l secrets.yaml.example`
Expected: file present, non-empty.

- [ ] **Step 3: Commit**

```bash
git add secrets.yaml.example
git commit -m "feat: add secrets.yaml.example template"
```

---

## Task 2: Scaffold `jk-pb-bms.yaml` — substitutions, esphome, esp32, logger

**Files:**
- Create: `jk-pb-bms.yaml`

- [ ] **Step 1: Write the initial scaffold**

```yaml
# JK-PB2A16S20P over RS485 → ESP32-C3 Super Mini → Home Assistant.
# See docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md
# Pin choices avoid ESP32-C3 strapping pins (GPIO 2/8/9) and reserved
# native-USB pins (GPIO 18/19).

substitutions:
  device_name: jk-pb-bms
  device_friendly_name: "JK-PB BMS"
  bms_address: "0x01"
  update_interval: 30s
  uart_tx_pin: GPIO21
  uart_rx_pin: GPIO20
  rs485_de_pin: GPIO10

esphome:
  name: ${device_name}
  friendly_name: ${device_friendly_name}
  min_version: 2025.11.0

esp32:
  board: esp32-c3-devkitm-1
  variant: ESP32C3
  framework:
    type: esp-idf

logger:
  level: INFO
  hardware_uart: USB_SERIAL_JTAG
```

- [ ] **Step 2: Validate parses (without external component yet — partial config will fail compile but parse should be OK)**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('jk-pb-bms.yaml'))" && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add jk-pb-bms.yaml
git commit -m "feat: scaffold ESPHome config (esp32-c3 + logger)"
```

---

## Task 3: Add api / ota / wifi / web_server blocks

**Files:**
- Modify: `jk-pb-bms.yaml` (append)

- [ ] **Step 1: Append the network/api stack**

```yaml
api:
  encryption:
    key: !secret api_encryption_key

ota:
  - platform: esphome
    password: !secret ota_password

wifi:
  ssid: !secret wifi_ssid
  password: !secret wifi_password
  ap:
    ssid: "${device_friendly_name} Fallback"
    password: !secret ap_password

captive_portal:

web_server:
  port: 80
  version: 3
```

- [ ] **Step 2: Re-parse YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('jk-pb-bms.yaml'))" && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add jk-pb-bms.yaml
git commit -m "feat: add api, ota, wifi, web_server blocks"
```

---

## Task 4: Add external component, UART, jk_rs485_bms

**Files:**
- Modify: `jk-pb-bms.yaml` (append)

- [ ] **Step 1: Append the BMS-link blocks**

```yaml
external_components:
  - source: github://syssi/esphome-jk-bms@main
    components: [jk_rs485_bms]
    refresh: 1d

uart:
  - id: uart_0
    baud_rate: 115200
    tx_pin: ${uart_tx_pin}
    rx_pin: ${uart_rx_pin}
    rx_buffer_size: 384
    # debug:
    #   direction: BOTH
    #   dummy_receiver: false
    #   after:
    #     delimiter: "\n"
    #   sequence:
    #     - lambda: UARTDebug::log_hex(direction, bytes, ' ');

jk_rs485_bms:
  - id: bms0
    uart_id: uart_0
    address: ${bms_address}
    rx_timeout: 50ms
    update_interval: ${update_interval}
    flow_control_pin: ${rs485_de_pin}
```

- [ ] **Step 2: Re-parse YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('jk-pb-bms.yaml'))" && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add jk-pb-bms.yaml
git commit -m "feat: wire upstream jk_rs485_bms over UART0 + DE/RE on GPIO10"
```

---

## Task 5: Expose entities (sensors, binary_sensors, text_sensors, diagnostics)

**Files:**
- Modify: `jk-pb-bms.yaml` (append)

- [ ] **Step 1: Append the entity block**

```yaml
binary_sensor:
  - platform: jk_rs485_bms
    jk_rs485_bms_id: bms0
    balancing:
      name: "${device_friendly_name} Balancing"
    charging:
      name: "${device_friendly_name} Charging"
    discharging:
      name: "${device_friendly_name} Discharging"
    online_status:
      name: "${device_friendly_name} Online"

sensor:
  - platform: jk_rs485_bms
    jk_rs485_bms_id: bms0
    total_voltage:
      name: "${device_friendly_name} Total Voltage"
    current:
      name: "${device_friendly_name} Current"
    power:
      name: "${device_friendly_name} Power"
    state_of_charge:
      name: "${device_friendly_name} State of Charge"
    capacity_remaining:
      name: "${device_friendly_name} Capacity Remaining"
    total_runtime:
      name: "${device_friendly_name} Total Runtime"
    min_cell_voltage:
      name: "${device_friendly_name} Min Cell Voltage"
    max_cell_voltage:
      name: "${device_friendly_name} Max Cell Voltage"
    delta_cell_voltage:
      name: "${device_friendly_name} Delta Cell Voltage"
    average_cell_voltage:
      name: "${device_friendly_name} Average Cell Voltage"
    cell_voltage_1:
      name: "${device_friendly_name} Cell 1 Voltage"
    cell_voltage_2:
      name: "${device_friendly_name} Cell 2 Voltage"
    cell_voltage_3:
      name: "${device_friendly_name} Cell 3 Voltage"
    cell_voltage_4:
      name: "${device_friendly_name} Cell 4 Voltage"
    cell_voltage_5:
      name: "${device_friendly_name} Cell 5 Voltage"
    cell_voltage_6:
      name: "${device_friendly_name} Cell 6 Voltage"
    cell_voltage_7:
      name: "${device_friendly_name} Cell 7 Voltage"
    cell_voltage_8:
      name: "${device_friendly_name} Cell 8 Voltage"
    cell_voltage_9:
      name: "${device_friendly_name} Cell 9 Voltage"
    cell_voltage_10:
      name: "${device_friendly_name} Cell 10 Voltage"
    cell_voltage_11:
      name: "${device_friendly_name} Cell 11 Voltage"
    cell_voltage_12:
      name: "${device_friendly_name} Cell 12 Voltage"
    cell_voltage_13:
      name: "${device_friendly_name} Cell 13 Voltage"
    cell_voltage_14:
      name: "${device_friendly_name} Cell 14 Voltage"
    cell_voltage_15:
      name: "${device_friendly_name} Cell 15 Voltage"
    cell_voltage_16:
      name: "${device_friendly_name} Cell 16 Voltage"
    temperature_sensor_1:
      name: "${device_friendly_name} Temperature 1"
    temperature_sensor_2:
      name: "${device_friendly_name} Temperature 2"
    power_tube_temperature:
      name: "${device_friendly_name} Power Tube Temperature"
    balancing_current:
      name: "${device_friendly_name} Balancing Current"

text_sensor:
  - platform: jk_rs485_bms
    jk_rs485_bms_id: bms0
    errors:
      name: "${device_friendly_name} Errors"
    total_runtime_formatted:
      name: "${device_friendly_name} Total Runtime Formatted"
    operation_mode:
      name: "${device_friendly_name} Operation Mode"

  - platform: wifi_info
    ip_address:
      name: "${device_friendly_name} IP Address"
    ssid:
      name: "${device_friendly_name} SSID"

button:
  - platform: restart
    name: "${device_friendly_name} Restart"
  - platform: factory_reset
    name: "${device_friendly_name} Factory Reset"
    entity_category: diagnostic

sensor:
  - platform: wifi_signal
    name: "${device_friendly_name} WiFi Signal"
    update_interval: 60s
  - platform: uptime
    name: "${device_friendly_name} Uptime"
  - platform: internal_temperature
    name: "${device_friendly_name} Internal Temperature"
```

> **NOTE on duplicate `sensor:`** — ESPHome merges multiple top-level platform blocks of the same key only when they are written as a single list. The block above is intentionally left as two separate `sensor:` lists for readability during bring-up; if `esphome config` rejects this, merge them into one `sensor:` list in Step 2 of this task and re-validate. The expected fix is just removing the second `sensor:` line and indenting the platform entries to follow the BMS sensor list.

- [ ] **Step 2: Re-parse YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('jk-pb-bms.yaml'))" && echo OK
```
Expected: `OK`. If it errors with duplicate-key, merge the two `sensor:` blocks into one (delete the second `sensor:` line and outdent its contents under the first).

- [ ] **Step 3: Commit**

```bash
git add jk-pb-bms.yaml
git commit -m "feat: expose BMS entities + diagnostics to HA"
```

---

## Task 6: Set up Python venv, install ESPHome, run `esphome config`

**Files:** none modified (env setup only).

- [ ] **Step 1: Create venv and install ESPHome**

Run:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet 'esphome>=2025.11.0'
esphome version
```
Expected: prints `Version: 2025.11.x` or newer.

- [ ] **Step 2: Create a throwaway `secrets.yaml` for config validation**

`esphome config` resolves `!secret` references, so we need a real `secrets.yaml` even just for parsing. Generate one with safe placeholder values:

```bash
cat > secrets.yaml <<'EOF'
wifi_ssid: "validation-only"
wifi_password: "validation-only"
api_encryption_key: "$(openssl rand -base64 32)"
ota_password: "validation-only"
ap_password: "validation-only"
EOF
```

> `secrets.yaml` is in `.gitignore`; it will not be committed. The user will overwrite it with real values before flashing.

- [ ] **Step 3: Run schema validation**

Run:
```bash
.venv/bin/esphome config jk-pb-bms.yaml | tail -40
```
Expected: exit 0; tail shows the resolved config (no errors). If it fails:
- Duplicate `sensor:` → apply the merge described in Task 5 Step 2 note.
- Unknown `jk_rs485_bms` field → check upstream README; some field names may have shifted (`errors` ↔ `errors_bitmask` etc.).

- [ ] **Step 4: Commit any fixes**

```bash
git add jk-pb-bms.yaml
git diff --cached --quiet || git commit -m "fix: align config with esphome schema"
```

---

## Task 7: Compile firmware (full toolchain build, no flashing)

**Files:** none modified.

- [ ] **Step 1: Run compile**

Run:
```bash
.venv/bin/esphome compile jk-pb-bms.yaml 2>&1 | tail -60
```
Expected: ends with `========================= [SUCCESS] Took … =========================` and `Successfully compiled program`. First run will pull ESP-IDF + the external component (multi-minute, multi-hundred-MB).

- [ ] **Step 2: If compile fails, capture and triage**

Common failure modes:
- ESP-IDF download timeout → re-run.
- Unknown component → re-check `external_components.source.ref` (try `@main` then a known-good commit from upstream tag list).
- C++ compile error inside `jk_rs485_bms` → upstream regression; pin the source to a known-good commit and add a TODO in README.

After fixes, re-run Step 1 until success.

- [ ] **Step 3: Commit any fixes**

```bash
git add jk-pb-bms.yaml
git diff --cached --quiet || git commit -m "fix: pin component / address compile error"
```

---

## Task 8: Write `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

```markdown
# ESPHome ↔ JK-PB2A16S20P

ESPHome configuration that monitors a JK-PB2A16S20P inverter BMS from an
ESP32-C3 Super Mini over RS485 and publishes all relevant entities to
Home Assistant via the native API.

Reuses the upstream [`jk_rs485_bms`](https://github.com/syssi/esphome-jk-bms)
component — no Bluetooth.

## Hardware

- ESP32-C3 Super Mini
- MAX3485 module (3.3V variant — **not** the 5V MAX485 board)
- RJ45 patch cable (one end sacrificed) or RJ45 breakout
- 4× DuPont jumper wires

### Wiring

| MAX3485 | ESP32-C3 |
|---------|----------|
| VCC     | 3V3      |
| GND     | GND      |
| DI      | GPIO 21  |
| RO      | GPIO 20  |
| DE + RE (tied) | GPIO 10 |

| RJ45 pin (BMS RS485-1) | MAX3485 |
|------------------------|---------|
| 1, 8                   | B       |
| 2, 7                   | A       |
| 3, 6                   | GND     |

Common ground between BMS, MAX3485, and ESP32-C3 is mandatory.

## BMS configuration

In the JK BLE app or Windows tool, set **UART1 Protocol** to:

> `000 — 4G-GPS Remote module Common protocol V4.2`

Without this, the BMS will not respond on RS485-1.

## Build & flash

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install 'esphome>=2025.11.0'

cp secrets.yaml.example secrets.yaml
# edit secrets.yaml with real values

esphome config jk-pb-bms.yaml      # validate
esphome compile jk-pb-bms.yaml     # build
esphome run jk-pb-bms.yaml         # flash + monitor (USB the first time)
```

## Adopt in Home Assistant

After first boot the device announces itself via mDNS. Settings →
Devices & Services → ESPHome → Add. Provide the API encryption key from
`secrets.yaml`.

## Reproducibility

`external_components.source.ref` is `@main`. After your first known-good
build, pin it to a specific commit SHA from
<https://github.com/syssi/esphome-jk-bms/commits/main> to insulate
against upstream churn.

## Reference

- Design spec: [docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md](docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md)
- Implementation plan: [docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md](docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with wiring, BMS config, build/flash steps"
```

---

## Task 9: Final sweep — verify, tidy, commit plan

**Files:** none modified by default.

- [ ] **Step 1: Re-run config + compile**

```bash
.venv/bin/esphome config jk-pb-bms.yaml > /dev/null && echo CONFIG_OK
.venv/bin/esphome compile jk-pb-bms.yaml 2>&1 | tail -5
```
Expected: `CONFIG_OK` and `[SUCCESS]`.

- [ ] **Step 2: Confirm `secrets.yaml` is not tracked**

```bash
git ls-files secrets.yaml
```
Expected: empty output.

- [ ] **Step 3: Commit the plan itself**

```bash
git add docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md
git commit -m "docs: add implementation plan"
```

- [ ] **Step 4: Print final tree**

```bash
git ls-files
```
Expected output (order may vary):
```
.gitignore
README.md
docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md
docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md
jk-pb-bms.yaml
secrets.yaml.example
```

---

## Post-execution addendum (2026-05-01)

Tasks 4 and 5 in this plan referenced an `external_components`/
`jk_rs485_bms` integration. That component does not exist on
`syssi/esphome-jk-bms@main`; upstream's JK-PB integration is built from
stock `modbus` + `modbus_controller` with the JK-PB register map
encoded in YAML (file `esp32-jk-pb-modbus-example.yaml`). The actual
implementation vendors that register map under
`packages/jk-pb-modbus.yaml` and the top-level YAML (`jk-pb-bms.yaml`)
references it via `packages: bms: !include packages/jk-pb-modbus.yaml`.
Plan tasks 4 & 5 should therefore be read as covering "wire up Modbus
+ register map (vendored)". `esphome config` and `esphome compile` both
succeed against the resulting config.

## Self-review checklist (already applied)

- **Spec coverage:** §3 hardware → README + comments in YAML; §3.2 BMS protocol setting → README explicit; §3.4 pin map → YAML substitutions Task 2; §4.1 YAML structure → Tasks 2–5 in stated order; §5 entities → Task 5; §6 error handling → upstream component (no plan task — by design); §7 testing → Tasks 6–7; §8 repo layout → Tasks 1, 2, 8; §9 R2 (component churn) → README "Reproducibility" section.
- **No placeholders:** every step has full code or full command.
- **Type consistency:** substitution names (`device_friendly_name`, `bms_address`, etc.) match across Tasks 2–5; pin substitutions (`uart_tx_pin`, `uart_rx_pin`, `rs485_de_pin`) are defined in Task 2 and only referenced afterward.
- **Known unknowns flagged inline:** Task 5 Step 1 NOTE about duplicate `sensor:` keys; Task 6 Step 3 lists likely failure modes; Task 7 Step 2 lists triage paths.
