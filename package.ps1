<#
.SYNOPSIS
    Package the GAW Research Search extension into a distributable ZIP.
.DESCRIPTION
    Creates a versioned ZIP in D:\AI\_PROJECTS\dist\ and mirrors
    the last 2 iterations to Google Drive archive.
.PARAMETER NoPause
    Skip final Read-Host pause.
.EXAMPLE
    pwsh -NoProfile -File "D:\AI\_PROJECTS\gaw-research-search\package.ps1"
.NOTES
    This header has no version number of its own -- the number that
    matters is the extension version, read dynamically from
    manifest.json at runtime (see $version below). Do not add a
    hardcoded version here; it would drift from the extension version
    and confuse the two.
    Requires: PowerShell 5.1+
#>

[CmdletBinding()]
param(
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptRoot = $PSScriptRoot
$ManifestPath = Join-Path $ScriptRoot 'manifest.json'
$DistDir = 'D:\AI\_PROJECTS\dist'
$DistUnpacked = Join-Path $DistDir 'gaw-research-search-dist'
$LogDir = 'D:\AI\_PROJECTS\logs'
$DriveArchive = 'E:\My Drive\_PROJECTS\gaw-research-search'

$log = [System.Collections.Generic.List[string]]::new()
function Say { param($t, $c='Cyan') Write-Host $t -ForegroundColor $c; $log.Add($t) }

$script:buildFailed = $false

try {
    Say '=== GAW RESEARCH SEARCH PACKAGER ==='

    # Read version from manifest
    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    $version = $manifest.version
    Say "  Version: $version"

    $ZipName = "gaw-research-search-v${version}.zip"
    $ZipPath = Join-Path $DistDir $ZipName

    # Files to include
    $files = @(
        'manifest.json',
        'background.js',
        'popup.html',
        'popup.js',
        'icons\icon16.png',
        'icons\icon48.png',
        'icons\icon128.png'
    )

    # Verify all files exist
    $missing = @()
    foreach ($f in $files) {
        $fp = Join-Path $ScriptRoot $f
        if (-not (Test-Path $fp)) { $missing += $f }
    }
    if ($missing.Count -gt 0) {
        Say "[FATAL] Missing files: $($missing -join ', ')" Red
        $script:buildFailed = $true
        throw "Missing files: $($missing -join ', ')"
    }
    Say "  All $($files.Count) files present" Green

    # Create dist dir
    if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir -Force | Out-Null }

    # Create unpacked dist directory
    if (Test-Path $DistUnpacked) { Remove-Item $DistUnpacked -Recurse -Force }
    New-Item -ItemType Directory -Path $DistUnpacked -Force | Out-Null
    $iconsDir = Join-Path $DistUnpacked 'icons'
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null

    foreach ($f in $files) {
        $src = Join-Path $ScriptRoot $f
        $dst = Join-Path $DistUnpacked $f
        Copy-Item $src $dst -Force
    }
    Say "  Unpacked dist: $DistUnpacked" Green

    # Create ZIP
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Compress-Archive -Path (Join-Path $DistUnpacked '*') -DestinationPath $ZipPath -Force
    $zipSize = (Get-Item $ZipPath).Length
    Say "  ZIP: $ZipPath ($([math]::Round($zipSize/1024, 1)) KB)" Green

    # Mirror to Google Drive (last 2 only)
    if (Test-Path 'E:\My Drive\_PROJECTS') {
        if (-not (Test-Path $DriveArchive)) {
            New-Item -ItemType Directory -Path $DriveArchive -Force | Out-Null
        }
        Copy-Item $ZipPath (Join-Path $DriveArchive $ZipName) -Force
        $archived = Get-ChildItem $DriveArchive -Filter 'gaw-research-search-v*.zip' |
            Sort-Object LastWriteTime -Descending
        $pruned = 0
        if ($archived.Count -gt 2) {
            $archived | Select-Object -Skip 2 | ForEach-Object {
                Remove-Item $_.FullName -Force
                $pruned++
            }
        }
        Say "  [archive OK] $DriveArchive\$ZipName (pruned $pruned older)" Green
    } else {
        Say '  [archive SKIP] E:\My Drive not mounted' Yellow
    }

    Say ''
    Say '=== PACKAGE REPORT ===' Green
    Say "  Version:     $version"
    Say "  ZIP:         $ZipPath"
    Say "  Unpacked:    $DistUnpacked"
    Say "  File count:  $($files.Count)"
    Say "  ZIP size:    $([math]::Round($zipSize/1024, 1)) KB"
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
    $logFile = Join-Path $LogDir ("package-research-search-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
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
