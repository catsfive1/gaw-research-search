// tests/anti-hammer.test.mjs
//
// Covers: the v2.4.0 CLIENT-SIDE ANTI-HAMMER helpers in background.js
// (spec §4) -- the token-bucket rate limiter (createBucket / refillBucket /
// takeToken), the short-TTL LRU result cache (cacheGet / cacheSet), the
// Retry-After parser (parseRetryAfterHeaderMs), and the cache -> dedup ->
// rate-limit funnel in handleSearch() (§4.1-4.4).
//
// The pure helpers are self-contained and sliced out standalone. The cache
// functions and handleSearch reference module-level state (the searchCache
// Map, inFlightSearches Map, SEARCH_BUCKET) and sibling functions, none of
// which are globals -- so those are injected as `extraGlobals`, wiring the
// REAL extracted functions together (e.g. handleSearch calls the real
// cacheGet/cacheSet/takeToken bound to the same Map/bucket instances). The
// only stub is doSearch (the network leaf), replaced with a controllable fake
// so the funnel is exercised without a real fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, extractFunction, compileFunction, loadFn } from './_extract.mjs';

const bgSrc = loadSource('../background.js');

// Fixed clock for the Retry-After HTTP-date branch.
const FIXED_NOW = Date.UTC(2026, 6, 10);
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() { return FIXED_NOW; }
}

const createBucket = loadFn(bgSrc, 'createBucket');
const refillBucket = loadFn(bgSrc, 'refillBucket');
const takeToken = loadFn(bgSrc, 'takeToken', { refillBucket });

// Hand-built bucket literal (avoids createBucket's Date.now() so `now` is
// fully explicit in every timing assertion).
function bucket(capacity, tokens, refillIntervalMs, lastRefill = 0, pausedUntil = 0) {
  return { capacity, tokens, refillIntervalMs, lastRefill, pausedUntil };
}

// ── createBucket ─────────────────────────────────────────────────────────────

test('createBucket: starts full and un-paused', () => {
  const b = createBucket(20, 3000);
  assert.equal(b.capacity, 20);
  assert.equal(b.tokens, 20);
  assert.equal(b.refillIntervalMs, 3000);
  assert.equal(b.pausedUntil, 0);
  assert.equal(typeof b.lastRefill, 'number');
});

// ── takeToken ────────────────────────────────────────────────────────────────

test('takeToken: consumes a token when available', () => {
  const b = bucket(3, 3, 1000, 1000);
  const r = takeToken(b, 1000);
  assert.deepEqual(r, { ok: true });
  assert.equal(b.tokens, 2);
});

test('takeToken: empty bucket before a refill interval elapses -> not ok, with retryAfterMs to the next token', () => {
  const b = bucket(3, 0, 1000, 1000);
  const r = takeToken(b, 1500); // 500ms into the 1000ms interval
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterMs, 500);
});

test('takeToken: a full interval later, one token has refilled and is consumed', () => {
  const b = bucket(3, 0, 1000, 1000);
  const r = takeToken(b, 2000); // exactly one interval later
  assert.deepEqual(r, { ok: true });
  assert.equal(b.tokens, 0); // 1 refilled, 1 taken
  assert.equal(b.lastRefill, 2000);
});

test('takeToken: refill is capped at capacity (a long idle does not over-fill)', () => {
  const b = bucket(3, 0, 1000, 0);
  const r = takeToken(b, 100000); // 100 intervals idle, but cap is 3
  assert.equal(r.ok, true);
  assert.equal(b.tokens, 2); // refilled to 3, then took 1
});

test('takeToken: honors a server-imposed pause window (§4.4) without consuming a token', () => {
  const b = bucket(3, 3, 1000, 1000, 5000); // pausedUntil = 5000
  const r = takeToken(b, 2000);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterMs, 3000); // 5000 - 2000
  assert.equal(b.tokens, 3, 'no token consumed while paused');
});

// ── refillBucket ─────────────────────────────────────────────────────────────

test('refillBucket: a bucket already at capacity just advances lastRefill', () => {
  const b = bucket(5, 5, 1000, 0);
  refillBucket(b, 5000);
  assert.equal(b.tokens, 5);
  assert.equal(b.lastRefill, 5000);
});

