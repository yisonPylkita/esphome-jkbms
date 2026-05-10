#!/usr/bin/env python3
"""Minify inline <style> and <script> blocks in an HTML file.

Conservative — only collapses whitespace and strips comments. Does NOT rename
identifiers, drop semicolons, or rewrite expressions, so behaviour is identical
to the source. Safe for hand-written code with template literals, regex
literals, etc., as long as no string spans multiple physical lines.

Also inlines `<script src="lib/X.js"></script>` tags by reading the referenced
file from disk — pure helper functions live as separate testable JS files
in dashboard/lib/ during development, but the deployed HTML stays self-
contained (no 404s, no extra round-trips on slow phone connections).

Usage:  python3 minify-html.py [--source-dir DIR] < input.html > output.html
"""

import argparse
import os
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
_SCRIPT_INLINE_RE = re.compile(
    r"(<script(?![^>]*\bsrc=)[^>]*>)(.*?)(</script>)", re.DOTALL
)
_SCRIPT_SRC_RE = re.compile(r"<script[^>]*\bsrc=\"([^\"]+)\"[^>]*>\s*</script>")
# Stylesheet `<link>` tag matched as a whole element so we can replace the
# entire tag (link is void — has no closing tag, just the leading `<link ... />`).
_LINK_CSS_RE = re.compile(
    r"<link\b[^>]*\brel=\"stylesheet\"[^>]*\bhref=\"([^\"]+)\"[^>]*/?>",
    re.IGNORECASE,
)
# Icon-style links — favicon, apple-touch-icon — keep their tag but the href
# may need flattening (source paths like `../favicon.svg` must become a
# sibling-relative `favicon.svg` once the build flattens into /config/www/).
_LINK_ICON_RE = re.compile(
    r"(<link\b[^>]*\brel=\"(?:icon|apple-touch-icon|shortcut icon)\"[^>]*\bhref=\")([^\"]+)(\"[^>]*/?>)",
    re.IGNORECASE,
)


def inline_external_scripts(html: str, source_dir: str) -> str:
    """Replace `<script src="X"></script>` with `<script>...minified contents...</script>`.

    Deployed HTML stays single-file. Source HTML still uses external scripts
    so editor tooling and Node tests can address them as standalone files.
    """

    def replace(match):
        rel = match.group(1)
        path = os.path.normpath(os.path.join(source_dir, rel))
        if not os.path.isfile(path):
            sys.stderr.write(
                f'[minify] WARN: <script src="{rel}"> -> {path} not found, leaving as-is\n'
            )
            return match.group(0)
        with open(path, "r", encoding="utf-8") as fh:
            body = fh.read()
        return f"<script>{minify_js(body)}</script>"

    return _SCRIPT_SRC_RE.sub(replace, html)


def inline_external_stylesheets(html: str, source_dir: str) -> str:
    """Replace `<link rel="stylesheet" href="X">` with `<style>...minified contents...</style>`.

    Same rationale as inline_external_scripts — source-side files are
    composable, deployed HTML is single-file.
    """

    def replace(match):
        rel = match.group(1)
        path = os.path.normpath(os.path.join(source_dir, rel))
        if not os.path.isfile(path):
            sys.stderr.write(
                f'[minify] WARN: <link href="{rel}"> -> {path} not found, leaving as-is\n'
            )
            return match.group(0)
        with open(path, "r", encoding="utf-8") as fh:
            body = fh.read()
        return f"<style>{minify_css(body)}</style>"

    return _LINK_CSS_RE.sub(replace, html)


def flatten_icon_paths(html: str) -> str:
    """Strip leading `../` from <link rel="icon">-style hrefs.

    Source layout nests each dashboard one level deep
    (`dashboard/bms/index.html` → `../favicon.svg`), but the deploy step
    flattens everything into `/config/www/`, so the icon should sit
    next to the deployed HTML and be referenced as a bare filename.
    """

    def replace(m):
        head, href, tail = m.group(1), m.group(2), m.group(3)
        # only flatten relative paths that climb one folder up
        if href.startswith("../"):
            href = href[3:]
        return f"{head}{href}{tail}"

    return _LINK_ICON_RE.sub(replace, html)


def minify_html(html: str, source_dir: str = ".") -> str:
    # Inline external scripts BEFORE we minify any inline scripts — the
    # inlined body itself will be minified by the substitution.
    html = inline_external_scripts(html, source_dir)
    html = inline_external_stylesheets(html, source_dir)
    html = flatten_icon_paths(html)
    html = _STYLE_RE.sub(
        lambda m: m.group(1) + minify_css(m.group(2)) + m.group(3), html
    )
    html = _SCRIPT_INLINE_RE.sub(
        lambda m: m.group(1) + minify_js(m.group(2)) + m.group(3), html
    )
    return html


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--source-dir",
        default=".",
        help="Directory containing the source HTML — used as base "
        'for resolving <script src="..."> paths. Defaults '
        "to the current working directory.",
    )
    args = p.parse_args()
    sys.stdout.write(minify_html(sys.stdin.read(), source_dir=args.source_dir))
