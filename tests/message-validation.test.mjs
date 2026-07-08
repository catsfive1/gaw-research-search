// tests/message-validation.test.mjs
//
// Covers: background.js's message-validation helpers for the 'search'
// message type -- clampInt(), validateSearchOpts() (limit/offset clamping,
// scope/sort allowlisting), and sanitizeQueryString(). These are real
// top-level named functions in background.js (not inlined in the
// onMessage handler), so they're extracted and called directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const bgSrc = loadSource('../background.js');

const clampInt = loadFn(bgSrc, 'clampInt');
const sanitizeQueryString = loadFn(bgSrc, 'sanitizeQueryString');

// validateSearchOpts references SCOPE_VALUES/SORT_VALUES (module-level
// const arrays) and clampInt (a sibling function) -- neither is a global,
// so they must be injected for the sliced function body to resolve them.
const SCOPE_VALUES = ['both', 'posts', 'comments'];
const SORT_VALUES = ['rank', 'score', 'date'];
const validateSearchOpts = loadFn(bgSrc, 'validateSearchOpts', { SCOPE_VALUES, SORT_VALUES, clampInt });

// ── clampInt ─────────────────────────────────────────────────────────────────

test('clampInt: value within range passes through unchanged', () => {
  assert.equal(clampInt(50, 1, 100, 10), 50);
});

test('clampInt: value below min is clamped up to min', () => {
  assert.equal(clampInt(-5, 1, 100, 10), 1);
});

test('clampInt: value above max is clamped down to max', () => {
  assert.equal(clampInt(9999, 1, 100, 10), 100);
});

test('clampInt: non-numeric value falls back to default', () => {
  assert.equal(clampInt('banana', 1, 100, 10), 10);
});

test('clampInt: undefined falls back to default', () => {
  assert.equal(clampInt(undefined, 1, 100, 10), 10);
});

test('clampInt: numeric string is parsed', () => {
  assert.equal(clampInt('42', 1, 100, 10), 42);
});

test('clampInt: float string is truncated via parseInt', () => {
  assert.equal(clampInt('42.9', 1, 100, 10), 42);
});

// ── validateSearchOpts: limit/offset clamping ────────────────────────────────

test('validateSearchOpts: valid limit/offset pass through', () => {
  const out = validateSearchOpts({ limit: 25, offset: 50, scope: 'both', sort: 'rank' });
  assert.equal(out.limit, 25);
  assert.equal(out.offset, 50);
});

test('validateSearchOpts: limit is clamped to max 100', () => {
  const out = validateSearchOpts({ limit: 99999, offset: 0, scope: 'both', sort: 'rank' });
  assert.equal(out.limit, 100);
});

test('validateSearchOpts: limit is clamped to min 1', () => {
  const out = validateSearchOpts({ limit: -50, offset: 0, scope: 'both', sort: 'rank' });
  assert.equal(out.limit, 1);
});

test('validateSearchOpts: offset is clamped to max 1000', () => {
  const out = validateSearchOpts({ limit: 25, offset: 999999, scope: 'both', sort: 'rank' });
  assert.equal(out.offset, 1000);
});

test('validateSearchOpts: offset is clamped to min 0 (negative offset rejected)', () => {
  const out = validateSearchOpts({ limit: 25, offset: -10, scope: 'both', sort: 'rank' });
  assert.equal(out.offset, 0);
});

test('validateSearchOpts: missing limit defaults to 50', () => {
  const out = validateSearchOpts({ offset: 0, scope: 'both', sort: 'rank' });
  assert.equal(out.limit, 50);
});

test('validateSearchOpts: missing offset defaults to 0', () => {
  const out = validateSearchOpts({ limit: 25, scope: 'both', sort: 'rank' });
  assert.equal(out.offset, 0);
});

// ── validateSearchOpts: scope/sort allowlisting ──────────────────────────────

test('validateSearchOpts: valid scope "posts" is preserved', () => {
  const out = validateSearchOpts({ scope: 'posts' });
  assert.equal(out.scope, 'posts');
});

test('validateSearchOpts: valid scope "comments" is preserved', () => {
  const out = validateSearchOpts({ scope: 'comments' });
  assert.equal(out.scope, 'comments');
});

test('validateSearchOpts: invalid/arbitrary scope falls back to "both"', () => {
  const out = validateSearchOpts({ scope: 'DROP TABLE posts;' });
  assert.equal(out.scope, 'both');
});

test('validateSearchOpts: missing scope falls back to "both"', () => {
  const out = validateSearchOpts({});
  assert.equal(out.scope, 'both');
});

test('validateSearchOpts: valid sort "score" is preserved', () => {
  const out = validateSearchOpts({ sort: 'score' });
  assert.equal(out.sort, 'score');
});

test('validateSearchOpts: valid sort "date" is preserved', () => {
  const out = validateSearchOpts({ sort: 'date' });
  assert.equal(out.sort, 'date');
});

test('validateSearchOpts: invalid/arbitrary sort falls back to "rank"', () => {
  const out = validateSearchOpts({ sort: '<script>alert(1)</script>' });
  assert.equal(out.sort, 'rank');
});

test('validateSearchOpts: missing sort falls back to "rank"', () => {
  const out = validateSearchOpts({});
  assert.equal(out.sort, 'rank');
});

test('validateSearchOpts: non-object opts (null) does not throw and returns all defaults', () => {
  const out = validateSearchOpts(null);
  assert.equal(out.limit, 50);
  assert.equal(out.offset, 0);
  assert.equal(out.scope, 'both');
  assert.equal(out.sort, 'rank');
});

test('validateSearchOpts: non-object opts (string) does not throw and returns all defaults', () => {
  const out = validateSearchOpts('not an object');
  assert.equal(out.limit, 50);
  assert.equal(out.scope, 'both');
});

test('validateSearchOpts: opts with prototype-pollution-shaped keys does not leak them through', () => {
  const out = validateSearchOpts({ __proto__: { limit: 99999 }, scope: 'both', sort: 'rank' });
  assert.ok(out.limit <= 100);
});

// ── sanitizeQueryString ──────────────────────────────────────────────────────

test('sanitizeQueryString: non-string input returns empty string', () => {
  assert.equal(sanitizeQueryString(12345), '');
});

test('sanitizeQueryString: null returns empty string', () => {
  assert.equal(sanitizeQueryString(null), '');
});

test('sanitizeQueryString: trims whitespace', () => {
  assert.equal(sanitizeQueryString('  hello  '), 'hello');
});

test('sanitizeQueryString: collapses embedded newlines to a space', () => {
  assert.equal(sanitizeQueryString('line1\nline2'), 'line1 line2');
});

test('sanitizeQueryString: truncates to maxLen', () => {
  const long = 'x'.repeat(1000);
  assert.equal(sanitizeQueryString(long, 10).length, 10);
});

test('sanitizeQueryString: default maxLen is 512', () => {
  const long = 'x'.repeat(1000);
  assert.equal(sanitizeQueryString(long).length, 512);
});
