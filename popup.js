const DEFAULTS = { ads: true, ai: true, follow: true, join: true, suggested: false, debug: false };

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    el.checked = !!s[key];
    el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const hint = document.getElementById('hint');
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'fbclean:stats' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      hint.textContent = 'Open facebook.com to see the counters.';
      return;
    }
    for (const k of ['ad', 'ai', 'follow', 'join', 'suggested']) {
      document.getElementById('c-' + k).textContent = res[k] ? res[k] : '';
    }
    const total = Object.values(res).reduce((a, b) => a + (b || 0), 0);
    hint.textContent = `Detected on this page: ${total}`;
  });
});
