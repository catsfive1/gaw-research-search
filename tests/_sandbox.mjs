// tests/_sandbox.mjs
//
// Shared helper: load the WHOLE popup.js top-level script into a sandboxed
// `vm` context backed by a minimal fake DOM, then hand the caller the real
// top-level functions off that context. This is the second technique
// documented in tests/README.md (the first being the standalone-slice
// approach in _extract.mjs).
//
// Why the whole-file sandbox is needed for these tests: buildQuery(),
// hasPositiveTerm(), buildDateDsl(), applyDatePreset(), copyResults() and
// renderResults() read/write a fixed set of DOM elements via the module-level
// `$()` helper AND depend on module-level mutable state (`advancedMode`,
// `loadedItems`, `lastOpts`, `lastQuery`). Slicing them out standalone would
// require re-creating all of that state by hand -- a re-typed copy that could
// drift. Loading the real file into a fake-DOM context exercises the ACTUAL
// shipped code, with `advancedMode` toggled through the real
// applyAdvancedMode() and `loadedItems` populated through the real
// renderResults(), exactly as the popup does at runtime.
//
// Note on vm scoping: top-level `function foo(){}` declarations become
// properties of the sandbox global (callable as ctx.foo), but top-level
// `let`/`const` bindings do NOT (per the ES spec's global lexical scope).
// That's why module state like `advancedMode` / `loadedItems` can only be
// driven through the exported functions, never set directly -- which is
// exactly what we want (test the real transitions, not a poked-in value).

import vm from 'node:vm';
import { loadSource } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');

// Every element id popup.js looks up at load time (const captures) or that the
// functions under test read/write. Ids not in this list still resolve (to a
// throwaway fake element) so the file loads; ids IN this list are stable
// instances the const captured AND that setInput/getInput can address.
const ELEMENT_IDS = [
  'q', 'q-label', 'btn-search', 'btn-save', 'status-bar', 'results', 'empty',
  'load-more', 'recent', 'recent-wrap', 'browse', 'saved-panel', 'saved-list',
  'adv-toggle', 'card-advanced', 'adv-card-hdr', 'adv-card-body',
  'adv-exact', 'adv-any', 'adv-exclude', 'dsl-preview',
  'filters-hdr', 'filters-body', 'filters-badge', 'f-date-preset', 'date-custom-row',
  'add-hdr', 'add-body', 'add-url', 'btn-add-submit', 'add-status',
  'results-toolbar', 'results-count', 'btn-copy-results', 'intro-tip', 'intro-tip-dismiss',
  'f-author', 'f-date-from', 'f-date-to', 'f-score-op', 'f-score-val',
  'f-flair', 'f-min-comments', 'f-scope', 'f-sort',
  'hdr-saved-btn', 'btn-saved-close',
];

function makeFakeElement() {
  const el = {
    value: '',
    textContent: '',
    className: '',
    hidden: false,
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
  const byId = new Map();
  for (const id of ELEMENT_IDS) byId.set(id, makeFakeElement());
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

// Builds and returns { ctx, setInput, getInput }. `opts.Date` lets a caller
// inject a fixed-clock Date (for deterministic relative-date preset tests);
// it defaults to the real Date.
export function buildPopupSandbox(opts = {}) {
  const document = buildFakeDocument();
  const clipboardWrites = [];
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
    navigator: {
      clipboard: {
        writeText(text) { clipboardWrites.push(text); return Promise.resolve(); },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    Number,
    Date: opts.Date || Date,
    Math,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    RegExp,
    Promise,
    isNaN,
    parseInt,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox._clipboardWrites = clipboardWrites;
  vm.createContext(sandbox);
  vm.runInContext(popupSrc, sandbox, { filename: 'popup.js' });

  const setInput = (id, value) => { document._byId.get(id).value = value; };
  const getInput = (id) => document._byId.get(id).value;
  return { ctx: sandbox, setInput, getInput };
}
