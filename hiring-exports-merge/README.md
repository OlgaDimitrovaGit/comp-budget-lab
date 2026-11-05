# Hiring exports merge

A workforce budget needs time to start by grade: days from a posted vacancy to
the new hire's first day, not to the accepted offer (time to fill), because pay
starts on day one. The three places that hold it rarely agree. The manager request log knows when a role was
asked for, the applicant tracking system (ATS) knows when the vacancy was
posted, the HR system knows when the person started. Each writes dates and
requisition numbers its own way.

`merge_hiring_exports.py` joins them into one row per filled requisition and
prints the median days by grade, for the two steps a budget plan uses:
request to posting, and posting to start date.

## Run it

Python 3.8 or later, standard library only, nothing to install.

The simplest way, on Windows: make a folder and put five files in it: the
three exports (as CSV), `merge_hiring_exports.py` and a copy of
`settings.csv` filled in as described below. Double-click
`merge_hiring_exports.py`. A window shows how each file was read; press Enter
to merge. The summary appears in the same window and `merged.csv` in the folder.

From a command prompt opened in the script's folder:

```
python merge_hiring_exports.py            # the demo files in demo/
python merge_hiring_exports.py my_exports # your own folder
```

On the demo data:

```
requests 40: filled 34, never posted 2, posted but not filled 4; hires without a request 3
grade  roles  median request->open  median open->start (days)
G1         4                    25                   39
G2         6                    30                   48
G3         7                    24                   57
G4        12                    27                   68
G5         5                    25                  108
```

The merged table is written to `merged.csv` in the same folder. Its first
line, `sep=,`, tells Excel the separator, so the columns split even where
Excel expects a semicolon. Other tools read it as a row: skip it there
(`pandas.read_csv(..., skiprows=1)`).

## What it fixes

| Problem in the exports | What the script does |
|---|---|
| Requisition written as `REQ-0042`, `req0042 `, `REQ0042`, `42` | keeps the digits only, so all four match |
| Grade written as `G4`, `4`, `Grade 4` | same rule, read as `G4` |
| Dates as `18.06.2025`, `2025-07-15T09:00:00Z`, `09/05/2025` | finds the one format each file uses, stops if day and month can't be told apart |
| Column headers differ from system to system | you write yours in `settings.csv` |
| ATS keeps one row per candidate | the earliest posting date per requisition |
| HR system exports some records twice | the earliest start date per requisition |
| Requests never posted, vacancies still open, hires without a request | counted and reported, left out of the medians |

Keeping the digits only assumes the number is the whole key. If your systems
add a year (`REQ-2025-0042` becomes `20250042`) or reuse numbers across
years, change `key()` in the script. A number that appears twice in the
request log prints a warning: only its last row is used. A requisition for several roles keeps
its earliest start date only.

## Your own exports

The script reads CSV only: an export in .xlsx is saved from Excel with
File > Save As > CSV.

You don't edit the script. Open `settings.csv` in Excel and write, in the
`your value` column, what your files are called and how their columns are
headed. Case and extra spaces in headers don't matter. Save it as CSV next to
the script, or put a copy in the folder with your exports: a `settings.csv`
there is used first.

Date formats are found by the script when the setting says `auto`: it tries
the common formats and keeps the one that fits every date in the column. If
none fits, or if `09/05/2025` could be either 9 May or 5 September because no
day in the column is above 12, it stops and asks you to write the format, for
example `DD.MM.YYYY` or `MM/DD/YYYY`. The separator (comma, semicolon or tab)
and the file encoding are detected too.

Before the first real run, check what the script found:

```
python merge_hiring_exports.py my_exports --preview
```

It prints, for each file, the separator, which column it took for each field,
the date format and the first three rows as the script reads them. If a column
or a format is wrong, the script stops and names the setting to change.

A median on four or five roles is a rough figure. Use two years of history
where you have it, and check grades with few roles by hand.

## Demo data

The three files in `demo/` are simulated, not real people. The time to start
behind them (35, 45, 55, 70 and 90 days for G1 to G5, about a month from
request to posting) is illustrative, not a market figure. Run the script on
them first: you should get the summary shown above.

## Licence

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as the rest of this
repository.
