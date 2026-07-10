// tests/advanced-dsl.test.mjs
//
// Covers: the v2.4.0 Advanced Search card -> query-DSL compilation in
// popup.js's buildQuery() (spec §3.4), plus hasPositiveTerm(). These read the
// #q main box + #adv-exact / #adv-any / #adv-exclude fields + the filter
// inputs, gated on the module-level `advancedMode` flag, so they're exercised
// through the real whole-file sandbox (see tests/_sandbox.mjs). Advanced Mode
// is toggled via the real applyAdvancedMode() -- never a poked-in value.
//
// The load-bearing guarantee under test (spec §0 / §3.4): NO raw FTS5
// metachar (quote, paren, colon, etc.) from an advanced field ever reaches
// the `q` string un-quoted/un-stripped. Exact phrase gets wrapped and its
// embedded quotes neutralized; any-of / exclude terms are reduced to word
// chars only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPopupSandbox } from './_sandbox.mjs';

const { ctx, setInput } = buildPopupSandbox();

// Reset every input the compiler touches, so each test starts from a clean
// slate regardless of order (the sandbox/ctx is shared across the file).
function clearAll() {
  for (const id of ['q', 'adv-exact', 'adv-any', 'adv-exclude', 'f-author',
    'f-date-from', 'f-date-to', 'f-score-op', 'f-score-val', 'f-flair',
    'f-min-comments', 'f-scope', 'f-sort']) {
    setInput(id, '');
  }
}

// ── Advanced Mode OFF: only the main box + filters contribute (v2.3.x) ────────

test('buildQuery: with Advanced Mode OFF, advanced fields are ignored entirely', () => {
  clearAll();
  ctx.applyAdvancedMode(false);
  setInput('q', 'covid origins');
  setInput('adv-exact', 'should be ignored');
  setInput('adv-any', 'alpha beta');
  setInput('adv-exclude', 'hoax');
  assert.equal(ctx.buildQuery(), 'covid origins');
});

// ── Exact phrase -> a single quoted phrase token ─────────────────────────────

test('buildQuery: exact phrase compiles to one "quoted" token', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-exact', 'weapons of mass destruction');
  assert.equal(ctx.buildQuery(), '"weapons of mass destruction"');
});

test('buildQuery: exact phrase strips embedded double-quotes so it cannot break out of its own phrase (no metachar leak)', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-exact', 'foo"bar OR baz');
  const q = ctx.buildQuery();
  // The lone embedded quote is replaced with a space, then the whole value is
  // wrapped -> exactly two quote chars, both at the ends, OR stays literal
  // text INSIDE the phrase (not an FTS operator).
  assert.equal(q, '"foo bar OR baz"');
  assert.equal((q.match(/"/g) || []).length, 2, 'exactly two quote chars (the wrappers)');
  assert.ok(q.startsWith('"') && q.endsWith('"'));
});

test('buildQuery: exact phrase that is only quotes/whitespace collapses to nothing (no dangling empty phrase)', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('q', 'anchor');
  setInput('adv-exact', '"""   ');
  assert.equal(ctx.buildQuery(), 'anchor');
});

// ── Any-of-these -> any:w1,w2,w3 (worker builds the OR-group) ─────────────────

test('buildQuery: any-of-these compiles to a single any:w1,w2,w3 token', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-any', 'fauci gates soros');
  assert.equal(ctx.buildQuery(), 'any:fauci,gates,soros');
});

test('buildQuery: any-of accepts comma OR space separators interchangeably', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-any', 'fauci, gates ,  soros');
  assert.equal(ctx.buildQuery(), 'any:fauci,gates,soros');
});

