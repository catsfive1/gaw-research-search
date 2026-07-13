# Releasing a new version — Maintainer Guide

This is the one-click workflow for publishing a new GAW: RE-SEARCH version to
GitHub. The whole thing takes about 90 seconds.

---

## Quick version (the script does everything)

From the project root, run:

```powershell
pwsh -NoProfile -File .\publish.ps1
```

That script will:
1. Read the current version from `manifest.json`
2. Run the test suite (aborts if anything fails)
3. Build the distributable ZIP via `package.ps1`
4. Commit the version bump + tag it
5. Push to `origin master` with the tag
6. Open the browser at the "create new release" page with the tag pre-filled
7. Copy the ZIP path to your clipboard

You then just **attach the ZIP** to the GitHub release and click publish.

For full control (doing it manually), follow the steps below.

---

## Manual version (step by step)

### 1. Bump the version

Edit `manifest.json` and bump the `"version"` field:

- **Patch** (bug fix): `2.5.0` → `2.5.1`
- **Minor** (new feature): `2.5.0` → `2.6.0`
- **Major** (breaking change): `2.5.0` → `3.0.0`

Use [semver](https://semver.org/). The version in `manifest.json` is the
single source of truth — the popup footer reads it automatically.

### 2. Run tests

```powershell
node --test tests\*.test.mjs
```

All 202 tests must pass before shipping. If any fail, fix them first.

### 3. Build the ZIP

```powershell
pwsh -NoProfile -File .\package.ps1
```

This creates `D:\AI\_PROJECTS\dist\gaw-research-search-vX.X.X.zip` and mirrors
it to Google Drive (last 2 kept).

### 4. Commit + tag + push

```powershell
git add -A
git commit -m "v2.5.1: short description of what changed"
git tag v2.5.1
git push origin master --tags
```

### 5. Create the GitHub Release

1. Go to: https://github.com/catsfive1/gaw-research-search/releases/new
2. **Choose a tag** → select the tag you just pushed (e.g. `v2.5.1`)
3. **Release title** → `v2.5.1` (or a friendly name like `v2.5.1 — bug fixes`)
4. **Description** → copy the bullet points from your commit message
5. **Attach binaries** → drag in `D:\AI\_PROJECTS\dist\gaw-research-search-vX.X.X.zip`
6. Click **Publish release**

Users clicking "Check for Updates" in the extension popup land on this page.

---

## What users do to get the update

Nothing automatic — Chrome can't auto-update "Load unpacked" extensions.
Users click **Check for Updates** in the popup footer, see the new release,
download the new ZIP, and either:

- **Reload** (if they overwrite the files in their unpacked folder), or
- **Remove + Load unpacked** (if they use a new folder)

Both paths are documented in `README.md` → "How to update."

---

## Files that matter for releases

| File | Purpose |
|------|---------|
| `manifest.json` → `"version"` | Source of truth for the version number |
| `package.ps1` | Builds the distributable ZIP |
| `publish.ps1` | One-click: test + build + commit + tag + push + open release |
| `README.md` | User-facing install/update instructions |
| `PRIVACY.md` | Privacy policy (update if data flows change) |
