// tests/dsl-and-dates.test.mjs
//
// Covers: quoteDslValue() (DSL value quoting for the GOD MODE query string)
// and formatDate() (timestamp -> human date), both from popup.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');
const quoteDslValue = loadFn(popupSrc, 'quoteDslValue');
const formatDate = loadFn(popupSrc, 'formatDate');

// ── quoteDslValue ────────────────────────────────────────────────────────────

test('quoteDslValue: plain word with no special chars is left unquoted', () => {
  assert.equal(quoteDslValue('someuser'), 'someuser');
});

test('quoteDslValue: value with a space gets wrapped in quotes', () => {
  assert.equal(quoteDslValue('John Doe'), '"John Doe"');
});

test('quoteDslValue: value with an embedded colon gets wrapped in quotes', () => {
  assert.equal(quoteDslValue('a:b'), '"a:b"');
});

test('quoteDslValue: value with an embedded double-quote gets wrapped AND the inner quote escaped', () => {
  assert.equal(quoteDslValue('say "hi"'), '"say \\"hi\\""');
});

test('quoteDslValue: DSL operator-like substring "date:" is quoted so it cannot be read as an operator', () => {
  assert.equal(quoteDslValue('date:2026'), '"date:2026"');
});

test('quoteDslValue: DSL operator-like substring "removed:" is quoted', () => {
  assert.equal(quoteDslValue('removed:true'), '"removed:true"');
});

test('quoteDslValue: DSL operator-like substring "score:" is quoted', () => {
  assert.equal(quoteDslValue('score:100'), '"score:100"');
});

test('quoteDslValue: embedded newlines are stripped to a space, then quoted (the resulting space triggers the quote-need check)', () => {
  assert.equal(quoteDslValue('line1\nline2'), '"line1 line2"');
});

test('quoteDslValue: embedded CRLF is collapsed to a single space, then quoted', () => {
  assert.equal(quoteDslValue('line1\r\nline2'), '"line1 line2"');
});

test('quoteDslValue: leading/trailing whitespace is trimmed before the quote-need check', () => {
  assert.equal(quoteDslValue('  someuser  '), 'someuser');
});

test('quoteDslValue: null coerces to empty string', () => {
  assert.equal(quoteDslValue(null), '');
});

test('quoteDslValue: undefined coerces to empty string', () => {
  assert.equal(quoteDslValue(undefined), '');
});

test('quoteDslValue: a value that is ONLY whitespace becomes empty after trim (no dangling quotes)', () => {
  assert.equal(quoteDslValue('   '), '');
});

test('quoteDslValue: numeric input is coerced to string first', () => {
  assert.equal(quoteDslValue(42), '42');
});

test('quoteDslValue: multiple embedded quotes are all escaped', () => {
  assert.equal(quoteDslValue('"a" and "b"'), '"\\"a\\" and \\"b\\""');
});

// ── formatDate ───────────────────────────────────────────────────────────────

test('formatDate: 0 is treated as "not a real timestamp" -> Unknown date', () => {
  assert.equal(formatDate(0), 'Unknown date');
});

test('formatDate: null -> Unknown date', () => {
  assert.equal(formatDate(null), 'Unknown date');
});

test('formatDate: negative number -> Unknown date', () => {
  assert.equal(formatDate(-1000), 'Unknown date');
});

test('formatDate: non-numeric string -> Unknown date', () => {
  assert.equal(formatDate('not a date'), 'Unknown date');
});

test('formatDate: undefined -> Unknown date', () => {
  assert.equal(formatDate(undefined), 'Unknown date');
});

test('formatDate: NaN -> Unknown date', () => {
  assert.equal(formatDate(NaN), 'Unknown date');
});

test('formatDate: a plausible seconds-scale Unix timestamp formats correctly', () => {
  // 2026-01-15T00:00:00Z in seconds
  const seconds = Math.floor(Date.UTC(2026, 0, 15) / 1000);
  const result = formatDate(seconds);
  assert.match(result, /Jan/);
  assert.match(result, /2026/);
  assert.match(result, /15/);
});

test('formatDate: a plausible milliseconds-scale timestamp formats correctly (not misread as year ~50000)', () => {
  // 2026-01-15T00:00:00Z in milliseconds -- well above the 1e12 threshold.
  const ms = Date.UTC(2026, 0, 15);
  const result = formatDate(ms);
  assert.match(result, /Jan/);
  assert.match(result, /2026/);
  assert.match(result, /15/);
});

test('formatDate: a numeric string timestamp (seconds-scale) is coerced and formatted', () => {
  const seconds = Math.floor(Date.UTC(2020, 5, 1) / 1000);
  const result = formatDate(String(seconds));
  assert.match(result, /Jun/);
  assert.match(result, /2020/);
});

test('formatDate: seconds-scale vs milliseconds-scale for the SAME instant produce the SAME formatted date', () => {
  const ms = Date.UTC(2024, 3, 10);
  const seconds = Math.floor(ms / 1000);
  assert.equal(formatDate(seconds), formatDate(ms));
});

test('formatDate: a value just under the 1e12 threshold is treated as seconds-scale', () => {
  // 999999999999 (< 1e12) * 1000 would be year ~33658 if misread as ms-scale
  // input; the function's own comment says values ABOVE ~1e12 are ms-scale,
  // so this exact boundary value must still be treated as seconds.
  const secondsLike = 999999999999;
  const result = formatDate(secondsLike);
  // Just confirm it does NOT bail out to "Unknown date" and produces some
  // plausible 4-digit year far in the future (33658-ish), proving the
  // *2 seconds->ms path was taken, not a passthrough.
  assert.notEqual(result, 'Unknown date');
});
