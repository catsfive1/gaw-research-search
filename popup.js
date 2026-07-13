/* GAW: RE-SEARCH v2.4.0 — Popup Logic */
'use strict';

const $ = id => document.getElementById(id);

// State
let lastQuery = '';
let lastOpts = {};
let currentOffset = 0;
let totalLoaded = 0;
let isLoading = false;
let isSubmittingUrl = false; // P1-8: explicit in-flight guard, belt-and-suspenders w/ addSubmit.disabled
let lastFocusedBeforeSaved = null;
let advancedMode = false;    // v2.4.0: persisted in chrome.storage.local 'advancedMode'
let loadedItems = [];        // v2.4.0: currently-loaded results (for Copy results)
let backoffTimer = null;     // v2.4.0: single active rate-limit/server-busy countdown

// Elements
const qEl          = $('q');
const qLabel       = $('q-label');
const btnSearch    = $('btn-search');
const btnSave      = $('btn-save');
const statusBar    = $('status-bar');
const resultsEl    = $('results');
const emptyEl      = $('empty');
const loadMore     = $('load-more');
const recentEl     = $('recent');
const recentWrap   = $('recent-wrap');
const browseEl     = $('browse');
const savedPanel   = $('saved-panel');
const savedList    = $('saved-list');
// Advanced Mode
const advToggle    = $('adv-toggle');
const cardAdvanced = $('card-advanced');
const advCardHdr   = $('adv-card-hdr');
const advCardBody  = $('adv-card-body');
const advExact     = $('adv-exact');
const advAny       = $('adv-any');
const advExclude   = $('adv-exclude');
const dslPreview   = $('dsl-preview');
// Filters card
const filtersHdr   = $('filters-hdr');
const filtersBody  = $('filters-body');
const filtersBadge = $('filters-badge');
const datePreset   = $('f-date-preset');
const dateCustomRow = $('date-custom-row');
// Add card
const addHdr       = $('add-hdr');
const addBody      = $('add-body');
const addUrl       = $('add-url');
const addSubmit    = $('btn-add-submit');
const addStatus    = $('add-status');
// Results toolbar
const resultsToolbar = $('results-toolbar');
const resultsCount   = $('results-count');
const btnCopyResults = $('btn-copy-results');
// First-run tip
const introTip     = $('intro-tip');
const introDismiss = $('intro-tip-dismiss');
// v2.5.1: auto update-check banner
const updateBanner      = $('update-banner');
const updateBannerTxt   = $('update-banner-txt');
const updateBannerDl    = $('update-banner-dl');
const updateBannerX     = $('update-banner-dismiss');

// ── Helpers ─────────────────────────────────────────────────────────────────

function msg(payload) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(payload, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r);
    });
  });
}

function status(txt, cls = '') {
  statusBar.textContent = txt;
  statusBar.className = cls;
}

// P2-3: formatDate must tolerate 0, null, strings, negative, and millisecond-scale
// timestamps instead of assuming valid Unix seconds.
function formatDate(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 'Unknown date';
  // Values above ~1e12 are already millisecond-scale (year ~2001+ in ms vs seconds).
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function excerpt(str, limit = 160) {
  if (!str) return '';
  const plain = String(str).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? plain.slice(0, limit) + '…' : plain;
}

// P0-3: highlightTerms now builds real DOM nodes (text + <mark>) instead of
// returning an HTML string. Appends its output directly into `parent`.
function appendHighlighted(parent, text, query) {
  const str = text == null ? '' : String(text);
  if (!query) {
    parent.appendChild(document.createTextNode(str));
    return;
  }
  const words = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    parent.appendChild(document.createTextNode(str));
    return;
  }
  const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let lastIndex = 0;
  let match;
  re.lastIndex = 0;
  while ((match = re.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
    }
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    parent.appendChild(mark);
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex++; // guard against zero-width match loops
  }
  if (lastIndex < str.length) {
    parent.appendChild(document.createTextNode(str.slice(lastIndex)));
  }
}

function buildGawUrl(item) {
  // Comments never have their own slug -- only the parent post does. The
  // Worker's comment SELECT now LEFT JOINs gaw_posts to attach it as
  // post_slug specifically so this function can build a real link (was
  // previously missing entirely, which is what sent mods to the site's
  // bare front/"new" page instead of the post their comment was in).
  //
  // Verified live against greatawakening.win on 2026-07-09 before shipping
  // this, because the obvious-looking alternatives are actually broken:
  //   - /p/<raw-numeric-post-id>              -> 500 (slug required, not id)
  //   - /p/<slug>/x/c/<raw-numeric-comment-id> -> 500 (the real per-comment
  //     permalink segment is an opaque encoded slug e.g. "4ed43EW5Efx", NOT
  //     the numeric comment id we store -- we don't capture that value
  //     anywhere today, so we can't build it)
  //   - /p/<slug>/x/c/  (no comment id)         -> 200 (comments tab, confirmed)
  // So this lands on the post's comments tab -- not scrolled to the exact
  // comment, but a real, working page containing it, not a broken link.
  if (item._type === 'comment') {
    if (item.post_slug) return 'https://greatawakening.win/p/' + item.post_slug + '/x/c/';
    return 'https://greatawakening.win';
  }
  if (item.slug) return 'https://greatawakening.win/p/' + item.slug;
  return 'https://greatawakening.win';
}

