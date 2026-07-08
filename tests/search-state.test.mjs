// tests/search-state.test.mjs
//
// Covers: captureSearchState() / restoreSearchState() round-trip from
// popup.js. Both functions read/write a fixed set of DOM input elements
// via the module-level `$()` helper and various `$('f-...')` lookups, so
// rather than slicing them out standalone (which would need ~10 stubbed
// elements wired to the exact ids the real code references), this test
// builds a minimal fake DOM (a Map-backed getElementById) and loads the
// WHOLE popup.js top-level scope in a sandboxed `vm` context, then calls
// the real captureSearchState/restoreSearchState functions directly off
// that context. This exercises the actual production code paths (not a
// re-typed copy) while avoiding a full jsdom dependency (none is
// installed, and the task brief says not to add one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadSource } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');

// ---------------------------------------------------------------------------
// Minimal fake DOM: just enough for popup.js's top-level script to run
// without throwing (it wires event listeners and reads elements at load
// time), and enough for the specific #f-* inputs captureSearchState /
// restoreSearchState touch to behave like real <input>/<select> elements.
// ---------------------------------------------------------------------------
function makeFakeElement() {
  const el = {
    value: '',
    textContent: '',
    className: '',
    style: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [],
    addEventListener() {},
    appendChild(child) { el.children.push(child); return child; },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector() { return makeFakeElement(); },
    focus() {},
    select() {},
  };
  return el;
}

function buildFakeDocument() {
  const ids = [
    'q', 'btn-search', 'status-bar', 'results', 'empty', 'load-more', 'recent',
    'filter-toggle', 'filters', 'saved-panel', 'saved-list', 'btn-save',
    'hdr-add-btn', 'add-panel', 'add-url', 'btn-add-submit', 'add-status',
    'f-author', 'f-date-from', 'f-date-to', 'f-score-op', 'f-score-val',
    'f-flair', 'f-min-comments', 'f-scope', 'f-sort',
    'main-content', 'hdr-saved-btn', 'btn-saved-close',
  ];
  const byId = new Map();
  for (const id of ids) byId.set(id, makeFakeElement());

  return {
    _byId: byId,
    getElementById(id) { return byId.get(id) || makeFakeElement(); },
    createElement() { return makeFakeElement(); },
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
    body: makeFakeElement(),
    activeElement: null,
    addEventListener() {},
  };
}

