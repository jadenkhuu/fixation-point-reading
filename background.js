// FixReading service worker
// Owns per-tab state and badge updates. Content scripts are injected on
// demand from the popup, not declaratively, so we don't need host_permissions.

const BADGE_COLOR = '#382288';

const DEFAULT_RATIO_FALLBACK = 0.5;

async function getDefaultRatio() {
  const { defaultRatio } = await chrome.storage.local.get('defaultRatio');
  return typeof defaultRatio === 'number' ? defaultRatio : DEFAULT_RATIO_FALLBACK;
}

async function getTabState(tabId) {
  const key = `tab-${tabId}`;
  const stored = await chrome.storage.session.get(key);
  if (stored[key]) return stored[key];
  const ratio = await getDefaultRatio();
  return { enabled: false, ratio };
}

async function setTabState(tabId, state) {
  await chrome.storage.session.set({ [`tab-${tabId}`]: state });
  await updateBadge(tabId, state.enabled);
}

async function updateBadge(tabId, enabled) {
  try {
    await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  } catch (_) {
    // Tab may have closed; ignore.
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = msg.tabId ?? sender.tab?.id;
    if (tabId == null) return sendResponse({ ok: false, error: 'no tab' });

    if (msg.type === 'GET_STATE') {
      sendResponse(await getTabState(tabId));
    } else if (msg.type === 'SET_STATE') {
      await setTabState(tabId, msg.state);
      sendResponse({ ok: true });
    }
  })();
  return true; // async response
});

// Clean up storage when a tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab-${tabId}`).catch(() => {});
});

// Reset state when a tab navigates to a new page. The injected content
// script doesn't survive navigation, so the stored "enabled" flag would
// be misleading. tabs.onUpdated doesn't require any extra permission.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading' || !changeInfo.url) return;
  chrome.storage.session.remove(`tab-${tabId}`).catch(() => {});
  updateBadge(tabId, false);
});
