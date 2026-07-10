// tests/date-presets.test.mjs
//
// Covers: the v2.4.0 relative-date presets (spec §3.5) -> date: DSL. The
// preset selector writes an absolute YYYY-MM-DD into the #f-date-from /
// #f-date-to inputs (isoDaysAgo + applyDatePreset), and buildDateDsl() reads
// those inputs back into the worker-supported `date:START..END` token.
//
// isoDaysAgo() and applyDatePreset() call Date.now(), so the sandbox (and the
// standalone isoDaysAgo slice) are given a FIXED-clock Date -- 2026-07-10 UTC
// -- making every relative-date assertion deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';
import { buildPopupSandbox } from './_sandbox.mjs';

// Fixed clock: 2026-07-10T00:00:00Z.
const FIXED_NOW = Date.UTC(2026, 6, 10);
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() { return FIXED_NOW; }
}

const popupSrc = loadSource('../popup.js');
const isoDaysAgo = loadFn(popupSrc, 'isoDaysAgo', { Date: FakeDate });

const { ctx, setInput, getInput } = buildPopupSandbox({ Date: FakeDate });

function clearDates() {
  setInput('f-date-from', '');
  setInput('f-date-to', '');
  setInput('f-date-preset', '');
}

// ── isoDaysAgo (deterministic against the fixed clock) ───────────────────────

test('isoDaysAgo: 0 days ago is today (fixed clock 2026-07-10)', () => {
  assert.equal(isoDaysAgo(0), '2026-07-10');
});

test('isoDaysAgo: 1 day ago (Past 24 hours)', () => {
  assert.equal(isoDaysAgo(1), '2026-07-09');
});

test('isoDaysAgo: 7 days ago (Past 7 days)', () => {
  assert.equal(isoDaysAgo(7), '2026-07-03');
});

test('isoDaysAgo: 30 days ago crosses the month boundary correctly', () => {
  assert.equal(isoDaysAgo(30), '2026-06-10');
});

test('isoDaysAgo: always emits a strict YYYY-MM-DD shape', () => {
  assert.match(isoDaysAgo(7), /^\d{4}-\d{2}-\d{2}$/);
});

// ── applyDatePreset -> writes absolute dates -> buildDateDsl -> date: token ───

test('applyDatePreset "24h" -> date:<yesterday>.. (open-ended range)', () => {
  clearDates();
  setInput('f-date-preset', '24h');
  ctx.applyDatePreset();
  assert.equal(getInput('f-date-from'), '2026-07-09');
  assert.equal(getInput('f-date-to'), '');
  assert.equal(ctx.buildDateDsl(), 'date:2026-07-09..');
});

test('applyDatePreset "7d" -> date:2026-07-03..', () => {
  clearDates();
  setInput('f-date-preset', '7d');
  ctx.applyDatePreset();
  assert.equal(getInput('f-date-from'), '2026-07-03');
  assert.equal(ctx.buildDateDsl(), 'date:2026-07-03..');
});

test('applyDatePreset "30d" -> date:2026-06-10..', () => {
  clearDates();
  setInput('f-date-preset', '30d');
  ctx.applyDatePreset();
  assert.equal(getInput('f-date-from'), '2026-06-10');
  assert.equal(ctx.buildDateDsl(), 'date:2026-06-10..');
});

test('applyDatePreset "" (Any time) clears both dates and emits no date restrictor', () => {
  // Seed some dates first, then confirm "Any time" wipes them.
  setInput('f-date-from', '2020-01-01');
  setInput('f-date-to', '2020-12-31');
  setInput('f-date-preset', '');
  ctx.applyDatePreset();
  assert.equal(getInput('f-date-from'), '');
  assert.equal(getInput('f-date-to'), '');
  assert.equal(ctx.buildDateDsl(), '');
});

test('applyDatePreset "custom" reveals the custom row and does NOT overwrite existing from/to', () => {
  clearDates();
  setInput('f-date-from', '2024-03-01');
  setInput('f-date-to', '2024-04-01');
  setInput('f-date-preset', 'custom');
  ctx.applyDatePreset();
  // custom preserves whatever the user already typed.
  assert.equal(getInput('f-date-from'), '2024-03-01');
  assert.equal(getInput('f-date-to'), '2024-04-01');
  assert.equal(ctx.buildDateDsl(), 'date:2024-03-01..2024-04-01');
});

// ── buildDateDsl: ISO-shape gate (no smuggling via the date inputs) ──────────

test('buildDateDsl: both sides present -> date:START..END', () => {
  clearDates();
  setInput('f-date-from', '2026-01-01');
  setInput('f-date-to', '2026-02-01');
  assert.equal(ctx.buildDateDsl(), 'date:2026-01-01..2026-02-01');
});

test('buildDateDsl: only the "to" side present -> date:..END', () => {
  clearDates();
  setInput('f-date-to', '2026-02-01');
  assert.equal(ctx.buildDateDsl(), 'date:..2026-02-01');
});

test('buildDateDsl: neither side present -> empty string (no restrictor)', () => {
  clearDates();
  assert.equal(ctx.buildDateDsl(), '');
});

test('buildDateDsl: a non-ISO / injected value fails the strict shape gate and is dropped', () => {
  clearDates();
  setInput('f-date-from', '2026-01-01"; DROP TABLE');
  setInput('f-date-to', 'garbage');
  // Neither value matches ^\d{4}-\d{2}-\d{2}$ -> both dropped -> no token.
  assert.equal(ctx.buildDateDsl(), '');
});
