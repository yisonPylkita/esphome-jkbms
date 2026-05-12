# Single entry point for tooling. Run `just` (no args) for the recipe list.

# Print recipe list (default).
default:
    @just --list

# Bootstrap a fresh checkout: Python venv + esphome, Node.js binary, secrets.yaml.
setup:
    scripts/setup.sh

# Format every supported file in place (prettier for JS/CSS/HTML/JSON/YAML/MD,
# ruff for Python). Idempotent — safe to re-run. Always run after a change.
fmt:
    scripts/fmt.sh

# What `just check` and CI use for formatting — same tools as `fmt`, but
# fail (non-zero exit) on any file that would change instead of rewriting.
fmt-check:
    scripts/fmt.sh --check

# Run every repo-level validation gate (formatter, syntax, JSON, esphome,
# HTML parse, link integrity, minifier round-trip, FSM-sync, secrets).
check:
    scripts/check.sh

# Run pure-function unit tests against dashboard/lib/*.js.
test:
    scripts/test.sh

# Integration test: drives the live HA alarm package via REST. Requires
# secrets.yaml (or HA_HOST / HA_TOKEN env). Side-effects (siren, push)
# are routed to a test log entity so the suite is safe to run while the
# real alarm is in service. Not in `just ci` — CI has no live HA.
test-alarm:
    scripts/test-alarm-ha.sh

# Zigbee downlink reliability test for the battery-room siren. Runs on
# the HA box itself; pushes the script then exits. Default: 30 pings,
# 5s apart (~2.5 min). Healthy: ≥ 95% success. 0% means the device
# dropped off the mesh — power-cycle, re-pair, possibly add a router.
ping-siren n="30" gap="5":
    scp -O -q -o ConnectTimeout=10 scripts/ping-siren.py root@$(grep -E '^ha_host:' secrets.yaml | sed -E 's/^ha_host: *"?([^"]*)"? *$/\1/'):/tmp/ping-siren.py
    ssh -o ConnectTimeout=10 root@$(grep -E '^ha_host:' secrets.yaml | sed -E 's/^ha_host: *"?([^"]*)"? *$/\1/') "python3 /tmp/ping-siren.py {{n}} {{gap}}"

# What CI runs: format-check + every gate + tests, in order.
ci: fmt-check check test

# Render minified copies of all four dashboards into /tmp for inspection.
minify:
    @mkdir -p /tmp/jkbms-minify
    @for folder in bms alarm advanced history; do \
        src="dashboard/$$folder/index.html"; \
        out="/tmp/jkbms-minify/$$folder.html"; \
        sed 's|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|test-token|' "$$src" \
          | .venv/bin/python scripts/minify-html.py --source-dir "dashboard/$$folder" > "$$out"; \
        printf '  %-30s -> %s (%d bytes)\n' "$$src" "$$out" "$$(wc -c < $$out)"; \
    done

# Push to Home Assistant. deploy-ha.sh runs `check.sh` + `test.sh` itself
# (unless --skip-checks), so no prerequisite recipes are needed here.
deploy:
    scripts/deploy-ha.sh

# Disaster-recovery: re-create the HA box from snapshots in this repo.
# Requires a fresh HA OS install with SSH access + secrets.yaml filled in.
# Idempotent. Prints "MANUAL STEP" markers for things that can't be
# automated (Tailscale auth, paired Zigbee state, HA users).
restore:
    scripts/restore-ha.sh

# Run deploy through the substitute/minify/hash steps, stop before scp.
dry-run:
    scripts/deploy-ha.sh --dry-run

# Run check + test, do not deploy.
check-only:
    scripts/deploy-ha.sh --check-only
