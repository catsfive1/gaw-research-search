// tests/merge-sort.test.mjs
//
// Covers: mergeSortedDesc() from popup.js -- the P1-7 two-pointer merge
// used to combine already-sorted posts[] and comments[] arrays into one
// descending-ordered list when sort=score or sort=date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, loadFn } from './_extract.mjs';

const popupSrc = loadSource('../popup.js');
const mergeSortedDesc = loadFn(popupSrc, 'mergeSortedDesc');

test('mergeSortedDesc: interleaves two pre-sorted-descending arrays correctly by score', () => {
  const posts    = [{ id: 'p1', score: 90 }, { id: 'p2', score: 50 }, { id: 'p3', score: 10 }];
  const comments = [{ id: 'c1', score: 80 }, { id: 'c2', score: 40 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  assert.deepEqual(merged.map(x => x.id), ['p1', 'c1', 'p2', 'c2', 'p3']);
});

test('mergeSortedDesc: result is monotonically non-increasing by the merge key', () => {
  const posts    = [{ score: 100 }, { score: 60 }, { score: 20 }];
  const comments = [{ score: 95 }, { score: 30 }, { score: 5 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  const scores = merged.map(x => x.score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], `expected ${scores[i-1]} >= ${scores[i]} at index ${i}`);
  }
});

test('mergeSortedDesc: works with an empty first array (comments-only)', () => {
  const merged = mergeSortedDesc([], [{ id: 'c1', score: 5 }, { id: 'c2', score: 1 }], 'score');
  assert.deepEqual(merged.map(x => x.id), ['c1', 'c2']);
});

test('mergeSortedDesc: works with an empty second array (posts-only)', () => {
  const merged = mergeSortedDesc([{ id: 'p1', score: 5 }, { id: 'p2', score: 1 }], [], 'score');
  assert.deepEqual(merged.map(x => x.id), ['p1', 'p2']);
});

test('mergeSortedDesc: both arrays empty returns an empty array', () => {
  assert.deepEqual(mergeSortedDesc([], [], 'score'), []);
});

test('mergeSortedDesc: on a tie, the first array (posts) wins the tiebreak (>= comparison, a-array checked first)', () => {
  const posts    = [{ id: 'p1', score: 50 }];
  const comments = [{ id: 'c1', score: 50 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  assert.deepEqual(merged.map(x => x.id), ['p1', 'c1']);
});

test('mergeSortedDesc: sorts by created_at key just as well as by score (key is parameterized)', () => {
  const posts    = [{ id: 'p1', created_at: 2000 }, { id: 'p2', created_at: 1000 }];
  const comments = [{ id: 'c1', created_at: 1500 }];
  const merged = mergeSortedDesc(posts, comments, 'created_at');
  assert.deepEqual(merged.map(x => x.id), ['p1', 'c1', 'p2']);
});

test('mergeSortedDesc: non-numeric/missing key values are treated as 0 (Number(x) || 0 coercion), not NaN or a thrown error', () => {
  const posts    = [{ id: 'p1', score: 10 }, { id: 'p2', score: undefined }];
  const comments = [{ id: 'c1', score: 5 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  // p2's score coerces to 0, so it should land after everything with a
  // positive score.
  assert.deepEqual(merged.map(x => x.id), ['p1', 'c1', 'p2']);
});

test('mergeSortedDesc: preserves relative order within each source array (stable merge, not a re-sort)', () => {
  // Deliberately NOT sorted -- mergeSortedDesc trusts its inputs are
  // pre-sorted and does a straight two-pointer merge, so feeding
  // out-of-order input should NOT get silently re-sorted; it should merge
  // positionally and preserve each array's original element order.
  const posts    = [{ id: 'p1', score: 1 }, { id: 'p2', score: 99 }];
  const comments = [{ id: 'c1', score: 50 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  // Two-pointer merge compares posts[0](1) vs comments[0](50) -> comments
  // wins first (50 >= 1 is false so posts loses -> comments pushed).
  // Wait: av=1, bv=50, av>=bv is false -> push b (c1). Then i=0,j=1(end of
  // comments) -> dump rest of posts in original order: p1, p2.
  assert.deepEqual(merged.map(x => x.id), ['c1', 'p1', 'p2']);
});

test('mergeSortedDesc: output length equals sum of input lengths (no items dropped or duplicated)', () => {
  const posts    = [{ score: 3 }, { score: 2 }, { score: 1 }];
  const comments = [{ score: 5 }, { score: 4 }];
  const merged = mergeSortedDesc(posts, comments, 'score');
  assert.equal(merged.length, posts.length + comments.length);
});
