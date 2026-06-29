/* GAW Research Search — Main UI Logic */

(function () {
  'use strict';

  const GAW_BASE = 'https://greatawakening.win';
  const PER_PAGE_DEFAULT = 50;

  // State
  let currentQuery = '';
  let currentOffset = 0;
  let currentResults = [];
  let totalResults = 0;
  let perPage = PER_PAGE_DEFAULT;
  let token = '';

  // Elements
  const searchInput = document.getElementById('search-input');
  const btnSearch = document.getElementById('btn-search');
  const queryBuilder = document.getElementById('query-builder');
  const btnToggleBuilder = document.getElementById('btn-toggle-builder');
  const btnBuildQuery = document.getElementById('btn-build-query');
  const btnClearBuilder = document.getElementById('btn-clear-builder');
  const resultsList = document.getElementById('results-list');
  const statusText = document.getElementById('status-text');
  const resultCount = document.getElementById('result-count');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const pageInfo = document.getElementById('page-info');
  const recentDiv = document.getElementById('recent-searches');
  const overlay = document.getElementById('overlay');

  // Panels
  const savedPanel = document.getElementById('saved-panel');
  const settingsPanel = document.getElementById('settings-panel');

  // Init
  async function init() {
    // Load token
    const resp = await msg({ type: 'getToken' });
    token = resp.token || '';

    // Load per-page setting
    chrome.storage.local.get(['perPage'], r => {
      if (r.perPage) {
        perPage = parseInt(r.perPage, 10) || PER_PAGE_DEFAULT;
        document.getElementById('settings-per-page').value = String(perPage);
      }
    });

    // Load recent searches
    loadRecentSearches();

    // Show empty state
    showEmptyState();

    // Check if query in URL hash
    const hash = location.hash;
    if (hash.startsWith('#q=')) {
      const q = decodeURIComponent(hash.slice(3));
      searchInput.value = q;
      doSearch(q);
    }

    // If no token, show settings
    if (!token) {
      openPanel('settings-panel');
    }
  }

  // Messaging
  function msg(data) {
    return new Promise(resolve => chrome.runtime.sendMessage(data, resolve));
  }

  // Search
  async function doSearch(query, offset = 0) {
    if (!query || !query.trim()) return;
    query = query.trim();
    currentQuery = query;
    currentOffset = offset;

    // Update URL hash
    location.hash = '#q=' + encodeURIComponent(query);

    // Track recent
    if (offset === 0) {
      msg({ type: 'addRecentSearch', query });
      loadRecentSearches();
    }

    // UI: loading
    resultsList.innerHTML = '<div class="loading">Searching</div>';
    statusText.textContent = 'Searching...';
    resultCount.textContent = '';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    pageInfo.textContent = '';

    // Get scope/sort from builder
    const scope = document.getElementById('qb-scope').value;
    const sort = document.getElementById('qb-sort').value;

    const result = await msg({
      type: 'search',
      query,
      token,
      opts: {
        scope,
        sort,
        limit: perPage,
        offset,
      },
    });

    if (result.error) {
      resultsList.innerHTML = '<div class="error-msg">' + escHtml(result.error) + '</div>';
      statusText.textContent = 'Error';
      return;
    }

    renderResults(result, query);
  }

  function renderResults(data, query) {
    const posts = data.posts || data.results || [];
    const comments = data.comments || [];
    const total = data.total || data.count || posts.length + comments.length;
    totalResults = total;
    currentResults = posts;

    // Status
    const elapsed = data.elapsed_ms ? ` (${data.elapsed_ms}ms)` : '';
    statusText.textContent = `Query: ${currentQuery}${elapsed}`;
    resultCount.textContent = `${total} result${total !== 1 ? 's' : ''}`;

    if (posts.length === 0 && comments.length === 0) {
      resultsList.innerHTML = '<div class="empty-state"><h2>No results</h2><p>Try different search terms or adjust your filters.</p></div>';
      return;
    }

    // Build query words for highlighting
    const highlightWords = extractSearchWords(query);

    let html = '';

    // Export bar
    if (posts.length > 0 || comments.length > 0) {
      html += '<div class="export-bar">';
      html += '<button class="export-btn" id="btn-export-csv">Export CSV</button>';
      html += '<button class="export-btn" id="btn-export-json">Export JSON</button>';
      html += '<button class="export-btn" id="btn-save-search">Save Search</button>';
      html += '<button class="export-btn" id="btn-copy-urls">Copy URLs</button>';
      html += '</div>';
    }

    // Render posts
    for (const p of posts) {
      const isRemoved = p.is_removed || p.is_deleted;
      const cls = isRemoved ? 'result-item removed' : 'result-item';
      const postUrl = p.url || (GAW_BASE + '/p/' + (p.slug || p.id) + '/');
      const title = p.title || '(untitled)';
      const snippet = truncate(stripHtml(p.body_md || p.body_html || ''), 300);
      const date = formatDate(p.created_at);
      const score = p.score != null ? p.score : '?';
      const cc = p.comment_count != null ? p.comment_count : '?';

      html += `<div class="${cls}" data-id="${esc(p.id)}">`;
      html += `<div class="result-title"><a href="${esc(postUrl)}" target="_blank" rel="noopener">${highlight(escHtml(title), highlightWords)}</a></div>`;
      html += '<div class="result-meta">';
      html += `<span class="author">u/${escHtml(p.author || '?')}</span>`;
      html += `<span class="score">${score} pts</span>`;
      html += `<span>${cc} comments</span>`;
      html += `<span>${date}</span>`;
      if (p.flair) html += `<span class="flair">${escHtml(p.flair)}</span>`;
      if (isRemoved) html += '<span class="removed-tag">[REMOVED]</span>';
      html += '</div>';
      if (snippet) {
        html += `<div class="result-snippet">${highlight(escHtml(snippet), highlightWords)}</div>`;
      }
      html += '</div>';
    }

    // Render comments
    for (const c of comments) {
      const isRemoved = c.is_removed || c.is_deleted;
      const cls = 'result-item comment-result' + (isRemoved ? ' removed' : '');
      const snippet = truncate(stripHtml(c.body_md || c.body_html || ''), 300);
      const date = formatDate(c.created_at);
      const score = c.score != null ? c.score : '?';
      const postLink = c.post_id ? (GAW_BASE + '/p/' + c.post_id + '/') : '#';

      html += `<div class="${cls}">`;
      html += `<div class="result-title">${highlight(escHtml(snippet.slice(0, 120)), highlightWords)}</div>`;
      html += '<div class="result-meta">';
      html += `<span class="author">u/${escHtml(c.author || '?')}</span>`;
      html += `<span class="score">${score} pts</span>`;
      html += `<span>${date}</span>`;
      html += `<a href="${esc(postLink)}" target="_blank" style="color:var(--accent);text-decoration:none;">View post</a>`;
      if (isRemoved) html += '<span class="removed-tag">[REMOVED]</span>';
      html += '</div>';
      if (snippet.length > 120) {
        html += `<div class="result-snippet">${highlight(escHtml(snippet), highlightWords)}</div>`;
      }
      html += '</div>';
    }

    resultsList.innerHTML = html;

    // Pagination
    const totalItems = posts.length + comments.length;
    const showing = currentOffset + totalItems;
    btnPrev.disabled = currentOffset === 0;
    btnNext.disabled = totalItems < perPage;
    pageInfo.textContent = `${currentOffset + 1}-${showing}` + (total > 0 ? ` of ${total}` : '');

    // Wire export buttons
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportJson = document.getElementById('btn-export-json');
    const btnSaveSearch = document.getElementById('btn-save-search');
    const btnCopyUrls = document.getElementById('btn-copy-urls');

    if (btnExportCsv) btnExportCsv.addEventListener('click', () => exportCsv(posts));
    if (btnExportJson) btnExportJson.addEventListener('click', () => exportJson(posts));
    if (btnSaveSearch) btnSaveSearch.addEventListener('click', () => {
      msg({ type: 'saveSearch', query: currentQuery });
      btnSaveSearch.textContent = 'Saved!';
      setTimeout(() => { btnSaveSearch.textContent = 'Save Search'; }, 1500);
    });
    if (btnCopyUrls) btnCopyUrls.addEventListener('click', () => {
      const urls = posts.map(p => p.url || (GAW_BASE + '/p/' + (p.slug || p.id) + '/')).join('\n');
      navigator.clipboard.writeText(urls).then(() => {
        btnCopyUrls.textContent = 'Copied!';
        setTimeout(() => { btnCopyUrls.textContent = 'Copy URLs'; }, 1500);
      });
    });
  }

  // Query builder
  function buildQueryFromBuilder() {
    const parts = [];
    const include = document.getElementById('qb-include').value.trim();
    const phrase = document.getElementById('qb-phrase').value.trim();
    const exclude = document.getElementById('qb-exclude').value.trim();
    const author = document.getElementById('qb-author').value.trim();
    const scoreOp = document.getElementById('qb-score-op').value;
    const scoreVal = document.getElementById('qb-score-val').value.trim();
    const dateFrom = document.getElementById('qb-date-from').value;
    const dateTo = document.getElementById('qb-date-to').value;
    const removed = document.getElementById('qb-removed').value;

    if (include) parts.push(include);
    if (phrase) parts.push('"' + phrase + '"');
    if (exclude) {
      for (const w of exclude.split(/\s+/)) {
        if (w) parts.push('-' + w);
      }
    }
    if (author) parts.push('author:' + author);
    if (scoreOp && scoreVal) parts.push('score:' + scoreOp + scoreVal);
    if (dateFrom || dateTo) {
      parts.push('date:' + (dateFrom || '') + '..' + (dateTo || ''));
    }
    if (removed) parts.push('removed:' + removed);

    return parts.join(' ');
  }

  function clearBuilder() {
    document.getElementById('qb-include').value = '';
    document.getElementById('qb-phrase').value = '';
    document.getElementById('qb-exclude').value = '';
    document.getElementById('qb-author').value = '';
    document.getElementById('qb-score-op').value = '';
    document.getElementById('qb-score-val').value = '';
    document.getElementById('qb-date-from').value = '';
    document.getElementById('qb-date-to').value = '';
    document.getElementById('qb-removed').value = '';
  }

  // Recent searches
  async function loadRecentSearches() {
    const resp = await msg({ type: 'getRecentSearches' });
    const searches = resp.searches || [];
    if (searches.length === 0) {
      recentDiv.innerHTML = '';
      return;
    }
    recentDiv.innerHTML = searches
      .map(s => `<span class="chip" data-query="${esc(s)}">${escHtml(truncate(s, 40))}</span>`)
      .join('');

    recentDiv.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.query;
        doSearch(el.dataset.query);
      });
    });
  }

  // Saved searches panel
  async function loadSavedSearches() {
    const resp = await msg({ type: 'getSavedSearches' });
    const list = resp.searches || [];
    const container = document.getElementById('saved-list');
    if (list.length === 0) {
      container.innerHTML = '<p style="color:var(--text2)">No saved searches yet.</p>';
      return;
    }
    container.innerHTML = list.map((s, i) => {
      const d = new Date(s.savedAt).toLocaleDateString();
      return `<div class="saved-item" data-index="${i}">
        <span class="saved-query">${escHtml(truncate(s.query, 60))}</span>
        <span class="saved-date">${d}</span>
        <button class="saved-delete" data-index="${i}" title="Delete">X</button>
      </div>`;
    }).join('');

    container.querySelectorAll('.saved-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.classList.contains('saved-delete')) return;
        const idx = parseInt(el.dataset.index, 10);
        const q = list[idx].query;
        searchInput.value = q;
        closeAllPanels();
        doSearch(q);
      });
    });

    container.querySelectorAll('.saved-delete').forEach(el => {
      el.addEventListener('click', async e => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.index, 10);
        await msg({ type: 'deleteSavedSearch', index: idx });
        loadSavedSearches();
      });
    });
  }

  // Export
  function exportCsv(posts) {
    const headers = ['id', 'title', 'author', 'score', 'comments', 'date', 'flair', 'removed', 'url'];
    const rows = posts.map(p => [
      p.id,
      csvEscape(p.title || ''),
      p.author || '',
      p.score,
      p.comment_count,
      formatDate(p.created_at),
      p.flair || '',
      p.is_removed ? 'yes' : 'no',
      p.url || (GAW_BASE + '/p/' + (p.slug || p.id) + '/'),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    downloadFile(csv, 'gaw-search-results.csv', 'text/csv');
  }

  function exportJson(posts) {
    downloadFile(JSON.stringify(posts, null, 2), 'gaw-search-results.json', 'application/json');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Panel management
  function openPanel(id) {
    closeAllPanels();
    document.getElementById(id).classList.remove('hidden');
    overlay.classList.remove('hidden');
    if (id === 'saved-panel') loadSavedSearches();
    if (id === 'settings-panel') {
      document.getElementById('settings-token').value = token ? '********' : '';
    }
  }

  function closeAllPanels() {
    savedPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    overlay.classList.add('hidden');
  }

  // Empty state
  function showEmptyState() {
    resultsList.innerHTML = `
      <div class="empty-state">
        <h2>Search the GAW Firehose Archive</h2>
        <p>Type a search query above or use the Advanced builder.</p>
        <p style="margin-top:16px"><strong>Query syntax:</strong></p>
        <p><code>trump pelosi</code> &mdash; AND search</p>
        <p><code>"exact phrase"</code> &mdash; phrase match</p>
        <p><code>author:catsfive</code> &mdash; by user</p>
        <p><code>score:>50</code> &mdash; vote threshold</p>
        <p><code>date:2026-01-01..2026-03-01</code> &mdash; date range</p>
        <p><code>removed:1</code> &mdash; deleted content</p>
        <p><code>-fauci</code> &mdash; exclude a term</p>
        <p><code>trump*</code> &mdash; prefix match</p>
      </div>
    `;
  }

  // Helpers
  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function esc(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function csvEscape(s) {
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function stripHtml(s) {
    return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  function formatDate(ts) {
    if (!ts) return '?';
    const d = typeof ts === 'number' && ts < 1e12 ? new Date(ts * 1000) : new Date(ts);
    if (isNaN(d.getTime())) return '?';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function extractSearchWords(query) {
    return (query.match(/[a-zA-Z0-9]+/g) || [])
      .filter(w => w.length > 2 && !['author', 'score', 'date', 'removed', 'community'].includes(w.toLowerCase()));
  }

  function highlight(html, words) {
    if (!words.length) return html;
    const re = new RegExp('\\b(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi');
    return html.replace(re, '<mark>$1</mark>');
  }

  // Event listeners
  btnSearch.addEventListener('click', () => doSearch(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(searchInput.value);
  });

  btnToggleBuilder.addEventListener('click', () => {
    const isHidden = queryBuilder.classList.toggle('hidden');
    btnToggleBuilder.textContent = isHidden ? 'Show Advanced' : 'Hide Advanced';
  });

  btnBuildQuery.addEventListener('click', () => {
    const q = buildQueryFromBuilder();
    if (q) {
      searchInput.value = q;
      doSearch(q);
    }
  });

  btnClearBuilder.addEventListener('click', clearBuilder);

  btnPrev.addEventListener('click', () => {
    if (currentOffset >= perPage) {
      doSearch(currentQuery, currentOffset - perPage);
    }
  });

  btnNext.addEventListener('click', () => {
    doSearch(currentQuery, currentOffset + perPage);
  });

  document.getElementById('btn-saved').addEventListener('click', () => openPanel('saved-panel'));
  document.getElementById('btn-settings').addEventListener('click', () => openPanel('settings-panel'));
  overlay.addEventListener('click', closeAllPanels);

  document.querySelectorAll('.panel-close').forEach(el => {
    el.addEventListener('click', closeAllPanels);
  });

  document.getElementById('btn-save-token').addEventListener('click', async () => {
    const input = document.getElementById('settings-token');
    const val = input.value.trim();
    if (!val || val === '********') return;
    token = val;
    await msg({ type: 'setToken', token: val });
    input.value = '********';
    statusText.textContent = 'Token saved.';
  });

  document.getElementById('settings-per-page').addEventListener('change', e => {
    perPage = parseInt(e.target.value, 10) || PER_PAGE_DEFAULT;
    chrome.storage.local.set({ perPage: String(perPage) });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllPanels();
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  init();
})();