// ── DSL value quoting (P1-3) ─────────────────────────────────────────────────
// The Worker's /gaw/search endpoint only accepts the GOD MODE query DSL as a
// single 'q' string -- there is no structured filter payload to switch to.
// Any filter value containing whitespace, a quote, or a colon (which could be
// read as a DSL operator like "date:" or "removed:") must be quoted so it is
// treated as a literal value rather than smuggled DSL syntax. Embedded
// newlines are stripped outright since the DSL is a single-line string.
function quoteDslValue(v) {
  let s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
  if (/["\s:]/.test(s)) {
    s = '"' + s.replace(/"/g, '\\"') + '"';
  }
  return s;
}

// P1-5: length caps mirrored from background.js's message validation so the
// user gets truncated/clean input rather than silently oversized payloads.
const MAX_TEXT_LEN   = 256;
const MAX_AUTHOR_LEN = 64;
const MAX_FLAIR_LEN  = 80;

function capLen(s, max) {
  return String(s == null ? '' : s).slice(0, max);
}

// ── Advanced-field term cleaning (v2.4.0) ────────────────────────────────────
// The `any:` OR-group and `-exclude` terms must NEVER carry raw FTS5 operators
// into the q string. Keep only word chars + a trailing-prefix '*', strip all
// metachars/quotes/colons/commas (the delimiters we build the DSL from), and
// cap each term. The worker ALSO re-strips server-side (defense in depth), but
// the client refuses to compose anything unsafe in the first place.
function cleanTerm(w) {
  return String(w == null ? '' : w).replace(/[^0-9A-Za-z_*]/g, '').slice(0, 64);
}
function cleanTermList(raw, maxTerms = 10) {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map(cleanTerm)
    .filter(Boolean)
    .slice(0, maxTerms);
}

// ── Date DSL (v2.4.0) ────────────────────────────────────────────────────────
// The worker's parseGodmodeQuery only accepts the range form
// `date:YYYY-MM-DD..YYYY-MM-DD` (either side optional) -- NOT `date:>=X`.
// The relative-date presets write absolute YYYY-MM-DD values into the
// #f-date-from / #f-date-to inputs, so this reads them as the single source of
// truth and emits the worker-supported range token. Values are validated
// against the strict ISO shape so nothing else can ride into the q string.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function buildDateDsl() {
  const rawFrom = $('f-date-from').value;
  const rawTo   = $('f-date-to').value;
  const from = ISO_DATE_RE.test(rawFrom) ? rawFrom : '';
  const to   = ISO_DATE_RE.test(rawTo)   ? rawTo   : '';
  if (!from && !to) return '';
  return 'date:' + from + '..' + to;
}

// ── Filters + advanced fields → query string ─────────────────────────────────
// buildQuery composes: [main box terms] + (advanced: [exact phrase] +
// [any-group] + [exclude terms]) + [filter restrictors]. When Advanced Mode is
// OFF, only the main box + filters contribute (v2.3.x behavior). Every value is
// quoted (quoteDslValue) or per-term sanitized (cleanTerm) -- never raw text.
function buildQuery() {
  const parts = [];

  const main = capLen(qEl.value.trim(), MAX_TEXT_LEN);
  if (main) parts.push(main);

  if (advancedMode) {
    // Exact phrase -> a single quoted FTS5 phrase token. Strip embedded quotes
    // and newlines so the token can't break out of its own phrase.
    const phrase = capLen(advExact.value, MAX_TEXT_LEN).replace(/["\r\n]+/g, ' ').trim();
    if (phrase) parts.push('"' + phrase + '"');

    // Any-of -> any:w1,w2,w3 (worker compiles the OR-group from its own literals).
    const anyTerms = cleanTermList(advAny.value);
    if (anyTerms.length) parts.push('any:' + anyTerms.join(','));

    // Exclude -> -word each (cleaned).
    cleanTermList(advExclude.value).forEach(w => parts.push('-' + w));
  }

  // Filter restrictors (apply in both modes).
  const author = capLen($('f-author').value.trim(), MAX_AUTHOR_LEN);
  if (author) parts.push('author:' + quoteDslValue(author));

  const dateDsl = buildDateDsl();
  if (dateDsl) parts.push(dateDsl);

  // score/minComments are numeric-only inputs -- validate they actually parse
  // as integers before use, ignoring non-numeric garbage rather than smuggling
  // it into the DSL string.
  const scoreOp     = $('f-score-op').value;
  const scoreValRaw = $('f-score-val').value.trim();
  if (scoreOp && scoreValRaw !== '') {
    const scoreVal = parseInt(scoreValRaw, 10);
    if (Number.isFinite(scoreVal)) parts.push('score:' + scoreOp + scoreVal);
  }

  const flair = capLen($('f-flair').value.trim(), MAX_FLAIR_LEN);
  if (flair) parts.push('flair:' + quoteDslValue(flair));

  const minCommentsRaw = $('f-min-comments').value.trim();
  if (minCommentsRaw !== '') {
    const minComments = parseInt(minCommentsRaw, 10);
    if (Number.isFinite(minComments) && minComments >= 0) parts.push('min_comments:' + minComments);
  }

  return parts.join(' ');
}

// A query is searchable only if it has at least one POSITIVE FTS term (the
// worker rejects filter-only / exclude-only queries). Mirrors the composition
// rules in buildQuery so we never fire a request the worker will bounce.
function hasPositiveTerm() {
  if (capLen(qEl.value.trim(), MAX_TEXT_LEN)) return true;
  if (advancedMode) {
    const phrase = capLen(advExact.value, MAX_TEXT_LEN).replace(/["\r\n]+/g, ' ').trim();
    if (phrase) return true;
    if (cleanTermList(advAny.value).length) return true;
  }
  return false;
}

function updateDslPreview() {
  if (!dslPreview) return;
  dslPreview.textContent = buildQuery();
}

function buildOpts(offset = 0) {
  return {
    scope:  $('f-scope').value,
    sort:   $('f-sort').value === 'relevance' ? 'rank' : $('f-sort').value === 'score' ? 'score' : 'date',
    limit:  25,
    offset,
  };
}

// P1-4: capture the full SearchState (not just the text box) so a saved or
// recent "search" actually restores every filter, not just the query text.
function captureSearchState() {
  return {
    text: capLen(qEl.value.trim(), MAX_TEXT_LEN),
    author: capLen($('f-author').value.trim(), MAX_AUTHOR_LEN),
    dateFrom: $('f-date-from').value || '',
    dateTo: $('f-date-to').value || '',
    scoreOp: $('f-score-op').value || '',
    scoreVal: (() => {
      const n = parseInt($('f-score-val').value.trim(), 10);
      return Number.isFinite(n) ? n : '';
    })(),
    flair: capLen($('f-flair').value.trim(), MAX_FLAIR_LEN),
    minComments: (() => {
      const n = parseInt($('f-min-comments').value.trim(), 10);
      return Number.isFinite(n) && n >= 0 ? n : '';
    })(),
    scope: $('f-scope').value || 'both',
    sort: $('f-sort').value || 'relevance',
    schemaVersion: 1,
  };
}

function hasActiveFilters(state) {
  if (!state) return false;
  return Boolean(
    state.author || state.dateFrom || state.dateTo ||
    (state.scoreOp && state.scoreVal !== '') || state.flair ||
    (state.minComments !== '' && state.minComments !== 0) ||
    (state.scope && state.scope !== 'both') ||
    (state.sort && state.sort !== 'relevance')
  );
}

function countActiveFilters(state) {
  if (!state) return 0;
  let n = 0;
  if (state.author) n++;
  if (state.dateFrom) n++;
  if (state.dateTo) n++;
  if (state.scoreOp && state.scoreVal !== '') n++;
  if (state.flair) n++;
  if (state.minComments !== '' && state.minComments !== 0) n++;
  if (state.scope && state.scope !== 'both') n++;
  if (state.sort && state.sort !== 'relevance') n++;
  return n;
}

// Restores a full SearchState into the filter inputs. Does not trigger a
// search itself -- callers decide when to re-run.
function restoreSearchState(state) {
  if (!state || typeof state !== 'object') return;
  qEl.value = state.text || '';
  $('f-author').value = state.author || '';
  $('f-date-from').value = state.dateFrom || '';
  $('f-date-to').value = state.dateTo || '';
  $('f-score-op').value = state.scoreOp || '';
  $('f-score-val').value = state.scoreVal === '' || state.scoreVal == null ? '' : String(state.scoreVal);
  $('f-flair').value = state.flair || '';
  $('f-min-comments').value = state.minComments === '' || state.minComments == null ? '' : String(state.minComments);
  $('f-scope').value = state.scope || 'both';
  $('f-sort').value = state.sort || 'relevance';
  // v2.4.0: sync the date-preset UI to the restored absolute dates. Relative
  // presets are snapshotted to absolute YYYY-MM-DD at capture time, so a saved
  // "Past 7 days" restores as a Custom range with those concrete dates.
  const hasDates = Boolean(state.dateFrom || state.dateTo);
  const dp = $('f-date-preset');
  if (dp) dp.value = hasDates ? 'custom' : '';
  const dcr = $('date-custom-row');
  if (dcr) dcr.hidden = !hasDates;
}

// ── Render results ──────────────────────────────────────────────────────────

// P0-3: build each result card via DOM APIs instead of innerHTML. Score,
// comment count, and formatted date are text content (no HTML injection
// surface); highlightTerms output is real <mark> nodes, not an HTML string.
function buildResultCard(item, query) {
  const isComment = item._type === 'comment';
  const url       = buildGawUrl(item);
  const card      = document.createElement('a');
  card.className  = 'result' + (isComment ? ' r-type-comment' : '');
  card.href       = url;
  card.target     = '_blank';
  card.rel        = 'noopener';

  const title    = item.title || (isComment ? '↳ Comment on post #' + item.post_id : 'Untitled');
  const scoreVal = Number.isFinite(item.score) ? item.score : 0;
  const commentCount = Number.isFinite(item.comment_count) ? item.comment_count : 0;
  const author   = item.author || '';
  const flair    = item.flair || '';
  const removed  = item.is_removed || item.is_deleted;

  const titleDiv = document.createElement('div');
  titleDiv.className = 'r-title';
  appendHighlighted(titleDiv, title, query);
  card.appendChild(titleDiv);

  const meta = document.createElement('div');
  meta.className = 'r-meta';

  if (flair) {
    const flairSpan = document.createElement('span');
    flairSpan.className = 'r-flair';
    flairSpan.textContent = flair;
    meta.appendChild(flairSpan);
  }
  if (removed) {
    const removedSpan = document.createElement('span');
    removedSpan.className = 'r-removed';
    removedSpan.textContent = 'REMOVED';
    meta.appendChild(removedSpan);
  }

  const scoreSpan = document.createElement('span');
  scoreSpan.className = 'r-score';
  scoreSpan.setAttribute('aria-label', scoreVal + ' points');
  const scoreIcon = document.createElement('span');
  scoreIcon.setAttribute('aria-hidden', 'true');
  scoreIcon.textContent = '⬆';
  scoreSpan.appendChild(scoreIcon);
  scoreSpan.appendChild(document.createTextNode(' ' + scoreVal));
  meta.appendChild(scoreSpan);

  if (!isComment) {
    const commentsSpan = document.createElement('span');
    commentsSpan.className = 'r-comments';
    commentsSpan.setAttribute('aria-label', commentCount + ' comments');
    const commentsIcon = document.createElement('span');
    commentsIcon.setAttribute('aria-hidden', 'true');
    commentsIcon.textContent = '💬';
    commentsSpan.appendChild(commentsIcon);
    commentsSpan.appendChild(document.createTextNode(' ' + commentCount));
    meta.appendChild(commentsSpan);
  }

  if (author) {
    const authorSpan = document.createElement('span');
    authorSpan.className = 'r-author';
    authorSpan.textContent = '@' + author;
    meta.appendChild(authorSpan);
  }

  const dateSpan = document.createElement('span');
  dateSpan.className = 'r-date';
  dateSpan.textContent = formatDate(item.created_at);
  meta.appendChild(dateSpan);

  if (isComment) {
    const typeSpan = document.createElement('span');
    typeSpan.className = 'r-type';
    typeSpan.textContent = 'comment';
    meta.appendChild(typeSpan);
  }

  card.appendChild(meta);

  const snippetRaw = item.body_md || item.body_html || item.content || '';
  const snip = excerpt(snippetRaw);
  if (snip) {
    const excerptDiv = document.createElement('div');
    excerptDiv.className = 'r-excerpt';
    appendHighlighted(excerptDiv, snip, query);
    card.appendChild(excerptDiv);
  }

  return card;
}

function renderResults(data, append = false) {
  if (!append) resultsEl.innerHTML = '';

  const posts    = data.posts    || [];
  const comments = data.comments || [];

  // P1-7: for score/date sort, both arrays already arrive sorted by that
  // field from the worker -- merge them client-side (O(n) merge of two
  // sorted arrays) so cross-type ordering reflects actual relevance instead
  // of dumping all posts before any comments. For rank/relevance sort the
  // worker doesn't expose a per-item numeric rank to the client, so a true
  // relevance merge isn't possible here -- keep posts-first as a documented
  // tradeoff pending a future Worker change to expose per-item rank.
  const taggedPosts    = posts.map(p => ({ ...p, _type: 'post' }));
  const taggedComments = comments.map(c => ({ ...c, _type: 'comment' }));
  let items;
  const sortField = lastOpts && lastOpts.sort;
  if (sortField === 'score' || sortField === 'date') {
    const key = sortField === 'score' ? 'score' : 'created_at';
    items = mergeSortedDesc(taggedPosts, taggedComments, key);
  } else {
    // rank/relevance: no per-item rank exposed by the worker -- posts-first.
    items = [...taggedPosts, ...taggedComments];
  }

  if (!append && items.length === 0) {
    loadedItems = [];
    resultsToolbar.hidden = true;
    emptyEl.style.display = 'flex';
    emptyEl.querySelector('.empty-icon').textContent = '🔍';
    emptyEl.querySelector('.empty-txt').textContent  = 'No digs match that yet';
    emptyEl.querySelector('.empty-hint').textContent = 'Try broader terms, or drop a filter — the archive is deep.';
    loadMore.style.display = 'none';
    status('No results', '');
    return;
  }

  emptyEl.style.display = 'none';
  items.forEach(item => {
    resultsEl.appendChild(buildResultCard(item, lastQuery));
  });

  loadedItems = loadedItems.concat(items);
  updateResultsToolbar();

  totalLoaded += items.length;
  loadMore.style.display = items.length >= 25 ? 'block' : 'none';
}

// Merge two arrays, each already sorted descending by `key`, into one
// descending-sorted array. Standard two-pointer merge, O(n).
function mergeSortedDesc(a, b, key) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const av = Number(a[i][key]) || 0;
    const bv = Number(b[j][key]) || 0;
    if (av >= bv) out.push(a[i++]);
    else out.push(b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

// ── Results toolbar / Copy results (v2.4.0) ──────────────────────────────────

function updateResultsToolbar() {
  const n = loadedItems.length;
  if (n > 0) {
    resultsToolbar.hidden = false;
    resultsCount.textContent = n + (n === 1 ? ' result' : ' results') + ' loaded';
  } else {
    resultsToolbar.hidden = true;
  }
}

// Copies ONLY the currently-loaded, on-screen results as a markdown list.
// Bounded to what the user has already pulled -- not a bulk harvest vector.
function copyResults() {
  if (!loadedItems.length) return;
  const lines = loadedItems.map(item => {
    const isComment = item._type === 'comment';
    const title  = item.title || (isComment ? 'Comment on post #' + item.post_id : 'Untitled');
    const url    = buildGawUrl(item);
    const author = item.author ? '@' + item.author : '@unknown';
    const score  = Number.isFinite(item.score) ? item.score : 0;
    const date   = formatDate(item.created_at);
    const tag    = isComment ? ' (comment)' : '';
    return '- [' + title + '](' + url + ') — ' + author + ' · ' + score + ' pts · ' + date + tag;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const n = loadedItems.length;
    resultsCount.textContent = 'Copied ' + n + ' result' + (n === 1 ? '' : 's');
    setTimeout(updateResultsToolbar, 1600);
  }).catch(() => {
    resultsCount.textContent = 'Copy failed — try again';
    setTimeout(updateResultsToolbar, 1600);
  });
}

// ── Friendly rate-limit / server-busy backoff (v2.4.0 §4.4) ──────────────────

function clearBackoff() {
  if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null; }
}

// Renders a calm countdown for guard/server limiting -- never a scary error.
function showBackoff(data) {
  clearBackoff();
  let ms = Number(data && data.retryAfterMs);
  if (!Number.isFinite(ms) || ms < 1000) ms = 3000;
  if (ms > 60000) ms = 60000;
  let secs = Math.ceil(ms / 1000);
  btnSearch.disabled = true;
  const lead = data && data.error === 'server_busy'
    ? 'The archive is catching its breath'
    : 'Easy there — one sec';
  const tick = () => {
    if (secs <= 0) {
      clearBackoff();
      btnSearch.disabled = false;
      status('Ready — try that search again.', '');
      return;
    }
    status(lead + '… ready in ' + secs + 's', 'backoff');
    secs -= 1;
    backoffTimer = setTimeout(tick, 1000);
  };
  tick();
}

// ── Search ──────────────────────────────────────────────────────────────────

async function doSearch(append = false) {
  if (isLoading) return;
  if (!hasPositiveTerm()) { qEl.focus(); return; }
  const q = buildQuery();
  if (!q) { qEl.focus(); return; }

  clearBackoff();
  isLoading = true;
  btnSearch.disabled = true;
  status('Digging through the archive…', 'loading');
  let inBackoff = false;

  if (!append) {
    lastQuery     = capLen(qEl.value.trim(), MAX_TEXT_LEN);
    lastOpts      = buildOpts(0);
    currentOffset = 0;
    totalLoaded   = 0;
    loadedItems   = [];
    resultsToolbar.hidden = true;
    resultsEl.innerHTML = '';
    emptyEl.style.display = 'none';
    loadMore.style.display = 'none';
  }

  try {
    const opts = buildOpts(currentOffset);
    const data = await msg({ type: 'search', query: q, opts });

    if (!data) {
      status('Couldn’t reach the archive — check your connection and try again.', 'error');
      return;
    }

    // Client-guard / server-backoff: calm countdown, never an error card.
    if (data.error === 'rate_limited' || data.error === 'server_busy') {
      inBackoff = true;
      showBackoff(data);
      return;
    }

    if (data.error) {
      const isServerError = /^HTTP [45]\d\d/.test(data.error);
      const friendly = isServerError
        ? 'The archive didn’t answer — server hiccup on our end, try again in a moment.'
        : data.error;
      status(friendly, 'error');
      if (!append) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('.empty-icon').textContent = '⚠️';
        emptyEl.querySelector('.empty-txt').textContent = isServerError ? 'The archive didn’t answer' : data.error;
        emptyEl.querySelector('.empty-hint').textContent = isServerError ? 'Server hiccup on our end — give it another go in a moment.' : '';
      }
      return;
    }

    const total = (data.posts || []).length + (data.comments || []).length;
    renderResults(data, append);
    currentOffset += total;

    const countStr = total === 0 ? 'No results' :
      (append ? totalLoaded + ' loaded' : total + ' results');
    status(countStr + (data.godmode ? ' · ⚡ full archive' : ''), '');

    // Save to recent + update save button state (P1-4: persist full SearchState)
    if (!append && lastQuery) {
      const state = captureSearchState();
      msg({ type: 'addRecent', q: lastQuery, state });
      renderRecent();
      updateSaveBtn(lastQuery);
    }
    updateFilterBadge();
  } catch (e) {
    status('Couldn’t reach the archive — check your connection and try again.', 'error');
  } finally {
    isLoading = false;
    // Leave the button disabled while a backoff countdown owns it; showBackoff
    // re-enables when the countdown ends.
    if (!inBackoff) btnSearch.disabled = false;
  }
}

// ── Recent searches ─────────────────────────────────────────────────────────

// P1-4: recent entries may be a plain string (legacy) or { q, state }.
function recentLabel(entry) {
  const q = typeof entry === 'string' ? entry : entry.q;
  const state = typeof entry === 'string' ? null : entry.state;
  const n = countActiveFilters(state);
  return n > 0 ? q + ' (+' + n + ' filter' + (n === 1 ? '' : 's') + ')' : q;
}

async function renderRecent() {
  const resp = await msg({ type: 'getRecent' });
  const list = (resp && resp.list) || [];
  recentEl.innerHTML = '';
  list.slice(0, 8).forEach(entry => {
    const q = typeof entry === 'string' ? entry : entry.q;
    const state = typeof entry === 'string' ? null : entry.state;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = recentLabel(entry);
    chip.addEventListener('click', () => {
      if (state) restoreSearchState(state);
      else qEl.value = q;
      updateFilterBadge();
      updateDslPreview();
      doSearch();
    });
    recentEl.appendChild(chip);
  });
  recentWrap.hidden = list.length === 0;
}

// ── Save button ──────────────────────────────────────────────────────────────

async function updateSaveBtn(q) {
  if (!q) {
    btnSave.classList.remove('saved');
    btnSave.setAttribute('aria-pressed', 'false');
    return;
  }
  const resp = await msg({ type: 'getSaved' });
  const list = (resp && resp.list) || [];
  const isSaved = list.some(s => s.q === q);
  btnSave.classList.toggle('saved', isSaved);
  btnSave.title = isSaved ? 'Unsave this search' : 'Save this search';
  btnSave.setAttribute('aria-label', isSaved ? 'Unsave this search' : 'Save this search');
  btnSave.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
}

// ── Add a page ───────────────────────────────────────────────────────────────

// Normalizes near-miss URLs a real user will paste (missing protocol, www.,
// http instead of https) before validating -- the worker is the final
// arbiter of whether the post actually exists; this just avoids rejecting
// cosmetic differences that aren't the actual /p/ path gate.
function normalizeGawUrl(u) {
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/^http:\/\//i, 'https://').replace(/^https:\/\/www\./i, 'https://');
}

function looksLikeGawPostUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname === 'greatawakening.win' && parsed.pathname.startsWith('/p/');
  } catch (_e) {
    return false;
  }
}

function friendlySubmitError(data, httpStatus) {
  if (httpStatus === 429) return 'You’re adding pages too fast — wait a bit and try again.';
  if (httpStatus === 404 || httpStatus === 422) return 'Couldn’t find that post. Double-check the link, or it may have been removed.';
  if (httpStatus >= 500) return 'Something went wrong on our end. Try again in a moment.';
  return (data && data.error) || 'Couldn’t pull that one in — try again?';
}

function collapseAddCard() {
  addHdr.setAttribute('aria-expanded', 'false');
  addBody.hidden = true;
}

async function submitUrl() {
  // P1-8: explicit in-flight guard in addition to addSubmit.disabled -- rapid
  // Enter+click sequences can race past a disabled-attribute check alone.
  if (isSubmittingUrl) return;

  const raw = addUrl.value.trim();
  if (!raw) { addUrl.focus(); return; }
  const url = normalizeGawUrl(raw);
  if (!looksLikeGawPostUrl(url)) {
    addStatus.textContent = 'That’s not a GAW post link — needs to look like greatawakening.win/p/…';
    addStatus.className = 'error';
    return;
  }

  isSubmittingUrl = true;
  addSubmit.disabled = true;
  addStatus.textContent = 'Adding…';
  addStatus.className = '';

  try {
    const data = await msg({ type: 'submitUrl', url });
    if (!data || !data.ok) {
      addStatus.textContent = friendlySubmitError(data, data && data.httpStatus);
      addStatus.className = 'error';
      return;
    }
    const label = data.status === 'new' ? '✅ In the archive' : '♻️ Refreshed';
    const title = (data.post && data.post.title) || 'post';
    const shortTitle = title.length > 48 ? title.slice(0, 48) + '…' : title;
    const n = data.comments_new || 0;
    addStatus.textContent = `${label}: "${shortTitle}"` + (n ? ` — +${n} new comment${n === 1 ? '' : 's'}` : '');
    addStatus.className = 'success';
    addUrl.value = '';
    setTimeout(() => {
      if (addStatus.className === 'success') collapseAddCard();
    }, 2500);
  } catch (e) {
    addStatus.textContent = 'Couldn’t reach the archive — check your connection and try again.';
    addStatus.className = 'error';
  } finally {
    isSubmittingUrl = false;
    addSubmit.disabled = false;
  }
}

// ── Saved panel ─────────────────────────────────────────────────────────────

// P0-2: saved-search rows are built with document.createElement instead of
// innerHTML. Button label uses .textContent; aria-label uses .setAttribute()
// with a plain (non-HTML-escaped) string -- setAttribute never parses HTML,
// so escaping there would be wrong, not just unnecessary.
async function openSaved() {
  lastFocusedBeforeSaved = document.activeElement;
  const resp = await msg({ type: 'getSaved' });
  const list = (resp && resp.list) || [];
  savedList.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-empty';
    empty.appendChild(document.createTextNode('No saved searches yet.'));
    empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('Search for something and click ★ to save it.'));
    savedList.appendChild(empty);
  } else {
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'saved-item';

      const qBtn = document.createElement('button');
      qBtn.type = 'button';
      qBtn.className = 'saved-q';
      qBtn.textContent = item.q;
      qBtn.addEventListener('click', () => {
        if (item.state) restoreSearchState(item.state);
        else qEl.value = item.q;
        updateFilterBadge();
        updateDslPreview();
        closeSaved();
        doSearch();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'saved-del';
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', 'Remove saved search: ' + item.q);
      delBtn.textContent = '×';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        msg({ type: 'toggleSave', q: item.q }).then(() => openSaved());
      });

      row.appendChild(qBtn);
      row.appendChild(delBtn);
      savedList.appendChild(row);
    });
  }
  browseEl.hidden = true;
  savedPanel.hidden = false;
  $('hdr-saved-btn').setAttribute('aria-expanded', 'true');
  // P2-4: move focus into the panel when it opens.
  $('btn-saved-close').focus();
}

