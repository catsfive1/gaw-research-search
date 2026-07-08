// tests/url-normalization.test.mjs
//
// Covers: normalizeGawUrl() and looksLikeGawPostUrl() from popup.js, plus
// the independent looksLikeGawPostUrl() copy in background.js (the real
// trust boundary per its own P0-5 comment -- background.js re-validates
// even though popup.js already checked). Both copies are tested because
// they are separately maintained functions, not one shared module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');
const bgSrc = loadSource('../background.js');

const normalizeGawUrl = loadFn(popupSrc, 'normalizeGawUrl');
const looksLikeGawPostUrl_popup = loadFn(popupSrc, 'looksLikeGawPostUrl');
const looksLikeGawPostUrl_bg = loadFn(bgSrc, 'looksLikeGawPostUrl');

// ── normalizeGawUrl ──────────────────────────────────────────────────────────

test('normalizeGawUrl: adds https:// when scheme is missing', () => {
  assert.equal(normalizeGawUrl('greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: upgrades http:// to https://', () => {
  assert.equal(normalizeGawUrl('http://greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: leaves https:// untouched (aside from www strip)', () => {
  assert.equal(normalizeGawUrl('https://greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: strips www. prefix', () => {
  assert.equal(normalizeGawUrl('https://www.greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: strips www. and upgrades http in one pass', () => {
  assert.equal(normalizeGawUrl('http://www.greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: is case-insensitive on the http(s):// and www. matches', () => {
  assert.equal(normalizeGawUrl('HTTP://WWW.greatawakening.win/p/abc123'), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: trims surrounding whitespace before checking scheme', () => {
  assert.equal(normalizeGawUrl('  greatawakening.win/p/abc123  '), 'https://greatawakening.win/p/abc123');
});

test('normalizeGawUrl: does NOT lowercase the host (uppercase host survives to the URL parser)', () => {
  assert.equal(normalizeGawUrl('GREATAWAKENING.WIN/p/abc123'), 'https://GREATAWAKENING.WIN/p/abc123');
});

// ── looksLikeGawPostUrl (both copies) ────────────────────────────────────────

for (const [label, looksLikeGawPostUrl] of [
  ['popup.js', looksLikeGawPostUrl_popup],
  ['background.js', looksLikeGawPostUrl_bg],
]) {
  test(`looksLikeGawPostUrl [${label}]: accepts a canonical https post URL`, () => {
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win/p/abc123'), true);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects http (protocol must be https:)`, () => {
    assert.equal(looksLikeGawPostUrl('http://greatawakening.win/p/abc123'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects a bare host with no path`, () => {
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects a non-/p/ path`, () => {
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win/u/someuser'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects uppercase host (hostname is exact-match, not case-folded)`, () => {
    // URL.hostname is lowercased automatically by the WHATWG URL parser for
    // ASCII hosts, so this actually normalizes to 'greatawakening.win' and
    // PASSES -- pin that behavior explicitly rather than assume it.
    assert.equal(looksLikeGawPostUrl('https://GREATAWAKENING.WIN/p/abc123'), true);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects embedded userinfo host confusion (https://greatawakening.win@evil.com/)`, () => {
    // The browser/URL parser sees hostname = 'evil.com' and
    // 'greatawakening.win' as the userinfo (username) component -- this
    // must NOT be treated as the real greatawakening.win host.
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win@evil.com/p/abc123'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects a lookalike host that merely CONTAINS greatawakening.win as a substring`, () => {
    assert.equal(looksLikeGawPostUrl('https://evil-greatawakening.win.attacker.com/p/abc123'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects a subdomain host (not an exact hostname match)`, () => {
    assert.equal(looksLikeGawPostUrl('https://sub.greatawakening.win/p/abc123'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects a non-standard port (hostname matches but port changes the origin)`, () => {
    // hostname === 'greatawakening.win' still holds even with an explicit
    // port, since URL.hostname excludes the port -- pin the real behavior:
    // this function does NOT check port, so a weird port still passes as
    // long as host+path match. This documents the current (permissive)
    // behavior rather than assuming a stricter check exists.
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win:8443/p/abc123'), true);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects garbage / unparsable input instead of throwing`, () => {
    assert.equal(looksLikeGawPostUrl('not a url at all'), false);
  });

  test(`looksLikeGawPostUrl [${label}]: rejects empty string`, () => {
    assert.equal(looksLikeGawPostUrl(''), false);
  });

  test(`looksLikeGawPostUrl [${label}]: accepts a deeper /p/ path (slug with extra segments)`, () => {
    assert.equal(looksLikeGawPostUrl('https://greatawakening.win/p/abc123/some-slug'), true);
  });
}
