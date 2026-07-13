/* GAW Research Search v2.3.1 — Background Service Worker */
'use strict';

const WORKER_BASE = 'https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev';

// ── §4.5: soft client-identity header sent on every worker fetch ──
const CLIENT_ID = 'research-ext/2.4.0';

// ── P1-9: in-memory debug ring buffer (no secrets/tokens — timings/status only) ──
const DEBUG_LOG_MAX = 20;
let debugLog = [];

// Check chrome.runtime.lastError inside storage callbacks and log a debug
// entry if Chrome reports one (quota exceeded, storage corruption, etc.).
// Returns true when an error was present (callers can choose to bail).
function checkStorageError(context) {
  if (chrome.runtime.lastError) {
    logDebug({ action: 'storage_error', context, errorClass: chrome.runtime.lastError.message });
    return true;
  }
  return false;
}

function logDebug(entry) {
  debugLog.push({ ts: Date.now(), ...entry });
  if (debugLog.length > DEBUG_LOG_MAX) debugLog = debugLog.slice(-DEBUG_LOG_MAX);
}

// ── P1-1: serialize storage read-modify-write cycles to avoid races ──
let writeQueue = Promise.resolve();
function serialize(fn) {
  const p = writeQueue.then(fn, fn);
  writeQueue = p.catch(() => {});
  return p;
}

// ── P0-4: shared fetch helper with timeout/abort ──
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    const durationMs = Date.now() - start;
    // §4.4: expose the server's Retry-After (ms) so callers can back off.
    const retryAfterMs = parseRetryAfterHeaderMs(resp.headers.get('Retry-After'));
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        data,
        error: (data && data.error) || ('HTTP ' + resp.status),
        timedOut: false,
        durationMs,
        retryAfterMs,
      };
    }
    return { ok: true, status: resp.status, data, error: null, timedOut: false, durationMs, retryAfterMs };
  } catch (e) {
    const durationMs = Date.now() - start;
    const timedOut = e && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      error: timedOut ? 'Request timed out.' : (e && e.message) || String(e),
      timedOut,
      durationMs,
      retryAfterMs: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── v2.4.0 CLIENT-SIDE ANTI-HAMMER (spec §4) ─────────────────────────────────
// These guards sit IN FRONT of the existing network path (doSearch/submitUrl).
// They never replace or weaken the sanitizers / timeout wrapper. A human never
// trips them; a loop trips them immediately.

// Parse an HTTP Retry-After header value into milliseconds (null if absent/bad).
// Accepts delta-seconds ("120") or an HTTP-date; clamps to 1 hour.
function parseRetryAfterHeaderMs(headerVal) {
  if (headerVal == null || headerVal === '') return null;
  const s = String(headerVal).trim();
  if (/^\d+$/.test(s)) {
    const secs = parseInt(s, 10);
    return Number.isFinite(secs) ? Math.min(secs * 1000, 3600000) : null;
  }
  const dateMs = Date.parse(s);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? Math.min(delta, 3600000) : 0;
  }
  return null;
}

// §4.1 Token-bucket rate limiter (in-memory, per-SW-lifetime). Lazy refill:
// tokens accrue on read from elapsed time, so no timers are needed.
function createBucket(capacity, refillIntervalMs) {
  return { capacity, tokens: capacity, refillIntervalMs, lastRefill: Date.now(), pausedUntil: 0 };
}
function refillBucket(b, now) {
  if (b.tokens >= b.capacity) { b.lastRefill = now; return; }
  const elapsed = now - b.lastRefill;
  if (elapsed < b.refillIntervalMs) return;
  const add = Math.floor(elapsed / b.refillIntervalMs);
  b.tokens = Math.min(b.capacity, b.tokens + add);
  b.lastRefill += add * b.refillIntervalMs;
}
// Consume one token. Returns { ok:true } or { ok:false, retryAfterMs }.
// Honors a server-imposed pause window (set on 429/503, §4.4).
function takeToken(b, now) {
  if (now < b.pausedUntil) return { ok: false, retryAfterMs: b.pausedUntil - now };
  refillBucket(b, now);
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
  const sinceRefill = now - b.lastRefill;
  const retryAfterMs = Math.max(0, b.refillIntervalMs - sinceRefill) || b.refillIntervalMs;
  return { ok: false, retryAfterMs };
}

