# BUILD SPEC — GAW: RE-SEARCH v2.4.0 (public beta rollout)

This is the authoritative build spec. Every implementing agent builds to THIS,
not to their own interpretation. The message contract and DSL grammar below are
PINNED — three agents build in parallel against them, so drift = breakage.

External product name: **GAW: RE-SEARCH**. Internal repo/worker/folder names
UNCHANGED (`gaw-research-search`, `gaw-mod-proxy`). Target version: **2.4.0**.

Files:
- `D:\AI\_PROJECTS\gaw-research-search\popup.html` / `popup.css` / `popup.js`
- `D:\AI\_PROJECTS\gaw-research-search\background.js`
- `D:\AI\_PROJECTS\cloudflare-worker\gaw-mod-proxy-v2.js`

---

## 0. HARD INVARIANTS — MUST PRESERVE (do not regress prior security work)

The extension just shipped v2.3.1 after a full red-team remediation. These
existing behaviors are load-bearing and MUST survive any rewrite:

- **background.js is the trust boundary.** It re-validates every message field
  (`sanitizeQueryString`, `validateSearchOpts`, `looksLikeGawPostUrl`,
  `sanitizeSearchState`, `validateSearchResponse`). popup.js never talks to the
  network directly — only via `chrome.runtime.sendMessage`.
- **No `innerHTML` with untrusted content.** Result cards + saved rows are built
  with `document.createElement`/`.textContent`/`.setAttribute`. `appendHighlighted()`
  emits real text + `<mark>` nodes, never an HTML string. KEEP THIS.
- **`buildGawUrl()` comment fix (v2.3.1):** comments link to
  `https://greatawakening.win/p/<post_slug>/x/c/` using `item.post_slug`; posts
  use `item.slug`; both fall back to bare domain if missing. The worker's
  `/gaw/search` comment query LEFT JOINs `gaw_posts` for `post_slug`. KEEP.
- **`quoteDslValue()`** quotes/escapes any value containing whitespace/quote/colon
  before it goes into the DSL string. All advanced-field values MUST route through
  it (or an equivalent per-term sanitizer). No raw user text into the `q` string.
- **`capLen` caps** (MAX_TEXT_LEN 256, MAX_AUTHOR_LEN 64, MAX_FLAIR_LEN 80).
- **`lastQuery` sanitize-on-read** in `init()` (typeof + capLen before use).
- **Escape-key / focus management** (P2-4), **in-flight submit guard** (P1-8),
  **debounced lastQuery write** (P2-1), **formatDate** hardening (P2-3).
- **CSP stays strict:** `script-src 'self'; object-src 'self'`. No inline event
  handlers, no `eval`, no inline `<style>` (all CSS in popup.css), no remote assets.
- The existing hand-rolled test suite in `tests/` must still pass.

---

## 1. MESSAGE CONTRACT (pinned — popup.js ↔ background.js)

popup.js sends, background.js handles. Existing types unchanged except `search`
gains a client-guard response shape and a new `getAdvancedPref`/`setAdvancedPref`
is NOT needed (advanced-mode preference is stored by popup.js directly in
`chrome.storage.local` under key `advancedMode`, sanitized on read like lastQuery).

`search` message: `{ type:'search', query:<string DSL>, opts:{ scope, sort, limit } }`
- background.js validates as today, PLUS applies the client-side guard (§4).
- Response success: `{ ok:true, posts:[], comments:[], godmode }` (unchanged).
- Response guard-limited: `{ ok:false, error:'rate_limited', retryAfterMs:<number> }`
  — returned WITHOUT hitting the network when the client token bucket is empty.
- Response server-limited (worker 429/503): `{ ok:false, error:'server_busy',
  httpStatus:429|503, retryAfterMs:<number from Retry-After> }`.

All other message types (`getSaved`, `toggleSave`, `getRecent`, `addRecent`,
`submitUrl`, `getDebugLog`) UNCHANGED.

---

## 2. QUERY DSL — what the worker already supports (client compiles to this)

