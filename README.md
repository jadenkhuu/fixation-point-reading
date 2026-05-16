# FixReading

*Fixation-point reading*

A Chrome extension that bolds the first letters of each word you select on
a web page, creating visual fixation points to help guide your eyes
through text.

The idea for this project was heavily inspired by some random image I saw on Twitter a few months back.

<img width="1290" height="1104" alt="image" src="https://github.com/user-attachments/assets/e0dd76a2-9dd4-4c7b-baf0-7990af9c0560" />

## Usage

https://github.com/user-attachments/assets/9532942c-3e93-46e3-9164-5546caf003d5

1. Click the FixReading icon and flip the toggle to **On**. The badge on
   the icon shows `ON` in purple on the active tab.
2. Highlight any text on the page. On mouse release, the selection is
   transformed in place. You can highlight multiple paragraphs — each
   one stacks on top of the previous formatting.
3. Click anywhere outside a highlight to clear **all** formatted text on
   the page at once. Clicks landing inside a highlight do nothing, so
   links and words inside formatted prose stay interactive.
4. The **Revert all text** button in the popup does the same thing
   explicitly.
5. Flip the toggle **Off** to revert everything and stop processing
   further selections.

## How it works

The leading portion of every word in your selection is wrapped in a
`<b class="fr-bold">` tag. The number of bolded letters scales with word
length:

- **1–2 letter words**: 1 letter bolded
- **3+ letter words**: `min(length − 1, round(length × intensity))`

The `length − 1` cap guarantees at least one trailing letter stays
unbolded, so a fixation anchor always exists. `round` (rather than
`ceil`) keeps short 4-letter words at ~50% bolded while longer words
settle near the chosen intensity.

`intensity` is configurable from **0.40** to **0.70** in 0.05 steps via
the slider in the popup, with a default of **0.60**. At the default,
here's what common word shapes look like:

| Word         | Length | Bold | Result          | %   |
|--------------|:------:|:----:|-----------------|:---:|
| `to`         | 2      | 1    | **t**o          | 50% |
| `the`        | 3      | 2    | **th**e         | 67% |
| `with`       | 4      | 2    | **wi**th        | 50% |
| `hello`      | 5      | 3    | **hel**lo       | 60% |
| `reader`     | 6      | 4    | **read**er      | 67% |
| `between`    | 7      | 4    | **betw**een     | 57% |
| `extension`  | 9      | 5    | **exten**sion   | 56% |
| `fixation`   | 8      | 5    | **fixat**ion    | 62% |
| `wonderfully`| 11     | 7    | **wonderf**ully | 64% |

Words split across DOM nodes (e.g. Wikipedia's `Encyclo<i>pedia</i>`) are
stitched back into a single logical word before bolding is computed, so
visual letter-skipping in the middle of a word doesn't happen.

Punctuation, capitalization, and whitespace are preserved exactly.

The popup exposes two intensity sliders:

- **General intensity** — applies right now on the current tab (per-tab
  session state).
- **Default intensity** — the value FixReading opens to on new tabs and
  fresh sessions (persisted globally).

## File layout

```
fixation-point-reading/
├── manifest.json
├── background.js          service worker; per-tab state + badge
├── content.js             selection handling + DOM transform + revert-all
├── styles.css             injected; styles .fr-bold
├── popup.html / popup.css / popup.js
├── icons/                 16/32/48/128 PNGs (chunky "fr" on purple)
├── README.md
└── PRIVACY.md
```

## Loading in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `fixation-point-reading/` directory.

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

See [PRIVACY.md](./PRIVACY.md). Short version: nothing leaves your
device, nothing is collected, no network requests.
