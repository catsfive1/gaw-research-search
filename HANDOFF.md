# GAW Research Search — Handoff (2026-07-09)

## Status: ready for mod testing

Everything below is verified working as of this handoff, not just "should work."

## v2.3.1 update (2026-07-09): fixed comment links going to the GAW homepage

Mod playtest feedback: clicking a comment result took mods to greatawakening.win's
bare front/"new" page instead of the post their comment was in. Root cause:
`buildGawUrl()` in popup.js only ever checked for `item.slug` — comment rows never
have one (only the parent post does), so every comment link silently fell through
to the bare-domain fallback.

The fix required live-verifying greatawakening.win before shipping, not just
pattern-matching existing code: an internal mod-only search page elsewhere in the
Worker has a `gawUrl()` helper that assumes `/p/<raw-numeric-id>` and
`/p/<slug>/x/c/<raw-numeric-comment-id>` both work as URLs. Neither does — both
500 live, confirmed via curl. The site's real per-comment permalink segment is an
opaque encoded slug (e.g. `4ed43EW5Efx`) this codebase has never captured; only
the numeric comment id is stored. Shipped fix: the Worker's `/gaw/search` comment
query now LEFT JOINs `gaw_posts` to attach the parent post's `slug`, and
`buildGawUrl()` uses it to link to `/p/<slug>/x/c/` — the post's comments tab,
confirmed 200 live. This lands mods on the actual post containing their comment
(not scrolled to the exact comment — that would need the crawler to capture the
real permalink slug, a larger change with no backfill path for the 100K+ already-
indexed comments) — but it's a real, working page, not a broken or homepage link.
7 new regression tests in `tests/gaw-url.test.mjs` lock in both the fix and the
two now-confirmed-broken URL shapes so they can't be reintroduced.

## v2.3.0 update (2026-07-08): CAT CHOIR red-team remediation

A full adversarial code review (manifest, background.js, popup.js, popup.html,
package.ps1) came back with 24 findings across 5 P0 (release blockers), 9 P1
(reliability), and 7 P2 (polish) items, plus a 10-item Worker-side risk
register. All 24 client-side findings were fixed and then independently
re-verified against the actual code on disk (not self-certified by whoever
implemented the fix) — the one gap that survived first-pass verification
(`lastQuery` restore bypassing sanitization) was fixed and re-verified closed.
Two real Worker-side gaps were also fixed and deployed: the `/gaw/submit-url`
outbound fetch now sets `redirect:'manual'` (was silently following redirects,
mirroring an SSRF pattern already fixed elsewhere in the same file), and the
rate-limiter no longer trusts the forgeable `x-real-ip` header. A 121-test
hand-rolled suite (`tests/`, no framework, `node --test`) now covers the
security-relevant logic and passes clean. Nothing here changes what a mod
testing the extension needs to do — this is a hardening pass, not a feature
or UX change.

## What this is

A Chrome extension (MV3) that lets anyone search the full GAW Firehose archive —
every indexed post and comment from greatawakening.win, including removed/deleted
ones — instantly, with filters, without logging in. Backed by a Cloudflare Worker
+ D1 database that a separate Python crawler has been continuously filling since
early July.

## Current numbers

