"""Regenerate the demo exports, run the merge, compare with the expected result.

    python check_merge.py

Then runs the merge on edited copies of the demo (renamed columns, a settings
file saved by Excel, mixed and ambiguous dates) and expects either the same
result or a clear stop. Exits 1 on any mismatch. If you change the generator
or the merge on purpose, update EXPECT.
"""
import csv
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from statistics import median

HERE = Path(__file__).parent
EXPECT = {
    "rows": 34,
    "summary": "requests 40: filled 34, never posted 2, posted but not filled 4; hires without a request 3",
    # grade: (roles, median request->open, median open->start)
    "medians": {"G1": (4, 25, 39), "G2": (6, 30, 47.5), "G3": (7, 24, 57), "G4": (12, 27, 67.5), "G5": (5, 25, 108)},
}

failed = []
for script in ("make_demo_data.py", "merge_hiring_exports.py"):
    run = subprocess.run([sys.executable, str(HERE / script)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if run.returncode:
        sys.exit(f"FAIL {script}: {run.stderr.strip()}")
if EXPECT["summary"] not in run.stdout:
    failed.append(f"summary line: {run.stdout.splitlines()[0]}")

with open(HERE / "demo" / "merged.csv", encoding="utf-8") as f:
    if f.readline().strip() != "sep=,":
        failed.append("merged.csv: first line is not sep=, so Excel may show one column")
    rows = list(csv.DictReader(f))
if len(rows) != EXPECT["rows"]:
    failed.append(f"merged rows {len(rows)} != {EXPECT['rows']}")
for g, want in EXPECT["medians"].items():
    sub = [r for r in rows if r["grade"] == g]
    got = (len(sub), median(int(r["request_to_open_days"]) for r in sub), median(int(r["open_to_start_days"]) for r in sub))
    if got != want:
        failed.append(f"{g}: {got} != {want}")
for r in rows:  # every merged row must be in date order
    if not r["requested"] <= r["opened"] <= r["started"]:
        failed.append(f"requisition {r['requisition']}: dates out of order")


# Exports that differ from the demo: each case edits a copy and expects a result or a clear stop.
def merge_copy(edit_files, settings=None, settings_encoding="utf-8", sep=","):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name in ("requests.csv", "ats.csv", "hris.csv"):
            shutil.copy(HERE / "demo" / name, tmp / name)
        for name, (old, new) in edit_files.items():
            text = (tmp / name).read_text(encoding="utf-8")
            (tmp / name).write_text(text.replace(old, new), encoding="utf-8")
        if settings:  # settings.csv as Excel saves it: no sep= line, local separator and code page
            text = (HERE / "settings.csv").read_text(encoding="utf-8").split("\n", 1)[1]
            for old, new in settings.items():
                text = text.replace(old, new)
            rows = list(csv.reader(text.splitlines()))
            with open(tmp / "settings.csv", "w", encoding=settings_encoding, newline="") as f:
                csv.writer(f, delimiter=sep).writerows(rows)
        return subprocess.run([sys.executable, str(HERE / "merge_hiring_exports.py"), str(tmp)],
                              capture_output=True, text=True, stdin=subprocess.DEVNULL)


CASES = [
    ("renamed column, settings not updated: stop naming the column",
     dict(edit_files={"hris.csv": ("Hire Date", "Start Date")}), "no column 'Hire Date'"),
    ("renamed column, settings saved by Excel with ';' and a Windows code page",
     dict(edit_files={"hris.csv": ("Hire Date", "Date of entry")}, settings={",Hire Date,": ",Date of entry,"},
          settings_encoding="cp1252", sep=";"), EXPECT["summary"]),
    ("a request number used twice: warn, it would overwrite quietly",
     dict(edit_files={"requests.csv": ("\n2;08.05.2025", "\n1;08.05.2025")}), "WARNING: 1 request numbers appear more than once"),
    ("a second date format in one column: stop",
     dict(edit_files={"hris.csv": ("09/05/2025", "2025-09-05")}), "no known date format fits"),
    ("date format set by hand that does not match: stop",
     dict(edit_files={}, settings={"hris,date format,auto": "hris,date format,DD/MM/YYYY"}), "does not match DD/MM/YYYY"),
]
for name, kwargs, want in CASES:
    run = merge_copy(**kwargs)
    if want not in run.stdout + run.stderr:
        failed.append(f"{name}: {(run.stdout + run.stderr).strip()[:200]}")

# Ambiguous dates: a file where every day is 12 or less.
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    for name in ("requests.csv", "ats.csv"):
        shutil.copy(HERE / "demo" / name, tmp / name)
    (tmp / "hris.csv").write_text("Employee ID,Position Ref,Hire Date\nE-1,REQ0001,09/05/2025\nE-2,REQ0002,03/04/2025\n",
                                  encoding="utf-8")
    run = subprocess.run([sys.executable, str(HERE / "merge_hiring_exports.py"), str(tmp)], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if "tells them apart" not in run.stderr:
        failed.append(f"ambiguous dates not stopped: {(run.stdout + run.stderr).strip()[:200]}")

for line in failed:
    print("FAIL", line)
print("FAIL" if failed else "OK", f"{len(rows)} merged rows checked")
sys.exit(1 if failed else 0)