The worker's `/gaw/search?godmode=1&q=<DSL>` already parses (parseGodmodeQuery):
- `"exact phrase"` → FTS5 phrase
- bare `term` → required AND term (trailing `*` = prefix). ALL bare terms are
  already must-have — FTS5 AND semantics. (This IS "force include / must have".)
- `-term` → FTS5 NOT (EXCLUDE). **Exclude is already supported server-side.**
- `author:NAME` / `author:"Name Here"` → exact author
- `community:NAME`
- `score:>50` `>=50` `<10` `=0`
- `flair:NAME` → LIKE
- `min_comments:N`
- `date:YYYY-MM-DD..YYYY-MM-DD` (either side optional)
- `removed:0|1` — **removed:1 requires a mod token → DO NOT expose in the public
  UI.** Public users never send removed:1.

**NEW server addition (§5, Worker agent):** `any:w1,w2,w3` → compiles SERVER-SIDE
to `(w1 OR w2 OR w3)` (each term metachar-stripped, OR/parens built from worker's
own literals — never trust client to send raw FTS operators). This is the only
grammar change. Everything else the client just composes from existing tokens.

---

## 3. UI REDESIGN (popup.html + popup.css + popup.js) — the "frontend" agent

### 3.1 Branding / title bar
- Header shows **GAW: RE-SEARCH** as the product title (⚖ logo mark kept).
- Under-tagline line: `WWW.GREATAWAKENING.WIN` rendered as an `<a>` linking to
  `https://www.greatawakening.win` (target=_blank rel="noopener"), small + muted.
- Small `BETA` badge near the title (subtle, not loud).
- Keep the existing dark palette (CSS vars in popup.css). It's clean + on-brand.

### 3.2 Card-based information architecture (features grouped by type)
Reorganize controls into visually distinct, titled, COLLAPSIBLE cards. This is a
600px-wide / 640px-max-height popup — do NOT expand everything at once; keep it
tight. Each card = a bordered section with a header row. Cards, in order:

1. **Search card** (always visible): the main query box + Search button + Save (★).
   In advanced mode this box is labeled "All of these words (required)".
2. **Advanced Search card** (hidden unless Advanced Mode toggle is ON): structured
   boolean fields (§3.4).
3. **Filters card** (collapsible, collapsed by default): date (with relative
   presets §3.5), author, score, flair, min comments, scope, sort.
4. **Results toolbar** (appears once there are results): result count + a
   **Copy results** button (§3.6) + quick sort control (optional, may reuse the
   filter sort).
5. **Add a Post card** (collapsible, existing feature): unchanged behavior, just
   restyled to match the card system.
6. **Saved / Recent**: existing saved panel + recent chips, restyled as cards.

"Sorted by type" = these grouped, headered, bordered sections instead of today's
flat form. Use consistent card styling (header + body, subtle border, `--bg2`
body). Keep motion subtle (existing .15s transitions).

### 3.3 Advanced Mode toggle (top of UI)
- A real toggle SWITCH near the top (below the header, above/inside the search
  card), labeled "Advanced Mode".
- State persisted in `chrome.storage.local` key `advancedMode` (boolean). Read on
  init (sanitize: coerce to boolean). Default OFF.
- When ON: reveals the Advanced Search card. When OFF: hides it and `buildQuery()`
  ignores advanced fields.
- Toggle must be keyboard-operable (role="switch", aria-checked, Space/Enter),
  and CSP-clean (no inline handlers).

### 3.4 Advanced Search card fields (all compile client-side to the §2 DSL)
Use the classic power-search set. Each field value goes through `quoteDslValue()`
(or per-term sanitize) before entering the `q` string — never raw:
- **All of these words** (the main search box; bare terms, AND) — already required.
- **This exact phrase** → `"<phrase>"` (one quoted phrase token).
- **Any of these words** (OR) → `any:<w1>,<w2>,<w3>` (comma-join cleaned single
  words; server compiles the OR-group). Split the user's input on spaces/commas,
  strip metachars per word, cap ~10 words.
