# ESPHome ↔ JK-PB2A16S20P

ESPHome configuration that monitors a JK-PB2A16S20P inverter BMS from an
ESP32-C3 Super Mini over RS485 and publishes all relevant entities to
Home Assistant via the native API.

Implementation is **stock ESPHome** — no Bluetooth, no external custom
component. Everything (device profile, network stack, JK-PB Modbus
register map) lives in a single file: [`jk-pb-bms.yaml`](jk-pb-bms.yaml).
The register map is adapted from
[syssi/esphome-jk-bms `esp32-jk-pb-modbus-example.yaml`](https://github.com/syssi/esphome-jk-bms/blob/main/esp32-jk-pb-modbus-example.yaml)
(pinned as a git submodule under `vendor/esphome-jk-bms` for reference).

## Hardware

- ESP32-C3 Super Mini
- MAX3485 module (3.3V variant — **not** the 5V MAX485 board)
- RJ45 patch cable (one end sacrificed) or RJ45 breakout
- 4× DuPont jumper wires

### Wiring

| MAX3485        | ESP32-C3 |
|----------------|----------|
| VCC            | 3V3      |
| GND            | GND      |
| DI             | GPIO 21  |
| RO             | GPIO 20  |
| DE + RE (tied) | GPIO 10  |

| RJ45 pin (BMS RS485-1) | MAX3485 |
|------------------------|---------|
| 1, 8                   | B       |
| 2, 7                   | A       |
| 3, 6                   | GND     |

Common ground between BMS, MAX3485, and ESP32-C3 is mandatory.

## BMS configuration

In the JK BLE app or Windows tool, set **UART1 Protocol** to:

> `000 — 4G-GPS Remote module Common protocol V4.2`

Then set the BMS address with the DIP switches. The default in this
config is `0x01`; change `device_addr` in `jk-pb-bms.yaml` if you use a
different address. Do not use `0x00` (that puts the BMS in master mode).

## Build & flash

```bash
python3 -m venv .venv      # requires Python 3.11+
source .venv/bin/activate
pip install 'esphome>=2025.11.0'

cp secrets.yaml.example secrets.yaml
# edit secrets.yaml with real values

esphome config jk-pb-bms.yaml      # validate
esphome compile jk-pb-bms.yaml     # build (~2 min, ~1 GB toolchain on first run)
esphome run jk-pb-bms.yaml         # flash + monitor (USB the first time)
```

## Adopt in Home Assistant

After first boot the device announces itself via mDNS. Settings →
Devices & Services → ESPHome → Add. Provide the API encryption key from
`secrets.yaml`.

## Reproducibility

The Modbus register map is a static, vendored copy embedded in
`jk-pb-bms.yaml`. There is no upstream ESPHome component pinned. To pull
in upstream improvements:

```bash
git submodule update --remote vendor/esphome-jk-bms
diff -u vendor/esphome-jk-bms/esp32-jk-pb-modbus-example.yaml jk-pb-bms.yaml
```

Then merge changes selectively into `jk-pb-bms.yaml`.

## License

MIT for the original code in this repo (see [`LICENSE`](LICENSE)). The
register-map portion of [`jk-pb-bms.yaml`](jk-pb-bms.yaml) is Apache-2.0
(derivative of `syssi/esphome-jk-bms`); see
[`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt). Combined SPDX
expression on the file: `MIT AND Apache-2.0`.

## Reference

- Design spec: [docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md](docs/superpowers/specs/2026-05-01-jk-pb-esphome-integration-design.md)
- Implementation plan: [docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md](docs/superpowers/plans/2026-05-01-jk-pb-esphome-integration-plan.md)
