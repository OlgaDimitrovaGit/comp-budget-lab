# Recalculates the Excel model with the live engine and verifies the result.
#
# openpyxl only writes formulas. What they actually compute is shown only by
# real Excel: in the first artefact that is how a "Total" referring to itself
# and a scalar median were found. Without this step the file holds no computed
# value at all, and "agrees to the cent" is backed by nothing.
#
# It does three things:
#   1. CalculateFullRebuild + Save — values appear in the workbook;
#   2. looks for formula errors (#REF!, #VALUE!, #DIV/0! and the rest);
#   3. reconciles the totals against budget-plan-fact.csv and fails on a mismatch.

$ErrorActionPreference = "Stop"

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$book  = Join-Path $here "budget-plan-fact-model.xlsx"
$csv   = Join-Path $here "budget-plan-fact.csv"

if (-not (Test-Path $book)) { throw "No workbook at $book — run python build_model.py first" }
if (-not (Test-Path $csv))  { throw "No data at $csv — run python generate_dataset.py first" }

# --- Reference figures from the CSV ----------------------------------------
$rows = Import-Csv -Path $csv
$planYear = 0.0; $fact8 = 0.0; $plan8 = 0.0; $expYear = 0.0
foreach ($r in $rows) {
    $p = [double]$r.plan
    $planYear += $p
    if ($r.fact) {
        $plan8 += $p
        $fact8 += [double]$r.fact
        $expYear += [double]$r.fact
    } else {
        $expYear += [double]$r.forecast
    }
}
$deltaYear = $expYear - $planYear

Write-Host "Reference figures from the CSV:"
Write-Host ("  annual plan       {0,18:N2}" -f $planYear)
Write-Host ("  annual expected   {0,18:N2}" -f $expYear)
Write-Host ("  deviation         {0,18:N2}" -f $deltaYear)
Write-Host ""

# --- Recalculation ---------------------------------------------------------
Write-Host "Starting Excel and rebuilding all formulas..."
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($book)
    $excel.CalculateFullRebuild()
    $wb.Save()

    # --- Formula errors across the workbook --------------------------------
    $errors = @()
    foreach ($ws in $wb.Worksheets) {
        $used = $ws.UsedRange
        # SpecialCells(-4123, 16) — cells whose formulas evaluate to an error
        try {
            $bad = $used.SpecialCells(-4123, 16)
            if ($bad) {
                foreach ($cell in $bad) {
                    $errors += ("{0}!{1} = {2}" -f $ws.Name, $cell.Address(0,0), $cell.Text)
                }
            }
        } catch {
            # SpecialCells throws when there are no such cells — that is normal
        }
    }

    # --- Totals from the workbook ------------------------------------------
    # The addresses are read from the workbook itself (columns D/E of the Summary
    # sheet) rather than kept here as a copy: a second copy drifts as soon as a
    # row is inserted. That happened once already — the check was reading the
    # header row instead of the plan.
    $sm = $wb.Worksheets.Item("Summary")
    $map = @{}
    for ($i = 2; $i -le 12; $i++) {
        $key = $sm.Cells.Item($i, 4).Text
        $ref = $sm.Cells.Item($i, 5).Text
        if ($key -and $ref) { $map[$key] = $ref }
    }
    foreach ($need in @("plan8","fact8","yplan","yexp","ydelta","cross")) {
        if (-not $map.ContainsKey($need)) {
            throw "The workbook has no address '$need' on the Summary sheet (columns D/E). Rebuild it: python build_model.py"
        }
    }

    $bookPlan8    = [double]$sm.Range($map["plan8"]).Value2
    $bookFact8    = [double]$sm.Range($map["fact8"]).Value2
    $bookPlanYear = [double]$sm.Range($map["yplan"]).Value2
    $bookExpYear  = [double]$sm.Range($map["yexp"]).Value2
    $bookDelta    = [double]$sm.Range($map["ydelta"]).Value2
    $crossMonth   = $sm.Range($map["cross"]).Text

    $wb.Close($true)
} finally {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}

Write-Host ""
Write-Host "From the recalculated workbook:"
Write-Host ("  annual plan       {0,18:N2}" -f $bookPlanYear)
Write-Host ("  annual expected   {0,18:N2}" -f $bookExpYear)
Write-Host ("  deviation         {0,18:N2}" -f $bookDelta)
Write-Host ("  first month above plan: {0}" -f $crossMonth)
Write-Host ""

# --- Reconciliation --------------------------------------------------------
$TOL = 0.01
$failures = @()

function Check($name, $expected, $actual) {
    $diff = [math]::Abs($expected - $actual)
    if ($diff -gt $script:TOL) {
        $script:failures += ("{0}: workbook {1:N2} against reference {2:N2}, difference {3:N4}" -f $name, $actual, $expected, $diff)
    } else {
        Write-Host ("  OK  {0,-22} difference {1:N6}" -f $name, $diff)
    }
}

Write-Host "Reconciling the workbook against the CSV:"
Check "annual plan"     $planYear  $bookPlanYear
Check "annual expected" $expYear   $bookExpYear
Check "deviation"       $deltaYear $bookDelta
Check "plan 8M"         $plan8     $bookPlan8
Check "actual 8M"       $fact8     $bookFact8

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "FORMULA ERRORS:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
}

if ($failures.Count -gt 0 -or $errors.Count -gt 0) {
    Write-Host ""
    if ($failures.Count -gt 0) {
        Write-Host "MISMATCHES:" -ForegroundColor Red
        $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
    Write-Host ""
    Write-Host "CHECK FAILED." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Workbook recalculated, no formula errors, totals agree with the CSV." -ForegroundColor Green
