/* GAW Research Search — Popup */
(function () {
  'use strict';

  const q = document.getElementById('q');
  const go = document.getElementById('go');
  const status = document.getElementById('status');
  const openFull = document.getElementById('open-full');

  chrome.storage.local.get(['modToken'], r => {
    if (r.modToken) {
      status.textContent = 'Token configured';
      status.className = 'status ok';
    } else {
      status.textContent = 'No token set -- open Full Search to configure';
      status.className = 'status err';
    }
  });

  function search() {
    const query = q.value.trim();
    if (!query) return;
    chrome.tabs.create({ url: 'search.html#q=' + encodeURIComponent(query) });
    window.close();
  }

  go.addEventListener('click', search);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });

  openFull.addEventListener('click', e => {
    e.preventDefault();
    chrome.tabs.create({ url: 'search.html' });
    window.close();
  });
})();
