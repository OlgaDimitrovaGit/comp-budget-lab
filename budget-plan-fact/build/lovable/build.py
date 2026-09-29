#!/usr/bin/env python3
"""Builds the dashboard page: build/dashboard.html, shipped as index.html.

  cd build/lovable && npm ci      # once: Tailwind, Vite, React, Recharts
  python build/lovable/build.py

1. Compiles lovable/styles.css with Tailwind 4 against the classes used in
   template.html and lovable/chart.jsx, and bundles chart.jsx (React +
   Recharts) into one script.
2. Inlines both into the template -> lovable/template.gen.html.
3. Hands that to build_dashboard.py, which checks the data and embeds it.

The page makes no network request: the CSS and the script are inline, the
fonts are the system stack. Exits non-zero if any step fails.
"""
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent          # build/lovable
BUILD = HERE.parent                                      # build/
TEMPLATE = BUILD / "template.html"
GEN = HERE / "template.gen.html"
DIST = HERE / "dist"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not (HERE / "node_modules").exists():
        sys.exit(f"no node_modules in {HERE}: run `npm ci` there first")

    npx = shutil.which("npx") or "npx"
    r = subprocess.run([npx, "vite", "build", "--logLevel", "warn"],
                       cwd=HERE, shell=(os.name == "nt"))
    if r.returncode:
        sys.exit(1)
    js = (DIST / "chart.js").read_text(encoding="utf-8")
    css_files = list(DIST.glob("*.css"))
    if len(css_files) != 1:
        sys.exit(f"expected one CSS file in {DIST}, got {[c.name for c in css_files]}")
    out_css = css_files[0].read_text(encoding="utf-8")

    # Inline safely: a literal "</script" or "</style" inside the code would
    # close the tag early.
    js = js.replace("</script", "<\\/script")
    out_css = out_css.replace("</style", "<\\/style")

    tpl = TEMPLATE.read_text(encoding="utf-8")
    for mark in ("/*LOVABLE_CSS*/", "/*LOVABLE_CHART*/"):
        if tpl.count(mark) != 1:
            sys.exit(f"{mark} must appear exactly once in {TEMPLATE.name}")
    html = tpl.replace("/*LOVABLE_CSS*/", out_css).replace("/*LOVABLE_CHART*/", js)
    GEN.write_text(html, encoding="utf-8", newline="\n")
    print(f"css {len(out_css) / 1024:.0f} KB, chart {len(js) / 1024:.0f} KB -> {GEN.name}")

    sys.path.insert(0, str(BUILD))
    import build_dashboard
    build_dashboard.build(os.path.relpath(GEN, BUILD), "dashboard.html")


if __name__ == "__main__":
    main()
