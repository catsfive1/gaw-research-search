/* GAW Research Search v2.2.0 — Background Service Worker */
'use strict';

const WORKER_BASE = 'https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev';

// ── P1-9: in-memory debug ring buffer (no secrets/tokens — timings/status only) ──
const DEBUG_LOG_MAX = 20;
let debugLog = [];

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
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        data,
        error: (data && data.error) || ('HTTP ' + resp.status),
        timedOut: false,
        durationMs,
      };
    }
    return { ok: true, status: resp.status, data, error: null, timedOut: false, durationMs };
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
    };
  } finally {
    clearTimeout(timer);
  }
}

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
    doSearch(query, opts).then(sendResponse).catch(e =>
      sendResponse({ ok: false, error: e.message || String(e) })
    );
    return true;
  }

  if (msg.type === 'getSaved') {
    chrome.storage.local.get(['saved'], r => sendResponse({ list: sanitizeSavedList(r.saved) }));
    return true;
  }

  if (msg.type === 'toggleSave') {
    const q = sanitizeQueryString(msg.q, 512);
    if (!q) { sendResponse({ ok: false, error: 'Invalid query.' }); return false; }
    const state = sanitizeSearchState(msg.state);
    serialize(() => new Promise(resolve => {
      chrome.storage.local.get(['saved'], r => {
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
          sendResponse({ ok: true, saved: idx < 0 });
          resolve();
        });
      });
    })).catch(e => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }

  if (msg.type === 'getRecent') {
    chrome.storage.local.get(['recent'], r => sendResponse({ list: sanitizeRecentList(r.recent) }));
    return true;
  }

  if (msg.type === 'addRecent') {
    const q = sanitizeQueryString(msg.q, 512);
    if (!q) { sendResponse({ ok: false, error: 'Invalid query.' }); return false; }
    const state = sanitizeSearchState(msg.state);
    serialize(() => new Promise(resolve => {
      chrome.storage.local.get(['recent'], r => {
        let list = sanitizeRecentList(r.recent).filter(s => (typeof s === 'string' ? s : s.q) !== q);
        const entry = state ? { q, state } : q;
        list.unshift(entry);
        if (list.length > 30) list.length = 30;
        chrome.storage.local.set({ recent: list }, () => {
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
    headers: { 'Content-Type': 'application/json' },
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

async function doSearch(query, opts) {
  const params = new URLSearchParams();
  params.set('godmode', '1');
  params.set('q', query);
  params.set('limit', String(opts.limit));
  params.set('scope', opts.scope);
  params.set('sort', opts.sort);
  params.set('offset', String(opts.offset));

  const result = await fetchJsonWithTimeout(WORKER_BASE + '/gaw/search?' + params, {
    headers: { Accept: 'application/json' },
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
    return { ok: false, error: result.error, timedOut: result.timedOut };
  }
  return validateSearchResponse(result.data || {});
}