test('buildQuery: any-of strips FTS metachars per term -- quotes/parens/colons never enter the DSL', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-any', 'foo"bar (baz) qu:ux');
  const q = ctx.buildQuery();
  assert.equal(q, 'any:foobar,baz,quux');
  // Check the VALUE portion (after the legitimate `any:` field separator):
  // no raw FTS metachar survived, only clean words joined by the comma delim.
  const anyValue = q.replace(/^any:/, '');
  assert.ok(!/["():~^]/.test(anyValue), 'compiled any: value must contain no FTS metachars');
});

test('buildQuery: any-of caps at 10 terms (loop-bomb / over-broad OR guard)', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-any', 'a b c d e f g h i j k l m n');
  const q = ctx.buildQuery();
  const list = q.replace(/^any:/, '').split(',');
  assert.equal(list.length, 10);
  assert.deepEqual(list, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
});

// ── Exclude -> -word each (cleaned) ──────────────────────────────────────────

test('buildQuery: exclude terms each become a -word token', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('q', 'election');
  setInput('adv-exclude', 'hoax debunked');
  assert.equal(ctx.buildQuery(), 'election -hoax -debunked');
});

test('buildQuery: exclude terms are metachar-stripped -- no operator smuggling via the exclude box', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('q', 'election');
  setInput('adv-exclude', 'ho"ax (fake)');
  const q = ctx.buildQuery();
  assert.equal(q, 'election -hoax -fake');
  assert.ok(!/["()]/.test(q));
});

// ── Combined composition: main + exact + any + exclude + filters ─────────────

test('buildQuery: composes main box + exact phrase + any-group + excludes + author filter in order', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('q', 'covid');
  setInput('adv-exact', 'lab leak');
  setInput('adv-any', 'fauci wuhan');
  setInput('adv-exclude', 'debunked');
  setInput('f-author', 'digger');
  assert.equal(
    ctx.buildQuery(),
    'covid "lab leak" any:fauci,wuhan -debunked author:digger'
  );
});

test('buildQuery: a filter value with whitespace/quote gets routed through quoteDslValue (author cannot smuggle DSL)', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('q', 'anchor');
  setInput('f-author', 'foo"bar OR baz');
  const q = ctx.buildQuery();
  // author value is quoted and its inner quote escaped -- never bare.
  assert.ok(q.includes('author:"foo\\"bar OR baz"'), 'author must be quoted+escaped: ' + q);
});

test('buildQuery: numeric score filter compiles to score:<op><int>, ignoring non-numeric garbage', () => {
  clearAll();
  ctx.applyAdvancedMode(false);
  setInput('q', 'anchor');
  setInput('f-score-op', '>=');
  setInput('f-score-val', '50');
  assert.equal(ctx.buildQuery(), 'anchor score:>=50');

  setInput('f-score-val', 'not-a-number');
  assert.equal(ctx.buildQuery(), 'anchor', 'non-numeric score value is dropped, not smuggled');
});

// ── hasPositiveTerm: mirrors what the worker will accept ─────────────────────

test('hasPositiveTerm: true when the main box has text', () => {
  clearAll();
  ctx.applyAdvancedMode(false);
  setInput('q', 'covid');
  assert.equal(ctx.hasPositiveTerm(), true);
});

test('hasPositiveTerm: an exact-phrase-only advanced query IS positive', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-exact', 'lab leak');
  assert.equal(ctx.hasPositiveTerm(), true);
});

test('hasPositiveTerm: an any-group-only advanced query IS positive', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-any', 'fauci gates');
  assert.equal(ctx.hasPositiveTerm(), true);
});

test('hasPositiveTerm: an exclude-ONLY advanced query is NOT positive (worker rejects exclude-only)', () => {
  clearAll();
  ctx.applyAdvancedMode(true);
  setInput('adv-exclude', 'hoax');
  assert.equal(ctx.hasPositiveTerm(), false);
});

test('hasPositiveTerm: advanced fields do not count when Advanced Mode is OFF', () => {
  clearAll();
  ctx.applyAdvancedMode(false);
  setInput('adv-exact', 'lab leak');
  setInput('adv-any', 'fauci gates');
  assert.equal(ctx.hasPositiveTerm(), false);
});
