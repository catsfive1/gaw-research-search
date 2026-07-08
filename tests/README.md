# Tests — GAW Research Search

Hand-rolled Node test suite. No test framework is installed (no
`package.json`, no jest/vitest) — every file here uses only Node's built-in
`node:test` + `node:assert/strict`. Node 24.x is confirmed installed, so
`node:test` (stable since Node 18, fully mature in 20+) is used directly
for clean pass/fail output, rather than the manual counter pattern used in
older sibling projects (e.g. `gaw-modtools-extension/scripts/_*_smoke_test.mjs`)
that had to target older Node versions.

## Why extraction instead of `require()`/`import` of the real files

`popup.js` and `background.js` are plain MV3 scripts, not ES modules — they
have no `export` statements and reference top-level `document`/`chrome`
globals at load time (event listener wiring, an `init()` IIFE, an
`onMessage` listener registration). Importing them directly in plain Node
would throw immediately (`document is not defined`).

Two techniques are used, both exercising the REAL production source text
(never a re-typed copy that could drift from what's actually shipped):

1. **`tests/_extract.mjs`** — slices a single named `function foo() {...}`
   out of the file via balanced-brace scanning, then compiles it standalone
   with `new Function`. Used for self-contained pure functions
   (`normalizeGawUrl`, `quoteDslValue`, `formatDate`, `mergeSortedDesc`,
   `clampInt`, `sanitizeQueryString`, `validateSearchOpts`, etc).
2. **A minimal fake-DOM `vm` sandbox** (built inline in
   `search-state.test.mjs` and `dom-rendering.test.mjs`) — for functions
   that read/write real DOM elements (`captureSearchState`,
   `restoreSearchState`, `buildResultCard`, `appendHighlighted`). The whole
   file is loaded into a `vm.createContext` sandbox with fake
   `document`/`chrome` globals, then the real top-level functions are
   called directly off that context. No jsdom dependency — just enough of
   a fake DOM (real element/text-node tree, `textContent` walking child
   nodes) to prove dangerous strings never turn into live markup.

## Running

```
node --test tests/*.test.mjs
```

Or any single file:

```
node --test tests/url-normalization.test.mjs
```

## Files

| File | Covers |
|---|---|
| `_extract.mjs` | shared helper (not a test file itself) |
| `url-normalization.test.mjs` | `normalizeGawUrl()`, `looksLikeGawPostUrl()` (both popup.js and background.js copies) |
| `dsl-and-dates.test.mjs` | `quoteDslValue()`, `formatDate()` |
| `message-validation.test.mjs` | `clampInt()`, `validateSearchOpts()`, `sanitizeQueryString()` (background.js message trust boundary) |
| `search-state.test.mjs` | `captureSearchState()` / `restoreSearchState()` round-trip, `hasActiveFilters()`, `countActiveFilters()` |
| `merge-sort.test.mjs` | `mergeSortedDesc()` (P1-7 posts+comments merge) |
| `dom-rendering.test.mjs` | `appendHighlighted()`, `buildResultCard()`, `excerpt()` — confirms the post-rewrite DOM-construction path never produces live markup from untrusted strings |

## Scope (deliberately out)

No real network calls, no real `chrome.*` API behavior (only enough of a
stub to let the file load), no end-to-end popup rendering. Pure logic and
DOM-tree-shape assertions only, per the project's "no test framework, no
new dependency" constraint.