test('refillBucket: adds whole intervals only, advancing lastRefill by the consumed intervals (not the full elapsed)', () => {
  const b = bucket(5, 1, 1000, 1000);
  refillBucket(b, 3500); // 2500ms elapsed -> 2 whole intervals
  assert.equal(b.tokens, 3);
  assert.equal(b.lastRefill, 3000); // 1000 + 2*1000, remainder 500 preserved
});

test('refillBucket: below one interval elapsed -> no change at all', () => {
  const b = bucket(5, 1, 1000, 1000);
  refillBucket(b, 1500);
  assert.equal(b.tokens, 1);
  assert.equal(b.lastRefill, 1000);
});

// ── parseRetryAfterHeaderMs ──────────────────────────────────────────────────

const parseRetryAfterHeaderMs = loadFn(bgSrc, 'parseRetryAfterHeaderMs', { Date: FakeDate });

test('parseRetryAfterHeaderMs: delta-seconds "120" -> 120000ms', () => {
  assert.equal(parseRetryAfterHeaderMs('120'), 120000);
});

test('parseRetryAfterHeaderMs: "0" -> 0ms', () => {
  assert.equal(parseRetryAfterHeaderMs('0'), 0);
});

test('parseRetryAfterHeaderMs: clamps absurd delta-seconds to 1 hour', () => {
  assert.equal(parseRetryAfterHeaderMs('999999'), 3600000);
});

test('parseRetryAfterHeaderMs: empty / null / non-numeric-non-date -> null', () => {
  assert.equal(parseRetryAfterHeaderMs(''), null);
  assert.equal(parseRetryAfterHeaderMs(null), null);
  assert.equal(parseRetryAfterHeaderMs(undefined), null);
  assert.equal(parseRetryAfterHeaderMs('not-a-date'), null);
});

test('parseRetryAfterHeaderMs: an HTTP-date in the future -> ms until then (fixed clock)', () => {
  const httpDate = new Date(FIXED_NOW + 120000).toUTCString();
  assert.equal(parseRetryAfterHeaderMs(httpDate), 120000);
});

test('parseRetryAfterHeaderMs: an HTTP-date already in the past -> 0 (never negative)', () => {
  const httpDate = new Date(FIXED_NOW - 60000).toUTCString();
  assert.equal(parseRetryAfterHeaderMs(httpDate), 0);
});

// ── cacheGet / cacheSet (shared Map, injected TTL/MAX) ───────────────────────

function makeCache(ttl, max) {
  const searchCache = new Map();
  const cacheGet = loadFn(bgSrc, 'cacheGet', { searchCache, SEARCH_CACHE_TTL_MS: ttl });
  const cacheSet = loadFn(bgSrc, 'cacheSet', { searchCache, SEARCH_CACHE_MAX: max });
  return { searchCache, cacheGet, cacheSet };
}

test('cache: a set value is returned within the TTL window', () => {
  const { cacheGet, cacheSet } = makeCache(60000, 30);
  cacheSet('k1', { ok: true, n: 1 }, 1000);
  assert.deepEqual(cacheGet('k1', 1000), { ok: true, n: 1 });
  assert.deepEqual(cacheGet('k1', 60000), { ok: true, n: 1 }); // still within TTL
});

test('cache: an entry past its TTL is a miss and is evicted on read', () => {
  const { searchCache, cacheGet, cacheSet } = makeCache(60000, 30);
  cacheSet('k1', { ok: true }, 1000);
  assert.equal(cacheGet('k1', 1000 + 60001), null);
  assert.equal(searchCache.has('k1'), false, 'expired entry deleted on read');
});

test('cache: exceeding MAX evicts the oldest (FIFO) entry', () => {
  const { cacheGet, cacheSet } = makeCache(60000, 2);
  cacheSet('a', { v: 1 }, 0);
  cacheSet('b', { v: 2 }, 0);
  cacheSet('c', { v: 3 }, 0); // pushes size to 3 -> evict oldest ('a')
  assert.equal(cacheGet('a', 1), null);
  assert.deepEqual(cacheGet('b', 1), { v: 2 });
  assert.deepEqual(cacheGet('c', 1), { v: 3 });
});

