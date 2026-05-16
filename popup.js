// FixReading popup. Owns view navigation (main ↔ settings), the big
// On/Off button, and two intensity sliders:
//   • "General intensity" — current value for the active tab (session)
//   • "Default intensity" — global, used when a fresh tab/session opens
//
// Persistence:
//   • per-tab state    → chrome.storage.session (managed by background.js)
//   • default ratio    → chrome.storage.local (managed here, mirrored to bg)

const DEFAULT_RATIO_FALLBACK = 0.6;

// ---- DOM handles --------------------------------------------------------
const viewMain     = document.getElementById('view-main');
const viewSettings = document.getElementById('view-settings');
const viewInfo     = document.getElementById('view-info');
const openSettings = document.getElementById('open-settings');
const closeSettings = document.getElementById('close-settings');
const openInfo     = document.getElementById('open-info');
const closeInfo    = document.getElementById('close-info');
const openGithub   = document.getElementById('open-github');
const openKofi     = document.getElementById('open-kofi');
const infoExample  = document.getElementById('info-example-bionic');

const INFO_EXAMPLE_TEXT =
  "Your eyes jump between anchor points instead of scanning every letter.";

const GITHUB_URL = 'https://github.com/jadenkhuu/fixation-point-reading';
const KOFI_URL   = 'https://ko-fi.com/jadenkhuu';

const bigToggle    = document.getElementById('big-toggle');
const revertBtn    = document.getElementById('revert-all');
const statusEl     = document.getElementById('status');

const intensityEl  = document.getElementById('intensity');
const intensityVal = document.getElementById('intensity-val');
const defaultEl    = document.getElementById('default-intensity');
const defaultVal   = document.getElementById('default-intensity-val');

// ---- Helpers ------------------------------------------------------------

const fmt = (r) => Number(r).toFixed(2);

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
}

function setRangeFill(input) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', pct + '%');
}

function setToggleVisual(on) {
  // CSS swaps the ON/OFF pixel-SVG via [aria-pressed].
  bigToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function canInject(tab) {
  if (!tab || !tab.url) return false;
  const blocked = ['chrome://', 'chrome-extension://', 'edge://', 'about:',
                   'chrome.google.com/webstore', 'chromewebstore.google.com'];
  return !blocked.some((b) => tab.url.startsWith(b) || tab.url.includes(b));
}

async function injectIfNeeded(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function send(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); }
  catch (_) { return null; }
}

// ---- View navigation ----------------------------------------------------

function showView(name) {
  viewMain.hidden     = name !== 'main';
  viewSettings.hidden = name !== 'settings';
  viewInfo.hidden     = name !== 'info';
  // Move focus to the most relevant control on each view.
  if (name === 'settings') intensityEl.focus({ preventScroll: true });
  else if (name === 'info') {
    renderInfoExample(parseFloat(intensityEl.value));
    closeInfo.focus({ preventScroll: true });
  }
  else bigToggle.focus({ preventScroll: true });
}

// Mirror of content.js's bolding rule — re-implemented here because the
// popup is a separate document with no module boundary back to the content
// script. Used only for the About-view example.
function exampleBoldCount(len, ratio) {
  if (len <= 2) return 1;
  return Math.min(len - 1, Math.round(len * ratio));
}

function renderInfoExample(ratio) {
  if (!infoExample) return;
  infoExample.textContent = '';
  const parts = INFO_EXAMPLE_TEXT.match(/(\p{L}+|[^\p{L}]+)/gu) || [];
  for (const part of parts) {
    if (!/^\p{L}/u.test(part)) {
      infoExample.appendChild(document.createTextNode(part));
      continue;
    }
    const n = exampleBoldCount(part.length, ratio);
    if (n > 0) {
      const b = document.createElement('b');
      b.className = 'fr-bold';
      b.textContent = part.slice(0, n);
      infoExample.appendChild(b);
    }
    if (n < part.length) {
      infoExample.appendChild(document.createTextNode(part.slice(n)));
    }
  }
}