function closeSaved() {
  savedPanel.hidden = true;
  browseEl.hidden = false;
  $('hdr-saved-btn').setAttribute('aria-expanded', 'false');
  // P2-4: return focus to whatever opened the panel.
  if (lastFocusedBeforeSaved && typeof lastFocusedBeforeSaved.focus === 'function') {
    lastFocusedBeforeSaved.focus();
  } else {
    $('hdr-saved-btn').focus();
  }
  lastFocusedBeforeSaved = null;
}

// ── Advanced Mode + collapsible cards (v2.4.0) ───────────────────────────────

// applyAdvancedMode is SAFE to call at load: it only toggles visibility/aria/
// label (no .value reads). Persisting + preview refresh live in setAdvancedMode,
// which fires from the user toggle only.
function applyAdvancedMode(on) {
  advancedMode = on === true;
  advToggle.setAttribute('aria-checked', advancedMode ? 'true' : 'false');
  cardAdvanced.hidden = !advancedMode;
  qLabel.hidden = !advancedMode;
}

function setAdvancedMode(on) {
  applyAdvancedMode(on);
  chrome.storage.local.set({ advancedMode: advancedMode });
  updateDslPreview();
}

function updateFilterBadge() {
  if (!filtersBadge) return;
  const n = countActiveFilters(captureSearchState());
  if (n > 0) {
    filtersBadge.hidden = false;
    filtersBadge.textContent = String(n);
  } else {
    filtersBadge.hidden = true;
  }
}