- **Exclude these words** (NOT) → each word becomes `-<word>` (cleaned).
- Show a tiny live "query preview" line under the advanced fields showing the
  compiled DSL string (read-only, helps power users learn the grammar). Optional
  but recommended — it's a researcher delight + demystifies the DSL.

`buildQuery()` composes: [main box terms] + [exact phrase] + [any-group] +
[exclude terms] + [existing filter restrictors from the Filters card]. When
Advanced Mode is OFF, only the main box + filters contribute (today's behavior).

### 3.5 Relative date presets (Filters card)
Replace/augment the raw date pickers with a preset selector:
`Any time | Past 24 hours | Past 7 days | Past 30 days | Custom range…`.
- Presets compute `date:` DSL from `Date.now()` (e.g. Past 7 days →
  `date:<ISO(now-7d)>..`). "Custom range…" reveals the existing two date inputs.
- "Any time" = no date restrictor.
- Keep the existing custom from/to inputs available under "Custom range…".

### 3.6 Copy results (Results toolbar)
- A **Copy results** button copies the CURRENTLY LOADED results as a markdown
  list to the clipboard: `- [<title>](<url>) — @<author> · <score> pts · <date>`
  (one line per result, comments noted as such). Bounded to what's on screen
  (already ≤ a few hundred). Uses `navigator.clipboard.writeText`, shows a brief
  "Copied N results" confirmation. This is NOT a bulk-export/harvest vector — only
  visible results.

### 3.7 First-run tip + beta polish
- On first open (storage key `seenIntro` absent), show a small dismissible tip
  strip: "New here? Type anything to search 130k+ GAW posts & comments. Flip
  Advanced Mode for power search." Dismiss sets `seenIntro=1`. Sanitize on read.
- Keep the existing "Copy debug info" affordance (beta feedback loop).
- Friendly rate-limit messaging (§4.4): when a search is guard/server limited,
  show a calm "Easy there — one sec…" status with a short countdown and
  re-enable, NEVER a scary error.

### 3.8 Accessibility / CSP (do not regress)
- All interactive elements keyboard-operable, correct roles/aria, visible focus.
- Escape closes open panels/cards (extend existing handler to new cards).
- No inline styles that would need `'unsafe-inline'`; all styling in popup.css.
- No inline event handlers; all wired via addEventListener in popup.js.

---

## 4. CLIENT-SIDE ANTI-HAMMER (background.js) — the "SW" agent

background.js is the choke point for every extension request — the guards live
here, invisible to well-intentioned users:

### 4.1 Token-bucket rate limiter (in-memory, per SW lifetime)
- Bucket: capacity 20, refill 1 token / 3s (≈ 20 burst, then ~20/min sustained).
  A human never trips this; a loop does immediately.
- On `search` with an empty bucket: return `{ ok:false, error:'rate_limited',
  retryAfterMs }` WITHOUT hitting the network. `submitUrl` is already IP-limited
  server-side; also give it a light client bucket (capacity 5, refill 1/12s).

### 4.2 Short-TTL result cache
- Cache successful `search` responses keyed by `JSON.stringify({query,opts})`,
  TTL 60s, max ~30 entries (LRU/FIFO evict). A repeat identical search inside the
  window returns the cached response — no network. UX win + fewer worker hits.

### 4.3 In-flight de-dup / coalescing
- If an identical `search` (same key) is already in flight, the second caller
  awaits the same promise instead of firing a second request.

### 4.4 Server-backoff propagation
- On worker 429/503, read `Retry-After` (seconds) → return
  `{ ok:false, error:'server_busy', httpStatus, retryAfterMs }`. Also pause the
  local bucket for that window so the SW doesn't keep trying.

### 4.5 Client identity header (defense-in-depth, soft)
- Add header `X-GAW-Client: research-ext/2.4.0` to worker fetches. The worker MAY
  apply gentler limits to requests bearing it (§5.3). Trivially spoofable, so it's
  a signal, never the sole gate.

Keep all existing sanitizers, timeout wrapper, debug ring buffer, storage
serialization. Extend `validateSearchResponse` to also pass through `post_slug`
(already added in v2.3.1 — keep).

---

## 5. BACKEND ANTI-HAMMER + OR-GROUP (gaw-mod-proxy-v2.js) — the "Worker" agent

Reliable enforcement (works regardless of client). Mirror the EXISTING KV
rate-limit pattern already proven in `_gawSubmitRateLimit` (fail-open on KV
error/absence, `CF-Connecting-IP` only — do NOT trust `x-real-ip`).

### 5.1 Per-IP rate limit on /gaw/search (NEW — currently unprotected)
- Sliding/bucketed window in KV keyed by `CF-Connecting-IP`:
  **40 / minute AND 400 / hour** per IP (generous for a human researcher,
  fatal to a scraping loop). Keys like `gaw:search:min:${ip}:${minuteBucket}` and
  `gaw:search:hr:${ip}:${hourBucket}` with appropriate TTLs.
- On breach: `429` JSON `{ error:'rate limit: slow down' }` with a
  `Retry-After` header (seconds until the window resets).
- **Fail-open:** missing `env.MOD_KV` or any KV error → allow (like submit-url).
  A KV blip must never take search down for everyone.

### 5.2 Global circuit breaker (protect the shared Cloudflare quota)
- A global KV counter `gaw:search:global:${minuteBucket}`. If global searches in
  the current minute exceed a ceiling (e.g. **1000/min** — far above real beta
  load, far below CF free limits), return `503` `{ error:'search is busy, try
  again shortly' }` + `Retry-After`. This sheds a distributed flood before it
  burns the account's Workers/D1 quota. Fail-open on KV error.

### 5.3 Client-header soft tiering (optional, defense-in-depth)
- Requests WITHOUT `X-GAW-Client` may get a stricter per-IP limit (e.g. half),
  since the real extension always sends it. Never a hard block on absence (keep it
  a signal). Skip this if it complicates the code much — §5.1+§5.2 are the 80%.

### 5.4 `any:` OR-group support in parseGodmodeQuery (NEW grammar)
- New field restrictor `any:val`. Split `val` on commas, trim, strip FTS5
  metachars per term (`[":()~^+\-]`), drop empties, cap at 10 terms, each ≤64 chars.
- Build the FTS fragment from the WORKER'S OWN literals:
  `(term1 OR term2 OR term3)` — join cleaned terms with ` OR `, wrap in parens,
  push to ftsParts as a single positive group. If 0 valid terms → ignore the token
  (don't error the whole query).
- This counts as a positive term for the `hasPositive` check.

### 5.5 Graceful, non-leaky query errors
- The FTS `catch` currently returns `500` with the raw error string. Change to:
  log server-side (console.error with a code), return a GENERIC message
  (`{ ok:false, error:'query could not be processed' }`) — do NOT leak internal
  error text to the public. Keep 500 for genuine faults; godmode parse errors stay
  400 (already correct). Since the godmode path now fully controls FTS string
  construction, malformed-FTS should be rare.

### 5.6 Keep intact
- `limit` clamp (≤200), removed:1 mod-token gate, parameterized D1 binds,
  submit-url's existing SSRF hardening + `redirect:'manual'` + IP rate limit.

---

## 6. TEST + VERIFY (later phases)
- Extend `tests/` (hand-rolled `node --test`, no framework) for: advanced-field →
  DSL compilation, relative-date → DSL, `any:` parser (worker), client rate-limiter
  + cache + dedup logic, copy-results markdown formatting. All green.
- Adversarial verify (fresh reads): hardening present + fail-open + injection-safe;
  UI IDs↔handlers all resolve, CSP-clean, a11y intact; DSL compilation can't smuggle
  raw FTS operators.
- Integrator (me) live-tests the deployed worker (curl the per-IP limit → 429 after
  N; malformed → graceful; `any:` → works), screenshots the redesigned popup via a
  standalone preview harness, bumps to v2.4.0, packages, opsec-scans, commits.