const SEARCH_BUCKET = createBucket(20, 3000);   // ~20 burst, then ~20/min sustained
const SUBMIT_BUCKET = createBucket(5, 12000);   // light guard; worker also IP-limits submit
const SERVER_BUSY_DEFAULT_MS = 10000;           // pause window when a 429/503 sends no Retry-After

// §4.2 Short-TTL result cache. Map is insertion-ordered → cheap LRU eviction.
const SEARCH_CACHE_TTL_MS = 60000;
const SEARCH_CACHE_MAX = 30;
const searchCache = new Map(); // key -> { ts, response }
function cacheGet(key, now) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (now - entry.ts > SEARCH_CACHE_TTL_MS) { searchCache.delete(key); return null; }
  searchCache.delete(key); searchCache.set(key, entry); // LRU: bump to most-recent
  return entry.response;
}
function cacheSet(key, response, now) {
  if (searchCache.has(key)) searchCache.delete(key);
  searchCache.set(key, { ts: now, response });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    searchCache.delete(searchCache.keys().next().value); // evict oldest
  }
}

// §4.3 In-flight de-dup / coalescing: identical live 'search' → one promise.
const inFlightSearches = new Map(); // key -> Promise<response>

// ── P1-2: schema/type validation helpers for stored values ──
function sanitizeQueryString(q, maxLen = 512) {
  if (typeof q !== 'string') return '';
  const trimmed = q.replace(/[\r\n]+/g, ' ').trim();
  return trimmed.slice(0, maxLen);
}

function sanitizeSavedList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const q = sanitizeQueryString(item.q, 512);
    if (!q) continue;
    const ts = Number.isFinite(item.ts) ? item.ts : Date.now();
    // P1-4: preserve full SearchState if present and well-formed; else just { q, ts }.
    const state = sanitizeSearchState(item.state);
    out.push(state ? { q, ts, state } : { q, ts });
    if (out.length >= 200) break;
  }
  return out;
}

function sanitizeRecentList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    // Recent entries may be legacy plain strings or { q, state } objects (P1-4).
    if (typeof item === 'string') {
      const q = sanitizeQueryString(item, 512);
      if (q) out.push(q);
    } else if (item && typeof item === 'object') {
      const q = sanitizeQueryString(item.q, 512);
      if (!q) continue;
      const state = sanitizeSearchState(item.state);
      out.push(state ? { q, state } : q);
    }
    if (out.length >= 200) break;
  }
  return out;
}

// P1-4: validate a SearchState object; return null if malformed rather than
// throwing, so callers can fall back to text-only.
const SCOPE_VALUES = ['both', 'posts', 'comments'];
const SORT_VALUES = ['rank', 'score', 'date'];

function sanitizeSearchState(state) {
  if (!state || typeof state !== 'object') return null;
  const s = {
    text: sanitizeQueryString(state.text, 256),
    author: sanitizeQueryString(state.author, 64),
    dateFrom: typeof state.dateFrom === 'string' ? state.dateFrom.slice(0, 10) : '',
    dateTo: typeof state.dateTo === 'string' ? state.dateTo.slice(0, 10) : '',
    scoreOp: ['', '>=', '>'].includes(state.scoreOp) ? state.scoreOp : '',
    scoreVal: Number.isFinite(state.scoreVal) ? state.scoreVal : '',
    flair: sanitizeQueryString(state.flair, 80),
    minComments: Number.isFinite(state.minComments) ? state.minComments : '',
    scope: SCOPE_VALUES.includes(state.scope) ? state.scope : 'both',
    sort: SORT_VALUES.includes(state.sort) ? state.sort : 'rank',
    schemaVersion: 1,
  };
  if (!s.text) return null;
  return s;
}

// ── P1-6: validate the Worker's search response shape before it reaches popup.js ──
function coerceStr(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}
function coerceNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeResultItem(item) {
  if (!item || typeof item !== 'object') item = {};
  return {
    ...item,
    score: coerceNum(item.score),
    comment_count: coerceNum(item.comment_count),
    title: coerceStr(item.title),
    author: coerceStr(item.author),
    flair: coerceStr(item.flair),
    body: coerceStr(item.body),
    body_md: coerceStr(item.body_md),
    body_html: coerceStr(item.body_html),
    content: coerceStr(item.content),
    // Comment rows' parent-post slug (added alongside the /gaw/search LEFT
    // JOIN fix) -- coerce like every other server-supplied string field
    // rather than trusting it unsanitized.
    post_slug: coerceStr(item.post_slug),
  };
}