// Generic collapsible-card header toggle.
function wireCard(hdr, body) {
  hdr.addEventListener('click', () => {
    const open = hdr.getAttribute('aria-expanded') !== 'true';
    hdr.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.hidden = !open;
  });
}

function collapseCard(hdr, body) {
  if (hdr.getAttribute('aria-expanded') === 'true') {
    hdr.setAttribute('aria-expanded', 'false');
    body.hidden = true;
  }
}

// Relative-date preset -> absolute YYYY-MM-DD written into the from/to inputs.
function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

function applyDatePreset() {
  const v = datePreset.value;
  if (v === 'custom') {
    dateCustomRow.hidden = false;
  } else if (v === '') {
    dateCustomRow.hidden = true;
    $('f-date-from').value = '';
    $('f-date-to').value = '';
  } else {
    dateCustomRow.hidden = true;
    const days = v === '24h' ? 1 : v === '7d' ? 7 : 30;
    $('f-date-from').value = isoDaysAgo(days);
    $('f-date-to').value = '';
  }
  updateFilterBadge();
  updateDslPreview();
}

// ── Event wiring ─────────────────────────────────────────────────────────────

btnSearch.addEventListener('click', () => doSearch());
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

btnSave.addEventListener('click', async () => {
  const q = capLen(qEl.value.trim(), MAX_TEXT_LEN);
  if (!q) return;
  const state = captureSearchState();
  await msg({ type: 'toggleSave', q, state });
  updateSaveBtn(q);
});

