# Single entry point for tooling. Run `just` (no args) for the recipe list.

# Print recipe list (default).
default:
    @just --list

# Bootstrap a fresh checkout: Python venv + esphome, Node.js binary, secrets.yaml.
setup:
    scripts/setup.sh

# Run every repo-level validation gate.
check:
    scripts/check.sh

# Run pure-function unit tests against dashboard/lib/*.js.
test:
    scripts/test.sh

# What CI runs: check + test, in order.
ci: check test

# Render minified copies of all three dashboards into /tmp for inspection.
minify:
    @mkdir -p /tmp/jkbms-minify
    @for folder in bms alarm advanced; do \
        src="dashboard/$$folder/index.html"; \
        out="/tmp/jkbms-minify/$$folder.html"; \
        sed 's|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|test-token|' "$$src" \
          | python3 scripts/minify-html.py --source-dir "dashboard/$$folder" > "$$out"; \
        printf '  %-30s -> %s (%d bytes)\n' "$$src" "$$out" "$$(wc -c < $$out)"; \
    done

# Push to Home Assistant (gated on `just check && just test`).
deploy: check test
    scripts/deploy-ha.sh

# Run deploy through the substitute/minify/hash steps, stop before scp.
dry-run:
    scripts/deploy-ha.sh --dry-run

# Run check + test, do not deploy.
check-only:
    scripts/deploy-ha.sh --check-only
