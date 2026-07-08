// tests/dom-rendering.test.mjs
//
// Covers: the post-rewrite DOM-construction helpers that replaced the old
// innerHTML+escHtml rendering path -- appendHighlighted() (real DOM nodes:
// text + <mark>, not an HTML string) and buildResultCard() (whole result
// card built via document.createElement/.textContent, no innerHTML
// anywhere). The rewrite's premise is that HTML-escaping is no longer
// needed because nothing is ever assigned to innerHTML with user data in
// it -- these tests confirm dangerous characters (&, <, >, quotes,
// apostrophes) survive as literal TEXT content and are never interpreted
// as markup, by using a small fake DOM that records what would happen if
// this were rendered (real tag structure, real text nodes) without
// needing a browser or jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadSource } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');

// ---------------------------------------------------------------------------
// A small but REAL fake DOM: elements track their own children/text nodes
// as a tree (not just flat calls), so we can walk the resulting structure
// and assert dangerous characters never appear as unescaped markup -- i.e.
// we render the tree back out as a naive string and confirm it looks like
// escaped/text content, not live tags.
// ---------------------------------------------------------------------------
class FakeTextNode {
  constructor(text) { this.nodeType = 3; this.textContent = String(text); }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.nodeType = 1;
    this._attrs = {};
    this._children = [];
    this._className = '';
    this.href = '';
    this.target = '';
    this.rel = '';
    this._textContent = '';
    this.style = {};
    this.id = '';
    this.type = '';
  }
  get className() { return this._className; }
  set className(v) { this._className = v; }
  set textContent(v) {
    this._textContent = String(v);
    this._children = [new FakeTextNode(v)];
  }
  get textContent() {
    // Mirror real DOM semantics: textContent getter concatenates all
    // descendant text nodes.
    const walk = (node) => {
      if (node.nodeType === 3) return node.textContent;
      return (node._children || []).map(walk).join('');
    };
    return walk(this);
  }
  appendChild(child) { this._children.push(child); return child; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  removeAttribute(k) { delete this._attrs[k]; }
  querySelector() { return new FakeElement('div'); }
  addEventListener() {}
  focus() {}
  select() {}
  // Serializes the tree the way a naive "just concatenate tag text" HTML
  // renderer would -- if a helper ever smuggled a raw '<script>' string
  // into a text node's content and something re-parsed it as HTML, this
  // would reveal it. Since we control serialization here (not relying on
  // a real HTML parser), the real assertion is on tagName/nodeType of
  // each node in the tree (see tests below), not this string.
  serialize() {
    const walk = (node) => {
      if (node.nodeType === 3) return node.textContent;
      const inner = (node._children || []).map(walk).join('');
      return '<' + node.tagName.toLowerCase() + '>' + inner + '</' + node.tagName.toLowerCase() + '>';
    };
    return walk(this);
  }
}

function buildSandbox() {
  const document = {
    createElement(tag) { return new FakeElement(tag); },
    createTextNode(text) { return new FakeTextNode(text); },
    getElementById() { return new FakeElement('div'); },
    body: new FakeElement('body'),
    activeElement: null,
    addEventListener() {},
  };
  const chrome = {
    runtime: { sendMessage(_p, cb) { if (cb) cb({}); }, lastError: null },
    storage: { local: { get(_k, cb) { cb({}); }, set() {} } },
  };
  const sandbox = {
    document, chrome, console, setTimeout, clearTimeout, URL,
    Number, Date, Math, String, Boolean, Array, Object, RegExp, Promise,
    isNaN, parseInt,
    navigator: { clipboard: { writeText: async () => {} } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(popupSrc, sandbox, { filename: 'popup.js' });
  return sandbox;
}

const ctx = buildSandbox();

// ── appendHighlighted: dangerous characters as real text/mark nodes ─────────

test('appendHighlighted: plain text with no query match becomes a single text node (no markup interpretation)', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, 'Tom & Jerry <script>alert(1)</script>', '');
  assert.equal(parent._children.length, 1);
  assert.equal(parent._children[0].nodeType, 3);
  assert.equal(parent._children[0].textContent, 'Tom & Jerry <script>alert(1)</script>');
  // Confirm no element node was created for "script" -- it's pure text.
  assert.ok(parent._children.every(c => c.nodeType === 3));
});

test('appendHighlighted: ampersand survives as literal text, not as an HTML entity or injection point', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, 'Q&A session', 'Q&A');
  assert.equal(parent.textContent, 'Q&A session');
});

test('appendHighlighted: angle brackets in the source text never produce a real element node', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, '<img src=x onerror=alert(1)>', 'nomatch');
  assert.equal(parent.textContent, '<img src=x onerror=alert(1)>');
  assert.ok(parent._children.every(c => c.nodeType === 3), 'every child must be a text node, not an element');
});

test('appendHighlighted: double quotes and apostrophes survive verbatim as text', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, `He said "don't stop"`, '');
  assert.equal(parent.textContent, `He said "don't stop"`);
});