// Advanced Mode toggle (role=switch button; native Space/Enter -> click).
advToggle.addEventListener('click', () => setAdvancedMode(!advancedMode));

// Live DSL preview from the main box + advanced fields.
[qEl, advExact, advAny, advExclude].forEach(el => {
  el.addEventListener('input', updateDslPreview);
});

// Filter changes keep the badge + preview in sync.
['f-author', 'f-score-op', 'f-score-val', 'f-flair', 'f-min-comments', 'f-scope', 'f-sort',
 'f-date-from', 'f-date-to'].forEach(id => {
  const el = $(id);
  el.addEventListener('input', () => { updateFilterBadge(); updateDslPreview(); });
  el.addEventListener('change', () => { updateFilterBadge(); updateDslPreview(); });
});
datePreset.addEventListener('change', applyDatePreset);

// Collapsible cards.
wireCard(advCardHdr, advCardBody);
wireCard(filtersHdr, filtersBody);
addHdr.addEventListener('click', () => {
  const open = addHdr.getAttribute('aria-expanded') !== 'true';
  addHdr.setAttribute('aria-expanded', open ? 'true' : 'false');
  addBody.hidden = !open;
  if (open) addUrl.focus();
});

addSubmit.addEventListener('click', submitUrl);
addUrl.addEventListener('keydown', e => { if (e.key === 'Enter') submitUrl(); });

