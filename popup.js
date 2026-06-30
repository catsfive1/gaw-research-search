/* GAW Research Search v2.0.0 — Popup Logic */
'use strict';

const $ = id => document.getElementById(id);

// State
let lastQuery = '';
let lastOpts = {};
let currentOffset = 0;
let totalLoaded = 0;
let isLoading = false;

// Elements
const qEl        = $('q');
const btnSearch  = $('btn-search');
const statusBar  = $('status-bar');
const resultsEl  = $('results');
const emptyEl    = $('empty');
const loadMore   = $('load-more');
const recentEl   = $('recent');
const filterTog  = $('filter-toggle');
const filtersEl  = $('filters');
const savedPanel = $('saved-panel');
const savedList  = $('saved-list');

// ── Helpers ─────────────────────────────────────────────────────────────────

function msg(payload) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(payload, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r);
    });
  });
}

function status(txt, cls = '') {
  statusBar.textContent = txt;
  statusBar.className = cls;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function excerpt(str, limit = 160) {
  if (!str) return '';
  const plain = str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? plain.slice(0, limit) + '…' : plain;
}

function highlightTerms(text, query) {
  if (!query) return escHtml(text);
  const words = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let out = escHtml(text);
  words.forEach(w => {
    const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  });
  return out;
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildGawUrl(post) {
  if (post.slug) return 'https://greatawakening.win/p/' + post.slug;
  return 'https://greatawakening.win';
}

// ── Filters → query string ──────────────────────────────────────────────────

function buildQuery() {
  let q = qEl.value.trim();
  if (!q) return '';

  const author   = $('f-author').value.trim();
  const dateFrom = $('f-date-from').value;
  const dateTo   = $('f-date-to').value;
  const scoreOp  = $('f-score-op').value;
  const scoreVal = $('f-score-val').value.trim();

  if (author)  q += ' author:' + author;
  if (dateFrom) q += ' date:>=' + dateFrom;
  if (dateTo)   q += ' date:<=' + dateTo;
  if (scoreOp && scoreVal) q += ' score:' + scoreOp + scoreVal;

  return q;
}

function buildOpts(offset = 0) {
  return {
    scope:  $('f-scope').value,
    sort:   $('f-sort').value === 'relevance' ? 'rank' : $('f-sort').value === 'score' ? 'score' : 'date',
    limit:  25,
    offset,
  };
}

// ── Render results ──────────────────────────────────────────────────────────

function renderResults(data, append = false) {
  if (!append) resultsEl.innerHTML = '';

  const posts    = data.posts    || [];
  const comments = data.comments || [];
  const items    = [
    ...posts.map(p => ({ ...p, _type: 'post' })),
    ...comments.map(c => ({ ...c, _type: 'comment' })),
  ];

  if (!append && items.length === 0) {
    emptyEl.style.display = 'flex';
    emptyEl.querySelector('.empty-icon').textContent = '🔍';
    emptyEl.querySelector('.empty-txt').textContent  = 'No results found';
    emptyEl.querySelector('.empty-hint').textContent = 'Try different keywords or adjust filters';
    loadMore.style.display = 'none';
    status('No results', '');
    return;
  }

  emptyEl.style.display = 'none';
  items.forEach(item => {
    const isComment = item._type === 'comment';
    const url       = buildGawUrl(item);
    const card      = document.createElement('a');
    card.className  = 'result' + (isComment ? ' r-type-comment' : '');
    card.href       = url;
    card.target     = '_blank';
    card.rel        = 'noopener';

    const title     = item.title || (isComment ? '↳ Comment on post #' + item.post_id : 'Untitled');
    const scoreVal  = item.score || 0;
    const comments  = item.comment_count || 0;
    const author    = item.author || '';
    const flair     = item.flair || '';
    const removed   = item.is_removed || item.is_deleted;

    const snippetRaw = item.body_md || item.body_html || item.content || '';
    const snip       = excerpt(snippetRaw);

    card.innerHTML = `
      <div class="r-title">${highlightTerms(title, lastQuery)}</div>
      <div class="r-meta">
        ${flair   ? `<span class="r-flair">${escHtml(flair)}</span>` : ''}
        ${removed ? `<span class="r-removed">REMOVED</span>` : ''}
        <span class="r-score">⬆ ${scoreVal}</span>
        ${!isComment ? `<span class="r-comments">💬 ${comments}</span>` : ''}
        ${author  ? `<span class="r-author">@${escHtml(author)}</span>` : ''}
        <span class="r-date">${formatDate(item.created_at)}</span>
        ${isComment ? '<span class="r-type">comment</span>' : ''}
      </div>
      ${snip ? `<div class="r-excerpt">${highlightTerms(snip, lastQuery)}</div>` : ''}
    `;
    resultsEl.appendChild(card);
  });

  totalLoaded += items.length;
  loadMore.style.display = items.length >= 25 ? 'block' : 'none';
}

// ── Search ──────────────────────────────────────────────────────────────────

async function doSearch(append = false) {
  if (isLoading) return;
  const q = buildQuery();
  if (!q) { qEl.focus(); return; }

  isLoading = true;
  btnSearch.disabled = true;
  status('Searching…', 'loading');

  if (!append) {
    lastQuery     = qEl.value.trim();
    lastOpts      = buildOpts(0);
    currentOffset = 0;
    totalLoaded   = 0;
    resultsEl.innerHTML = '';
    emptyEl.style.display = 'none';
    loadMore.style.display = 'none';
  }

  try {
    const opts = buildOpts(currentOffset);
    const data = await msg({ type: 'search', query: q, opts });

    if (data.error) {
      status(data.error, 'error');
      if (!append) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('.empty-icon').textContent = '⚠️';
        emptyEl.querySelector('.empty-txt').textContent = data.error;
        emptyEl.querySelector('.empty-hint').textContent = '';
      }
      return;
    }

    const total = (data.posts || []).length + (data.comments || []).length;
    renderResults(data, append);
    currentOffset += total;

    const countStr = total === 0 ? 'No results' :
      (append ? totalLoaded + ' loaded' : total + ' results');
    status(countStr + (data.godmode ? ' · GOD MODE' : ''), '');

    // Save to recent
    if (!append && lastQuery) {
      msg({ type: 'addRecent', q: lastQuery });
      renderRecent();
    }
  } catch (e) {
    status('Error: ' + e.message, 'error');
  } finally {
    isLoading = false;
    btnSearch.disabled = false;
  }
}

// ── Recent searches ─────────────────────────────────────────────────────────

async function renderRecent() {
  const { list } = await msg({ type: 'getRecent' });
  recentEl.innerHTML = '';
  (list || []).slice(0, 8).forEach(q => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = q;
    chip.addEventListener('click', () => {
      qEl.value = q;
      doSearch();
    });
    recentEl.appendChild(chip);
  });
}

