// tests/gaw-url.test.mjs
//
// Covers: buildGawUrl() from popup.js -- the function that builds the link
// each result card points at. Regression coverage for the mod-playtest bug
// (2026-07-09): clicking a comment result took mods to greatawakening.win's
// bare front page instead of the post their comment was in, because
// buildGawUrl() only ever checked item.slug, which comment rows never have.
//
// The fix (and these tests) were shaped by live-verifying the real site
// before shipping, not by assumption -- an earlier draft of this fix used
// /p/<slug>/x/c/<numeric-comment-id>, which looked right by analogy to an
// internal mod-tool helper elsewhere in the same Worker file, but actually
// 500s live: the real per-comment permalink segment is an opaque encoded
// slug (e.g. "4ed43EW5Efx") this codebase has never captured, not the
// numeric comment id. Confirmed-working URLs only, per curl against the
// live site on 2026-07-09:
//   /p/<slug>              -> 200
//   /p/<slug>/x/c/         -> 200 (comments tab)
//   /p/<raw-numeric-id>    -> 500
//   /p/<slug>/x/c/<num-id> -> 500
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');
const buildGawUrl = loadFn(popupSrc, 'buildGawUrl');

// ── Posts ────────────────────────────────────────────────────────────────────

test('buildGawUrl: post with a slug links to /p/<slug>', () => {
  assert.equal(
    buildGawUrl({ _type: 'post', id: 8709459, slug: '1ATBhMQrWr' }),
    'https://greatawakening.win/p/1ATBhMQrWr'
  );
});

test('buildGawUrl: post with no slug falls back to the bare domain (raw numeric id 500s live -- do not use it)', () => {
  assert.equal(
    buildGawUrl({ _type: 'post', id: 8709459, slug: null }),
    'https://greatawakening.win'
  );
});

test('buildGawUrl: post with neither slug nor id falls back to the bare domain', () => {
  assert.equal(buildGawUrl({ _type: 'post' }), 'https://greatawakening.win');
});

// ── Comments (the regression) ───────────────────────────────────────────────

test('buildGawUrl: comment with a post_slug links to the parent post\'s comments tab, NOT the bare domain', () => {
  assert.equal(
    buildGawUrl({ _type: 'comment', id: 69352422, post_id: 8716836, post_slug: '1ATBlzi1Dy' }),
    'https://greatawakening.win/p/1ATBlzi1Dy/x/c/'
  );
});

test('buildGawUrl: comment missing post_slug (orphaned comment / post row deleted) falls back to the bare domain rather than building a broken link', () => {
  assert.equal(
    buildGawUrl({ _type: 'comment', id: 69352422, post_id: 8716836, post_slug: '' }),
    'https://greatawakening.win'
  );
});

test('buildGawUrl: comment missing post_slug field entirely falls back to the bare domain', () => {
  assert.equal(
    buildGawUrl({ _type: 'comment', id: 69352422, post_id: 8716836 }),
    'https://greatawakening.win'
  );
});

test('buildGawUrl: comment never uses the raw numeric comment id or post_id in the URL (both 500 live)', () => {
  const url = buildGawUrl({ _type: 'comment', id: 69352422, post_id: 8716836, post_slug: '1ATBlzi1Dy' });
  assert.ok(!url.includes('69352422'), 'must not embed the raw comment id');
  assert.ok(!url.includes('8716836'), 'must not embed the raw numeric post_id');
});
