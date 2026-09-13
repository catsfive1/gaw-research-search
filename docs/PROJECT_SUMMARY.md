# PROJECT SUMMARY — GAW: RE-SEARCH (gaw-research-search)

**Repo:** https://github.com/catsfive1/gaw-research-search (public)
**Branch:** `master` · **Version:** 2.5.1 (manifest.json) · **Status: active**
HEAD at time of writing: `f18c0fe` (a `docs:` commit for this file follows).

## Purpose / users

Chrome (MV3) extension that lets anyone keyword-search the full greatawakening.win
archive — 130,000+ posts and comments — from the browser toolbar, with filters and
boolean operators. No login, no tracking, no analytics. Users are greatawakening.win
community members (distributed via GitHub Releases; announcement threads on GAW).

## Stack / runtime

- Plain JavaScript (MV3): service worker (`background.js`) + popup (`popup.html/css/js`).
- No build step, no bundler, no npm dependencies. Manifest V3, `minimum_chrome_version` 116.
- Single permission: `storage`. Zero content scripts.
- Backend: `gaw-mod-proxy` Cloudflare Worker (`https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev`)
  fronting a D1 database (separate repo, private). Update checks hit `api.github.com`.
- Tests: Node built-in `node:test` + `node:assert/strict` (Node 24 confirmed; no framework).
- Packaging/publish: PowerShell (`package.ps1`, `publish.ps1`, `export-clean-source.ps1`).

## What the code does

- `manifest.json` — MV3 manifest; CSP pins `connect-src` to the Worker + `api.github.com`.
- `popup.js` (~50 KB) — the entire UI: search input, filters card (date presets, author,
  score, flair, comment count, scope, sort), Advanced Mode (exact-phrase / any-of /
  exclude with live compiled-query preview), saved searches (★) and recent-search chips
  (chrome.storage), copy-results-to-clipboard, "Add a Post" (index a GAW link on the spot),
  REMOVED badges for removed/deleted posts, rate-limit countdown UI, update-check banner
  against GitHub Releases, copy-debug-info footer.
- `background.js` — service worker: `WORKER_BASE` proxy calls (search, add-a-post),
  message validation, anti-hammer client token bucket.
- `preview/` — `build-preview.mjs` + `chrome-mock.js` build a static `preview/index.html`
  demo of the popup (generated artifact is gitignored).
- `tests/` — 13 test files exercising the REAL production source text (balanced-brace
  extraction via `tests/_extract.mjs`, fake-DOM `vm` sandbox) — see `tests/README.md`.

### Data flow

popup.js → `chrome.runtime.sendMessage` → background.js → HTTPS GET `gaw-mod-proxy`
Worker → D1 archive → JSON results → popup renders cards. Update check: popup.js →
`api.github.com/repos/catsfive1/gaw-research-search/releases/latest`. Only the search
query ever leaves the machine (see `PRIVACY.md`).

## How to run / test / ship

- **Load (dev):** `chrome://extensions` → Developer mode → Load unpacked → this folder.
- **Tests:** `node --test tests/` (or run individual `tests/*.test.mjs`).
- **Package:** `pwsh -NoProfile -File .\package.ps1` → release ZIP.
- **Publish:** `pwsh -NoProfile -File .\publish.ps1` (see `RELEASE.md`).

## Documentation index

- `README.md` — user-facing: install, update, usage tips, troubleshooting, privacy.
- `PRIVACY.md` — full data-flow / privacy policy.
- `RELEASE.md` — maintainer release workflow.
- `HANDOFF.md` — internal engineering handoff (status, shipped versions, decisions).
- `BUILD-SPEC-v2.4.0.md` — v2.4.0 build spec.
- `MOD-TESTING-ANNOUNCEMENT.md` — community announcement copy.
- `tests/README.md` — test-suite design notes.
- `docs/PROJECT_SUMMARY.md` — this file.

## Recent work (git log, newest first)

- `f18c0fe` / `85d89b0` chore: ignore local agent/editor state dirs (2026-09-13)
- `7bcf84c` chore: untrack `.claude/launch.json` (OPSEC finding)
- `144e0da` docs(HANDOFF): scrub FIREHOSE + operational detail from public repo
- `2242a27` docs: power-user section (keyboard shortcut + git clone install)
- `67db759` v2.5.1: auto update-check banner + Add-a-Post microcopy
- `18a2fc1` v2.5.0: GitHub distribution + security/UI hardening (3-cycle review)
- `b86b803` v2.4.0: public rollout — rebrand, card UI, Advanced Mode, anti-hammer

## Key files

`manifest.json`, `popup.js`, `popup.html`, `popup.css`, `background.js`,
`tests/` (13 files), `package.ps1`, `publish.ps1`, `icons/`.

## Known gaps / TODOs

- No auto-update for unpacked installs (Chrome limitation; "Check for Updates" button +
  update-check banner mitigate).
- Firefox not supported (Chromium-only by design).
- Backend Worker/D1 live in separate private repos (`gaw-mod-proxy`, indexer).
