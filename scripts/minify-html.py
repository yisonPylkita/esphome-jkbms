#!/usr/bin/env python3
"""Minify inline ``<style>`` and ``<script>`` blocks in an HTML file.

Conservative — only collapses whitespace and strips comments. Does NOT rename
identifiers, drop semicolons, or rewrite expressions, so behaviour is identical
to the source. Safe for hand-written code with template literals, regex
literals, etc., as long as no string spans multiple physical lines.

Also inlines ``<script src="lib/X.js"></script>`` and
``<link rel="stylesheet" href="...">`` tags by reading the referenced file
from disk — pure helper files live as separate testable units in
``dashboard/lib/`` during development, but the deployed HTML stays self-
contained (no 404s, no extra round-trips on slow phone connections).

Usage::

    python3 minify-html.py [--source-dir DIR] < input.html > output.html
"""

import argparse
import re
import sys
from pathlib import Path

# Type alias kept top-level so it's importable from tests / callers.
type Match = re.Match[str]


def strip_block_comments(s: str, /) -> str:
    """Drop ``/* ... */`` blocks, multi-line aware."""
    return re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)


def minify_css(css: str, /) -> str:
    """Collapse whitespace + strip comments. Output is one long line."""
    css = strip_block_comments(css)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)
    css = re.sub(r";}", "}", css)
    return css.strip()


# Lines whose stripped form starts with `//` are pure line-comments and can be
# dropped. Do NOT try to drop trailing `//` from arbitrary lines — string and
# regex literals can contain `//` (e.g. URLs).
_LINE_COMMENT_RE: re.Pattern[str] = re.compile(r"^\s*//")


def minify_js(js: str, /) -> str:
    """Drop ``//`` line comments + ``/* */`` blocks; collapse blank lines."""
    js = strip_block_comments(js)
    out_lines: list[str] = []
    for line in js.splitlines():
        stripped = line.strip()
        if not stripped or _LINE_COMMENT_RE.match(line):
            continue
        out_lines.append(stripped)
    return "\n".join(out_lines)


_STYLE_RE: re.Pattern[str] = re.compile(r"(<style[^>]*>)(.*?)(</style>)", re.DOTALL)
_SCRIPT_INLINE_RE: re.Pattern[str] = re.compile(
    r"(<script(?![^>]*\bsrc=)[^>]*>)(.*?)(</script>)", re.DOTALL
)
_SCRIPT_SRC_RE: re.Pattern[str] = re.compile(r'<script[^>]*\bsrc="([^"]+)"[^>]*>\s*</script>')
# Stylesheet `<link>` tag matched as a whole element so we can replace the
# entire tag (link is void — has no closing tag, just the leading
# `<link ... />`).
_LINK_CSS_RE: re.Pattern[str] = re.compile(
    r'<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*/?>',
    re.IGNORECASE,
)
# Icon-style links — favicon, apple-touch-icon — keep their tag but the href
# may need flattening (source paths like `../favicon.svg` must become a
# sibling-relative `favicon.svg` once the build flattens into /config/www/).
_LINK_ICON_RE: re.Pattern[str] = re.compile(
    r'(<link\b[^>]*\brel="(?:icon|apple-touch-icon|shortcut icon)"[^>]*\bhref=")'
    r'([^"]+)("[^>]*/?>)',
    re.IGNORECASE,
)


def _read_relative(source_dir: Path, rel: str, kind: str) -> str | None:
    """Return the file contents at ``source_dir / rel``, or ``None`` if missing.

    A missing file is non-fatal — the caller leaves the original tag in place
    and prints a warning so a typo doesn't silently drop a script.
    """
    path = (source_dir / rel).resolve()
    if not path.is_file():
        sys.stderr.write(
            f'[minify] WARN: <{kind} ... "{rel}"> -> {path} not found, leaving as-is\n'
        )
        return None
    return path.read_text(encoding="utf-8")


def inline_external_scripts(html: str, source_dir: Path) -> str:
    """Replace ``<script src="X">`` with ``<script>...minified body...</script>``.

    Deployed HTML stays single-file. Source HTML still uses external scripts
    so editor tooling and Node tests can address them as standalone files.
    """

    def replace(match: Match, /) -> str:
        rel = match.group(1)
        body = _read_relative(source_dir, rel, "script")
        if body is None:
            return match.group(0)
        return f"<script>{minify_js(body)}</script>"

    return _SCRIPT_SRC_RE.sub(replace, html)


def inline_external_stylesheets(html: str, source_dir: Path) -> str:
    """Replace ``<link rel="stylesheet" href="X">`` with ``<style>...</style>``.

    Same rationale as :func:`inline_external_scripts` — source-side files are
    composable, deployed HTML is single-file.
    """

    def replace(match: Match, /) -> str:
        rel = match.group(1)
        body = _read_relative(source_dir, rel, "link")
        if body is None:
            return match.group(0)
        return f"<style>{minify_css(body)}</style>"

    return _LINK_CSS_RE.sub(replace, html)


def flatten_icon_paths(html: str, /) -> str:
    """Strip leading ``../`` from ``<link rel="icon">``-style hrefs.

    Source layout nests each dashboard one level deep
    (``dashboard/bms/index.html`` → ``../favicon.svg``), but the deploy step
    flattens everything into ``/config/www/``, so the icon should sit next to
    the deployed HTML and be referenced as a bare filename.
    """

    def replace(m: Match, /) -> str:
        head, href, tail = m.group(1), m.group(2), m.group(3)
        # only flatten relative paths that climb one folder up
        if href.startswith("../"):
            href = href[3:]
        return f"{head}{href}{tail}"

    return _LINK_ICON_RE.sub(replace, html)


def minify_html(html: str, source_dir: Path | str = ".") -> str:
    """End-to-end minify: inline externals, flatten icons, then collapse."""
    source = Path(source_dir)
    # Inline external scripts BEFORE we minify any inline scripts — the
    # inlined body itself will be minified by the substitution.
    html = inline_external_scripts(html, source)
    html = inline_external_stylesheets(html, source)
    html = flatten_icon_paths(html)
    html = _STYLE_RE.sub(
        lambda m: m.group(1) + minify_css(m.group(2)) + m.group(3),
        html,
    )
    html = _SCRIPT_INLINE_RE.sub(
        lambda m: m.group(1) + minify_js(m.group(2)) + m.group(3),
        html,
    )
    return html


def main(argv: list[str] | None = None) -> int:
    summary = (__doc__ or "").splitlines()[0] or None
    parser = argparse.ArgumentParser(description=summary)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path(),
        help=(
            "Directory containing the source HTML — used as base for resolving"
            ' <script src="..."> and <link href="..."> paths. Defaults to the'
            " current working directory."
        ),
    )
    args = parser.parse_args(argv)
    sys.stdout.write(minify_html(sys.stdin.read(), source_dir=args.source_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
