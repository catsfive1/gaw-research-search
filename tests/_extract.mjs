// tests/_extract.mjs
//
// Shared helper: slice a single top-level `function name(...) { ... }`
// declaration verbatim out of popup.js / background.js source text using
// balanced-brace scanning, then compile it standalone via `new Function`.
//
// Why not require()/import the real files directly: both are plain MV3
// scripts (no `export`, no module wrapper) that reference top-level
// `document`/`chrome` globals at load time (event listeners, DOM lookups,
// IIFEs) which would throw immediately in plain Node. Slicing the target
// function's exact source and compiling it in isolation lets us exercise
// the REAL implementation text (not a re-typed copy that could drift from
// the source of truth) without needing jsdom or a chrome.* shim for the
// whole file. This mirrors the existing convention in
// gaw-modtools-extension/scripts/_p13_sus_rating_smoke_test.mjs.
//
// Limitation (by design, per the task brief): this only works for
// functions that are self-contained (reference only their own params/
// locals, or globals we explicitly inject via `extraGlobals`). Functions
// tightly coupled to module-level state (e.g. `lastOpts`, `qEl`) are
// exercised via their *effects* instead (see the SearchState / merge-sort
// tests), not by slicing them out.

import { readFileSync } from 'node:fs';

export function loadSource(relPath) {
  return readFileSync(new URL(relPath, import.meta.url), 'utf8');
}

// Finds `function <name>(` and returns the full source text of that
// function's declaration, from the `function` keyword through its
// matching closing brace, via a simple balanced-brace scan. Throws loudly
// if the function can't be found or braces don't balance -- a silent
// empty-string slice would make every test against it vacuously pass.
export function extractFunction(src, name) {
  const sigRe = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = sigRe.exec(src);
  if (!m) throw new Error('extractFunction: could not find "function ' + name + '(" in source');

  const start = m.index;
  const braceStart = src.indexOf('{', m.index);
  if (braceStart < 0) throw new Error('extractFunction: no opening brace found for ' + name);

  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('extractFunction: unbalanced braces scanning ' + name);

  return src.slice(start, i + 1);
}

// Compiles a sliced function body into a real, callable function, with an
// optional object of extra "global" names it's allowed to see (e.g. a
// stub `document`). Uses `new Function` (not `eval`) to keep the compiled
// function's scope isolated from this module's own bindings.
export function compileFunction(fnSrc, extraGlobals = {}) {
  const globalNames = Object.keys(extraGlobals);
  const factory = new Function(...globalNames, fnSrc + '\nreturn ' + fnSrc.match(/function\s+(\w+)/)[1] + ';');
  return factory(...globalNames.map(k => extraGlobals[k]));
}

// Convenience: extract + compile in one call.
export function loadFn(src, name, extraGlobals = {}) {
  const fnSrc = extractFunction(src, name);
  return compileFunction(fnSrc, extraGlobals);
}
