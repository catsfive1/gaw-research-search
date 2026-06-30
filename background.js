/* GAW Research Search v2.0.0 — Background Service Worker */
'use strict';

const WORKER_BASE = 'https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'search') {
    doSearch(msg.query, msg.opts).then(sendResponse).catch(e =>
      sendResponse({ ok: false, error: e.message || String(e) })
    );
    return true;
  }
  if (msg.type === 'getSaved') {
    chrome.storage.local.get(['saved'], r => sendResponse({ list: r.saved || [] }));
    return true;
  }
  if (msg.type === 'toggleSave') {
    chrome.storage.local.get(['saved'], r => {
      let list = r.saved || [];
      const idx = list.findIndex(s => s.q === msg.q);
      if (idx >= 0) list.splice(idx, 1);
      else { list.unshift({ q: msg.q, ts: Date.now() }); if (list.length > 100) list.length = 100; }
      chrome.storage.local.set({ saved: list }, () => sendResponse({ ok: true, saved: idx < 0 }));
    });
    return true;
  }
  if (msg.type === 'getRecent') {
    chrome.storage.local.get(['recent'], r => sendResponse({ list: r.recent || [] }));
    return true;
  }
  if (msg.type === 'addRecent') {
    chrome.storage.local.get(['recent'], r => {
      let list = (r.recent || []).filter(s => s !== msg.q);
      list.unshift(msg.q);
      if (list.length > 30) list.length = 30;
      chrome.storage.local.set({ recent: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});

async function doSearch(query, opts = {}) {
  if (!query || !query.trim()) return { ok: false, error: 'Empty query.' };

  const params = new URLSearchParams();
  params.set('godmode', '1');
  params.set('q', query.trim());
  params.set('limit', String(opts.limit || 50));
  if (opts.scope) params.set('scope', opts.scope);
  if (opts.sort)  params.set('sort', opts.sort);
  if (opts.offset) params.set('offset', String(opts.offset));

  const resp = await fetch(WORKER_BASE + '/gaw/search?' + params, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { ok: false, error: 'HTTP ' + resp.status + ': ' + txt.slice(0, 200) };
  }
  return resp.json();
}
