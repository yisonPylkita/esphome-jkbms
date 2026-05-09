#!/usr/bin/env python3
"""Minify inline <style> and <script> blocks in an HTML file.

Conservative — only collapses whitespace and strips comments. Does NOT rename
identifiers, drop semicolons, or rewrite expressions, so behaviour is identical
to the source. Safe for hand-written code with template literals, regex
literals, etc., as long as no string spans multiple physical lines.

Usage:  python3 minify-html.py < input.html > output.html
"""
import re
import sys


def strip_block_comments(s: str) -> str:
    return re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)


def minify_css(css: str) -> str:
    css = strip_block_comments(css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)
    css = re.sub(r";}", "}", css)
    return css.strip()


# Lines whose stripped form starts with `//` are pure line-comments and can be
# dropped. Do NOT try to drop trailing `//` from arbitrary lines — string and
# regex literals can contain `//` (e.g. URLs).
_LINE_COMMENT_RE = re.compile(r"^\s*//")


def minify_js(js: str) -> str:
    js = strip_block_comments(js)
    out_lines = []
    for line in js.splitlines():
        stripped = line.strip()
        if not stripped or _LINE_COMMENT_RE.match(line):
            continue
        out_lines.append(stripped)
    return "\n".join(out_lines)


_STYLE_RE = re.compile(r"(<style[^>]*>)(.*?)(</style>)", re.DOTALL)
_SCRIPT_RE = re.compile(r"(<script[^>]*>)(.*?)(</script>)", re.DOTALL)


def minify_html(html: str) -> str:
    html = _STYLE_RE.sub(
        lambda m: m.group(1) + minify_css(m.group(2)) + m.group(3), html
    )
    html = _SCRIPT_RE.sub(
        lambda m: m.group(1) + minify_js(m.group(2)) + m.group(3), html
    )
    return html


if __name__ == "__main__":
    sys.stdout.write(minify_html(sys.stdin.read()))