btnCopyResults.addEventListener('click', copyResults);
loadMore.addEventListener('click', () => doSearch(true));

$('hdr-saved-btn').addEventListener('click', openSaved);
$('btn-saved-close').addEventListener('click', closeSaved);

introDismiss.addEventListener('click', () => {
  introTip.hidden = true;
  chrome.storage.local.set({ seenIntro: 1 });
});

// P2-4: Escape closes the saved overlay first, otherwise collapses any open
// cards, and manages focus via the close helpers above.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!savedPanel.hidden) { closeSaved(); return; }
  collapseCard(advCardHdr, advCardBody);
  collapseCard(filtersHdr, filtersBody);
  collapseCard(addHdr, addBody);
});

// ── Auto update-check (v2.5.1) ──────────────────────────────────────────────
// Checks GitHub's public releases API for a newer version, throttled to once
// every 3 days. PRIVACY: this sends NO user data — it's a GET to a public API
// endpoint that returns release metadata (version tag + asset URLs). GitHub
// sees the extension's IP (like any website visit); it receives no query text,
// no account info, no identifier. The CSP (manifest.json) allows api.github.com
// specifically for this fetch — no new chrome.permissions or host_permissions
// are required. The check runs when the popup opens, only if 3 days have
// passed since the last check. Failed checks (offline, rate-limited, parse
// error) fail silently — the banner simply doesn't show.
const UPDATE_REPO = 'catsfive1/gaw-research-search';
const UPDATE_API_URL = 'https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// Compare two semver strings (e.g. "2.5.1" vs "2.6.0"). Returns true if
// `remote` is strictly newer than `local`. Strips leading "v" if present and
// tolerates non-numeric segments by treating them as 0.
function isVersionNewer(local, remote) {
  const strip = v => String(v || '').replace(/^v/i, '').trim();
  const parse = v => strip(v).split('.').map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
  const a = parse(local);
  const b = parse(remote);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
}