- **Database total: 131,138+ posts** (gaw_posts table, gaw-audit D1, confirmed live 2026-07-09) — climbing continuously.
- Quality filter on the bulk crawler: score > 20, comments >= 6 (deliberate submissions via
  the extension's "Add a Post" feature bypass this filter — see below).
- Extension version: **v2.3.1** (comment-link fix — see below).

## Architecture (where everything lives)

| Piece | Path / identifier |
|---|---|
| Extension source | `D:\AI\_PROJECTS\gaw-research-search\` (manifest.json, popup.html, popup.js, background.js) |
| Packaged ZIP | `D:\AI\_PROJECTS\dist\gaw-research-search-v2.3.1.zip` |
| Unpacked (Load unpacked target) | `D:\AI\_PROJECTS\dist\gaw-research-search-dist\` |
| Worker source | `D:\AI\_PROJECTS\cloudflare-worker\gaw-mod-proxy-v2.js` |
| Worker deployed as | `gaw-mod-proxy` → `https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev` |
| Database | Cloudflare D1 `gaw-audit` (tables: gaw_posts, gaw_comments, gaw_users, bug_reports, ...) |
| Indexer source | `D:\AI\_PROJECTS\gaw-firehose-indexer\indexer.py` |
| Indexer state | `D:\AI\_PROJECTS\gaw-firehose-indexer\state.db` (local SQLite, resumable) |
| Manual start/check script | `C:\Users\smoki\Desktop\_SCRIPTS\Start Firehose Indexer.bat` (double-click) |

## Extension features (all shipped, tested)

1. **Full-text search** across posts and comments, with highlighting.
2. **Filters**: date range, author, score threshold, flair, minimum comment count, scope
   (posts/comments/both), sort (relevance/newest/top).
3. **Saved searches** (star icon) + **recent searches** (chips).
4. **"Add a Post"** (header button) — paste any `greatawakening.win/p/...` link and it gets
   indexed on the spot, bypassing the score/comment quality gate. Public endpoint, no login,
   rate-limited to 5 submissions/hour per IP, strict SSRF-safe URL validation server-side.
   Works for both text posts and image/link posts (fixed a real parser gap during this build —
   image posts were silently failing before the fix).
5. **GOD MODE query syntax** (already baked into search): `author:name`, `community:x`,
   `score:>50`, `date:2026-01-01..2026-02-01`, `removed:1`, `flair:News`, `min_comments:10`.

## Reliability (indexer keeps running unattended)

Three independent layers, all verified live:
1. **Windows Scheduled Task** `GAW-Firehose-Indexer` — launches indexer.py, auto-restarts up
   to 100x (1 min apart) on crash. Non-elevated (`RunLevel: Limited`) so it stays visible to
   standard process checks — this reverted to `Highest` once mid-session and got fixed twice;
   if indexer health-checks ever come back empty/confusing, check this first
   (`Get-ScheduledTask -TaskName "GAW-Firehose-Indexer" | select -expand Principal`).
2. **Windows Scheduled Task** `GAW-Indexer-Overnight-Watchdog` — runs
   `D:\AI\_PROJECTS\gaw-firehose-indexer\overnight-watchdog.ps1` every 5 minutes. Single-shot
   health check (log freshness, not just process existence) + restart if stale. Not a
   background loop — safe to leave running indefinitely.
3. **Claude Code scheduled task** `gaw-indexer-watchdog` — every 15 minutes, same log-freshness
   check, only active while a Claude Code session is open.

**Self-stop safety cap**: indexer.py stops itself and writes `CAP-REACHED.flag` once *its own*
ingest counter hits 100,000 (currently **86,584 as of 2026-07-09 — getting close**; this is
separate from the 131,138+ database total, which also includes older crawler contributions and
Add-a-Post submissions). All three watchdogs check for that flag and will NOT restart it once
present — this is intentional, not a bug. **If mod testing continues for more than another
day or two, the indexer may hit this cap and stop on its own** — check for `CAP-REACHED.flag`
if the database total suddenly stops climbing. To resume past the cap: delete the flag and
re-run with a higher `--max-posts` value.

## Known limitations / not done yet

- Not submitted to Chrome Web Store — mods will need "Load unpacked" for now (see mod prompt below).
- Comment results link to the parent post's comments tab, not scrolled to the exact comment
  (see the v2.3.1 note above) — a known, documented gap, not silently unfixed.
- **Indexer approaching its self-stop cap** (86,584 / 100,000 own-counter as of 2026-07-09) — see
  the safety-cap note above.
- No usage analytics on the Add-a-Post feature yet (works, but no dashboard for how often
  it's used / rate-limit hit rate).
- Rate limit on Add-a-Post (5/hour/IP) has not been load-tested with real concurrent mod usage.

## If something looks wrong

- Indexer health: run `C:\Users\smoki\Desktop\_SCRIPTS\Start Firehose Indexer.bat` — reports
  status, fixes itself if down, safe to run anytime.
- Worker errors: `npx wrangler tail gaw-mod-proxy` from `D:\AI\_PROJECTS\cloudflare-worker`.
- Extension errors: `chrome://extensions` → GAW Research Search → "service worker" link opens
  the background console; the popup itself can be inspected via right-click → Inspect while open.
