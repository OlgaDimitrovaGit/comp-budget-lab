# -*- coding: utf-8 -*-
"""Inline build/*.js into build/shell.html -> pay-gap-calculator.html.

The bundle is a derived file: never edit it by hand. Run this
after any change under build/. It asserts that no <script src=> survives —
a single external reference would break the page's core promise.
"""
import base64, io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'pay-gap-calculator.html')

html = io.open(os.path.join(HERE, 'shell.html'), encoding='utf-8').read()

# The format sample is served from a data: URI, not a file next to the page:
# the artifact travels as a single HTML file, and a relative href would 404
# everywhere it is republished. Base64 keeps the newlines intact.
SAMPLE_TOKEN = '__SAMPLE_CSV_DATA_URI__'
if SAMPLE_TOKEN in html:
    csv_bytes = io.open(os.path.join(HERE, 'sample.csv'), 'rb').read()
    data_uri = 'data:text/csv;charset=utf-8;base64,' + \
        base64.b64encode(csv_bytes).decode('ascii')
    html = html.replace(SAMPLE_TOKEN, data_uri)

for name in ('calc.js', 'csv.js', 'ui.js'):
    src = io.open(os.path.join(HERE, name), encoding='utf-8').read()
    # Drop the CommonJS export tail used only for node-side testing.
    src = re.sub(r"\n?if \(typeof module[\s\S]*?\n\}\n?", "\n", src)
    tag = '<script src="%s"></script>' % name
    if tag not in html:
        sys.exit('FAIL: missing %s' % tag)
    html = html.replace(tag, '<script>\n%s\n</script>' % src)

if 'script src=' in html:
    sys.exit('FAIL: an external script reference survived the build')

io.open(OUT, 'w', encoding='utf-8').write(html)
print('built %s (%d bytes)' % (os.path.basename(OUT), len(html)))
