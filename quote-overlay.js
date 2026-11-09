// Persistent highlight overlay for saved quotes (划线收藏).
//
// The reader already renders document blocks with `data-document-block` ids.
// A saved quote stores an anchor of block ids plus character offsets, so the
// same highlight can be drawn purely on the client, for both the live reader
// and the library copy, on desktop and mobile. Nothing here writes data: it
// only reads `/api/library?kind=quotes` and re-applies marks, so cancelling a
// quote in the library removes its line on the next refresh.
(() => {
  if (globalThis.__orletQuoteOverlay) return;
  globalThis.__orletQuoteOverlay = true;

  const STYLE_ID = 'orlet-quote-overlay-style';
  const MARK = 'orlet-quote-mark';
  const REFRESH_MS = 4000;

  // The styles live in quote-overlay.css: the local server sets style-src 'self',
  // so an injected <style> would be blocked there.
  function ensureStylesheet() {
    if (document.querySelector('link[data-quote-overlay-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('quote-overlay.css', import.meta.url).href;
    link.dataset.quoteOverlayStyle = '1';
    document.head.appendChild(link);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureStylesheet, { once: true });
  else ensureStylesheet();

  let quotes = [];
  let quotesAt = 0;
  let absorbed = false;
  let applying = false;
  let timer = null;
  let documentUrl = null;
  let lastArticleId = null;

  function backendBase() {
    try {
      if (globalThis.orletBackend?.path) return null; // request() used instead
    } catch {}
    return '';
  }

  async function requestJson(path) {
    if (globalThis.orletBackend?.request) return globalThis.orletBackend.request(path);
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('quotes ' + response.status);
    return response.json();
  }

  // Fallback for an older backend without quoteRanges: read the saved quotes
  // directly. Only block positions are used, never the quoted text.
  async function loadQuotes() {
    if (absorbed) return;
    try {
      const collected = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const data = await requestJson('/api/library?kind=quotes&limit=100&offset=' + offset);
        const items = Array.isArray(data?.items) ? data.items : [];
        collected.push(...items);
        const total = Number(data?.total);
        if (!Number.isFinite(total) || collected.length >= total || !items.length) break;
      }
      quotes = collected
        .map(item => ({ id: item.id, anchor: item.anchor || item.range }))
        .filter(item => item.anchor?.start?.blockId && item.anchor?.end?.blockId);
      quotesAt = Date.now();
    } catch {}
  }

  function unwrap(container) {
    for (const mark of [...container.querySelectorAll(`mark.${MARK}`)]) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize?.();
    }
  }

  function wrap(block, from, to) {
    if (!(to > from)) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.nodeValue ? node.nodeValue.length : 0;
      if (!length) continue;
      nodes.push({ node, start: total, end: total + length });
      total += length;
    }
    if (to > total) to = total;
    for (const entry of nodes) {
      const start = Math.max(from, entry.start);
      const end = Math.min(to, entry.end);
      if (end <= start) continue;
      const range = document.createRange();
      range.setStart(entry.node, start - entry.start);
      range.setEnd(entry.node, end - entry.start);
      const mark = document.createElement('mark');
      mark.className = MARK;
      mark.dataset.quoteMark = '1';
      try { range.surroundContents(mark); } catch {}
    }
  }

  function applyAll() {
    const container = document.getElementById('reader-content');
    if (!container || !container.childElementCount) return;
    if (!quotes.length) { unwrap(container); return; }
    applying = true;
    try {
      unwrap(container);
      const blocks = [...container.querySelectorAll('[data-document-block]')];
      if (!blocks.length) return;
      const index = new Map();
      blocks.forEach((node, position) => index.set(node.dataset.documentBlock, position));
      for (const quote of quotes) {
        const startBlock = index.get(quote.anchor.start.blockId);
        const endBlock = index.get(quote.anchor.end.blockId);
        if (startBlock === undefined || endBlock === undefined) continue;
        if (blocks[startBlock].querySelector('li')) continue; // list offsets differ
        for (let position = startBlock; position <= endBlock; position++) {
          const node = blocks[position];
          const length = node.textContent ? node.textContent.length : 0;
          const from = position === startBlock ? Number(quote.anchor.start.offset) || 0 : 0;
          const to = position === endBlock ? Number(quote.anchor.end.offset) || length : length;
          wrap(node, Math.max(0, from), Math.min(length, to));
        }
      }
    } finally {
      applying = false;
    }
  }

  function schedule(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(applyAll, delay);
  }

  async function refresh({ force = false } = {}) {
    if (force || Date.now() - quotesAt > REFRESH_MS) await loadQuotes();
    schedule(0);
  }

  const observer = new MutationObserver(mutations => {
    if (applying) return;
    for (const mutation of mutations) {
      const target = mutation.target;
      if (!(target instanceof Element)) continue;
      if (target.id === 'reader-content' || target.closest?.('#reader-content')) { schedule(); return; }
    }
  });

  function absorb(payload) {
    if (!payload || !Array.isArray(payload.quoteRanges)) return;
    absorbed = true;
    if (Number.isFinite(Number(payload.articleId))) lastArticleId = Number(payload.articleId);
    quotes = payload.quoteRanges
      .filter(anchor => anchor?.start?.blockId && anchor?.end?.blockId)
      .map(anchor => ({ anchor }));
    quotesAt = Date.now();
    schedule(0);
  }

  // The document response already carries the quote ranges for its own document,
  // so the reader needs no extra request (and works from the public frontend too).
  function watchDocumentResponses() {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === 'function') {
      globalThis.fetch = function patchedFetch(input, init) {
        const result = originalFetch.apply(this, arguments);
        try {
          const url = typeof input === 'string' ? input : input?.url || '';
          if (/\/api\/(articles\/\d+|documents\/[a-f0-9-]{36})\/document(\?|$)/.test(url)) { documentUrl = url; result.then(response => {
            response.clone().json().then(absorb).catch(() => {});
          }, () => {}); }
        } catch {}
        return result;
      };
    }
    const backend = globalThis.orletBackend;
    if (backend && typeof backend.request === 'function' && !backend.__quoteOverlay) {
      const original = backend.request;
      backend.request = async function patchedRequest(...args) {
        const value = await original.apply(this, args);
        try { absorb(value); } catch {}
        return value;
      };
      backend.__quoteOverlay = true;
    }
  }

  // A new or cancelled quote changes the document's ranges; re-read the same
  // document endpoint instead of guessing.
  async function refreshFromDocument() {
    const target = documentUrl || (lastArticleId ? '/api/articles/' + lastArticleId + '/document' : null);
    if (!target) return;
    try {
      if (globalThis.orletBackend?.request) absorb(await globalThis.orletBackend.request(target));
      else {
        const response = await fetch(target, { headers: { Accept: 'application/json' } });
        if (response.ok) absorb(await response.json());
      }
    } catch {}
  }

  // If the shared page landed on an offline banner (tunnel or backend restart),
  // probe the backend and reload once it answers again. This keeps a phone that
  // was open during a restart from staying stuck on "服务离线".
  function watchConnection() {
    let lastReload = 0;
    const offline = () => {
      const status = document.getElementById('refresh-status')?.textContent || '';
      const title = document.getElementById('connection-title')?.textContent || '';
      return /服务离线|暂时离线/.test(status + title);
    };
    const probe = async () => {
      if (document.hidden || !offline()) return;
      if (Date.now() - lastReload < 30000) return;
      try {
        if (globalThis.orletBackend?.refresh) await globalThis.orletBackend.refresh();
        if (globalThis.orletBackend?.request) await globalThis.orletBackend.request('/api/health');
        else {
          const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
          if (!response.ok) return;
        }
        lastReload = Date.now();
        location.reload();
      } catch {}
    };
    setInterval(probe, 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) setTimeout(probe, 1200);
    });
  }

  function start() {
    watchDocumentResponses();
    watchConnection();
    observer.observe(document.body, { childList: true, subtree: true });
    refresh({ force: true });
    setInterval(() => {
      const container = document.getElementById('reader-content');
      if (container && container.childElementCount) refresh();
    }, REFRESH_MS);
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('#quote-save,[data-quote-save],[data-quote-delete],[data-library-remove]')) { setTimeout(() => refreshFromDocument(), 700); return; }
      if (target.closest('#library-list,#reader-content,#articles')) setTimeout(() => refreshFromDocument(), 1200);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  globalThis.orletQuoteOverlay = { refresh: () => refresh({ force: true }), state: () => ({ absorbed, quotes: quotes.length, documentUrl, lastArticleId, marks: document.querySelectorAll('mark.' + MARK).length }) };
})();
