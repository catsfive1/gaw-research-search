// tests/worker-any-group.test.mjs
//
// Covers: the v2.4.0 `any:` OR-group grammar addition to parseGodmodeQuery()
// in the Cloudflare Worker (cloudflare-worker/gaw-mod-proxy-v2.js, spec §5.4),
// plus regression coverage that the new branch didn't break the existing DSL
// tokens (phrase / bare / negation / field restrictors). parseGodmodeQuery is
// a self-contained top-level function, so it's sliced out of the worker source
// and compiled standalone via _extract.mjs -- the same convention the popup
// tests use.
//
// The OR keyword and parentheses in the compiled fragment come from the
// WORKER'S OWN literals -- terms are metachar-stripped first -- so a client
// can never smuggle raw FTS5 operators through the `any:` value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const workerSrc = loadSource('../../cloudflare-worker/gaw-mod-proxy-v2.js');
const parseGodmodeQuery = loadFn(workerSrc, 'parseGodmodeQuery');

// ── any: OR-group construction ───────────────────────────────────────────────

test('any: two terms -> a single (t1 OR t2) positive FTS group', () => {
  const r = parseGodmodeQuery('any:fauci,gates');
  assert.equal(r.error, undefined);
  assert.equal(r.ftsQ, '(fauci OR gates)');
  assert.deepEqual(r.where, []);
  assert.deepEqual(r.bindings, []);
});

test('any: an any-group ALONE counts as a positive term (query is not rejected)', () => {
  const r = parseGodmodeQuery('any:fauci,gates,soros');
  assert.equal(r.error, undefined);
  assert.equal(r.ftsQ, '(fauci OR gates OR soros)');
});

test('any: empty inner terms are dropped before the OR-join', () => {
  const r = parseGodmodeQuery('any:fauci,,gates');
  assert.equal(r.ftsQ, '(fauci OR gates)');
});

test('any: FTS metachars are stripped per term -- quotes/parens never enter the group', () => {
  const r = parseGodmodeQuery('any:fau(ci,ga"tes,so~ros');
  assert.equal(r.ftsQ, '(fauci OR gates OR soros)');
  // The only parens are the worker's OWN group wrappers; assert each INNER
  // term is free of every FTS metachar (that's the anti-smuggle guarantee).
  const inner = r.ftsQ.slice(1, -1).split(' OR ');
  for (const t of inner) {
    assert.ok(!/["():~^+\-]/.test(t), 'inner term carried an FTS metachar: ' + t);
  }
});

test('any: a metachar-only value contributes NO group and is ignored (does not error the whole query)', () => {
  const r = parseGodmodeQuery('covid any:(),~^');
  assert.equal(r.error, undefined);
  // The any: token collapsed to zero valid terms -> ignored; only `covid` remains.
  assert.equal(r.ftsQ, 'covid');
});

test('any: an any-only query whose terms are all metachars is rejected (no positive term)', () => {
  const r = parseGodmodeQuery('any:(),~^,+');
  assert.ok(r.error, 'expected a no-positive-term error');
  assert.equal(r.ftsQ, undefined);
});

test('any: caps at 10 terms even when more are supplied', () => {
  const r = parseGodmodeQuery('any:a,b,c,d,e,f,g,h,i,j,k,l,m');
  assert.equal(r.ftsQ, '(a OR b OR c OR d OR e OR f OR g OR h OR i OR j)');
  const inner = r.ftsQ.slice(1, -1).split(' OR ');
  assert.equal(inner.length, 10);
});

test('any: each term is capped at 64 chars', () => {
  const long = 'x'.repeat(100);
  const r = parseGodmodeQuery('any:' + long + ',bar');
  const inner = r.ftsQ.slice(1, -1).split(' OR ');
  assert.equal(inner[0].length, 64, 'first term truncated to 64 chars');
  assert.equal(inner[1], 'bar');
});

test('any: composes with a bare term and a negation into one FTS string', () => {
  const r = parseGodmodeQuery('covid any:fauci,gates -hoax');
  assert.equal(r.error, undefined);
  // Positives are joined with explicit AND (FTS5 rejects `covid (…)` implicit-
  // AND against a parenthesized group); the negation is appended as `NOT hoax`.
  assert.equal(r.ftsQ, 'covid AND (fauci OR gates) NOT hoax');
});

test('any: a bare term before an any-group is joined with AND, not a bare space (FTS5 rejects `term (group)`)', () => {
  // This is the exact shape that 500'd live before the join fix: `trump (a OR b)`
  // is an FTS5 syntax error; `trump AND (a OR b)` is valid.
  const r = parseGodmodeQuery('trump any:fauci,gates');
  assert.equal(r.error, undefined);
  assert.equal(r.ftsQ, 'trump AND (fauci OR gates)');
});

// ── Regression: the new any: branch didn't break existing grammar ────────────

test('regression: an exact "quoted phrase" still becomes a phrase token', () => {
  const r = parseGodmodeQuery('"lab leak"');
  assert.equal(r.error, undefined);
  assert.equal(r.ftsQ, '"lab leak"');
});

test('regression: bare terms are ANDed (explicit AND) and a -term becomes NOT', () => {
  const r = parseGodmodeQuery('covid vaccine -hoax');
  assert.equal(r.ftsQ, 'covid AND vaccine NOT hoax');
});

test('regression: author: restrictor produces a parameterized WHERE binding, not FTS text', () => {
  const r = parseGodmodeQuery('author:digger covid');
  assert.deepEqual(r.where, ['author = ?']);
  assert.deepEqual(r.bindings, ['digger']);
  assert.equal(r.ftsQ, 'covid');
});

test('regression: an exclude-only query is still rejected (needs a positive term)', () => {
  const r = parseGodmodeQuery('-hoax -debunked');
  assert.ok(r.error, 'exclude-only must error');
});

test('regression: score: restrictor parses the operator + integer into a binding', () => {
  const r = parseGodmodeQuery('covid score:>=50');
  assert.deepEqual(r.where, ['score >= ?']);
  assert.deepEqual(r.bindings, [50]);
  assert.equal(r.ftsQ, 'covid');
});