// Returns the current installed version from the manifest (e.g. "2.5.1").
function getInstalledVersion() {
  try {
    return chrome.runtime.getManifest().version || '';
  } catch (_e) {
    return '';
  }
}

// Runs on popup open. If 3+ days since last check, hits the GitHub API for the
// latest release. If it's newer than what's installed AND the user hasn't
// dismissed that specific version, shows the update banner with a download
// link to the latest ZIP asset.
async function maybeCheckForUpdate() {
  if (!updateBanner) return;

  const keys = await new Promise(r =>
    chrome.storage.local.get(['updateCheckTs', 'updateDismissedVer'], r));
  const now = Date.now();
  const lastCheck = Number(keys.updateCheckTs) || 0;

  // Throttle: don't hit GitHub more than once per interval.
  if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;

  // Record that we checked now (before the fetch — if the fetch fails we still
  // don't want to re-check every popup open).
  chrome.storage.local.set({ updateCheckTs: now });

  let release;
  try {
    // GitHub's public API: no auth needed for public repos. User-Agent header
    // is polite (GitHub asks for one) and identifies the extension.
    const resp = await fetch(UPDATE_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gaw-research-search-ext' },
      cache: 'no-store',
    });
    if (!resp.ok) return;
    release = await resp.json();
  } catch (_e) {
    return; // offline / network error — fail silently
  }

  if (!release || !release.tag_name) return;
  const remoteVer = String(release.tag_name).replace(/^v/i, '');
  const installedVer = getInstalledVersion();
  if (!remoteVer || !installedVer) return;
  if (!isVersionNewer(installedVer, remoteVer)) return;

  // User dismissed this exact version before? Stay quiet until a NEWER one.
  if (keys.updateDismissedVer === remoteVer) return;

  // Find the ZIP asset URL (first .zip in assets). Fallback to releases page.
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zip = assets.find(a => /\.zip$/i.test(a.name || ''));
  const dlUrl = (zip && zip.browser_download_url) || release.html_url || RELEASES_URL;

  updateBannerTxt.textContent = 'Update available — v' + remoteVer;
  updateBannerDl.href = dlUrl;
  updateBanner.hidden = false;

  // Remember the remote version we're showing the banner FOR, so the dismiss
  // handler can suppress just this version (and re-appear for a newer one).
  updateBanner.dataset.remoteVer = remoteVer;
}

// Dismiss handler: records the dismissed version so the banner stays gone
// until an even newer version ships. Does NOT reset the 3-day check clock.
if (updateBannerX) {
  updateBannerX.addEventListener('click', () => {
    updateBanner.hidden = true;
    // Suppress this specific remote version until an even newer one ships.
    const dismissedVer = updateBanner.dataset.remoteVer || '';
    if (dismissedVer) chrome.storage.local.set({ updateDismissedVer: dismissedVer });
  });
}

