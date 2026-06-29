/* GAW Research Search — MV3 Background Service Worker */

const WORKER_BASE = 'https://gaw-mod-proxy.gaw-mods-a2f2d0e4.workers.dev';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'search') {
    doSearch(msg.query, msg.token, msg.opts).then(sendResponse).catch(e =>
      sendResponse({ error: e.message || String(e) })
    );
    return true;
  }
  if (msg.type === 'getToken') {
    chrome.storage.local.get(['modToken'], r => sendResponse({ token: r.modToken || '' }));
    return true;
  }
  if (msg.type === 'setToken') {
    chrome.storage.local.set({ modToken: msg.token }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'getSavedSearches') {
    chrome.storage.local.get(['savedSearches'], r =>
      sendResponse({ searches: r.savedSearches || [] })
    );
    return true;
  }
  if (msg.type === 'saveSearch') {
    chrome.storage.local.get(['savedSearches'], r => {
      const list = r.savedSearches || [];
      list.unshift({ query: msg.query, savedAt: Date.now() });
      if (list.length > 50) list.length = 50;
      chrome.storage.local.set({ savedSearches: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg.type === 'deleteSavedSearch') {
    chrome.storage.local.get(['savedSearches'], r => {
      const list = (r.savedSearches || []).filter((_, i) => i !== msg.index);
      chrome.storage.local.set({ savedSearches: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg.type === 'getRecentSearches') {
    chrome.storage.local.get(['recentSearches'], r =>
      sendResponse({ searches: r.recentSearches || [] })
    );
    return true;
  }
  if (msg.type === 'addRecentSearch') {
    chrome.storage.local.get(['recentSearches'], r => {
      let list = r.recentSearches || [];
      list = list.filter(s => s !== msg.query);
      list.unshift(msg.query);
      if (list.length > 20) list.length = 20;
      chrome.storage.local.set({ recentSearches: list }, () => sendResponse({ ok: true }));
    });
    return true;
  }
});

async function doSearch(query, token, opts = {}) {
  if (!token) return { error: 'No mod token configured. Go to Settings.' };
  if (!query || !query.trim()) return { error: 'Empty query.' };

  const params = new URLSearchParams();
  params.set('godmode', '1');
  params.set('q', query.trim());
  if (opts.scope) params.set('scope', opts.scope);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));

  const url = WORKER_BASE + '/gaw/search?' + params.toString();
  const resp = await fetch(url, {
    headers: { 'x-mod-token': token, 'Accept': 'application/json' },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    return { error: 'HTTP ' + resp.status + ': ' + txt.slice(0, 300) };
  }

  return resp.json();
}