function validateSearchResponse(data) {
  const posts = Array.isArray(data && data.posts) ? data.posts : [];
  const comments = Array.isArray(data && data.comments) ? data.comments : [];
  return {
    ...data,
    posts: posts.slice(0, 200).map(sanitizeResultItem),
    comments: comments.slice(0, 200).map(sanitizeResultItem),
  };
}

// ── P0-5: message-field validation (background.js is the real trust boundary) ──
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function validateSearchOpts(opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  return {
    limit: clampInt(opts.limit, 1, 100, 50),
    offset: clampInt(opts.offset, 0, 1000, 0),
    scope: SCOPE_VALUES.includes(opts.scope) ? opts.scope : 'both',
    sort: SORT_VALUES.includes(opts.sort) ? opts.sort : 'rank',
  };
}

function looksLikeGawPostUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && parsed.hostname === 'greatawakening.win' && parsed.pathname.startsWith('/p/');
  } catch (_e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // P0-5: sender validation — this SW's message API is for our own popup
  // only. With no externally_connectable, foreign senders can't normally
  // reach us, but we enforce the boundary explicitly: any message not from
  // this extension's own runtime is rejected before type/shape checks run.
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'Unauthorized sender.' });
    return false;
  }
  if (!msg || typeof msg !== 'object') {
    sendResponse({ ok: false, error: 'Malformed message.' });
    return false;
  }

  if (msg.type === 'search') {
    const query = sanitizeQueryString(msg.query, 512);
    if (!query) {
      sendResponse({ ok: false, error: 'Empty query.' });
      return false;
    }
    const opts = validateSearchOpts(msg.opts);
    handleSearch(query, opts).then(sendResponse).catch(e =>
      sendResponse({ ok: false, error: e.message || String(e) })
    );
    return true;
  }

  if (msg.type === 'getSaved') {
    chrome.storage.local.get(['saved'], r => {
      if (checkStorageError('getSaved')) { sendResponse({ list: [] }); return; }
      sendResponse({ list: sanitizeSavedList(r.saved) });
    });
    return true;
  }

  if (msg.type === 'toggleSave') {
    const q = sanitizeQueryString(msg.q, 512);
    if (!q) { sendResponse({ ok: false, error: 'Invalid query.' }); return false; }
    const state = sanitizeSearchState(msg.state);
    serialize(() => new Promise(resolve => {
      chrome.storage.local.get(['saved'], r => {
        checkStorageError('toggleSave.get');
        let list = sanitizeSavedList(r.saved);
        const idx = list.findIndex(s => s.q === q);
        if (idx >= 0) {
          list.splice(idx, 1);
        } else {
          const entry = { q, ts: Date.now() };
          if (state) entry.state = state;
          list.unshift(entry);
          if (list.length > 100) list.length = 100;
        }
        chrome.storage.local.set({ saved: list }, () => {
          if (checkStorageError('toggleSave.set')) {
            sendResponse({ ok: false, error: 'Couldn’t save — storage unavailable.' });
            resolve();
            return;
          }
          sendResponse({ ok: true, saved: idx < 0 });
          resolve();
        });
      });
    })).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }

  if (msg.type === 'getRecent') {
    chrome.storage.local.get(['recent'], r => {
      if (checkStorageError('getRecent')) { sendResponse({ list: [] }); return; }
      sendResponse({ list: sanitizeRecentList(r.recent) });
    });
    return true;
  }

  if (msg.type === 'addRecent') {
    const q = sanitizeQueryString(msg.q, 512);
    if (!q) { sendResponse({ ok: false, error: 'Invalid query.' }); return false; }
    const state = sanitizeSearchState(msg.state);
    serialize(() => new Promise(resolve => {
      chrome.storage.local.get(['recent'], r => {
        checkStorageError('addRecent.get');
        let list = sanitizeRecentList(r.recent).filter(s => (typeof s === 'string' ? s : s.q) !== q);
        const entry = state ? { q, state } : q;
        list.unshift(entry);
        if (list.length > 30) list.length = 30;
        chrome.storage.local.set({ recent: list }, () => {
          if (checkStorageError('addRecent.set')) {
            sendResponse({ ok: false, error: 'Couldn’t save — storage unavailable.' });
            resolve();
            return;
          }
          sendResponse({ ok: true });
          resolve();
        });
      });
    })).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }

  if (msg.type === 'submitUrl') {
    // Re-validate strictly even though popup.js already checked — background.js
    // must not trust its caller (P0-5).
    const url = typeof msg.url === 'string' ? msg.url : '';
    if (!looksLikeGawPostUrl(url)) {
      sendResponse({ ok: false, error: 'Not a valid greatawakening.win post link.' });
      return false;
    }
    // §4.1: light client bucket (worker also IP-limits submit-url server-side).
    const submitTake = takeToken(SUBMIT_BUCKET, Date.now());
    if (!submitTake.ok) {
      sendResponse({ ok: false, error: 'rate_limited', retryAfterMs: submitTake.retryAfterMs });
      return false;
    }
    submitUrl(url).then(sendResponse).catch(e =>
      sendResponse({ ok: false, error: e.message || String(e) })
    );
    return true;
  }

  if (msg.type === 'getDebugLog') {
    sendResponse({ list: debugLog.slice() });
    return false;
  }

  sendResponse({ ok: false, error: 'Unknown message type.' });
  return false;
});

