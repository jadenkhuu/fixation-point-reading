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
const openSettings = document.getElementById('open-settings');
const closeSettings = document.getElementById('close-settings');
const openInfo     = document.getElementById('open-info');

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
  const isSettings = name === 'settings';
  viewMain.hidden = isSettings;
  viewSettings.hidden = !isSettings;
  // Move focus to the most relevant control on each view.
  if (isSettings) intensityEl.focus({ preventScroll: true });
  else bigToggle.focus({ preventScroll: true });
}

openSettings.addEventListener('click', () => showView('settings'));
closeSettings.addEventListener('click', () => showView('main'));

// Info button — placeholder. Intent: eventually open a Chrome Web Store
// listing or an About page. For now it's a no-op with a transient hint.
openInfo.addEventListener('click', () => {
  setStatus('More info coming soon.');
});

// Esc returns to main from settings.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !viewSettings.hidden) {
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