openSettings.addEventListener('click', () => showView('settings'));
closeSettings.addEventListener('click', () => showView('main'));
openInfo.addEventListener('click', () => showView('info'));
closeInfo.addEventListener('click', () => showView('main'));

// External links — popups close on click, so we use chrome.tabs.create
// rather than letting an anchor element handle navigation.
function openExternal(url) {
  chrome.tabs.create({ url });
  window.close();
}
openGithub.addEventListener('click', () => openExternal(GITHUB_URL));
openKofi.addEventListener('click', () => openExternal(KOFI_URL));

// Esc returns to main from any sub-view.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (!viewSettings.hidden || !viewInfo.hidden)) {
    e.preventDefault();
    showView('main');
  }
});

// ---- Default-intensity persistence --------------------------------------

async function loadDefaultRatio() {
  const { defaultRatio } = await chrome.storage.local.get('defaultRatio');
  return typeof defaultRatio === 'number' ? defaultRatio : DEFAULT_RATIO_FALLBACK;
}

async function saveDefaultRatio(ratio) {
  await chrome.storage.local.set({ defaultRatio: ratio });
}

// ---- Tab state ---------------------------------------------------------

async function getTabStateFromBg(tabId) {
  return await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId });
}

async function setTabStateInBg(tabId, state) {
  await chrome.runtime.sendMessage({ type: 'SET_STATE', tabId, state });
}

// ---- Initial load ------------------------------------------------------

async function init() {
  const tab = await getActiveTab();
  const defaultRatio = await loadDefaultRatio();

  defaultEl.value = defaultRatio;
  defaultVal.textContent = fmt(defaultRatio);
  setRangeFill(defaultEl);

  if (!tab) return;

  if (!canInject(tab)) {
    bigToggle.disabled = true;
    revertBtn.disabled = true;
    intensityEl.disabled = true;
    intensityEl.value = defaultRatio;
    intensityVal.textContent = fmt(defaultRatio);
    setRangeFill(intensityEl);
    setStatus('Not available on this page.', true);
    return;
  }

  const state = await getTabStateFromBg(tab.id);
  const ratio = (state && typeof state.ratio === 'number') ? state.ratio : defaultRatio;
  const enabled = !!(state && state.enabled);

  setToggleVisual(enabled);
  intensityEl.value = ratio;
  intensityVal.textContent = fmt(ratio);
  setRangeFill(intensityEl);

  setStatus(enabled
    ? 'On — select text on the page.'
    : 'Off — turn on to start.');
}

// ---- Event wiring ------------------------------------------------------

bigToggle.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab || !canInject(tab)) return;
  const next = bigToggle.getAttribute('aria-pressed') !== 'true';
  setToggleVisual(next);

  const ratio = parseFloat(intensityEl.value);
  if (next) {
    try { await injectIfNeeded(tab.id); }
    catch (_) {
      setStatus('Injection blocked on this page.', true);
      setToggleVisual(false);
      return;
    }
    await send(tab.id, { type: 'ENABLE', ratio });
  } else {
    await send(tab.id, { type: 'DISABLE' });
  }
  await setTabStateInBg(tab.id, { enabled: next, ratio });
  setStatus(next
    ? 'On — select text on the page.'
    : 'Off — selections will not be transformed.');
});

revertBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  await send(tab.id, { type: 'REVERT_ALL' });
  setStatus('All transformations reverted.');
});

intensityEl.addEventListener('input', async () => {
  const ratio = parseFloat(intensityEl.value);
  intensityVal.textContent = fmt(ratio);
  setRangeFill(intensityEl);
  const tab = await getActiveTab();
  if (!tab) return;
  await send(tab.id, { type: 'SET_RATIO', ratio });
  const enabled = bigToggle.getAttribute('aria-pressed') === 'true';
  await setTabStateInBg(tab.id, { enabled, ratio });
});

defaultEl.addEventListener('input', async () => {
  const ratio = parseFloat(defaultEl.value);
  defaultVal.textContent = fmt(ratio);
  setRangeFill(defaultEl);
  await saveDefaultRatio(ratio);
});

init();
