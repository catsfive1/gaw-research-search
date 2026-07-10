/* Preview-only chrome.* mock — lets the real popup.js run in a plain browser
 * tab (served by the dev server) so the redesigned UI can be screenshotted.
 * NOT shipped in the extension; lives under preview/ which is excluded from the
 * package. Returns plausible fake data so results/cards render. */
(function () {
  'use strict';

  const FAKE_POSTS = [
    {
      id: '8709459', slug: '1ATBhMQrWr', _type: 'post',
      title: 'The Plan to Save the World — full breakdown and sources',
      author: 'MuckeyDuck', community: 'GreatAwakening',
      score: 384, comment_count: 92, flair: 'News', created_at: 1782975586,
      is_removed: 0,
      body_md: 'A deep dive into the plan, with primary sources and a timeline of events that most people have never connected before now.',
    },
    {
      id: '8716836', slug: '1ATBlzi1Dy', _type: 'post',
      title: 'General Chat for Tue, Jul 07',
      author: 'purkiss80', community: 'GreatAwakening',
      score: 128, comment_count: 240, flair: 'Discussion', created_at: 1783397014,
      is_removed: 0,
      body_md: 'Daily general chat thread. Drop your digs, questions, and finds here for the day.',
    },
    {
      id: '8700001', slug: '1ATBremoved', _type: 'post',
      title: 'Archived dig that was later removed from the feed',
      author: 'anon_researcher', community: 'GreatAwakening',
      score: 57, comment_count: 6, flair: 'Dig', created_at: 1782800000,
      is_removed: 1,
      body_md: 'This one got removed but the archive still has it — exactly why a research tool matters.',
    },
  ];

  const FAKE_COMMENTS = [
    {
      id: '69352422', post_id: '8716836', post_slug: '1ATBlzi1Dy', _type: 'comment',
      author: '5DWeBe', score: 41, created_at: 1783397100, is_removed: 0,
      body_md: 'Which side of your brain is dominant? Here is an easy follow-along that ties back to the main dig.',
    },
    {
      id: '69373037', post_id: '8719322', post_slug: '1ATBm35pTO', _type: 'comment',
      author: 'purkiss80', score: 18, created_at: 1783528895, is_removed: 0,
      body_md: 'Total monopoly on destruction. No rival. That was the window, and here is what happened next.',
    },
  ];

  function respond(msg, cb) {
    const t = msg && msg.type;
    let out;
    if (t === 'search') {
      out = { ok: true, godmode: true, posts: FAKE_POSTS.slice(), comments: FAKE_COMMENTS.slice() };
    } else if (t === 'getSaved') {
      out = { list: [
        { q: 'deep state', ts: 1783000000, state: { text: 'deep state', schemaVersion: 1 } },
        { q: 'the plan', ts: 1782900000, state: { text: 'the plan', scope: 'posts', schemaVersion: 1 } },
      ] };
    } else if (t === 'getRecent') {
      out = { list: [ 'fauci emails', { q: 'durham report', state: { text: 'durham report', scope: 'both', schemaVersion: 1 } }, 'red october' ] };
    } else if (t === 'addRecent' || t === 'toggleSave') {
      out = { ok: true };
    } else if (t === 'submitUrl') {
      out = { ok: true, status: 'new', post: { title: 'Submitted post' }, comments_new: 3 };
    } else if (t === 'getDebugLog') {
      out = { list: [ { ts: Date.now(), action: 'search', endpoint: '/gaw/search', durationMs: 142, httpStatus: 200, errorClass: null, timedOut: false } ] };
    } else {
      out = { ok: false, error: 'mock: unknown type ' + t };
    }
    setTimeout(() => cb && cb(out), 60);
  }

  const store = {};
  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: function (msg, cb) { respond(msg, cb); },
      onMessage: { addListener: function () {} },
    },
    storage: {
      local: {
        get: function (keys, cb) {
          const res = {};
          const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          arr.forEach(k => { if (k in store) res[k] = store[k]; });
          setTimeout(() => cb && cb(res), 5);
        },
        set: function (obj, cb) { Object.assign(store, obj); setTimeout(() => cb && cb(), 5); },
        remove: function (keys, cb) {
          (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]);
          setTimeout(() => cb && cb(), 5);
        },
      },
    },
  };
})();
