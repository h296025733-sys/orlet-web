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

  const MARK = 'orlet-quote-mark';
  const REFRESH_MS = 4000;

  // The styles live in quote-overlay.css: the local server sets style-src 'self',
  // so an injected <style> would be blocked there.
  function ensureStylesheet() {
    const stylesheet = new URL('quote-overlay.css', import.meta.url);
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].some(link => {
      const url = new URL(link.href, document.baseURI);
      return url.origin === stylesheet.origin && url.pathname === stylesheet.pathname;
    });
    if (existing) return;
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
  let applied = null;
  let contentDirty = true;
  let selectionPending = false;
  let documentIdentity = '';
  let currentDocumentId = null;
  let currentVersionId = null;
  let documentRequest = 0;
  let quotesLoading = null;
  let timer = null;
  let documentUrl = null;
  let lastArticleId = null;

  async function requestJson(path) {
    const response = globalThis.orletBackend?.request
      ? await globalThis.orletBackend.request(path)
      : await fetch(path, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('quotes ' + response.status);
    return response.json();
  }

  // Fallback for an older backend without quoteRanges: read the saved quotes
  // directly. Only block positions are used, never the quoted text.
  async function loadQuotes() {
    if (absorbed) return;
    const identity = documentIdentity;
    try {
      const collected = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const data = await requestJson('/api/library?kind=quotes&limit=100&offset=' + offset);
        const items = Array.isArray(data?.items) ? data.items : [];
        collected.push(...items);
        const total = Number(data?.total);
        if (!Number.isFinite(total) || collected.length >= total || !items.length) break;
      }
      if (identity !== documentIdentity || absorbed) return;
      quotes = collected
        .filter(item => !currentDocumentId || item.documentId === currentDocumentId)
        .filter(item => !currentVersionId || !item.versionId || item.versionId === currentVersionId)
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
    const blocks = [...container.querySelectorAll('[data-document-block]')];
    const key = JSON.stringify([documentIdentity, quotes.map(quote => quote.anchor)]);
    if (!contentDirty && applied?.container === container && applied.key === key &&
        applied.blocks.length === blocks.length && blocks.every((block, index) => block === applied.blocks[index])) return;
    const selection = globalThis.getSelection?.();
    if (selection && !selection.isCollapsed && selection.rangeCount &&
        selection.getRangeAt(0).intersectsNode(container)) {
      selectionPending = true;
      return;
    }
    selectionPending = false;
    // MutationObserver callbacks run after this stack. Disconnect while changing
    // our own marks so those changes cannot schedule another render.
    observer.disconnect();
    try {
      unwrap(container);
      const index = new Map();
      blocks.forEach((node, position) => index.set(node.dataset.documentBlock, position));
      for (const quote of quotes) {
        const startBlock = index.get(quote.anchor.start.blockId);
        const endBlock = index.get(quote.anchor.end.blockId);
        if (startBlock === undefined || endBlock === undefined) continue;
        if (blocks[startBlock].querySelector('li')) continue;
        for (let position = startBlock; position <= endBlock; position++) {
          const node = blocks[position];
          const length = node.textContent?.length || 0;
          const from = position === startBlock ? Number(quote.anchor.start.offset) || 0 : 0;
          const to = position === endBlock ? Number(quote.anchor.end.offset) : length;
          wrap(node, Math.max(0, from), Math.min(length, to));
        }
      }
      applied = { container, blocks, key };
      contentDirty = false;
    } finally {
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    }
  }

  function schedule(delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(applyAll, delay);
  }

  async function refresh({ force = false } = {}) {
    const container = document.getElementById('reader-content');
    if (document.hidden || !container?.childElementCount) return;
    if (!absorbed && (force || Date.now() - quotesAt > REFRESH_MS)) {
      quotesLoading ??= loadQuotes().finally(() => { quotesLoading = null; });
      await quotesLoading;
    }
    schedule(0);
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      if (target?.id === 'reader-content' || target?.closest?.('#reader-content')) {
        contentDirty = true;
        schedule();
        return;
      }
    }
  });

  function absorb(payload) {
    const document = payload?.document || payload;
    if (!document) return;
    currentDocumentId = document.documentId || payload.documentId || null;
    currentVersionId = document.versionId || payload.versionId || null;
    documentIdentity = JSON.stringify([documentUrl, currentDocumentId, currentVersionId]);
    if (Number.isFinite(Number(document.articleId))) lastArticleId = Number(document.articleId);
    absorbed = Array.isArray(document.quoteRanges);
    if (!absorbed) { quotes = []; quotesAt = 0; void refresh({ force: true }); return; }
    quotes = document.quoteRanges
      .filter(anchor => anchor?.start?.blockId && anchor?.end?.blockId)
      .map(anchor => ({ anchor }));
    quotesAt = Date.now();
    schedule(0);
  }

  function observeRequest(target, method, result) {
    const isDocument = method === 'GET' && /\/api\/(?:articles\/\d+\/document|documents\/[a-f0-9-]{36}\/document|library\/(?:articles|quotes)\/[a-zA-Z0-9-]+)(?:\?|$)/.test(target);
    const quoteChanged = method === 'POST' && /\/api\/(?:articles\/\d+|documents\/[a-f0-9-]{36})\/quotes(?:\?|$)/.test(target)
      || method === 'DELETE' && /\/api\/library\/quotes\/[a-zA-Z0-9-]+(?:\?|$)/.test(target);
    if (isDocument) {
      const request = ++documentRequest;
      documentUrl = target;
      result.then(response => {
        if (!response.ok) return;
        response.clone().json().then(payload => {
          if (request === documentRequest) absorb(payload);
        }).catch(() => {});
      }, () => {});
    } else if (quoteChanged) {
      result.then(response => { if (response.ok) void refreshFromDocument(); }, () => {});
    }
  }

  // Observe the same transport as the app. Reading a document supplies its own
  // ranges, and successful quote writes refresh only that document.
  function watchDocumentResponses() {
    const backend = globalThis.orletBackend;
    if (backend?.request && !backend.__quoteOverlay) {
      const original = backend.request;
      backend.request = function patchedRequest(...args) {
        const result = original.apply(this, args);
        observeRequest(String(args[0] || ''), (args[1]?.method || 'GET').toUpperCase(), result);
        return result;
      };
      backend.__quoteOverlay = true;
    } else if (!backend && typeof globalThis.fetch === 'function') {
      const original = globalThis.fetch;
      globalThis.fetch = function patchedFetch(input, init) {
        const result = original.apply(this, arguments);
        observeRequest(typeof input === 'string' ? input : input?.url || '', (init?.method || input?.method || 'GET').toUpperCase(), result);
        return result;
      };
    }
  }

  async function refreshFromDocument() {
    const target = documentUrl;
    if (!target) return;
    try { await requestJson(target); } catch {}
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
        if (globalThis.orletBackend?.request) {
          const response = await globalThis.orletBackend.request('/api/health');
          if (!response.ok) return;
        }
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
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    refresh({ force: true });
    setInterval(() => {
      const container = document.getElementById('reader-content');
      if (container && container.childElementCount) refresh();
    }, REFRESH_MS);
    document.addEventListener('selectionchange', () => {
      if (selectionPending) schedule();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  globalThis.orletQuoteOverlay = { refresh: () => refresh({ force: true }), state: () => ({ absorbed, quotes: quotes.length, documentUrl, lastArticleId, marks: document.querySelectorAll('mark.' + MARK).length }) };
})();
