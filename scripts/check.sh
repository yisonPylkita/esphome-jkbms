#!/usr/bin/env bash
#
# Validation gate. Runs every "is the repo OK?" check we care about,
# in series, exiting non-zero on the first failure.
#
# Used by:  just check  · CI · scripts/deploy-ha.sh --check-only
#
# Tested locally with bash 3.2 (macOS default) and bash 5.x (Linux CI).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

# 1. Shell syntax — every .sh under scripts/.
for f in scripts/*.sh; do
  /bin/bash -n "$f" || fail "bash syntax: $f"
done
ok "bash -n on $(/bin/ls -1 scripts/*.sh | /usr/bin/wc -l | /usr/bin/tr -d ' ') script(s)"

# 2. Python syntax + minifier sanity.
/usr/bin/python3 -m py_compile scripts/*.py || fail "python syntax"
ok "python3 -m py_compile on scripts/*.py"

# 3. JSON validates — every flow / config we ship.
for f in node-red/*.flow.json; do
  /usr/bin/python3 -c "import json; json.load(open('$f'))" || fail "JSON parse: $f"
done
ok "JSON parse on $(/bin/ls -1 node-red/*.flow.json | /usr/bin/wc -l | /usr/bin/tr -d ' ') flow(s)"

# 4. ESPHome config validates — both YAMLs.
ESPHOME=""
if [ -x ".venv/bin/esphome" ]; then ESPHOME=".venv/bin/esphome"
elif command -v esphome >/dev/null 2>&1; then ESPHOME="esphome"
else
  printf '\033[33m·\033[0m esphome not on PATH; skipping firmware config validation\n'
fi
if [ -n "$ESPHOME" ]; then
  for f in jk-pb-bms.yaml inverter/easun.yaml; do
    "$ESPHOME" config "$f" >/dev/null 2>&1 || fail "esphome config: $f"
  done
  ok "esphome config on jk-pb-bms.yaml, inverter/easun.yaml"
fi

# 5. HTML basic-parse — quick smoke test that nothing in the source is
#    grossly malformed (unbalanced tags, busted entities, etc.).
for f in dashboard/*.html; do
  /usr/bin/python3 - "$f" <<'PY' || fail "html parse: $1"
import html.parser, sys
class P(html.parser.HTMLParser):
    def error(self, m): raise RuntimeError(m)
P().feed(open(sys.argv[1], encoding="utf-8").read())
PY
done
ok "html.parser on $(/bin/ls -1 dashboard/*.html | /usr/bin/wc -l | /usr/bin/tr -d ' ') dashboard(s)"

# 6. Font-link integrity — every /local/fonts/X referenced in HTML must
#    actually exist in dashboard/fonts/, otherwise the deploy will 404.
MISSING=""
for ref in $(/usr/bin/grep -hoE '/local/fonts/[A-Za-z0-9._-]+' dashboard/*.html | /usr/bin/sort -u); do
  base="${ref##/local/fonts/}"
  if [ ! -f "dashboard/fonts/$base" ]; then
    MISSING="$MISSING $base"
  fi
done
[ -z "$MISSING" ] || fail "fonts referenced but not in dashboard/fonts/:$MISSING"
ok "font references resolve under dashboard/fonts/"

# 7. lib/*.js references resolve — same check for `<script src="lib/...">`.
MISSING_LIB=""
for ref in $(/usr/bin/grep -hoE 'src="lib/[A-Za-z0-9._/-]+\.js"' dashboard/*.html | /usr/bin/sed -E 's/^src="lib\///; s/"$//' | /usr/bin/sort -u); do
  if [ ! -f "dashboard/lib/$ref" ]; then
    MISSING_LIB="$MISSING_LIB $ref"
  fi
done
[ -z "$MISSING_LIB" ] || fail "lib scripts referenced but not in dashboard/lib/:$MISSING_LIB"
ok "<script src=\"lib/...\"> references resolve"

# 8. Minifier round-trip — substitute a fake token, minify both HTMLs,
#    confirm output still parses as HTML AND contains no unresolved
#    `<script src="lib/...">` tags (i.e. inlining worked).
TMP="$(/usr/bin/mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for src in dashboard/bms-integrated.html dashboard/dashboard.html; do
  out="$TMP/$(basename "$src")"
  /usr/bin/sed 's|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|test-token|' "$src" \
    | /usr/bin/python3 scripts/minify-html.py --source-dir dashboard > "$out" \
    || fail "minify: $src"
  /usr/bin/python3 - "$out" <<'PY' || fail "minified html parse: $1"
import html.parser, sys
class P(html.parser.HTMLParser):
    def error(self, m): raise RuntimeError(m)
P().feed(open(sys.argv[1], encoding="utf-8").read())
PY
  if /usr/bin/grep -qE 'src="lib/' "$out"; then
    fail "minify did not inline lib/ scripts in $(/usr/bin/basename "$src")"
  fi
done
ok "minifier round-trip on both dashboards"

# 9. secrets.yaml.example covers every key the deploy script reads.
NEEDS="ha_host ha_user ha_token wifi_ssid wifi_password api_encryption_key ota_password ap_password bms_mac_address"
for k in $NEEDS; do
  /usr/bin/grep -qE "^${k}:" secrets.yaml.example || fail "secrets.yaml.example missing key: $k"
done
ok "secrets.yaml.example covers required keys"

printf '\n\033[32mall checks passed\033[0m\n'
