<#
.SYNOPSIS
    One-click release publisher for GAW: RE-SEARCH.
.DESCRIPTION
    Runs the full release pipeline:
      1. Reads the version from manifest.json
      2. Runs the test suite (aborts on failure)
      3. Builds the distributable ZIP via package.ps1
      4. Commits + tags + pushes to origin master
      5. Opens the GitHub "new release" page with the tag pre-filled
      6. Copies the ZIP path to clipboard for easy attach
    After it finishes, the only manual step is attaching the ZIP to the
    GitHub release and clicking Publish.
.PARAMETER Message
    Commit message / release description. If omitted, prompts for one.
.PARAMETER NoCommit
    Build the ZIP and open the release page, but don't commit/tag/push.
    Useful if you want to inspect the ZIP before committing.
.PARAMETER NoPause
    Skip final Read-Host pause.
.EXAMPLE
    pwsh -NoProfile -File .\publish.ps1 -Message "v2.5.1: fix search timeout"
.EXAMPLE
    pwsh -NoProfile -File .\publish.ps1 -NoCommit
.NOTES
    Requires: PowerShell 5.1+, Node.js (for tests), git, the package.ps1
    script in the same folder. The version is the single source of truth in
    manifest.json — bump it there BEFORE running this script.
#>

[CmdletBinding()]
param(
    [string]$Message,
    [switch]$NoCommit,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$ScriptRoot = $PSScriptRoot
$ManifestPath = Join-Path $ScriptRoot 'manifest.json'
$PackageScript = Join-Path $ScriptRoot 'package.ps1'
$LogDir = 'D:\AI\_PROJECTS\logs'

$log = [System.Collections.Generic.List[string]]::new()
function Say { param($t, $c='Cyan') Write-Host $t -ForegroundColor $c; $log.Add($t) }

$script:failed = $false

try {
    Say '=== GAW: RE-SEARCH RELEASE PUBLISHER ==='
    Say ''

    # ── 1. Read version ──
    if (-not (Test-Path $ManifestPath)) { throw "manifest.json not found at $ManifestPath" }
    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    $version = $manifest.version
    $tag = "v$version"
    Say "  Version:  $version"
    Say "  Tag:      $tag"
    Say ''

    # ── 2. Run tests ──
    Say '── Step 1/5: Running test suite ──' Yellow
    Push-Location $ScriptRoot
    try {
        $testOut = & node --test 'tests/*.test.mjs' 2>&1 | Out-String
        $testPass = ($testOut -match '# pass\s+\d+') -and ($testOut -match '# fail\s+0')
        $passLine = ($testOut -split "`n" | Where-Object { $_ -match '# pass' } | Select-Object -First 1)
        $failLine = ($testOut -split "`n" | Where-Object { $_ -match '# fail' } | Select-Object -First 1)
        if ($testPass) {
            Say "  $passLine".Trim()  Green
            Say "  $failLine".Trim()  Green
            Say '  Tests PASSED' Green
        } else {
            Say '  Tests FAILED — aborting release' Red
            Say $testOut DarkGray
            $script:failed = $true
            throw "Tests failed"
        }
    } finally {
        Pop-Location
    }
    Say ''

    # ── 3. Build the ZIP ──
    Say '── Step 2/5: Building distributable ZIP ──' Yellow
    if (-not (Test-Path $PackageScript)) { throw "package.ps1 not found at $PackageScript" }
    & pwsh -NoProfile -File $PackageScript -NoPause
    if ($LASTEXITCODE -ne 0) { throw "package.ps1 exited with code $LASTEXITCODE" }
    $ZipPath = "D:\AI\_PROJECTS\dist\gaw-research-search-v$version.zip"
    if (-not (Test-Path $ZipPath)) { throw "Expected ZIP not found: $ZipPath" }
    $zipSize = [math]::Round((Get-Item $ZipPath).Length / 1024, 1)
    Say "  ZIP built: $ZipPath ($zipSize KB)" Green
    Say ''

    # ── 4. Commit + tag + push (unless -NoCommit) ──
    if ($NoCommit) {
        Say '── Step 3/5: SKIPPED (-NoCommit) ──' Yellow
    } else {
        Say '── Step 3/5: Commit + tag + push ──' Yellow
        if (-not $Message) {
            $Message = Read-Host "  Enter commit/release message (e.g. '$tag: fix search timeout')"
        }
        if ([string]::IsNullOrWhiteSpace($Message)) {
            $Message = "$tag release"
        }
        git add -A 2>&1 | ForEach-Object { Say "    $_" DarkGray }
        git commit -m $Message 2>&1 | ForEach-Object { Say "    $_" DarkGray }
        # Tag (force not used — if tag exists, user must resolve manually)
        git tag $tag 2>&1 | ForEach-Object { Say "    $_" DarkGray }
        git push origin master --tags 2>&1 | ForEach-Object { Say "    $_" DarkGray }
        Say "  Committed, tagged $tag, and pushed" Green
    }
    Say ''

    # ── 5. Open the GitHub release page ──
    Say '── Step 4/5: Opening GitHub release page ──' Yellow
    $releaseUrl = "https://github.com/catsfive1/gaw-research-search/releases/new?tag=$tag"
    Say "  URL: $releaseUrl"
    try {
        Start-Process $releaseUrl
        Say '  Browser opened' Green
    } catch {
        Say "  Could not open browser automatically — open this URL manually: $releaseUrl" Yellow
    }
    Say ''

    # ── 6. Copy ZIP path to clipboard ──
    Say '── Step 5/5: ZIP path copied to clipboard ──' Yellow
    Set-Clipboard -Value $ZipPath
    Say "  $ZipPath"
    Say '  (paste into the GitHub release "Attach binaries" box)' Green
    Say ''

    Say '=== RELEASE PUBLISHER REPORT ===' Green
    Say "  Version:   $version"
    Say "  Tag:       $tag"
    Say "  ZIP:       $ZipPath ($zipSize KB)"
    if (-not $NoCommit) { Say "  Pushed:    origin master + tag $tag" }
    Say "  Release:   $releaseUrl"
    if ($NoCommit) { Say "  NOTE:      -NoCommit was set; commit/tag/push was skipped" Yellow }
    Say '  NEXT:      Attach the ZIP to the GitHub release and click Publish.' Cyan
    Say '===============================' Green
}
catch {
    $script:failed = $true
    Say "FAILED: $($_.Exception.Message)" Red
    if ($_.InvocationInfo.PositionMessage) { Say "  at: $($_.InvocationInfo.PositionMessage)" DarkGray }
}
finally {
    # Save log
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $logFile = Join-Path $LogDir ("publish-research-search-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $log -join "`r`n" | Out-File -FilePath $logFile -Encoding utf8
    Say "  Log: $logFile"

    # Copy full debug log to clipboard (overrides the ZIP path — debug log owns clipboard per convention)
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

if ($script:failed) { exit 1 } else { exit 0 }
