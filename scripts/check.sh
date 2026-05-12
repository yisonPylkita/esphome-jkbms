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

# 0. Formatting — prettier (JS/CSS/HTML/JSON/YAML/MD) + ruff (Python).
#    Skipped if the toolchain isn't installed (e.g. lean CI container) so
#    contributors aren't forced to run `npm install` to do a syntax check.
if [ -x node_modules/.bin/prettier ] || [ -x .venv/bin/ruff ]; then
  bash scripts/fmt.sh --check >/dev/null || fail "formatter (run \`just fmt\`)"
  ok "format gates pass (prettier + ruff)"
else
  printf '\033[33m·\033[0m formatter tooling absent; run scripts/setup.sh to enable\n'
fi

# 1. Shell syntax — every .sh under scripts/.
for f in scripts/*.sh; do
  /bin/bash -n "$f" || fail "bash syntax: $f"
done
ok "bash -n on $(/bin/ls -1 scripts/*.sh | /usr/bin/wc -l | /usr/bin/tr -d ' ') script(s)"

# 2. Python: static type check (ty) + syntax check fallback.
#    ty subsumes py_compile (it parses the same AST + much more), so we run
#    it as gate 0 for Python and only fall back to py_compile when the
#    toolchain isn't on the box (e.g. minimal CI runners without uv).
#    Single-capture pattern: run once, hold stderr, dump only on failure.
if [ -x ".venv/bin/ty" ]; then
  out=$(.venv/bin/ty check 2>&1) || { printf '%s\n' "$out" >&2; fail "ty type check"; }
  ok "ty static type check on scripts/"
else
  /usr/bin/python3 -m py_compile scripts/*.py || fail "python syntax"
  printf '\033[33m·\033[0m ty absent; falling back to python3 -m py_compile\n'
fi

# 2b. Python: ruff lint. pyproject.toml configures E/F/I/UP/B/SIM; this
#     gate is what actually enforces them. Same single-capture pattern.
if [ -x ".venv/bin/ruff" ]; then
  out=$(.venv/bin/ruff check 2>&1) || { printf '%s\n' "$out" >&2; fail "ruff check"; }
  ok "ruff lint on scripts/"
fi

# 3. JSON validates — every addon snapshot we ship.
JSON_FILES=$(find homeassistant/addons -name '*.json' -type f 2>/dev/null)
for f in $JSON_FILES; do
  /usr/bin/python3 -c "import json; json.load(open('$f'))" || fail "JSON parse: $f"
done
ok "JSON parse on $(printf '%s\n' "$JSON_FILES" | /usr/bin/wc -l | /usr/bin/tr -d ' ') JSON file(s)"

# 4. ESPHome config validates — both YAMLs.
ESPHOME=""
if [ -x ".venv/bin/esphome" ]; then ESPHOME=".venv/bin/esphome"
elif command -v esphome >/dev/null 2>&1; then ESPHOME="esphome"
else
  printf '\033[33m·\033[0m esphome not on PATH; skipping firmware config validation\n'
fi
if [ -n "$ESPHOME" ]; then
  for f in jk-pb-bms.yaml inverter/easun.yaml; do
    # Single-capture: hold stderr, dump only on failure so CI logs
    # show the actual validator complaint instead of just "config:".
    out=$("$ESPHOME" config "$f" 2>&1) || { printf '%s\n' "$out" >&2; fail "esphome config: $f"; }
  done
  ok "esphome config on jk-pb-bms.yaml, inverter/easun.yaml"
fi

# 5. HTML basic-parse — quick smoke test that nothing in the source is
#    grossly malformed (unbalanced tags, busted entities, etc.).
HTML_FILES="$(find dashboard -maxdepth 2 -mindepth 2 -name 'index.html' -type f)"
for f in $HTML_FILES; do
  /usr/bin/python3 - "$f" <<'PY' || fail "html parse: $1"
import html.parser, sys
class P(html.parser.HTMLParser):
    def error(self, m): raise RuntimeError(m)
P().feed(open(sys.argv[1], encoding="utf-8").read())
PY
done
ok "html.parser on $(printf '%s\n' "$HTML_FILES" | /usr/bin/wc -l | /usr/bin/tr -d ' ') dashboard(s)"

# 6. Font-link integrity — every /local/fonts/X referenced anywhere in the
#    dashboard sources must actually exist in dashboard/fonts/, otherwise
#    the deploy will 404.
MISSING=""
for ref in $(/usr/bin/grep -rhoE '/local/fonts/[A-Za-z0-9._-]+' dashboard/{bms,alarm,advanced,history} 2>/dev/null | /usr/bin/sort -u); do
  base="${ref##/local/fonts/}"
  if [ ! -f "dashboard/fonts/$base" ]; then
    MISSING="$MISSING $base"
  fi
done
[ -z "$MISSING" ] || fail "fonts referenced but not in dashboard/fonts/:$MISSING"
ok "font references resolve under dashboard/fonts/"

# 7. lib/*.js references resolve — references in each dashboard's
#    index.html now climb one level (`../lib/X.js`) since each lives in
#    its own folder. Validate every match.
MISSING_LIB=""
for ref in $(/usr/bin/grep -rhoE 'src="\.\./lib/[A-Za-z0-9._/-]+\.js"' dashboard/{bms,alarm,advanced,history} 2>/dev/null | /usr/bin/sed -E 's|^src="\.\./lib/||; s/"$//' | /usr/bin/sort -u); do
  if [ ! -f "dashboard/lib/$ref" ]; then
    MISSING_LIB="$MISSING_LIB $ref"
  fi
done
[ -z "$MISSING_LIB" ] || fail "lib scripts referenced but not in dashboard/lib/:$MISSING_LIB"
ok "<script src=\"../lib/...\"> references resolve"

# 7b. Cross-dashboard navigation must NOT use `../X.html`. After deploy
#     every dashboard lands flat in /config/www/, so sibling-relative
#     `href="alarm.html"` is what works. `../alarm.html` would resolve
#     to /alarm.html (404). Caught one of these in the wild — guard it.
# grep returns 1 on no match — under `set -e` that aborts the script; the
# `|| true` keeps us in the "no offending hrefs found" success path.
BAD_NAV=$(/usr/bin/grep -rhoE 'href="\.\./[A-Za-z0-9._-]+\.html"' dashboard/{bms,alarm,advanced,history} 2>/dev/null | /usr/bin/sort -u || true)
if [ -n "$BAD_NAV" ]; then
  printf '\033[31m✗\033[0m cross-dashboard hrefs use ../ prefix; deploy lands files flat — drop the ../:\n%s\n' "$BAD_NAV" >&2
  exit 1
fi
ok "cross-dashboard <a href> uses sibling-relative paths"

# 8. Minifier round-trip — substitute a fake token, run the minifier on
#    each component-folder index.html, confirm the output still parses
#    as HTML AND contains no unresolved `<script src=` or `<link rel=
#    "stylesheet">` tags (i.e. inlining worked end-to-end).
TMP="$(/usr/bin/mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for folder in bms alarm advanced history; do
  src="dashboard/$folder/index.html"
  out="$TMP/$folder.html"
  /usr/bin/sed 's|PASTE_LONG_LIVED_ACCESS_TOKEN_HERE|test-token|' "$src" \
    | .venv/bin/python scripts/minify-html.py --source-dir "dashboard/$folder" > "$out" \
    || fail "minify: $src"
  /usr/bin/python3 - "$out" <<'PY' || fail "minified html parse: $1"
import html.parser, sys
class P(html.parser.HTMLParser):
    def error(self, m): raise RuntimeError(m)
P().feed(open(sys.argv[1], encoding="utf-8").read())
PY
  if /usr/bin/grep -qE '<script[^>]*\bsrc=' "$out"; then
    fail "minify left an external <script src=> in $folder/index.html"
  fi
  if /usr/bin/grep -qE '<link[^>]*\brel="stylesheet"' "$out"; then
    fail "minify left an external <link rel=stylesheet> in $folder/index.html"
  fi
done
ok "minifier round-trip on all dashboards"

# 9. secrets.yaml.example covers every key the deploy script reads.
NEEDS="ha_host ha_user ha_token wifi_ssid wifi_password api_encryption_key ota_password ap_password bms_mac_address easun_api_encryption_key easun_ota_password"
for k in $NEEDS; do
  /usr/bin/grep -qE "^${k}:" secrets.yaml.example || fail "secrets.yaml.example missing key: $k"
done
ok "secrets.yaml.example covers required keys"

printf '\n\033[32mall checks passed\033[0m\n'
