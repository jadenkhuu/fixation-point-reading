# FixReading

*Fixation-point reading*

A Chrome extension that bolds the first letters of each word you select on
a web page, creating visual fixation points to help guide your eyes
through text.

## How it works

The leading portion of every word in your selection is wrapped in a
`<b class="fr-bold">` tag. The number of bolded letters scales with word
length:

- **1–2 letter words**: 1 letter bolded
- **3+ letter words**: `min(length − 1, ceil(length × intensity))`

The `length − 1` cap guarantees at least one trailing letter stays
unbolded, so a fixation anchor always exists.

`intensity` is configurable from **0.40** to **0.70** in 0.05 steps via
the slider in the popup, with a default of **0.60** (roughly 60% of each
word's letters get bolded). At the default, here's what some common word
shapes look like:

| Word     | Bolded count | Result          |
|----------|:------------:|-----------------|
| `the`    | 2            | **th**e         |
| `with`   | 3            | **wit**h        |
| `result` | 4            | **resu**lt      |
| `reader` | 4            | **read**er      |
| `extension` | 6         | **extens**ion   |

Punctuation, capitalization, and whitespace are preserved exactly.

The popup exposes two intensity sliders:

- **General intensity** — applies right now on the current tab (per-tab
  session state).
- **Default intensity** — the value FixReading opens to on new tabs and
  fresh sessions (persisted globally).

## Usage

1. Click the FixReading icon and flip the toggle to **On**. The badge on
   the icon shows `ON` in purple on the active tab.
2. Highlight any text on the page. On mouse release, the selection is
   transformed in place.
3. Click an empty area to undo the most recent transformation (undo
   stack — multiple selections each pop in reverse order).
4. Press **Revert all on this page** in the popup to clear every
   transformation at once.
5. Flip the toggle **Off** to revert everything and stop processing
   further selections.

The popup also shows a live preview that updates as you move the
intensity slider, so you can dial it in without leaving the popup.

## File layout

```
fixreading/
├── manifest.json
├── background.js          service worker; per-tab state + badge
├── content.js             selection handling + DOM transform + undo
├── styles.css             injected; styles .fr-bold
├── popup.html / popup.css / popup.js
└── icons/                 16/32/48/128 PNGs (chunky "fr" on purple)
```

## Loading in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `fixreading/` directory.

The extension only requests `activeTab`, `scripting`, and `storage` —
no host permissions, no network access.

## Customizing the bold style

Bolded letters use `<b class="fr-bold">`. The default style is just
`font-weight: 700`. To customize, add CSS to your user stylesheet:

```css
.fr-bold {
  font-weight: 800;
  color: #1e293b;
}
```

## Known limitations

- **PDF viewers** — Chrome's built-in PDF viewer renders text via
  canvas / plugin; selections inside it cannot be transformed.
- **Google Docs** — text is rendered into a canvas; the DOM contains
  no real text nodes to wrap, so transformations don't apply.
- **Shadow DOM** — selections that cross into closed shadow roots
  fail gracefully (the extension catches the error and does nothing
  for that selection).
- **`<input>`, `<textarea>`, `contenteditable`** — deliberately skipped
  to avoid mangling form input.
- **`<code>`, `<pre>`** — skipped to preserve code formatting.
- **Navigation** — when a tab navigates to a new URL, the extension
  resets to **Off** for that tab. Re-toggle it on the new page.

## Privacy

FixReading makes no network requests and stores nothing outside of
`chrome.storage.session` (per-tab enabled flag + intensity ratio,
cleared when Chrome restarts).
# fixation-point-reading
