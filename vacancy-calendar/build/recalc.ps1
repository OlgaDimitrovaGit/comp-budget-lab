# Recalculates the workbook with real Excel and lists formula errors.
# openpyxl only writes formulas: without this step the file holds no computed value.
#   powershell -File recalc.ps1 [workbook.xlsx]
# Exit 1 if any formula evaluates to an error. check_model.py then compares the figures.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$book = if ($args.Count -gt 0) { (Resolve-Path $args[0]).Path } else { Join-Path (Split-Path -Parent $here) "vacancy-calendar-model.xlsx" }
if (-not (Test-Path $book)) { throw "No workbook at ${book}: run python build_model.py first" }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$errors = @()
try {
    $wb = $excel.Workbooks.Open($book)
    $excel.CalculateFullRebuild()
    foreach ($ws in $wb.Worksheets) {
        try {
            $bad = $ws.UsedRange.SpecialCells(-4123, 16)
            foreach ($cell in $bad) { $errors += ("{0}!{1} = {2}" -f $ws.Name, $cell.Address(0, 0), $cell.Text) }
        } catch { }  # SpecialCells throws when there are no such cells
    }
    $wb.Save()
    $wb.Close($true)
} finally {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}

# Excel writes the folder it saved from into xl/workbook.xml (x15ac:absPath): strip it.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($book, "Update")
try {
    $entry = $zip.GetEntry("xl/workbook.xml")
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $clean = [regex]::Replace($xml, '<mc:AlternateContent[^>]*>\s*<mc:Choice Requires="x15(ac)?">\s*<x15ac:absPath[^>]*/>\s*</mc:Choice>\s*</mc:AlternateContent>', '')
    $clean = [regex]::Replace($clean, '<x15ac:absPath[^>]*/>', '')
    if ($clean -ne $xml) {
        $entry.Delete()
        $writer = New-Object System.IO.StreamWriter($zip.CreateEntry("xl/workbook.xml").Open(), (New-Object System.Text.UTF8Encoding($false)))
        $writer.Write($clean)
        $writer.Close()
    }
} finally { $zip.Dispose() }

if ($errors.Count -gt 0) {
    Write-Host ("FORMULA ERRORS: {0}" -f $errors.Count)
    $errors | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-Host "Recalculated with Excel, no formula errors: $book"
