# JK-PB2A16S20P ↔ ESP32-C3 ESPHome Integration — Design

**Date:** 2026-05-01
**Status:** Approved (sections: architecture + pin map). Remaining sections folded in for unattended build.
**Author:** Wojciech Bartnik
**Target hardware:** JK-PB2A16S20P inverter BMS, ESP32-C3 Super Mini, MAX3485 transceiver module

## 1. Goal

Expose the BMS over a hardwired link (no Bluetooth) to Home Assistant via ESPHome native API. Single device, one battery pack. No custom protocol implementation — reuse the upstream `jk_rs485_bms` component from `syssi/esphome-jk-bms` (PR #464, merged on `main`).

## 2. Non-goals

- Multiple BMS units on one ESP (the upstream component supports it, but spec targets a single pack).
- Bluetooth fallback.
- CAN-bus integration to inverters (Pylon/Goodwe emulation).
- Custom OTA flashing tooling — rely on stock ESPHome flow.

## 3. Hardware

### 3.1. BMS port choice

JK-PB2A16S20P exposes (per official spec PDF):

| Port             | Connector  | Levels         | Default baud |
|------------------|------------|----------------|--------------|
| RS232            | RJ11 6P6C  | ±12V (not TTL) | 9600         |
| RS485-1          | RJ45 8P8C  | differential   | 115200       |
| RS485-2 parallel | RJ45 8P8C  | differential   | —            |
| CAN              | RJ45 8P8C  | differential   | 250k         |

Direct ESP32-C3 GPIO connection is electrically incompatible with all of these. The PB family does **not** ship the 4-pin JST 1.25mm "GPS" 3.3V-TTL header that the older JK-B family exposes.

**Chosen port:** RS485-1 over a MAX3485 (3.3V-native) transceiver. RJ45 pinout: pins 1/8 = B, pins 2/7 = A, pins 3/6 = GND.

### 3.2. Required BMS configuration

Set UART1 protocol on the BMS to **`000 — 4G-GPS Remote module Common protocol V4.2`** via the JK BLE app or Windows tool. The upstream `jk_rs485_bms` component speaks exactly this protocol. Without this setting, the BMS will not respond.

### 3.3. Bill of materials

- ESP32-C3 Super Mini (already owned)
- MAX3485 module, 3.3V variant, ~13 PLN on Allegro
- RJ45 patch cable, sacrificed at one end, OR an RJ45 breakout
- 4× DuPont jumper wires
- 5V supply for ESP (USB-C from PC during dev; USB charger or step-down from battery later)

### 3.4. Pin map

**MAX3485 ↔ ESP32-C3 Super Mini:**

| MAX3485 pin | ESP32-C3 pin | Notes                                  |
|-------------|--------------|----------------------------------------|
| VCC         | 3V3          | 3.3V supply (do **not** use 5V)        |
| GND         | GND          | common with BMS GND                    |
| DI          | GPIO 21      | ESP TX → BMS                           |
| RO          | GPIO 20      | BMS → ESP RX                           |
| DE          | GPIO 10      | tied to RE; ESPHome `flow_control_pin` |
| RE          | GPIO 10      | tied to DE                             |

**Pin selection constraints (ESP32-C3 Super Mini):**

- GPIO 18/19 reserved for native USB-CDC (logging).
- GPIO 2/8/9 are strapping pins — avoid as outputs during boot. GPIO 8 also drives onboard LED.
- GPIO 20/21 expose UART0 by default (free on Super Mini because logger uses USB-CDC).
- GPIO 10 is general-purpose, safe for DE/RE.

**MAX3485 ↔ BMS RS485-1 RJ45:**

| RJ45 pin | BMS signal | MAX3485 |
|----------|-----------|---------|
| 1, 8     | RS485-B   | B       |
| 2, 7     | RS485-A   | A       |
| 3, 6     | GND      | GND     |

### 3.5. Wiring diagram

```
┌──────────────────┐                  ┌─────────────┐                  ┌──────────────────────┐
│ JK-PB2A16S20P    │                  │ MAX3485     │                  │ ESP32-C3 Super Mini  │
│  RS485-1 RJ45    │                  │             │                  │                      │
│                  │                  │             │                  │ USB-C ── PC / charger│
│ 1,8 (B) ─────────┼──── B ──────────┤             │                  │                      │
│ 2,7 (A) ─────────┼──── A ──────────┤   3.3V      │                  │                      │
│ 3,6 (GND) ───────┼─────────────────┤ VCC ────────┼──── 3V3 ─────────┤ 3V3                  │
│                  │                 │ GND ────────┼──── GND ─────────┤ GND                  │
│                  │                 │ DI  ────────┼──── GPIO 21 ─────┤ TX                   │
│                  │                 │ RO  ────────┼──── GPIO 20 ─────┤ RX                   │
│                  │                 │ DE+RE ──────┼──── GPIO 10 ─────┤ flow ctrl            │
└──────────────────┘                 └─────────────┘                  └──────────────────────┘
```

## 4. Software architecture

```
JK-PB BMS  ──UART/RS485──  MAX3485  ──UART0──  ESP32-C3 firmware
                                                    │
                                                    ├── jk_rs485_bms component (upstream)
                                                    ├── sensor / binary_sensor / text_sensor entities
                                                    ├── ESPHome native API server (encrypted)
                                                    └── OTA + USB-CDC logger
                                                              │
                                                            WiFi
                                                              │
                                                       Home Assistant
```

### 4.1. ESPHome YAML structure

Single file `jk-pb-bms.yaml` at repo root. Sections in order:

1. `substitutions:` — device name, friendly name, polling intervals, pin numbers
2. `esphome:` — name, friendly_name
3. `esp32:` — board: `esp32-c3-devkitm-1`, framework: `esp-idf` (preferred for C3 USB-CDC stability)
4. `logger:` — `hardware_uart: USB_SERIAL_JTAG`, level: `INFO` (DEBUG when bring-up)
5. `api:` — encryption.key from `secrets.yaml`
6. `ota:` — platform: `esphome`, password from secrets
7. `wifi:` — ssid/password from secrets, fallback hotspot
8. `web_server:` — optional, port 80, useful during bring-up
9. `external_components:` — `source: github://syssi/esphome-jk-bms@main`, components: `[jk_rs485_bms]`
10. `uart:` — id `uart_0`, baud 115200, tx_pin 21, rx_pin 20, rx_buffer_size 384, debug stanza guarded by substitution
11. `jk_rs485_bms:` — id `bms0`, uart_id `uart_0`, address `0x01`, rx_timeout `50ms`, update_interval `30s`, flow_control_pin 10
12. `binary_sensor:` / `sensor:` / `text_sensor:` — full entity set wired to `jk_rs485_bms_id: bms0`
13. (Optional) `switch:` — charge / discharge / balancer enable

Secrets live in `secrets.yaml` (not committed). A `secrets.yaml.example` is committed.

### 4.2. Why ESP-IDF framework over Arduino

ESP32-C3 native USB-CDC support in Arduino ESP32 has historically been flaky for logger output. ESP-IDF is the upstream-recommended framework for the C3 in current ESPHome. If a regression appears we can switch back to Arduino.

### 4.3. Update interval

Default `30s`. The BMS responds quickly; the bottleneck is HA traffic, not the link. Faster polling (5–10 s) is technically supported and can be tuned later via substitution.

## 5. Entities exposed (initial set)

Mirror what `jk_rs485_bms` provides upstream. Naming follows snake_case device name + entity.

**Sensors (numeric):**

- `total_voltage`, `current`, `power`, `state_of_charge`, `capacity_remaining`, `total_runtime`
- `min_cell_voltage`, `max_cell_voltage`, `delta_cell_voltage`, `average_cell_voltage`
- `cell_voltage_1` … `cell_voltage_16`
- `temperature_sensor_1`, `temperature_sensor_2`, `power_tube_temperature`
- `balancing_current`

**Binary sensors:**

- `balancing`, `charging`, `discharging`, `online_status`

**Text sensors:**

- `errors_bitmask`, `total_runtime_formatted`, `operation_mode`

**Diagnostics:**

- ESPHome built-ins: `wifi_signal`, `uptime`, `internal_temperature`, restart button, factory-reset button.

Switches/numbers (charge enable, discharge enable, balancer trigger, cell voltage thresholds, etc.) are deliberately omitted from the v1 set to keep the initial bring-up read-only and reduce risk of misconfiguring the pack. Add later once polling is stable.

## 6. Error handling

The upstream component already covers:

- CRC validation per frame
- Timeout-driven entity unavailable (~30s after last successful frame)
- Reconnect on UART error

Firmware-level concerns:

- Wi-Fi disconnect: ESPHome retries automatically; native API queues events.
- USB-CDC drop: logger continues silently, no fault.
- BMS reboot / cable disconnect: entities go `unavailable` in HA after timeout — surfaced naturally, no extra code.

No custom retry, watchdog, or fault-recovery logic in our YAML. If a real failure mode shows up in field testing, address it then.

## 7. Testing & validation plan

1. **Compile-only test** before any hardware contact:
   - `esphome config jk-pb-bms.yaml` — schema validation
   - `esphome compile jk-pb-bms.yaml` — full toolchain build, catches version mismatches with the external component
2. **Bench wiring sanity check** — multimeter continuity from ESP GPIO header to MAX3485 pins; confirm 3V3 rail; confirm GND common.
3. **First flash** via USB-C, watch logger:
   - Wi-Fi connect → API up → BMS frames arriving on UART debug
4. **BMS configuration** — set Protocol 000 in JK app *before* expecting frames.
5. **HA discovery** — adopt device, confirm entity values match BMS LCD/JK app readings within tolerance.
6. **Soak test** — 24h online, watch for unexpected `unavailable` flaps.

## 8. Repository layout

```
/
├── jk-pb-bms.yaml              # main config
├── secrets.yaml.example        # template; secrets.yaml is gitignored
├── .gitignore                  # secrets.yaml, .esphome/, build/
├── README.md                   # quick-start, wiring, BMS config
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-05-01-jk-pb-esphome-integration-design.md
        └── plans/
            └── 2026-05-01-jk-pb-esphome-integration-plan.md
```

## 9. Open risks

- **R1 — MAX3485 module quality.** Cheap clones occasionally ship MAX485 silicon under a MAX3485 silkscreen. Mitigation: 3.3V supply works for both, but if RX is unreliable, swap module.
- **R2 — Upstream component churn.** `jk_rs485_bms` is in active development. Pinning to `@main` is convenient but breaks reproducibility. Mitigation: after first known-good flash, pin to a specific commit SHA in `external_components.source.ref`.
- **R3 — BMS firmware variance.** Different JK-PB firmware revisions have shipped different field layouts. Mitigation: enable UART debug on first run, compare against upstream test fixtures, file an issue if mismatch.
- **R4 — Strapping pin accident.** Reusing GPIO 8/9 later for an output would brick boot. Mitigation: comments in YAML calling out the strapping constraints.

## 9a. Implementation correction — component naming

During implementation it turned out that `syssi/esphome-jk-bms` does not
ship a `jk_rs485_bms` external component on `main`. The JK-PB inverter
BMS support that landed via PR #464 actually uses **stock ESPHome
`modbus` + `modbus_controller`** with the JK-PB register map written
directly in YAML; the upstream example file is
`esp32-jk-pb-modbus-example.yaml`.

Decision: vendor that register map locally as
`packages/jk-pb-modbus.yaml` and let `jk-pb-bms.yaml` own only the
device profile + network stack. This removes the external-components
dependency entirely (so risk R2 is downgraded) and produces a
self-contained config that compiles cleanly today and is auditable in
diff against future upstream revisions. Verified by:

```
esphome config  jk-pb-bms.yaml  -> Configuration is valid
esphome compile jk-pb-bms.yaml  -> SUCCESS, firmware.factory.bin built
```

The §5 "entities exposed" inventory is still accurate in spirit; the
exact field names and address coverage are governed by the vendored
register map. Compared to the original list, the vendored map adds
ample additional fields (extra temperature sensors, charge/discharge
SCPR/OCPR countdowns, wire resistances per cell, configurable BMS
parameters such as cell UVP / OVP / RCV / RFV / SOC limits read back as
sensors). The deliberately-deferred control entities (charge/discharge/
balancer enable selects) were stripped from the vendored file in line
with the §5 read-only-v1 decision.

## 10. Sources

- [syssi/esphome-jk-bms](https://github.com/syssi/esphome-jk-bms)
- [PR #464 — `jk_rs485_bms`](https://github.com/syssi/esphome-jk-bms/pull/464)
- [opendtu-onbattery JK-PB models](https://opendtu-onbattery.net/hardware/jkbms/models_pb/)
- [Discussion #873 — JK-PB2A16S20P](https://github.com/syssi/esphome-jk-bms/discussions/873)
- [Discussion #630 — ESP8266 + JK-PB UART](https://github.com/syssi/esphome-jk-bms/discussions/630)
- [JK-PB2A16S20P spec PDF](https://www.gobelpower.com/download/JKBMS-JK-PB2A16S20P-Specication-EN-V1.0.pdf)
- [MAX3485 datasheet](https://www.analog.com/en/products/max3485.html)
- [ESP32-C3 datasheet — strapping pins](https://www.espressif.com/sites/default/files/documentation/esp32-c3_datasheet_en.pdf)