async function submitUrl(url) {
  const result = await fetchJsonWithTimeout(WORKER_BASE + '/gaw/submit-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GAW-Client': CLIENT_ID },
    body: JSON.stringify({ url }),
  });
  logDebug({
    action: 'submitUrl',
    endpoint: '/gaw/submit-url',
    durationMs: result.durationMs,
    httpStatus: result.status,
    errorClass: result.ok ? null : (result.timedOut ? 'timeout' : 'http_error'),
    timedOut: result.timedOut,
  });
  if (!result.ok) {
    return { ok: false, error: result.error, httpStatus: result.status, timedOut: result.timedOut };
  }
  return result.data;
}

// §4 guard funnel: cache -> dedup -> rate-limit -> network. Sits IN FRONT of
// doSearch; doSearch still owns all response validation/sanitization.
async function handleSearch(query, opts) {
  const key = JSON.stringify({ query, opts });
  const now = Date.now();

  // §4.2 cache hit — no token, no network.
  const cached = cacheGet(key, now);
  if (cached) {
    logDebug({ action: 'search', endpoint: '/gaw/search', served: 'cache' });
    return cached;
  }

  // §4.3 identical request already in flight — coalesce; no token, no 2nd request.
  const pending = inFlightSearches.get(key);
  if (pending) {
    logDebug({ action: 'search', endpoint: '/gaw/search', served: 'dedup' });
    return pending;
  }

  // §4.1 / §4.4 token bucket (also enforces any active server-pause window).
  const take = takeToken(SEARCH_BUCKET, now);
  if (!take.ok) {
    logDebug({ action: 'search', endpoint: '/gaw/search', guard: 'rate_limited', retryAfterMs: take.retryAfterMs });
    return { ok: false, error: 'rate_limited', retryAfterMs: take.retryAfterMs };
  }

  const p = doSearch(query, opts);
  inFlightSearches.set(key, p);
  try {
    const resp = await p;
    if (resp && resp.ok === true) cacheSet(key, resp, Date.now());
    return resp;
  } finally {
    inFlightSearches.delete(key);
  }
}

async function doSearch(query, opts) {
  const params = new URLSearchParams();
  params.set('godmode', '1');
  params.set('q', query);
  params.set('limit', String(opts.limit));
  params.set('scope', opts.scope);
  params.set('sort', opts.sort);
  params.set('offset', String(opts.offset));

  const result = await fetchJsonWithTimeout(WORKER_BASE + '/gaw/search?' + params, {
    headers: { Accept: 'application/json', 'X-GAW-Client': CLIENT_ID },
  });
  logDebug({
    action: 'search',
    endpoint: '/gaw/search',
    durationMs: result.durationMs,
    httpStatus: result.status,
    errorClass: result.ok ? null : (result.timedOut ? 'timeout' : 'http_error'),
    timedOut: result.timedOut,
  });
  if (!result.ok) {
    // §4.4 server-backoff: worker is shedding load -> surface a distinct shape
    // and pause the local bucket so the SW stops hammering during the window.
    if (result.status === 429 || result.status === 503) {
      const retryAfterMs = result.retryAfterMs != null ? result.retryAfterMs : SERVER_BUSY_DEFAULT_MS;
      SEARCH_BUCKET.pausedUntil = Date.now() + retryAfterMs;
      return { ok: false, error: 'server_busy', httpStatus: result.status, retryAfterMs };
    }
    return { ok: false, error: result.error, timedOut: result.timedOut };
  }
  return validateSearchResponse(result.data || {});
}
