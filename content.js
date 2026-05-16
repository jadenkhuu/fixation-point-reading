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
  let ratio = 0.6;

  // No undo stack: clicking outside any .fr-text reverts everything via
  // revertAll(), which works straight off the DOM. This avoids the
  // stack/DOM-desync bugs the previous LIFO undo had.

  // ---- Bolding rules -----------------------------------------------------

  // Lengths 1-2 always bold exactly 1 letter (no contrast possible otherwise).
  // For length 3+ the count scales with `ratio`, capped at length-1 so at
  // least one trailing letter remains unbolded as a fixation anchor.
  function boldCountFor(len) {
    if (len <= 2) return 1;
    return Math.min(len - 1, Math.ceil(len * ratio));
  }

  // ---- DOM helpers -------------------------------------------------------

  function isForbidden(node) {
    let p = node.parentElement;
    while (p) {
      if (FORBIDDEN_TAGS.has(p.tagName)) return true;
      if (p.isContentEditable) return true;
      p = p.parentElement;
    }
    return false;
  }

  // Cache the closest block-displayed ancestor per text node — used to tell
  // whether two adjacent text nodes are in the same prose flow (and therefore
  // could be fragments of the same word).
  const blockCache = new WeakMap();
  function closestBlock(node) {
    if (blockCache.has(node)) return blockCache.get(node);
    let p = node.parentElement;
    while (p) {
      const d = getComputedStyle(p).display;
      if (d && !d.startsWith('inline') && d !== 'contents') break;
      p = p.parentElement;
    }
    const block = p || document.body;
    blockCache.set(node, block);
    return block;
  }

  // ---- Selection → DOM transformation ------------------------------------

  // The Range API is the trickiest part of this file. We can't just call
  // range.extractContents() — that would flatten inline structure (links,
  // styled spans). Instead:
  //   1. Insert zero-width text-node "markers" at the range boundaries.
  //      Range.insertNode splits text nodes at the boundaries for us, so
  //      after this every text node lies fully inside or outside the
  //      selection — no partial nodes to fuss with.
  //   2. Flatten any pre-existing .fr-text the selection touches
  //      (re-selection should refresh, not double-bold).
  //   3. Collect all eligible text nodes between the markers.
  //   4. Stitch them into a virtual word stream — text nodes that share a
  //      block ancestor AND have no whitespace between them are treated as
  //      fragments of the same word. The bold count for each word is
  //      computed from the *full* word length, then distributed across
  //      its fragments. This fixes the "skip a letter, then bold again"
  //      pattern caused by inline-element splits (Wikipedia, etc.).
  //   5. Replace each text node with the planned <span class="fr-text">.
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
    } catch (_) {
      // Shadow DOM, detached nodes, or other range failures: bail.
      return false;
    }

    const work = document.createRange();
    work.setStartAfter(startMarker);
    work.setEndBefore(endMarker);

    // Flatten any .fr-text that overlaps the new selection.
    document.querySelectorAll('.fr-text').forEach((span) => {
      if (work.intersectsNode(span)) {
        span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
      }
    });
    work.setStartAfter(startMarker);
    work.setEndBefore(endMarker);

    // Collect text nodes inside the markers.
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

    if (textNodes.length === 0) {
      startMarker.remove();
      endMarker.remove();
      sel.removeAllRanges();
      return false;
    }

    // Split each text node into alternating letter / non-letter parts.
    const items = textNodes.map((tn) => ({
      tn,
      parts: tn.data.match(/(\p{L}+|[^\p{L}]+)/gu) || [],
    }));

    // Walk all parts in document order; group adjacent letter-runs into
    // logical words. A letter-run at the start of a text node merges with
    // the previous text node's trailing letter-run IFF they share a block
    // ancestor (same prose flow, no paragraph break between them).
    const words = [];
    let current = null;
    let prevItem = null;
    let prevEndedInLetter = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      for (let j = 0; j < item.parts.length; j++) {
        const part = item.parts[j];
        const isLetter = /^\p{L}/u.test(part);
        if (isLetter) {
          const continues = j === 0 && prevEndedInLetter && prevItem
            && closestBlock(prevItem.tn) === closestBlock(item.tn);
          if (continues && current) {
            current.segments.push({ i, j, len: part.length });
            current.total += part.length;
          } else {
            current = { segments: [{ i, j, len: part.length }], total: part.length };
            words.push(current);
          }
          prevEndedInLetter = true;
        } else {
          current = null;
          prevEndedInLetter = false;
        }
      }
      prevItem = item;
    }

    // Distribute each word's bold count across its segments.
    const boldByPart = new Map();  // key "i.j" → bold count
    for (const word of words) {
      let remaining = boldCountFor(word.total);
      for (const seg of word.segments) {
        const take = Math.min(remaining, seg.len);
        boldByPart.set(`${seg.i}.${seg.j}`, take);
        remaining -= take;
      }
    }

    // Build the replacement <span class="fr-text"> for each text node.
    let replacedCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const span = document.createElement('span');
      span.className = 'fr-text';
      for (let j = 0; j < item.parts.length; j++) {
        const part = item.parts[j];
        const isLetter = /^\p{L}/u.test(part);
        if (!isLetter) {
          span.appendChild(document.createTextNode(part));
          continue;
        }
        const bc = boldByPart.get(`${i}.${j}`) || 0;
        if (bc > 0) {
          const b = document.createElement('b');
          b.className = 'fr-bold';
          b.textContent = part.slice(0, bc);
          span.appendChild(b);
        }
        if (bc < part.length) {
          span.appendChild(document.createTextNode(part.slice(bc)));
        }
      }
      item.tn.parentNode.replaceChild(span, item.tn);
      replacedCount++;
    }

    startMarker.remove();
    endMarker.remove();
    sel.removeAllRanges();
    return replacedCount > 0;
  }

  // ---- Revert ------------------------------------------------------------

  // Single source of truth: every visible .fr-text gets unwrapped. No undo
  // stack to drift away from the DOM.
  function revertAll() {
    document.querySelectorAll('.fr-text').forEach((span) => {
      if (span.parentNode) {
        span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
      }
    });
  }

  // ---- Selection event handling -----------------------------------------

  // Mouseup distinguishes "released after a drag-select" from a plain click.
  // setTimeout(0) lets the browser finalize the selection before we read it.
  //
  // Click behaviour:
  //   - inside any .fr-text → no action (so links/words inside highlighted
  //     prose stay interactive without nuking all highlights)
  //   - outside any .fr-text → revertAll
  function onMouseUp(e) {
    if (!enabled) return;
    if (e.button !== 0) return;
    setTimeout(() => {
      const s = window.getSelection();
      const text = s ? s.toString() : '';
      if (text && text.trim()) {
        try { transformSelection(); } catch (_) { /* fail gracefully */ }
        return;
      }
      // Plain click. Decide based on click target.
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.fr-text')) {
        return;  // click landed on highlighted text — leave everything alone
      }
      revertAll();
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
