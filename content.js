// FixReading content script. Injected on demand by the popup.
// Guarded so re-injection is a no-op.
(() => {
  if (window.__fixReadingLoaded) return;
  window.__fixReadingLoaded = true;

  const FORBIDDEN_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'CODE', 'PRE',
    'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME'
  ]);

  let enabled = false;
  let ratio = 0.4;
  // Stack of transformation entries. Each entry: { id, replacements: [{ parent, original, replacement }, ...] }
  const undoStack = [];

  // ---- Bolding rules -----------------------------------------------------

  function boldCountFor(len) {
    if (len <= 1) return 1;
    if (len <= 3) return 1;
    if (len <= 5) return 2;
    if (len <= 7) return 3;
    return Math.ceil(len * ratio);
  }

  // Build a <span class="fr-text"> with <b class="fr-bold"> on the leading
  // portion of each letter-run. Non-letter runs (whitespace, punctuation,
  // digits) are emitted as plain text so spacing and punctuation survive
  // intact.
  function buildFixSpan(text, id) {
    const span = document.createElement('span');
    span.className = 'fr-text';
    span.dataset.frId = id;

    const parts = text.match(/(\p{L}+|[^\p{L}]+)/gu) || [];
    for (const part of parts) {
      if (!/^\p{L}/u.test(part)) {
        span.appendChild(document.createTextNode(part));
        continue;
      }
      const n = boldCountFor(part.length);
      const b = document.createElement('b');
      b.className = 'fr-bold';
      b.textContent = part.slice(0, n);
      span.appendChild(b);
      if (n < part.length) {
        span.appendChild(document.createTextNode(part.slice(n)));
      }
    }
    return span;
  }

  // ---- DOM / Range helpers ----------------------------------------------

  function isForbidden(node) {
    let p = node.parentElement;
    while (p) {
      if (FORBIDDEN_TAGS.has(p.tagName)) return true;
      if (p.isContentEditable) return true;
      p = p.parentElement;
    }
    return false;
  }

  function nextId() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // The Range API is the trickiest part of this file. We can't just call
  // range.extractContents() and rebuild — that would flatten inline structure
  // (links, styled spans). Instead:
  //   1. Insert zero-width text-node "markers" at the range boundaries.
  //      Range.insertNode splits text nodes at boundaries for us, so after
  //      this step every text node lies fully inside or fully outside the
  //      selection — no partial nodes to fuss with.
  //   2. Unwrap any pre-existing .fr-text that the selection touches
  //      (re-selection should refresh, not double-bold).
  //   3. Walk text nodes between the markers and replace each with a fresh
  //      formatted span. Each replacement is recorded so we can undo it later.
  function transformSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const origRange = sel.getRangeAt(0);
    if (origRange.collapsed) return false;

    let startMarker, endMarker;
    try {
      endMarker = document.createTextNode('');
      const endR = origRange.cloneRange();
      endR.collapse(false);
      endR.insertNode(endMarker);

      startMarker = document.createTextNode('');
      const startR = origRange.cloneRange();
      startR.collapse(true);
      startR.insertNode(startMarker);
    } catch (e) {
      // Shadow DOM, detached nodes, or other range failures: bail.
      return false;
    }

    const work = document.createRange();
    work.setStartAfter(startMarker);
    work.setEndBefore(endMarker);

    // Step 2: flatten overlapping spans (and drop their undo entries).
    const overlapping = [];
    document.querySelectorAll('.fr-text').forEach((span) => {
      if (work.intersectsNode(span)) overlapping.push(span);
    });
    if (overlapping.length) {
      const dropped = new Set(overlapping.map((s) => s.dataset.frId));
      for (let i = undoStack.length - 1; i >= 0; i--) {
        if (dropped.has(undoStack[i].id)) undoStack.splice(i, 1);
      }
      for (const span of overlapping) {
        span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
      }
      work.setStartAfter(startMarker);
      work.setEndBefore(endMarker);
    }

    // Step 3: collect eligible text nodes inside the markers.
    const root = work.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? work.commonAncestorContainer.parentNode
      : work.commonAncestorContainer;

    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n === startMarker || n === endMarker) return NodeFilter.FILTER_REJECT;
        if (!work.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
        if (isForbidden(n)) return NodeFilter.FILTER_REJECT;
        if (!n.data || !n.data.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    const id = nextId();
    const replacements = [];
    for (const tn of textNodes) {
      const replacement = buildFixSpan(tn.data, id);
      replacements.push({ parent: tn.parentNode, original: tn, replacement });
      tn.parentNode.replaceChild(replacement, tn);
    }

    startMarker.remove();
    endMarker.remove();
    sel.removeAllRanges();

    if (replacements.length) {
      undoStack.push({ id, replacements });
      return true;
    }
    return false;
  }

  function undoOne() {
    const entry = undoStack.pop();
    if (!entry) return false;
    for (const r of entry.replacements) {
      if (r.replacement.parentNode) {
        r.replacement.parentNode.replaceChild(r.original, r.replacement);
      }
    }
    return true;
  }

  function revertAll() {
    while (undoStack.length) undoOne();
    // Belt-and-suspenders: clear any stray spans that lost their stack entry.
    document.querySelectorAll('.fr-text').forEach((span) => {
      span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
    });
  }

  // ---- Selection event handling -----------------------------------------

  // The mouseup handler distinguishes "released after a drag-select" from a
  // plain click. setTimeout(0) lets the browser finalize the selection
  // before we read it.
  function onMouseUp(e) {
    if (!enabled) return;
    if (e.button !== 0) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : '';
      if (text && text.trim()) {
        try { transformSelection(); } catch (_) { /* fail gracefully */ }
      } else {
        undoOne();
      }
    }, 0);
  }

  document.addEventListener('mouseup', onMouseUp, true);

  // ---- Messages from popup ----------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
    } else if (msg.type === 'ENABLE') {
      enabled = true;
      if (typeof msg.ratio === 'number') ratio = msg.ratio;
      sendResponse({ ok: true });
    } else if (msg.type === 'DISABLE') {
      enabled = false;
      revertAll();
      sendResponse({ ok: true });
    } else if (msg.type === 'SET_RATIO') {
      ratio = msg.ratio;
      sendResponse({ ok: true });
    } else if (msg.type === 'REVERT_ALL') {
      revertAll();
      sendResponse({ ok: true });
    }
    return true;
  });
})();
