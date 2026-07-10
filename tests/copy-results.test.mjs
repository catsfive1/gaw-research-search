// tests/copy-results.test.mjs
//
// Covers: the v2.4.0 "Copy results" markdown formatter (spec §3.6) in
// popup.js's copyResults(). It serializes the currently-loaded results
// (module-level `loadedItems`) as a markdown list and writes it to the
// clipboard. `loadedItems` is populated the real way -- by driving the actual
// renderResults() -- rather than poked in, so this exercises the true
// render -> copy path. The sandbox's navigator.clipboard.writeText records
// every write into ctx._clipboardWrites for assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPopupSandbox } from './_sandbox.mjs';

const { ctx } = buildPopupSandbox();
const writes = ctx._clipboardWrites;

// A seconds-scale Unix timestamp for 2026-01-15 (formatDate -> "Jan 15, 2026").
const JAN_15_2026 = Math.floor(Date.UTC(2026, 0, 15) / 1000);

// ── empty state: nothing loaded -> no clipboard write ────────────────────────

test('copyResults: with no loaded results, does nothing (no clipboard write)', () => {
  writes.length = 0;
  ctx.copyResults();
  assert.equal(writes.length, 0);
});

// ── formatting: post + comment lines ─────────────────────────────────────────

test('copyResults: formats each loaded result as a markdown list line', () => {
  writes.length = 0;

  // Drive the REAL render path so loadedItems is populated exactly as at
  // runtime (posts tagged _type:'post', comments _type:'comment').
  ctx.renderResults({
    posts: [
      { title: 'Covid origins', author: 'digger', score: 128, created_at: JAN_15_2026, slug: '1ATBhMQrWr' },
    ],
    comments: [
      { title: '', author: '', score: 0, created_at: 0, post_id: 8716836, post_slug: '1ATBlzi1Dy' },
    ],
  }, false);

  ctx.copyResults();

  assert.equal(writes.length, 1, 'exactly one clipboard write');
  const lines = writes[0].split('\n');
  assert.equal(lines.length, 2, 'one markdown line per loaded result');

  // Post line: - [<title>](<url>) — @<author> · <score> pts · <date>
  assert.equal(
    lines[0],
    '- [Covid origins](https://greatawakening.win/p/1ATBhMQrWr) — @digger · 128 pts · Jan 15, 2026'
  );

  // Comment line: title falls back to "Comment on post #<id>", author to
  // @unknown, created_at 0 -> "Unknown date", url -> parent post comments tab,
  // and it is tagged " (comment)".
  assert.equal(
    lines[1],
    '- [Comment on post #8716836](https://greatawakening.win/p/1ATBlzi1Dy/x/c/) — @unknown · 0 pts · Unknown date (comment)'
  );
});

test('copyResults: a comment result is tagged "(comment)"; a post result is not', () => {
  writes.length = 0;
  ctx.renderResults({
    posts: [{ title: 'A post', author: 'a', score: 5, created_at: JAN_15_2026, slug: 'sluga' }],
    comments: [{ title: 'A comment', author: 'b', score: 3, created_at: JAN_15_2026, post_id: 42, post_slug: 'slugb' }],
  }, false);
  ctx.copyResults();

  const lines = writes[0].split('\n');
  const postLine = lines.find(l => l.includes('A post'));
  const commentLine = lines.find(l => l.includes('A comment'));
  assert.ok(!postLine.endsWith('(comment)'), 'post line is not tagged');
  assert.ok(commentLine.endsWith('(comment)'), 'comment line is tagged');
});

test('copyResults: every emitted line is a well-formed markdown link bullet', () => {
  writes.length = 0;
  ctx.renderResults({
    posts: [{ title: 'Only', author: 'x', score: 1, created_at: JAN_15_2026, slug: 's' }],
    comments: [],
  }, false);
  ctx.copyResults();
  for (const line of writes[0].split('\n')) {
    assert.match(line, /^- \[.*\]\(https:\/\/greatawakening\.win\/.*\) — @.+ · \d+ pts · .+$/);
  }
});
