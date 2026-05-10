#!/usr/bin/env bash
#
# Single entry point for formatting and format-checking. Used by:
#   just fmt        → rewrite every supported file in place
#   just fmt-check  → fail if any file would change (CI gate)
#
# Tools (auto-discovered):
#   prettier (node)  → JS / CSS / HTML / JSON / YAML / Markdown
#   ruff format      → Python
#   shfmt (optional) → Bash scripts in scripts/*.sh (if installed)
#
# All three are idempotent and safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

MODE="write"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    -h|--help)
      /usr/bin/sed -n '2,/^set -/p' "$0" | /usr/bin/sed -n '/^#/p; /^$/q'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
info() { printf '\033[36m·\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1" >&2; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

# ---- prettier ----
PRETTIER="node_modules/.bin/prettier"
if [ ! -x "$PRETTIER" ]; then
  fail "prettier not installed — run \`scripts/setup.sh\` (or \`npm install\`)"
fi

if [ "$MODE" = "check" ]; then
  "$PRETTIER" --check . || fail "prettier: files need formatting (run \`just fmt\`)"
  ok "prettier: all files match style"
else
  "$PRETTIER" --write --log-level warn .
  ok "prettier: formatted"
fi

# ---- ruff (Python) ----
RUFF=""
if   [ -x ".venv/bin/ruff" ];   then RUFF=".venv/bin/ruff"
elif command -v ruff >/dev/null 2>&1; then RUFF="ruff"
fi
if [ -z "$RUFF" ]; then
  warn "ruff not installed — skipping Python formatting (run \`scripts/setup.sh\`)"
else
  if [ "$MODE" = "check" ]; then
    "$RUFF" format --check . >/dev/null || fail "ruff format: Python files need formatting (run \`just fmt\`)"
    ok "ruff format: all Python files match style"
  else
    "$RUFF" format . >/dev/null
    ok "ruff format: formatted"
  fi
fi

# ---- shfmt (optional — bash scripts) ----
SHFMT=""
if   command -v shfmt >/dev/null 2>&1; then SHFMT="shfmt"
fi
if [ -n "$SHFMT" ]; then
  SCRIPTS=$(find scripts -maxdepth 2 -name '*.sh' -type f)
  if [ -n "$SCRIPTS" ]; then
    if [ "$MODE" = "check" ]; then
      # -d prints a diff and exits non-zero on any pending change.
      $SHFMT -i 2 -ci -d $SCRIPTS >/dev/null || fail "shfmt: shell scripts need formatting (run \`just fmt\`)"
      ok "shfmt: all shell scripts match style"
    else
      $SHFMT -i 2 -ci -w $SCRIPTS
      ok "shfmt: formatted"
    fi
  fi
else
  info "shfmt not installed — skipping shell formatting (optional)"
fi

printf '\n\033[32m%s\033[0m\n' "$([ "$MODE" = "check" ] && echo "all format gates passed" || echo "everything formatted")"
