"""Merge three hiring exports into one time-to-start table.

    python merge_hiring_exports.py [folder] [--preview]

Or put this file, settings.csv and the three exports in one folder and
double-click it: it shows what it read, asks before merging and waits
before closing the window.

Reads the manager request log, the applicant tracking (ATS) export and the
HR system export from the folder: the one given, else this script's folder if
the exports are there, else demo/. File names, column names
and date formats come from settings.csv: the one in the folder if there is
one, otherwise the one next to this script. Writes merged.csv next to the
exports and prints median days by grade.

--preview shows what the script found in each file (separator, columns,
date format, first rows) and stops before the merge.

Plain Python 3.8+, nothing to install.
"""
import csv
import io
import locale
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
preview = "--preview" in sys.argv[1:]
# Started by a double-click (Windows, no command prompt around it): the window would close at once,
# so show what was read, ask before merging and wait before closing.
clicked = os.name == "nt" and "PROMPT" not in os.environ and sys.stdin.isatty() and sys.stdout.isatty() and not sys.argv[1:]
exports_here = len([p for p in HERE.glob("*.csv") if p.name.lower() not in ("settings.csv", "merged.csv")]) >= 3
folder = Path(args[0]) if args else HERE if exports_here else HERE / "demo"


def close(code=0):
    if clicked:
        input("\nPress Enter to close this window.")
    sys.exit(code)

# Date formats tried when settings.csv says "auto", written the way settings.csv takes them.
KNOWN_DATES = [
    "DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", "YYYY/MM/DD",
    "DD.MM.YYYY hh:mm", "DD.MM.YYYY hh:mm:ss", "DD/MM/YYYY hh:mm", "MM/DD/YYYY hh:mm",
    "YYYY-MM-DD hh:mm", "YYYY-MM-DD hh:mm:ss", "YYYY-MM-DDThh:mm:ss", "YYYY-MM-DDThh:mm:ssZ",
]
TOKENS = {"YYYY": "%Y", "YY": "%y", "MM": "%m", "DD": "%d", "hh": "%H", "mm": "%M", "ss": "%S"}


def fail(message):
    print("STOP: " + message, file=sys.stderr)
    close(1)