// ── Footer: version + debug log + check for updates (v2.5.0) ─────────────────
// Small, unobtrusive footer row at the bottom of the popup. Three elements:
//   1. Version label (read from manifest via chrome.runtime.getManifest)
//   2. "Copy debug info" — pulls the in-memory ring buffer from background.js
//      (timings/status/error class only — no secrets/tokens) and copies as text.
//   3. "Check for Updates" — opens the GitHub Releases page in a new tab.
//
// WHY NOT update_url / auto-update: Chrome ignores update_url for extensions
// installed via "Load unpacked" (developer mode). The honest, working pattern
// for GitHub distribution is a manual check: this button opens the releases
// page so the user can see if a newer version exists, then follow the update
// steps in README.md. Zero new permissions — window.open on a user gesture
// needs no host_permission or tabs permission.
const RELEASES_URL = 'https://github.com/catsfive1/gaw-research-search/releases';

function formatDebugEntry(e) {
  const when = e.ts ? new Date(e.ts).toLocaleTimeString() : '?';
  return [
    when,
    e.action || '?',
    e.endpoint || '',
    (e.durationMs != null ? e.durationMs + 'ms' : ''),
    'status=' + (e.httpStatus != null ? e.httpStatus : '?'),
    e.errorClass ? 'error=' + e.errorClass : 'ok',
    e.timedOut ? 'TIMED_OUT' : '',
  ].filter(Boolean).join(' | ');
}

function initFooter() {
  const wrap = document.createElement('div');
  wrap.id = 'footer-wrap';

  // 1. Version label — getManifest() is synchronous and needs no permission.
  const ver = document.createElement('span');
  ver.id = 'footer-version';
  try {
    const m = chrome.runtime.getManifest();
    ver.textContent = 'v' + (m.version || '?');
  } catch (_e) {
    ver.textContent = '';
  }

  // 2. Copy debug info button (P1-9, unchanged behavior).
  const debugBtn = document.createElement('button');
  debugBtn.type = 'button';
  debugBtn.id = 'debug-copy-btn';
  debugBtn.className = 'footer-btn';
  debugBtn.textContent = 'Copy debug info';
  debugBtn.addEventListener('click', async () => {
    try {
      const resp = await msg({ type: 'getDebugLog' });
      const list = (resp && resp.list) || [];
      const text = list.length === 0
        ? 'No debug entries yet.'
        : list.map(formatDebugEntry).join('\n');
      await navigator.clipboard.writeText(text);
      const original = debugBtn.textContent;
      debugBtn.textContent = 'Copied';
      setTimeout(() => { debugBtn.textContent = original; }, 1500);
    } catch (e) {
      debugBtn.textContent = 'Copy failed';
      setTimeout(() => { debugBtn.textContent = 'Copy debug info'; }, 1500);
    }
  });

  // 3. Check for Updates — opens GitHub Releases. Lets the user see the latest
  // version and follow README.md update steps. No auto-install is possible for
  // unpacked extensions, so this is the honest path.
  const updateBtn = document.createElement('button');
  updateBtn.type = 'button';
  updateBtn.id = 'update-check-btn';
  updateBtn.className = 'footer-btn';
  updateBtn.textContent = 'Check for Updates';
  updateBtn.addEventListener('click', () => {
    // window.open from the popup opens a new tab on user gesture. No extra
    // permission required (no chrome.tabs, no host_permission for github.com).
    window.open(RELEASES_URL, '_blank', 'noopener');
  });

  wrap.appendChild(ver);
  wrap.appendChild(debugBtn);
  wrap.appendChild(updateBtn);
  (browseEl || document.body).appendChild(wrap);
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  await renderRecent();
  initFooter();
  maybeCheckForUpdate(); // v2.5.1: throttled, non-blocking, silent on failure

  const stored = await new Promise(r =>
    chrome.storage.local.get(['lastQuery', 'advancedMode', 'seenIntro'], r));

  // advancedMode: written here as a boolean; sanitize to a strict boolean on read.
  applyAdvancedMode(stored.advancedMode === true);

  // First-run tip: shown unless seenIntro is set (sanitize on read = truthiness).
  introTip.hidden = Boolean(stored.seenIntro);

  // Restore last query if popup was closed mid-search.
  // P1-2: this key is written directly by this file (not via background.js's
  // message API), so it never passes through background.js's sanitization
  // helpers. Apply the same type-check + length cap here before it touches
  // the DOM, so a corrupted/wrong-type stored value can't flow into
  // qEl.value or a .textContent template string unsanitized.
  const lastQueryStored = typeof stored.lastQuery === 'string'
    ? capLen(stored.lastQuery.trim(), MAX_TEXT_LEN) : '';
  if (lastQueryStored) {
    qEl.value = lastQueryStored;
    // Results aren't restored (avoids re-hitting the worker on every popup
    // open for cost/latency reasons) -- make the empty state say so instead
    // of looking like the previous search just vanished. This is a
    // .textContent assignment, so no HTML-escaping is applied or needed
    // (P2-2: escHtml() into .textContent would double-escape).
    emptyEl.querySelector('.empty-txt').textContent = 'Press Enter to search again';
    emptyEl.querySelector('.empty-hint').textContent = `Picking up where you left off: "${lastQueryStored}"`;
    updateSaveBtn(lastQueryStored);
  }
  qEl.focus();
  qEl.select();
})();

// P2-1: debounce the lastQuery persistence write to ~300ms after the user
// stops typing, and skip the write if the value hasn't changed since the
// last write -- avoids writing chrome.storage.local on every keystroke.
let lastPersistedQuery = null;
let persistTimer = null;
qEl.addEventListener('input', () => {
  const value = qEl.value;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (value === lastPersistedQuery) return;
    lastPersistedQuery = value;
    chrome.storage.local.set({ lastQuery: value });
  }, 300);
});