test('appendHighlighted: a query term that matches wraps ONLY the matched substring in a real <mark> element node', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, 'the covid lab leak theory', 'covid');
  // Expect: text("the ") + mark("covid") + text(" lab leak theory")
  assert.equal(parent._children.length, 3);
  assert.equal(parent._children[0].nodeType, 3);
  assert.equal(parent._children[0].textContent, 'the ');
  assert.equal(parent._children[1].nodeType, 1);
  assert.equal(parent._children[1].tagName, 'MARK');
  assert.equal(parent._children[1].textContent, 'covid');
  assert.equal(parent._children[2].nodeType, 3);
  assert.equal(parent._children[2].textContent, ' lab leak theory');
});

test('appendHighlighted: a query containing HTML-special characters (e.g. "<script>") is stripped of punctuation for matching and does not inject markup', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, 'plain text with no matches', '<script>alert(1)</script>');
  // The query's non-word/non-space chars are stripped by the implementation
  // before building the match regex, so "script" and "alert" become the
  // effective search words -- neither appears in the source text, so the
  // whole string should come back as one plain text node.
  assert.equal(parent.textContent, 'plain text with no matches');
  assert.ok(parent._children.every(c => c.nodeType === 3));
});

test('appendHighlighted: null/undefined text does not throw and produces an empty text node', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, null, '');
  assert.equal(parent.textContent, '');
});

test('appendHighlighted: query text itself containing a literal ampersand highlights correctly without corrupting surrounding text', () => {
  const parent = new FakeElement('div');
  ctx.appendHighlighted(parent, 'Bed Bath & Beyond files for it', 'Beyond');
  assert.equal(parent.textContent, 'Bed Bath & Beyond files for it');
  const markNode = parent._children.find(c => c.nodeType === 1 && c.tagName === 'MARK');
  assert.ok(markNode, 'expected a <mark> node to exist');
  assert.equal(markNode.textContent, 'Beyond');
});

// ── buildResultCard: full card assembly with dangerous field values ─────────

test('buildResultCard: title/author/flair containing &, <, >, quotes survive as textContent verbatim (no innerHTML string is ever built)', () => {
  const item = {
    slug: 'abc123',
    title: `<b>Breaking</b> & "shocking" news`,
    author: `evil<img onerror=alert(1)>`,
    flair: `Tag & "Quoted"`,
    score: 42,
    comment_count: 3,
    created_at: 1700000000,
    body_md: 'some body text',
  };
  const card = ctx.buildResultCard(item, '');

  // The title div's real textContent must equal the raw dangerous string
  // exactly -- if it had been run through innerHTML anywhere, either the
  // tags would have been parsed away (textContent would show "Breaking"
  // only) or entities would double-encode. Neither happens here because
  // appendHighlighted uses createTextNode.
  const titleDiv = card._children.find(c => c._className === 'r-title');
  assert.ok(titleDiv, 'expected a .r-title div');
  assert.equal(titleDiv.textContent, `<b>Breaking</b> & "shocking" news`);
  // And critically: no actual <b> element node was created as a child.
  assert.ok(!titleDiv._children.some(c => c.nodeType === 1 && c.tagName === 'B'));

  const meta = card._children.find(c => c._className === 'r-meta');
  assert.ok(meta, 'expected a .r-meta div');
  const authorSpan = meta._children.find(c => c._className === 'r-author');
  assert.equal(authorSpan.textContent, '@evil<img onerror=alert(1)>');
  assert.ok(!authorSpan._children.some(c => c.nodeType === 1 && c.tagName === 'IMG'));

  const flairSpan = meta._children.find(c => c._className === 'r-flair');
  assert.equal(flairSpan.textContent, `Tag & "Quoted"`);
});

test('buildResultCard: sets href/target/rel as real element attributes (not string-built HTML attributes)', () => {
  const item = { slug: 'xyz', title: 'Post title', score: 1, comment_count: 0 };
  const card = ctx.buildResultCard(item, '');
  assert.equal(card.href, 'https://greatawakening.win/p/xyz');
  assert.equal(card.target, '_blank');
  assert.equal(card.rel, 'noopener');
});

test('buildResultCard: a comment item with a title/body containing quotes and angle brackets renders safely and gets the comment type marker', () => {
  const item = {
    _type: 'comment',
    post_id: 55,
    body_md: `<script>document.cookie</script> & 'single quotes' too`,
    score: 7,
    author: 'commenter',
  };
  const card = ctx.buildResultCard(item, '');
  const excerptDiv = card._children.find(c => c._className === 'r-excerpt');
  assert.ok(excerptDiv, 'expected a .r-excerpt div for a non-empty body');
  // excerpt() intentionally strips anything that LOOKS like an HTML/markdown
  // tag (/<[^>]+>/g -> ' ') as part of building a plain-text preview -- this
  // is deliberate preview-cleanup, not an escaping bug, and happens before
  // appendHighlighted ever sees the string. So "<script>...</script>" is
  // stripped to a space, and only the surrounding text should remain.
  assert.equal(excerptDiv.textContent.includes('<script>'), false);
  assert.match(excerptDiv.textContent, /document\.cookie/);
  assert.match(excerptDiv.textContent, /single quotes/);
  assert.ok(!excerptDiv._children.some(c => c.nodeType === 1 && c.tagName === 'SCRIPT'));
});

test('excerpt: standalone check -- tag-like substrings are stripped to a space, plain text and punctuation survive', () => {
  const sandboxExcerpt = ctx.excerpt;
  assert.equal(sandboxExcerpt('<b>bold</b> & "quoted" text'), 'bold & "quoted" text');
});