test('cache: reading an entry bumps it to most-recent, sparing it from the next eviction (LRU)', () => {
  const { cacheGet, cacheSet } = makeCache(60000, 2);
  cacheSet('a', { v: 1 }, 0);
  cacheSet('b', { v: 2 }, 0);
  cacheGet('a', 1);               // bump 'a' -> now 'b' is oldest
  cacheSet('c', { v: 3 }, 1);     // evict oldest ('b')
  assert.deepEqual(cacheGet('a', 2), { v: 1 }, 'recently-read entry survived');
  assert.equal(cacheGet('b', 2), null, 'the un-touched entry was evicted');
});

// ── handleSearch funnel: cache -> dedup -> rate-limit -> network (§4.1-4.4) ──

// extractFunction slices from the `function` keyword, which drops the leading
// `async ` on `async function handleSearch(...)`; restore it so the compiled
// body's internal `await` is valid.
const handleSearchSrc = 'async ' + extractFunction(bgSrc, 'handleSearch');

// One shared cache/in-flight/bucket wired into the real handleSearch, with a
// controllable fake doSearch as the network leaf.
function makeFunnel() {
  const searchCache = new Map();
  const inFlightSearches = new Map();
  const cacheGet = loadFn(bgSrc, 'cacheGet', { searchCache, SEARCH_CACHE_TTL_MS: 60000 });
  const cacheSet = loadFn(bgSrc, 'cacheSet', { searchCache, SEARCH_CACHE_MAX: 30 });
  const SEARCH_BUCKET = bucket(20, 20, 3000, Date.now());

  const state = { calls: 0, resolvers: [] };
  const doSearch = () => {
    state.calls++;
    return new Promise(res => state.resolvers.push(res));
  };

  const handleSearch = compileFunction(handleSearchSrc, {
    JSON, Date, logDebug: () => {},
    cacheGet, cacheSet, inFlightSearches, takeToken, SEARCH_BUCKET, doSearch,
  });
  return { handleSearch, SEARCH_BUCKET, state };
}

test('handleSearch: two identical in-flight searches coalesce into ONE network call (§4.3 dedup)', async () => {
  const { handleSearch, state } = makeFunnel();
  const opts = { limit: 25, offset: 0, scope: 'both', sort: 'rank' };

  const p1 = handleSearch('dedupe-me', opts);
  const p2 = handleSearch('dedupe-me', opts); // same key, still in flight
  assert.equal(state.calls, 1, 'second identical request did not hit the network');

  state.resolvers[0]({ ok: true, posts: [], comments: [] });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, { ok: true, posts: [], comments: [] });
  assert.deepEqual(r2, { ok: true, posts: [], comments: [] });
});

test('handleSearch: a successful response is cached; an identical later search is served without a network call (§4.2)', async () => {
  const { handleSearch, state } = makeFunnel();
  const opts = { limit: 25, offset: 0, scope: 'both', sort: 'rank' };

  const p = handleSearch('cache-me', opts);
  state.resolvers[0]({ ok: true, posts: [{ id: 1 }], comments: [] });
  await p;
  assert.equal(state.calls, 1);

  const r = await handleSearch('cache-me', opts); // identical -> cache hit
  assert.equal(state.calls, 1, 'cached response served, no second network call');
  assert.deepEqual(r, { ok: true, posts: [{ id: 1 }], comments: [] });
});

test('handleSearch: a failed response is NOT cached (only ok:true is cached)', async () => {
  const { handleSearch, state } = makeFunnel();
  const opts = { limit: 25, offset: 0, scope: 'both', sort: 'rank' };

  const p = handleSearch('fail-me', opts);
  state.resolvers[0]({ ok: false, error: 'boom' });
  await p;
  assert.equal(state.calls, 1);

  const p2 = handleSearch('fail-me', opts); // must hit the network again
  assert.equal(state.calls, 2, 'a non-ok response was not cached');
  state.resolvers[1]({ ok: false, error: 'boom' });
  await p2;
});

test('handleSearch: an empty token bucket returns rate_limited WITHOUT a network call (§4.1)', async () => {
  const { handleSearch, SEARCH_BUCKET, state } = makeFunnel();
  SEARCH_BUCKET.tokens = 0;
  SEARCH_BUCKET.lastRefill = Date.now(); // no refill available yet
  SEARCH_BUCKET.pausedUntil = 0;

  const r = await handleSearch('rate-me', { limit: 25, offset: 0, scope: 'both', sort: 'rank' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'rate_limited');
  assert.equal(typeof r.retryAfterMs, 'number');
  assert.equal(state.calls, 0, 'no network call when the bucket is empty');
});
