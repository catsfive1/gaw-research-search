<#
.SYNOPSIS
    Export a clean, shareable source ZIP of GAW Research Search for external code review.
.DESCRIPTION
    Copies only the real runtime source files (manifest.json, background.js,
    popup.html/js/css, icons\) plus reviewer-relevant docs (HANDOFF.md,
    README.md if present) into a scratch folder, then zips that folder.
    Explicitly excludes .git, .claude, node_modules, dist\, logs\, and any
    *.zip files already sitting in the project directory. This exists
    because a past source ZIP shared for review accidentally included the
    full .git history/metadata, which can leak more than intended.
.PARAMETER NoPause
    Skip final Read-Host pause.
.EXAMPLE
    pwsh -NoProfile -File "D:\AI\_PROJECTS\gaw-research-search\export-clean-source.ps1"
.NOTES
    This header has no version number of its own -- see package.ps1's
    header for why (extension version drift). Requires: PowerShell 5.1+
#>

[CmdletBinding()]
param(
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptRoot = $PSScriptRoot
$DistDir = 'D:\AI\_PROJECTS\dist'
$ZipPath = Join-Path $DistDir 'gaw-research-search-SOURCE-REVIEW.zip'
$StageDir = Join-Path $env:TEMP 'gaw-research-search-source-review-stage'
$LogDir = 'D:\AI\_PROJECTS\logs'

$log = [System.Collections.Generic.List[string]]::new()
function Say { param($t, $c='Cyan') Write-Host $t -ForegroundColor $c; $log.Add($t) }

$script:buildFailed = $false

try {
    Say '=== GAW RESEARCH SEARCH -- CLEAN SOURCE EXPORT ==='

    # Required runtime source files (mirrors package.ps1's own file list)
    $requiredFiles = @(
        'manifest.json',
        'background.js',
        'popup.html',
        'popup.js',
        'icons\icon16.png',
        'icons\icon48.png',
        'icons\icon128.png'
    )

    # Optional files -- included only if present, never fatal if missing
    $optionalFiles = @(
        'popup.css',
        'HANDOFF.md',
        'README.md'
    )

    # Verify required files exist
    $missing = @()
    foreach ($f in $requiredFiles) {
        $fp = Join-Path $ScriptRoot $f
        if (-not (Test-Path $fp)) { $missing += $f }
    }
    if ($missing.Count -gt 0) {
        Say "[FATAL] Missing required files: $($missing -join ', ')" Red
        $script:buildFailed = $true
        throw "Missing required files: $($missing -join ', ')"
    }
    Say "  All $($requiredFiles.Count) required files present" Green

    $includeFiles = @($requiredFiles)
    foreach ($f in $optionalFiles) {
        $fp = Join-Path $ScriptRoot $f
        if (Test-Path $fp) {
            $includeFiles += $f
            Say "  Including optional: $f" Green
        } else {
            Say "  Skipping optional (not present): $f" DarkGray
        }
    }

    # Explicit exclusion reminder (nothing below is ever added to $includeFiles):
    #   .git\, .claude\, node_modules\, dist\, logs\, *.zip
    Say '  Excluded by design: .git, .claude, node_modules, dist, logs, *.zip'

    # Fresh staging directory
    if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
    New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $StageDir 'icons') -Force | Out-Null

    foreach ($f in $includeFiles) {
        $src = Join-Path $ScriptRoot $f
        $dst = Join-Path $StageDir $f
        Copy-Item $src $dst -Force
    }
    Say "  Staged: $StageDir" Green

    # Create dist dir + ZIP
    if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir -Force | Out-Null }
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Compress-Archive -Path (Join-Path $StageDir '*') -DestinationPath $ZipPath -Force
    $zipSize = (Get-Item $ZipPath).Length
    Say "  ZIP: $ZipPath ($([math]::Round($zipSize/1024, 1)) KB)" Green

    # Clean up staging directory (no leftover machine-specific temp copy)
    Remove-Item $StageDir -Recurse -Force

    Say ''
    Say '=== EXPORT REPORT ===' Green
    Say "  ZIP:         $ZipPath"
    Say "  File count:  $($includeFiles.Count)"
    Say "  ZIP size:    $([math]::Round($zipSize/1024, 1)) KB"
    Say "  Excluded:    .git, .claude, node_modules, dist, logs, *.zip"
    Say '======================' Green
}
catch {
    $script:buildFailed = $true
    Say "FAILED: $($_.Exception.Message)" Red
    Say "  at: $($_.InvocationInfo.PositionMessage)" DarkGray
}
finally {
    # Save log
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $logFile = Join-Path $LogDir ("export-clean-source-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $log -join "`r`n" | Out-File -FilePath $logFile -Encoding utf8
    Say "  Log: $logFile"

    # Copy full debug log to clipboard
    $log -join "`r`n" | Set-Clipboard
    Say '[FULL DEBUG LOG COPIED TO CLIPBOARD]' Green

    # E-C-G beep
    [Console]::Beep(659, 160)
    Start-Sleep -Milliseconds 100
    [Console]::Beep(523, 160)
    Start-Sleep -Milliseconds 100
    [Console]::Beep(784, 800)

    # Pause
    if (-not $NoPause) { Read-Host 'Press Enter to exit' }
}

if ($script:buildFailed) { exit 1 } else { exit 0 }