// ── Saved panel ─────────────────────────────────────────────────────────────

async function openSaved() {
  const { list } = await msg({ type: 'getSaved' });
  savedList.innerHTML = '';
  if (!list || list.length === 0) {
    savedList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">No saved searches yet.<br>Search for something and click ★ to save it.</div>';
  } else {
    list.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'saved-item';
      row.innerHTML = `<span class="saved-q">${escHtml(item.q)}</span><button class="saved-del" title="Remove">×</button>`;
      row.querySelector('.saved-q').addEventListener('click', () => {
        qEl.value = item.q;
        closeSaved();
        doSearch();
      });
      row.querySelector('.saved-del').addEventListener('click', e => {
        e.stopPropagation();
        msg({ type: 'toggleSave', q: item.q }).then(() => openSaved());
      });
      savedList.appendChild(row);
    });
  }
  savedPanel.classList.add('visible');
  $('main-content').style.display = 'none';
}

function closeSaved() {
  savedPanel.classList.remove('visible');
  $('main-content').style.display = 'flex';
}

// ── Event wiring ─────────────────────────────────────────────────────────────

btnSearch.addEventListener('click', () => doSearch());
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

filterTog.addEventListener('click', () => {
  filterTog.classList.toggle('open');
  filtersEl.classList.toggle('visible');
});

loadMore.addEventListener('click', () => doSearch(true));

$('hdr-saved-btn').addEventListener('click', openSaved);
$('btn-saved-close').addEventListener('click', closeSaved);

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  await renderRecent();
  // Restore last query if popup was closed mid-search
  const stored = await new Promise(r => chrome.storage.local.get(['lastQuery'], r));
  if (stored.lastQuery) qEl.value = stored.lastQuery;
  qEl.focus();
  qEl.select();
})();

// Persist query across popup open/close
qEl.addEventListener('input', () => {
  chrome.storage.local.set({ lastQuery: qEl.value });
});