function buildSandbox() {
  const document = buildFakeDocument();
  const chrome = {
    runtime: {
      sendMessage(_payload, cb) { if (cb) cb({}); },
      lastError: null,
    },
    storage: {
      local: {
        get(_keys, cb) { cb({}); },
        set() {},
      },
    },
  };
  const sandbox = {
    document,
    chrome,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    URL,
    Number,
    Date,
    Math,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Promise,
    isNaN,
    parseInt,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(popupSrc, sandbox, { filename: 'popup.js' });
  return sandbox;
}

const ctx = buildSandbox();

function setInput(id, value) {
  ctx.document._byId.get(id).value = value;
}
function getInput(id) {
  return ctx.document._byId.get(id).value;
}

// ── captureSearchState / restoreSearchState round-trip ───────────────────────

test('captureSearchState: captures every field when all filter inputs are populated', () => {
  setInput('q', '  covid origins  ');
  setInput('f-author', '  someuser  ');
  setInput('f-date-from', '2024-01-01');
  setInput('f-date-to', '2024-12-31');
  setInput('f-score-op', '>=');
  setInput('f-score-val', '  50  ');
  setInput('f-flair', '  Discussion  ');
  setInput('f-min-comments', '  10  ');
  setInput('f-scope', 'posts');
  setInput('f-sort', 'score');

  const state = ctx.captureSearchState();

  assert.equal(state.text, 'covid origins');
  assert.equal(state.author, 'someuser');
  assert.equal(state.dateFrom, '2024-01-01');
  assert.equal(state.dateTo, '2024-12-31');
  assert.equal(state.scoreOp, '>=');
  assert.equal(state.scoreVal, 50);
  assert.equal(state.flair, 'Discussion');
  assert.equal(state.minComments, 10);
  assert.equal(state.scope, 'posts');
  assert.equal(state.sort, 'score');
  assert.equal(state.schemaVersion, 1);
});

test('captureSearchState -> restoreSearchState round-trip: nothing is lost for a fully-populated state', () => {
  const original = {
    text: 'ignored-by-restore', // restoreSearchState DOES restore text into qEl
    author: 'jane',
    dateFrom: '2023-05-01',
    dateTo: '2023-06-01',
    scoreOp: '>',
    scoreVal: 25,
    flair: 'Analysis',
    minComments: 5,
    scope: 'comments',
    sort: 'date',
    schemaVersion: 1,
  };

  // Clear everything first so restore is the only source of truth.
  for (const id of ['q', 'f-author', 'f-date-from', 'f-date-to', 'f-score-op', 'f-score-val', 'f-flair', 'f-min-comments', 'f-scope', 'f-sort']) {
    setInput(id, '');
  }

  ctx.restoreSearchState(original);

  assert.equal(getInput('q'), 'ignored-by-restore');
  assert.equal(getInput('f-author'), 'jane');
  assert.equal(getInput('f-date-from'), '2023-05-01');
  assert.equal(getInput('f-date-to'), '2023-06-01');
  assert.equal(getInput('f-score-op'), '>');
  assert.equal(getInput('f-score-val'), '25');
  assert.equal(getInput('f-flair'), 'Analysis');
  assert.equal(getInput('f-min-comments'), '5');
  assert.equal(getInput('f-scope'), 'comments');
  assert.equal(getInput('f-sort'), 'date');

  // Re-capture and confirm the round-trip is stable (capture(restore(x)) == x
  // for every field restore actually writes back into inputs).
  const recaptured = ctx.captureSearchState();
  assert.equal(recaptured.author, original.author);
  assert.equal(recaptured.dateFrom, original.dateFrom);
  assert.equal(recaptured.dateTo, original.dateTo);
  assert.equal(recaptured.scoreOp, original.scoreOp);
  assert.equal(recaptured.scoreVal, original.scoreVal);
  assert.equal(recaptured.flair, original.flair);
  assert.equal(recaptured.minComments, original.minComments);
  assert.equal(recaptured.scope, original.scope);
  assert.equal(recaptured.sort, original.sort);
});

test('restoreSearchState: a null/undefined state is a no-op (does not throw, does not clear existing inputs)', () => {
  setInput('f-author', 'keepme');
  ctx.restoreSearchState(null);
  assert.equal(getInput('f-author'), 'keepme');
  ctx.restoreSearchState(undefined);
  assert.equal(getInput('f-author'), 'keepme');
});

test('restoreSearchState: empty-string scoreVal/minComments restore as empty string, not "0" or "undefined"', () => {
  ctx.restoreSearchState({ scoreVal: '', minComments: '' });
  assert.equal(getInput('f-score-val'), '');
  assert.equal(getInput('f-min-comments'), '');
});

test('restoreSearchState: missing scope/sort fall back to defaults ("both" / "relevance")', () => {
  ctx.restoreSearchState({});
  assert.equal(getInput('f-scope'), 'both');
  assert.equal(getInput('f-sort'), 'relevance');
});

test('hasActiveFilters: returns false for a fully-neutral state (all fields explicitly empty, matching what sanitizeSearchState/captureSearchState actually produce)', () => {
  const state = {
    author: '', dateFrom: '', dateTo: '', scoreOp: '', scoreVal: '',
    flair: '', minComments: '', scope: 'both', sort: 'relevance',
  };
  assert.equal(ctx.hasActiveFilters(state), false);
});

test('hasActiveFilters: returns true when any single filter field is set', () => {
  assert.equal(ctx.hasActiveFilters({ author: 'someuser', scope: 'both', sort: 'relevance' }), true);
  assert.equal(ctx.hasActiveFilters({ scope: 'posts', sort: 'relevance' }), true);
  assert.equal(ctx.hasActiveFilters({ scope: 'both', sort: 'score' }), true);
});

test('hasActiveFilters: null state returns false', () => {
  assert.equal(ctx.hasActiveFilters(null), false);
});

test('countActiveFilters: counts each independently-set filter field', () => {
  const state = {
    author: 'someuser',
    dateFrom: '2024-01-01',
    dateTo: '',
    scoreOp: '>=',
    scoreVal: 10,
    flair: '',
    minComments: '',
    scope: 'posts',
    sort: 'score',
  };
  // author, dateFrom, scoreOp+scoreVal, scope!=both, sort!=relevance = 5
  assert.equal(ctx.countActiveFilters(state), 5);
});

test('countActiveFilters: minComments of 0 does not count as an active filter (explicit zero is treated as unset)', () => {
  const state = { minComments: 0, scope: 'both', sort: 'relevance' };
  assert.equal(ctx.countActiveFilters(state), 0);
});
