# GAW: RE-SEARCH — Handoff

## Status: v2.5.1 shipped and launched (public)

Current version: **2.5.1**. Released to the community on 2026-07-13; adoption
thread on greatawakening.win ran clean with positive feedback and zero
technical failures.

Public repo: https://github.com/catsfive1/gaw-research-search
Latest release: https://github.com/catsfive1/gaw-research-search/releases/latest

---

## What this is

A Chrome MV3 extension that lets anyone search the full greatawakening.win
post and comment archive — instantly, with filters, without logging in.
Backed by a Cloudflare Worker + D1 database.

The extension asks for one permission (`storage`) and talks to exactly one
server (the search proxy). No content scripts, no tracking, no login. See
[`PRIVACY.md`](PRIVACY.md) for the full data-flow disclosure.

## Shipped versions

- **v2.5.1** (2026-07-13): auto update-check banner (green popup notification
  when a newer GitHub release exists), Add-a-Post microcopy improvement.
- **v2.5.0** (2026-07-13): GitHub distribution — `Check for Updates` button,
  version display in popup footer, README, RELEASE.md, publish.ps1. Security
  hardening from a three-cycle code review (sender validation, lastError
  checks, CSP `connect-src` pin, WCAG contrast fix, reduced-motion support),
  privacy policy.
- **v2.4.0** (2026-07-10): public rollout — rebrand to GAW: RE-SEARCH,
  collapsible card UI, Advanced Mode (structured boolean search with live DSL
  preview), anti-hammer hardening (client token bucket + worker rate limits),
  removed-content lockdown for public callers.
- **v2.3.x**: comment-link fix, CAT CHOIR red-team remediation (24 findings
  fixed across P0/P1/P2 tiers).

## Extension features (all shipped, tested)

1. **Full-text search** across posts and comments, with highlighting.
2. **Filters**: date range, author, score threshold, flair, minimum comment
   count, scope (posts/comments/both), sort (relevance/newest/top).
3. **Advanced Mode**: exact phrase, any-of (OR), exclude (NOT) — every value
   quoted/metachar-stripped before entering the query string.
4. **Saved searches** (star icon) + **recent searches** (chips).
5. **Add a Post** — paste a GAW link, it gets indexed.
6. **Copy results** — markdown list of current on-screen results.
7. **Auto update-check** — popup polls GitHub releases every 3 days, shows a
   green banner when a newer version exists.
8. **Copy debug info** — timings/status codes only, no secrets, for bug reports.

## Architecture

| Piece | Where |
|---|---|
| Extension source | this repo (`manifest.json`, `popup.html`, `popup.js`, `background.js`) |
| Releases | https://github.com/catsfive1/gaw-research-search/releases |
| Worker | `gaw-mod-proxy` → `https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev` |
| Database | Cloudflare D1 (gaw_posts, gaw_comments, gaw_users) |

## Tests

202 tests, all green. Hand-rolled `node:test` suite in `tests/`. Run with:

```bash
node --test tests/*.test.mjs
```

## How to ship a new version

See [`RELEASE.md`](RELEASE.md) for the maintainer workflow, or run:

```powershell
pwsh -NoProfile -File .\publish.ps1
```

…which runs the tests, builds the ZIP, commits/tags/pushes, and opens the
GitHub release page with the ZIP path on your clipboard.

## Known limitations

- Not on the Chrome Web Store — users install via "Load unpacked" from the
  GitHub Releases ZIP.
- Comment results link to the parent post's comments tab, not scrolled to the
  exact comment (a known, documented gap).
- No usage analytics (deliberate — no telemetry is collected).

## If something looks wrong

- **Extension errors:** `chrome://extensions` → GAW: RE-SEARCH → "service
  worker" link opens the background console. The popup can be inspected via
  right-click → Inspect while open.
- **User bug reports:** ask them to click "Copy debug info" in the popup
  footer and paste it with their report.
- **Operator-only runbooks** (worker deployment, indexer health, scheduled
  tasks) live in the internal operator docs, not in this public repo.

## Companion project

**GAW Awesomizer** — a separate Chrome extension that enhances GAW/PDW pages
as you browse (hover-zoom, keyboard nav, age filters). Different tool,
different privacy contract, same team.
Repo: https://github.com/catsfive1/gaw-awesomizer
