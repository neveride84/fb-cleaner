(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Ustawienia
  // ---------------------------------------------------------------------------
  const DEFAULTS = { ads: true, ai: true, follow: true, join: true, suggested: false, debug: false };
  let settings = { ...DEFAULTS };
  const stats = { ad: 0, ai: 0, follow: 0, join: 0, suggested: 0 };

  // ---------------------------------------------------------------------------
  // Słowniki (PL + EN + kilka innych języków dla "Sponsorowane")
  // ---------------------------------------------------------------------------
  const norm = (s) =>
    (s || '')
      .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
      .replace(/[\u00A0\s]+/g, ' ')
      .trim()
      .toLowerCase();

  const SPONSORED = new Set([
    'sponsored', 'sponsorowane', 'sponsorowany', 'sponsorowana',
    'reklama', 'gesponsert', 'sponsorisé', 'sponsorisée',
    'patrocinado', 'patrocinada', 'sponsorizzato', 'gesponsord'
  ]);

  const AI_EXACT = new Set([
    'ai content', 'ai info', 'ai label',
    'treści ai', 'treść ai', 'zawartość ai', 'treści sztucznej inteligencji',
    'informacje o ai', 'informacja o ai', 'etykieta ai',
    'made with ai', 'created with ai', 'imagined with ai', 'generated with ai',
    'ai generated', 'ai-generated', 'ai-generated content', 'edited with ai',
    'utworzono przy użyciu ai', 'utworzone przy użyciu ai',
    'stworzono przy użyciu ai', 'wygenerowano przez ai', 'wygenerowane przez ai',
    'wygenerowano przy użyciu ai', 'zmodyfikowano przy użyciu ai',
    'treści wygenerowane przez ai', 'treść wygenerowana przez ai',
    'zapytaj meta ai', 'ask meta ai'
  ]);

  const AI_REGEX = [
    /^(made|created|generated|imagined|edited|modified)\s+(with|by|using)\s+(meta\s+)?ai\b/,
    /^(utworzon|wygenerowan|stworzon|zmodyfikowan|edytowan|zrobion)\S*\s+(przy użyciu|przez|za pomocą|z użyciem|z)\s+(meta\s+)?ai\b/
  ];

  const SUGGESTED = new Set([
    'suggested for you', 'sugerowane dla ciebie', 'sugerowany post',
    'proponowane dla ciebie', 'polecane dla ciebie',
    'reels', 'rolki', 'reels and short videos', 'rolki i krótkie filmy',
    'people you may know', 'osoby, które możesz znać'
  ]);

  // Przyciski w nagłówku posta podsuniętego przez FB:
  // "Follow" – strona, której nie obserwujesz; "Join" – grupa, do której nie należysz
  const FOLLOW_BUTTONS = new Set(['follow', 'obserwuj']);
  const JOIN_BUTTONS = new Set(['join', 'join group', 'dołącz', 'dołącz do grupy']);

  const isAiText = (t) => AI_EXACT.has(t) || AI_REGEX.some((r) => r.test(t));
  const isSponsoredText = (t) => {
    if (!t) return false;
    if (SPONSORED.has(t)) return true;
    for (const k of SPONSORED) if (t.startsWith(k + ' ')) return true;
    return false;
  };

  // ---------------------------------------------------------------------------
  // Pomocnicze
  // ---------------------------------------------------------------------------

  // Treść wpisana przez ludzi (tekst posta, komentarze) – tam etykiet nie szukamy,
  // żeby komentarz "AI content" nie ukrył posta
  const USER_TEXT = [
    '[data-ad-preview="message"]',
    '[data-ad-rendering-role="story_message"]',
    '[role="story_message"]',
    '[data-ad-comet-preview="message"]',
    'blockquote',
    '[role="article"] [role="article"]',
    'ul [role="article"]'
  ].join(',');

  // Krótkie teksty w obrębie elementu (etykiety, nagłówki, przyciski)
  function shortTexts(root, maxLen = 40) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (!v || v.length > maxLen) continue;
      if (n.parentElement && n.parentElement.closest(USER_TEXT)) continue;
      const t = norm(v);
      if (t) out.push(t);
      const parent = n.parentElement;
      const pt = parent && parent.textContent;
      if (pt && pt.length <= maxLen && pt !== v) out.push(norm(pt));
    }
    return out;
  }

  // Czy element jest faktycznie widoczny dla człowieka (FB zaciemnia "Sponsorowane"
  // wstawiając ukryte litery, przesunięte spany itp.)
  function isRendered(el, root, rootRect) {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (
        cs.display === 'none' ||
        cs.visibility === 'hidden' ||
        parseFloat(cs.opacity) === 0 ||
        parseFloat(cs.fontSize) === 0
      ) return false;
      if (e === root) break;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    return !(
      r.bottom <= rootRect.top || r.top >= rootRect.bottom ||
      r.right <= rootRect.left || r.left >= rootRect.right
    );
  }

  // Odtwarza tekst tak, jak widzi go użytkownik (tylko widoczne fragmenty,
  // posortowane wg pozycji na ekranie – omija sztuczki z CSS `order`)
  function visibleText(root) {
    const rootRect = root.getBoundingClientRect();
    if (!rootRect.width || !rootRect.height) return '';
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (!t || !t.trim()) continue;
      const el = n.parentElement;
      if (!el || !isRendered(el, root, rootRect)) continue;
      const r = el.getBoundingClientRect();
      parts.push({ x: r.left, y: r.top, t });
    }
    parts.sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));
    return norm(parts.map((p) => p.t).join(''));
  }

  const SPONSORED_SELECTOR = [
    'a[href*="/ads/about"]',
    'a[href^="/ads/"]',
    'a[href*="facebook.com/ads/"]',
    ...[...SPONSORED].map((k) => `[aria-label="${k}" i]`)
  ].join(',');

  // ---------------------------------------------------------------------------
  // Wykrywanie
  // ---------------------------------------------------------------------------
  function isSponsored(unit) {
    // 1. Jawne linki / aria-label
    if (unit.querySelector(SPONSORED_SELECTOR)) return true;

    // 2. aria-labelledby wskazujące na tekst "Sponsorowane"
    for (const el of unit.querySelectorAll('[aria-labelledby]')) {
      for (const id of el.getAttribute('aria-labelledby').split(/\s+/)) {
        const ref = id && document.getElementById(id);
        if (ref && isSponsoredText(norm(ref.textContent))) return true;
      }
    }

    // 3. Tekst renderowany przez SVG <use href="#id">
    for (const use of unit.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (!href || href[0] !== '#') continue;
      const ref = document.getElementById(href.slice(1));
      if (ref && isSponsoredText(norm(ref.textContent))) return true;
    }

    // 4. Zaciemniony tekst w nagłówku posta – rekonstrukcja widocznego tekstu
    const candidates = unit.querySelectorAll('a[href], [role="link"], span[aria-labelledby]');
    let checked = 0;
    for (const el of candidates) {
      if (checked++ > 30) break;
      const raw = el.textContent || '';
      if (raw.length < 3 || raw.length > 200) continue;
      if (isSponsoredText(norm(raw))) return true;
      if (isSponsoredText(visibleText(el))) return true;
    }
    return false;
  }

  function hasAiAria(unit) {
    for (const el of unit.querySelectorAll('[aria-label]')) {
      if (el.closest(USER_TEXT)) continue;
      if (isAiText(norm(el.getAttribute('aria-label')))) return true;
    }
    return false;
  }

  // Etykieta AI w nagłówku posta: przycisk/link, którego cały tekst to np. "AI content"
  // (np. <div role="button">AI content</div>)
  function hasAiLabelButton(unit) {
    for (const el of unit.querySelectorAll('[role="button"], [role="link"], a')) {
      const raw = el.textContent;
      if (!raw || raw.length > 40) continue;
      if (el.closest(USER_TEXT)) continue;
      if (isAiText(norm(raw))) return true;
    }
    return false;
  }

  // Czy w nagłówku posta (obok nazwy autora) jest przycisk o jednym z podanych tekstów
  function hasHeaderButton(unit, labels) {
    for (const header of unit.querySelectorAll('[data-ad-rendering-role="profile_name"], h2, h3, h4')) {
      for (const el of header.querySelectorAll('[role="button"]')) {
        const raw = el.textContent;
        if (raw && raw.length <= 30 && labels.has(norm(raw))) return true;
      }
    }
    return false;
  }

  // Zwraca wszystkie pasujące kategorie, żeby wyłączenie jednej (np. AI)
  // nie odkrywało posta, który pasuje też do innej (np. nieobserwowane)
  function classify(unit, inFeed) {
    const reasons = [];
    if (isSponsored(unit)) reasons.push('ad');
    const texts = shortTexts(unit);
    if (hasAiLabelButton(unit) || hasAiAria(unit) || texts.some(isAiText)) reasons.push('ai');
    if (hasHeaderButton(unit, FOLLOW_BUTTONS)) reasons.push('follow');
    if (hasHeaderButton(unit, JOIN_BUTTONS)) reasons.push('join');
    if (inFeed && texts.some((t) => SUGGESTED.has(t))) reasons.push('suggested');
    return reasons;
  }

  // ---------------------------------------------------------------------------
  // Zbieranie "jednostek" do sprawdzenia (posty w feedzie, artykuły, grupy, wideo)
  // ---------------------------------------------------------------------------
  function collectUnits() {
    const units = new Map(); // element -> inFeed
    document.querySelectorAll('[role="feed"]').forEach((feed) => {
      for (const child of feed.children) units.set(child, true);
    });
    document.querySelectorAll('div[aria-posinset], [role="article"]').forEach((el) => {
      if (el.closest('[role="feed"]')) return; // już pokryte przez dziecko feedu
      if (el.matches('[role="article"]') && el.parentElement?.closest('[role="article"]')) return; // komentarz
      if (!units.has(el)) units.set(el, false);
    });
    // Posty bez role="feed"/role="article" (nowy układ FB, strony grup itp.):
    // od nagłówka posta wspinamy się do kontenera, który zawiera też przycisk "Lubię to"
    document.querySelectorAll('[data-ad-rendering-role="profile_name"]').forEach((h) => {
      if (h.closest('[role="feed"]')) return;
      if (h.parentElement?.closest('[role="article"], div[aria-posinset]')) return;
      let node = h.parentElement;
      while (node && node !== document.body &&
             !node.querySelector('[data-ad-rendering-role="like_button"]')) {
        node = node.parentElement;
      }
      if (!node || node === document.body) return;
      while (node.parentElement && node.parentElement !== document.body &&
             node.parentElement.children.length === 1) {
        node = node.parentElement;
      }
      if (!units.has(node)) units.set(node, false);
    });
    return units;
  }

  // Sprawdzamy ponownie, bo FB dociąga etykiety (np. "Sponsorowane") z opóźnieniem
  const seen = new WeakMap();
  function shouldCheck(unit, now) {
    if (unit.dataset.fbclean) return false;
    const s = seen.get(unit);
    if (!s) return true;
    if (now - s.first < 15000 && now - s.last > 700) return true;
    if (now - s.last > 3000) {
      const r = unit.getBoundingClientRect();
      if (r.bottom > -300 && r.top < innerHeight + 300) return true;
    }
    return false;
  }

  function flag(el, reasons) {
    if (el.dataset.fbclean) return;
    if (typeof reasons === 'string') reasons = [reasons];
    el.dataset.fbclean = reasons.join(' ');
    for (const r of reasons) stats[r]++;
  }

  // ---------------------------------------------------------------------------
  // Prawa kolumna – blok "Sponsorowane"
  // ---------------------------------------------------------------------------
  function isExternalLink(a) {
    const h = a.getAttribute('href') || '';
    return /^https?:\/\//.test(h) && !/^https?:\/\/(www\.)?facebook\.com\//.test(h);
  }

  function scanRightRail() {
    const rail = document.querySelector('[data-pagelet="RightRail"]') ||
                 document.querySelector('[role="complementary"]');
    if (!rail) return;
    const walker = document.createTreeWalker(rail, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || n.nodeValue.length > 30) continue;
      if (!SPONSORED.has(norm(n.nodeValue))) continue;
      let node = n.parentElement;
      // wspinamy się, aż sekcja obejmie linki reklamowe...
      while (node.parentElement && node.parentElement !== rail &&
             ![...node.querySelectorAll('a[href]')].some(isExternalLink)) {
        node = node.parentElement;
      }
      // ...a potem przez wrappery z jednym dzieckiem
      while (node.parentElement && node.parentElement !== rail &&
             node.parentElement.children.length === 1) {
        node = node.parentElement;
      }
      if (node !== rail) flag(node, 'ad');
    }
  }

  // ---------------------------------------------------------------------------
  // Główna pętla
  // ---------------------------------------------------------------------------
  function scan() {
    const now = Date.now();
    for (const [unit, inFeed] of collectUnits()) {
      if (!shouldCheck(unit, now)) continue;
      const s = seen.get(unit) || { first: now, last: 0 };
      s.last = now;
      seen.set(unit, s);
      try {
        const reasons = classify(unit, inFeed);
        if (reasons.length) flag(unit, reasons);
      } catch (e) {
        if (settings.debug) console.warn('[Feed Cleaner]', e);
      }
    }
    try { scanRightRail(); } catch (_) { /* ignoruj */ }
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 250);
  }

  function applyClasses() {
    const h = document.documentElement;
    h.classList.toggle('fbclean-debug', !!settings.debug);
    h.classList.toggle('fbclean-hide-ad', settings.ads && !settings.debug);
    h.classList.toggle('fbclean-hide-ai', settings.ai && !settings.debug);
    h.classList.toggle('fbclean-hide-follow', settings.follow && !settings.debug);
    h.classList.toggle('fbclean-hide-join', settings.join && !settings.debug);
    h.classList.toggle('fbclean-hide-suggested', settings.suggested && !settings.debug);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    applyClasses();
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k in changes) settings[k] = changes[k].newValue;
    applyClasses();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'fbclean:stats') reply({ ...stats });
  });

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  addEventListener('scroll', schedule, { passive: true });
})();
