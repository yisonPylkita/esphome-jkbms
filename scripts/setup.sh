#!/usr/bin/env bash
#
# Bootstrap a fresh checkout. Idempotent — safe to re-run.
#
# Assumes the host has: git, just, rust/cargo, python3 (>=3.10), curl, tar.
# Everything else is downloaded into the repo (.venv/ for Python deps,
# .tools/ for Node.js).
#
# Targets: macOS (x64 + arm64), Linux (x64 + arm64).
#
# Usage:  scripts/setup.sh                    # full bootstrap
#         scripts/setup.sh --no-node          # skip Node.js download (if already on PATH)
#         scripts/setup.sh --no-esphome       # skip Python venv + esphome
#         scripts/setup.sh --no-check         # skip the final `just check && just test` smoke test
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

INSTALL_NODE=1
INSTALL_ESPHOME=1
RUN_CHECK=1
for arg in "$@"; do
  case "$arg" in
    --no-node)    INSTALL_NODE=0 ;;
    --no-esphome) INSTALL_ESPHOME=0 ;;
    --no-check)   RUN_CHECK=0 ;;
    -h|--help)
      /usr/bin/sed -n '2,/^set -/p' "$0" | /usr/bin/sed -n '/^#/p; /^$/q'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ok()    { printf '\033[32m✓\033[0m %s\n' "$1"; }
info()  { printf '\033[36m·\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$1" >&2; }
die()   { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1 (please install and re-run)"
}
require git
require just
require curl
require tar

# uv (Astral's Python package + version manager) replaces pip + venv. It
# downloads Python itself if the requested version isn't on the host, so
# we don't need a system python3 here. Install hint if missing:
if ! command -v uv >/dev/null 2>&1; then
  die "uv is missing — install with \`curl -LsSf https://astral.sh/uv/install.sh | sh\` (or your package manager) and re-run"
fi

# ---------- 1. Detect OS / arch ----------
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux)  OS=linux  ;;
  *)      die "unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64)    ARCH=x64 ;;
  arm64|aarch64)   ARCH=arm64 ;;
  *)               die "unsupported arch: $(uname -m)" ;;
esac
info "host: $OS-$ARCH"

# ---------- 2. Python via uv: download Python 3.14 if needed, sync deps ----------
if [ "$INSTALL_ESPHOME" = "1" ]; then
  info "uv $(uv --version 2>&1 | head -n1 | awk '{print $2}') — syncing Python + dev deps from uv.lock"
  # `uv sync` reads pyproject.toml + .python-version, downloads the right
  # Python if not present, materialises .venv/, installs every dep group.
  uv sync --all-groups --quiet
  ok ".venv/bin/python ready ($(.venv/bin/python --version 2>&1))"
  ok ".venv/bin/esphome ready ($(.venv/bin/esphome version 2>&1 | head -n1))"
  ok ".venv/bin/ruff ready ($(.venv/bin/ruff --version 2>&1 | head -n1))"
  ok ".venv/bin/ty ready ($(.venv/bin/ty --version 2>&1))"
else
  info "skipping Python/esphome setup (--no-esphome)"
fi

# ---------- 3. Node.js (downloaded binary; no system install) ----------
NODE_VERSION="20.18.1"
TOOLS_DIR=".tools"
NODE_DIST="node-v${NODE_VERSION}-${OS}-${ARCH}"
NODE_HOME="$TOOLS_DIR/$NODE_DIST"

if [ "$INSTALL_NODE" = "1" ]; then
  # Reuse a system-wide node (>=18) if it's already on PATH and current.
  USE_SYSTEM_NODE=0
  if command -v node >/dev/null 2>&1; then
    sys_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$sys_major" -ge 18 ] 2>/dev/null; then
      USE_SYSTEM_NODE=1
      info "system node $(node -v) on PATH — using it"
    fi
  fi

  if [ "$USE_SYSTEM_NODE" = "0" ]; then
    if [ ! -x "$NODE_HOME/bin/node" ]; then
      mkdir -p "$TOOLS_DIR"
      TARBALL="${NODE_DIST}.tar.gz"
      URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"
      info "downloading $URL"
      curl -fsSL "$URL" | tar -xz -C "$TOOLS_DIR"
    fi
    # Stable in-repo path so test.sh can find it.
    mkdir -p "$TOOLS_DIR/bin"
    ln -sf "../${NODE_DIST}/bin/node" "$TOOLS_DIR/bin/node"
    ln -sf "../${NODE_DIST}/bin/npm"  "$TOOLS_DIR/bin/npm"
    ok ".tools/bin/node ready ($("$NODE_HOME/bin/node" -v))"
  fi
else
  info "skipping Node.js setup (--no-node)"
fi

# ---------- 3b. npm dev deps (prettier) ----------
if [ "$INSTALL_NODE" = "1" ]; then
  # Pick the npm we'll use — the one paired with the node we'll actually
  # call from CI / Just (`.tools/bin/npm` if we just downloaded one,
  # otherwise system npm).
  if [ -x ".tools/bin/npm" ]; then NPM=".tools/bin/npm"
  elif command -v npm >/dev/null 2>&1; then NPM="npm"
  else NPM=""
  fi
  if [ -n "$NPM" ] && [ -f package.json ]; then
    info "installing npm dev deps (prettier) via $NPM"
    "$NPM" install --silent --no-audit --no-fund
    ok "node_modules/.bin/prettier ready ($(./node_modules/.bin/prettier --version))"
  fi
fi

# ---------- 4. secrets.yaml ----------
if [ ! -f secrets.yaml ]; then
  cp secrets.yaml.example secrets.yaml
  warn "created secrets.yaml from template — fill in real values before deploying"
else
  info "secrets.yaml present"
fi

# Make `inverter/secrets.yaml` resolve to the same file so `esphome config
# inverter/easun.yaml` works without copy-paste.
if [ ! -e inverter/secrets.yaml ]; then
  ln -s ../secrets.yaml inverter/secrets.yaml
  ok "linked inverter/secrets.yaml -> ../secrets.yaml"
fi

# ---------- 5. Smoke test the toolchain ----------
if [ "$RUN_CHECK" = "1" ]; then
  echo
  info "running just check + just test to validate the bootstrap"
  just check
  just test
  echo
  ok "setup complete — toolchain validated"
else
  echo
  ok "setup complete — skipped final check (run \`just check && just test\` to verify)"
fi

cat <<'EOF'

Next steps
----------
  1. Edit secrets.yaml — fill in WiFi creds, HA host/token, BMS BLE MAC.
     Generate the encryption key with:  openssl rand -base64 32
  2. (Once secrets.yaml is real)  just deploy   — push dashboards to HA.
  3. Flash the BMS firmware:        .venv/bin/esphome run jk-pb-bms.yaml
  4. Run `just` (no args) to see all available recipes.
EOF