def read_table(path):
    """Text of a CSV saved by any tool: UTF-8 or the Windows code page, any separator."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
        encoding = "UTF-8"
    except UnicodeDecodeError:
        encoding = locale.getpreferredencoding(False)
        text = raw.decode(encoding, errors="replace")
    lines = io.StringIO(text)
    first = lines.readline()
    if first.lower().startswith("sep="):  # Excel's hint line
        sep = first.strip()[4:] or ","
    else:
        sep = max(";,\t", key=first.count)
        lines.seek(0)
    rows = list(csv.reader(lines, delimiter=sep))
    return encoding, sep, rows


def load_settings():
    path = folder / "settings.csv"
    if not path.exists():
        path = HERE / "settings.csv"
    if not path.exists():
        fail(f"settings.csv not found in {folder} or {HERE}.")
    rows = read_table(path)[2][1:]  # first three columns: export, setting, your value
    return path, {(r[0].strip(), r[1].strip()): r[2].strip() for r in rows if len(r) >= 3 and r[0].strip()}


settings_path, SETTINGS = load_settings()


def setting(export, name):
    value = SETTINGS.get((export, name))
    if not value:
        fail(f"settings.csv has no value for ({export}, {name}).")
    return value


def to_python(fmt):
    return re.sub("|".join(TOKENS), lambda m: TOKENS[m.group()], fmt)


def fits(value, fmt):
    try:
        datetime.strptime(value, to_python(fmt))
        return True
    except ValueError:
        return False


class Export:
    """One export file read through its block of settings.csv."""

    def __init__(self, export, fields, date_field):
        self.export = export
        self.name = setting(export, "file")
        path = folder / self.name
        if not path.exists():
            fail(f"{self.name} not found in {folder}. Put the export there or change its name in settings.csv ({export}, file).")
        self.encoding, self.sep, table = read_table(path)
        if not table:
            fail(f"{self.name} is empty.")
        header = [h.strip() for h in table[0]]
        self.columns = {f: self.find(f, header) for f in fields}
        self.rows = [{f: (r[i].strip() if i < len(r) else "") for f, i in self.columns.items()}
                     for r in table[1:] if any(c.strip() for c in r)]
        self.date_field = date_field
        self.date_format = self.find_date_format()

    def find(self, field, header):
        want = setting(self.export, field)
        for i, h in enumerate(header):
            if h.lower() == want.lower():
                return i
        fail(f"{self.name}: no column '{want}' ({field}). Columns in the file: {', '.join(header)}. "
             f"Write the right one in settings.csv ({self.export}, {field}).")

    def find_date_format(self):
        values = [r[self.date_field] for r in self.rows if r[self.date_field]]
        column = setting(self.export, self.date_field)
        given = setting(self.export, "date format")
        if not values:
            fail(f"{self.name}, column '{column}': no dates at all.")
        if given.lower() != "auto":
            bad = [v for v in values if not fits(v, given)]
            if bad:
                fail(f"{self.name}, column '{column}': '{bad[0]}' does not match {given} set in settings.csv. "
                     f"Correct the format there, or write auto.")
            return given
        found = [f for f in KNOWN_DATES if all(fits(v, f) for v in values)]
        if not found:
            fail(f"{self.name}, column '{column}': no known date format fits every value, e.g. '{values[0]}'. "
                 f"Write the format in settings.csv ({self.export}, date format), e.g. DD.MM.YYYY.")
        if len(found) > 1:
            fail(f"{self.name}, column '{column}': the dates fit both {' and '.join(found)}, "
                 f"no day above 12 tells them apart. Write the right one in settings.csv ({self.export}, date format).")
        return found[0]

    def day(self, row):
        raw = row[self.date_field]
        return datetime.strptime(raw, to_python(self.date_format)).date() if raw else None


def key(raw):
    """'REQ-0042', 'req0042 ', '42', 'Grade 4' -> '42' / '4'; no digits -> None."""
    digits = re.sub(r"\D", "", raw or "")
    return str(int(digits)) if digits else None


def grade(raw):
    k = key(raw)
    return "G" + k if k else (raw or "no grade")


requests_x = Export("requests", ["request number", "request date", "grade", "department"], "request date")
ats_x = Export("ats", ["requisition number", "posting date"], "posting date")
hris_x = Export("hris", ["employee id", "requisition number", "start date"], "start date")

if preview or clicked:
    print(f"folder: {folder}\nsettings: {settings_path}")
    for x in (requests_x, ats_x, hris_x):
        sep = {"\t": "tab"}.get(x.sep, x.sep)
        print(f"\n{x.name}: {len(x.rows)} rows, {x.encoding}, separator '{sep}', dates {x.date_format}")
        for field, i in x.columns.items():
            print(f"  {field:<20} <- column {i + 1} '{setting(x.export, field)}'")
        for r in x.rows[:3]:
            keys = {f: key(r[f]) for f in ("request number", "requisition number") if f in r}
            print(f"  e.g. {r} -> number {next(iter(keys.values()))}, date {x.day(r)}")
    if preview:
        close(0)
    input("\nIf the columns and dates above are right, press Enter to merge. If not, close the window "
          "and correct settings.csv.")
    print()

skipped = {"requests": 0, "ats": 0, "hris": 0}
requests, repeated = {}, set()
for r in requests_x.rows:
    k, d = key(r["request number"]), requests_x.day(r)
    if k and d:
        if k in requests:
            repeated.add(k)
        requests[k] = (r, d)
    else:
        skipped["requests"] += 1
opened = {}
for r in ats_x.rows:  # one row per candidate: keep the posting date
    k, d = key(r["requisition number"]), ats_x.day(r)
    if k and d:
        opened[k] = min(opened.get(k, d), d)
    else:
        skipped["ats"] += 1
started, no_request = {}, set()
for r in hris_x.rows:  # repeated records collapse to the earliest start
    k, d = key(r["requisition number"]), hris_x.day(r)
    if not d:
        skipped["hris"] += 1
    elif k in requests:
        started[k] = min(started.get(k, d), d)
    else:
        no_request.add(r["employee id"])

FIELDS = ["requisition", "grade", "department", "requested", "opened", "started",
          "request_to_open_days", "open_to_start_days"]
rows = []
for k, (r, requested) in requests.items():
    if k in opened and k in started:
        rows.append(dict(zip(FIELDS, [
            k, grade(r["grade"]), r["department"], requested, opened[k], started[k],
            (opened[k] - requested).days, (started[k] - opened[k]).days])))

with open(folder / "merged.csv", "w", encoding="utf-8", newline="") as f:
    f.write("sep=,\r\n")  # tells Excel the separator, so columns split where the list separator is ';'
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)

print(f"requests {len(requests)}: filled {len(rows)}, never posted {len(requests.keys() - opened.keys())}, "
      f"posted but not filled {len(opened.keys() - started.keys())}; hires without a request {len(no_request)}")
if repeated:
    print(f"WARNING: {len(repeated)} request numbers appear more than once in {requests_x.name}, only the last row "
          f"of each is used: {', '.join(sorted(repeated, key=int)[:10])}. If numbers are reused across years, "
          f"see the README.")
if any(skipped.values()):
    print("rows left out for an empty number or date: " + ", ".join(f"{n} {c}" for n, c in skipped.items() if c))
print("grade  roles  median request->open  median open->start (days)")
for g in sorted({r["grade"] for r in rows}):
    sub = [r for r in rows if r["grade"] == g]
    print(f"{g:<6} {len(sub):>5}  {median(r['request_to_open_days'] for r in sub):>20.0f}"
          f"  {median(r['open_to_start_days'] for r in sub):>19.0f}")
print(f"\nThe merged table is in {folder / 'merged.csv'}")
close(0)
