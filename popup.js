/* GAW Research Search v2.3.1 — Popup Logic */
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
let lastFocusedBeforeAdd = null;

// Elements
const qEl        = $('q');
const btnSearch  = $('btn-search');
const statusBar  = $('status-bar');
const resultsEl  = $('results');
const emptyEl    = $('empty');
const loadMore   = $('load-more');
const recentEl   = $('recent');
const filterTog  = $('filter-toggle');
const filtersEl  = $('filters');
const savedPanel = $('saved-panel');
const savedList  = $('saved-list');
const btnSave    = $('btn-save');
const addBtn     = $('hdr-add-btn');
const addPanel   = $('add-panel');
const addUrl     = $('add-url');
const addSubmit  = $('btn-add-submit');
const addStatus  = $('add-status');

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

// ── Filters → query string ──────────────────────────────────────────────────

function buildQuery() {
  let q = capLen(qEl.value.trim(), MAX_TEXT_LEN);
  if (!q) return '';

  const author      = capLen($('f-author').value.trim(), MAX_AUTHOR_LEN);
  const dateFrom    = $('f-date-from').value;
  const dateTo      = $('f-date-to').value;
  const scoreOp     = $('f-score-op').value;
  const scoreValRaw = $('f-score-val').value.trim();
  const flair       = capLen($('f-flair').value.trim(), MAX_FLAIR_LEN);
  const minCommentsRaw = $('f-min-comments').value.trim();

  if (author)   q += ' author:' + quoteDslValue(author);
  if (dateFrom) q += ' date:>=' + dateFrom;
  if (dateTo)   q += ' date:<=' + dateTo;

  // score/minComments are numeric-only inputs -- validate they actually parse
  // as integers before use, ignoring non-numeric garbage rather than smuggling
  // it into the DSL string.
  if (scoreOp && scoreValRaw !== '') {
    const scoreVal = parseInt(scoreValRaw, 10);
    if (Number.isFinite(scoreVal)) q += ' score:' + scoreOp + scoreVal;
  }
  if (flair) q += ' flair:' + quoteDslValue(flair);
  if (minCommentsRaw !== '') {
    const minComments = parseInt(minCommentsRaw, 10);
    if (Number.isFinite(minComments) && minComments >= 0) q += ' min_comments:' + minComments;
  }

  return q;
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

// ── Search ──────────────────────────────────────────────────────────────────

async function doSearch(append = false) {
  if (isLoading) return;
  const q = buildQuery();
  if (!q) { qEl.focus(); return; }

  isLoading = true;
  btnSearch.disabled = true;
  status('Digging through the archive…', 'loading');

  if (!append) {
    lastQuery     = capLen(qEl.value.trim(), MAX_TEXT_LEN);
    lastOpts      = buildOpts(0);
    currentOffset = 0;
    totalLoaded   = 0;
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
  } catch (e) {
    status('Couldn’t reach the archive — check your connection and try again.', 'error');
  } finally {
    isLoading = false;
    btnSearch.disabled = false;
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
      doSearch();
    });
    recentEl.appendChild(chip);
  });
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
      if (addStatus.className === 'success') closeAddPanel();
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
    empty.style.padding = '20px';
    empty.style.textAlign = 'center';
    empty.style.color = 'var(--text3)';
    empty.style.fontSize = '12px';
    const line1 = document.createTextNode('No saved searches yet.');
    const br = document.createElement('br');
    const line2 = document.createTextNode('Search for something and click ★ to save it.');
    empty.appendChild(line1);
    empty.appendChild(br);
    empty.appendChild(line2);
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
  savedPanel.classList.add('visible');
  $('main-content').style.display = 'none';
  $('hdr-saved-btn').setAttribute('aria-expanded', 'true');
  // P2-4: move focus into the panel when it opens.
  $('btn-saved-close').focus();
}

function closeSaved() {
  savedPanel.classList.remove('visible');
  $('main-content').style.display = 'flex';
  $('hdr-saved-btn').setAttribute('aria-expanded', 'false');
  // P2-4: return focus to whatever opened the panel.
  if (lastFocusedBeforeSaved && typeof lastFocusedBeforeSaved.focus === 'function') {
    lastFocusedBeforeSaved.focus();
  } else {
    $('hdr-saved-btn').focus();
  }
  lastFocusedBeforeSaved = null;
}

function closeAddPanel() {
  addPanel.classList.remove('visible');
  addPanel.setAttribute('aria-hidden', 'true');
  addBtn.setAttribute('aria-expanded', 'false');
  if (lastFocusedBeforeAdd && typeof lastFocusedBeforeAdd.focus === 'function') {
    lastFocusedBeforeAdd.focus();
  }
  lastFocusedBeforeAdd = null;
}

function closeFilters() {
  filterTog.classList.remove('open');
  filtersEl.classList.remove('visible');
  filterTog.setAttribute('aria-expanded', 'false');
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

filterTog.addEventListener('click', () => {
  const opening = !filtersEl.classList.contains('visible');
  if (opening) closeAddPanel();
  filterTog.classList.toggle('open', opening);
  filtersEl.classList.toggle('visible', opening);
  filterTog.setAttribute('aria-expanded', opening ? 'true' : 'false');
});

addBtn.addEventListener('click', () => {
  const opening = !addPanel.classList.contains('visible');
  if (opening) {
    closeFilters();
    lastFocusedBeforeAdd = document.activeElement;
  }
  addPanel.classList.toggle('visible', opening);
  addPanel.setAttribute('aria-hidden', opening ? 'false' : 'true');
  addBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  if (opening) addUrl.focus();
});
addSubmit.addEventListener('click', submitUrl);
addUrl.addEventListener('keydown', e => { if (e.key === 'Enter') submitUrl(); });

loadMore.addEventListener('click', () => doSearch(true));

$('hdr-saved-btn').addEventListener('click', openSaved);
$('btn-saved-close').addEventListener('click', closeSaved);

// P2-4: Escape closes whichever panel(s) are currently open, and manages
// focus via the close helpers above.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (savedPanel.classList.contains('visible')) {
    closeSaved();
  }
  if (addPanel.classList.contains('visible')) {
    closeAddPanel();
  }
  if (filtersEl.classList.contains('visible')) {
    closeFilters();
  }
});

// ── Debug log (P1-9) ─────────────────────────────────────────────────────────
// Small, unobtrusive "Copy debug info" link at the bottom of the popup. Pulls
// the in-memory ring buffer from background.js (timings/status/error class
// only -- no secrets/tokens) and copies it as plain text.
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

function initDebugLink() {
  const wrap = document.createElement('div');
  wrap.id = 'debug-link-wrap';
  wrap.style.cssText = 'flex-shrink:0;padding:4px 14px 6px;text-align:center';

  const link = document.createElement('button');
  link.type = 'button';
  link.id = 'debug-copy-btn';
  link.textContent = 'Copy debug info';
  link.style.cssText = 'background:none;border:none;color:var(--text3);font-size:10px;' +
    'cursor:pointer;padding:2px 6px;opacity:.6;transition:opacity .15s';
  link.addEventListener('mouseenter', () => { link.style.opacity = '1'; });
  link.addEventListener('mouseleave', () => { link.style.opacity = '.6'; });

  link.addEventListener('click', async () => {
    try {
      const resp = await msg({ type: 'getDebugLog' });
      const list = (resp && resp.list) || [];
      const text = list.length === 0
        ? 'No debug entries yet.'
        : list.map(formatDebugEntry).join('\n');
      await navigator.clipboard.writeText(text);
      const original = link.textContent;
      link.textContent = 'Copied';
      setTimeout(() => { link.textContent = original; }, 1500);
    } catch (e) {
      link.textContent = 'Copy failed';
      setTimeout(() => { link.textContent = 'Copy debug info'; }, 1500);
    }
  });

  wrap.appendChild(link);
  document.body.appendChild(wrap);
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  await renderRecent();
  initDebugLink();
  // Restore last query if popup was closed mid-search
  const stored = await new Promise(r => chrome.storage.local.get(['lastQuery'], r));
  // P1-2: this key is written directly by this file (not via background.js's
  // message API), so it never passes through background.js's sanitization
  // helpers. Apply the same type-check + length cap here before it touches
  // the DOM, so a corrupted/wrong-type stored value can't flow into
  // qEl.value or a .textContent template string unsanitized.
  const lastQuery = typeof stored.lastQuery === 'string' ? capLen(stored.lastQuery.trim(), MAX_TEXT_LEN) : '';
  if (lastQuery) {
    qEl.value = lastQuery;
    // Results aren't restored (avoids re-hitting the worker on every popup
    // open for cost/latency reasons) -- make the empty state say so instead
    // of looking like the previous search just vanished. This is a
    // .textContent assignment, so no HTML-escaping is applied or needed
    // (P2-2: escHtml() into .textContent would double-escape).
    emptyEl.querySelector('.empty-txt').textContent = 'Press Enter to search again';
    emptyEl.querySelector('.empty-hint').textContent = `Picking up where you left off: "${lastQuery}"`;
    updateSaveBtn(lastQuery);
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
