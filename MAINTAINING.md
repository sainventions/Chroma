# Maintaining Chroma

How the extension works internally, what it depends on in claude.ai, and how to repair it when claude.ai ships a UI update.

Chroma has no build step: [`content.js`](content.js) and [`background.js`](background.js) are what the browser runs. Everything in [`dev/`](dev/) is tooling and is not shipped.

- [1. What breaks when claude.ai changes](#1-what-breaks-when-claudeai-changes)
- [2. Repair playbook](#2-repair-playbook)
- [3. Architecture](#3-architecture)
- [4. How the theming works](#4-how-the-theming-works)
- [5. claude.ai as of November 2026](#5-claudeai-as-of-november-2026)
- [6. Storage and sync](#6-storage-and-sync)
- [7. The UI (launcher, bubble, panel)](#7-the-ui-launcher-bubble-panel)
- [8. Dev tools](#8-dev-tools)
- [9. Gotchas](#9-gotchas)
- [10. Release checklist](#10-release-checklist)

---

## 1. What breaks when claude.ai changes

Chroma never calls claude.ai's code. Its only contacts with the site are listed below. When claude.ai ships an update, the broken feature tells you which row to look at.

| Feature | What it relies on in claude.ai | Where in Chroma | Symptom when it breaks |
|---|---|---|---|
| Darker / AMOLED | CSS custom properties `--cds-surface-*`, `--cds-neutral-*`, plus legacy `--bg-*` | `CDS`, `PALETTES` and the theme half of `buildCSS()` | Background stays gray; parts of the page (sidebar, menus, composer) stay lighter |
| Accent color | `--cds-fill-brand*`, `--cds-fill-accent*`, `--cds-role-accent-*`, `--cds-text-accent`, `--cds-clay*` and friends | Accent half of `buildCSS()` | Send button, logo, focus rings or links keep Claude's orange or blue |
| Overrides reach every region | Theme tokens are declared on `html.cds-root` **and** on nested `.cds-root` wrappers | Override selector in `buildCSS()` (`const sel = ...`) | Only some areas recolor; popovers or panels keep site colors |
| Top-bar dot | A row of `<button>`s at the top of the page (within the top ~56px), right side | `topBarAnchor()`, `placeLauncher()` | Dot floats in the top-right corner (fallback), or sits somewhere odd |
| Per-chat colors | URL shapes `/chat/<uuid>`, `/project/<uuid>`, `/new` | `CHAT_ROUTE`, `COMPOSE_ROUTE`, `chatKey()` | Colors stop sticking to chats, or new chats stop inheriting the tab color |
| SPA navigation | `history.pushState`/`replaceState` route changes | `onNavigate()` plus the Navigation API listener and the 700 ms poll | Color doesn't change when switching chats until reload |
| Tab favicon dot | `<link rel="icon">` elements in `<head>` | `applyFavicon()` | No dot, or the dot disappears after navigation |
| Fonts in the panel | `anthropic-sans` web font loaded by the page | `UI_CSS` (`font:` on `.ui`) | Panel falls back to the system font (cosmetic) |
| Panel colors | Same `--cds-*` tokens, inherited into the shadow DOM | `UI_CSS` (`--bg`, `--fg`, `--line`... on `.ui`) | Panel looks off-theme; every token has a hard-coded fallback, so it never becomes unreadable |

Things that **cannot** break from a site update: hotkeys (window-level listener), the glow (Chroma's own fixed `div`), the toast, storage and sync, pruning, and the panel's own structure (it lives in a shadow root).

---

## 2. Repair playbook

Follow this after a claude.ai redesign.

### Step 1: Reproduce and audit

1. Set claude.ai to **dark mode** and open a chat (not `/new`) with Chroma enabled.
2. Pick a strong accent (for example Lime) and set the background to AMOLED. Mismatches are easy to spot that way.
3. Open DevTools > Console and paste the contents of [`dev/audit.js`](dev/audit.js). It is read-only and prints seven sections:
   1. **Dead overrides**: tokens Chroma sets that claude.ai no longer defines. A long list means a token rename.
   2. **Current color tokens**, grouped (surfaces, text, accent, brand/logo, legacy) with live values; `*` marks the ones Chroma overrides.
   3. **Candidates**: accent- or surface-looking tokens Chroma doesn't override yet. New names usually show up here.
   4. **Selectors that declare key tokens**: tells you whether new nested theme roots exist.
   5. **Cascade layers**: counts site rules inside versus outside `@layer`.
   6. **Top-bar buttons**, left to right, and where the launcher landed.
   7. **Link shapes**: route patterns for `CHAT_ROUTE`.
4. Also press **Alt+Shift+K** for Chroma's own token dump (`dumpTokens()`): a table of every matching token and its value.

### Step 2: Find which token paints an element

When a specific element keeps the wrong color:

1. Inspect it, and find the `background-color` / `color` / `fill` / `border-color` rule in the Styles pane.
2. The value is usually `var(--cds-something)`. Follow it in the Computed pane, or run:
   ```js
   getComputedStyle(document.body).getPropertyValue('--cds-something')
   ```
3. If that token resolves through another (`var(--cds-gray-850)`), decide which level to override. **Prefer the semantic token** (`--cds-surface-1`) over a scale step (`--cds-gray-850`): scale steps are shared by unrelated parts of the UI.
4. A utility class tells you the mapping too. For example `.bg-bg-100 { background-color: var(--cds-surface-1) }` shows that legacy class names now point at new tokens.

To list every rule that uses a token:

```js
const hits = [];
const walk = (rs) => { for (const r of rs) { if (r.cssRules) walk(r.cssRules); if (r.style && r.cssText.includes('--cds-surface-2')) hits.push(r.selectorText); } };
for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
hits;
```

### Step 3: Fix

| Situation | Edit |
|---|---|
| A token was **renamed** | Rename it in `buildCSS()` or `CDS`. Keep the old name next to it for a release or two; overriding a token that doesn't exist is harmless. |
| A **new** surface or accent token appeared | Add it to `CDS.darker` / `CDS.amoled` (surfaces) or the accent `decl.push(...)` block (accents). |
| The site switched **value format** (hex, `H S% L%` triplet, `oklch()`) | Each token must keep the format the site uses, because the site wraps some in functions such as `hsl(var(--x))`. Triplets: `tok()` or `trip()`. Full colors: hex or `color-mix()`. `detectFormat()` already switches the legacy tokens between triplet and full color. |
| Tokens are declared on a **new kind of element** | Add that selector to `sel` in `buildCSS()`. |
| Site CSS moved **out of `@layer`** | Chroma's non-`!important` rules (`html,body{background-color}`, `::selection`) may stop winning. Add `!important` to them. |
| The dot floats in the corner | The top bar changed. Adjust the geometry limits in `topBarAnchor()` (`r.top > 30`, `r.bottom > 56`, `innerWidth * 0.6`), using section 6 of the audit. |
| Per-chat colors stop working | Update `CHAT_ROUTE` / `COMPOSE_ROUTE` from section 7 of the audit. **Keep the `chatKey()` output stable**: changing it orphans every saved color (they expire after 30 days anyway). |
| Light mode support | Out of scope today: `CDS` values are dark. Light mode would need a second table keyed on `html[data-mode="light"]`. |

### Step 4: Verify

1. Run `node dev/test-content.js` and `node dev/test-background.js`. Add an assertion for whatever you fixed (for example a new token in the "CSS overrides" check).
2. Load the change: press **Alt+Shift+U** on claude.ai (reloads the extension and the tab), or click Reload at `chrome://extensions`.
3. Re-run [`dev/audit.js`](dev/audit.js): section 1 should be empty or contain only names you kept on purpose.
4. Check by eye, for **Site, Darker and AMOLED**:
   - `/new`
   - a chat
   - the sidebar collapsed
   - a popover menu (model picker)
   - the panel, the bubble and settings
5. Release (section 10).

---

## 3. Architecture

```
manifest.json      MV3. Pins the extension ID via "key" (needed for sync), permissions: storage, alarms.
background.js      Service worker: the only writer of per-chat colors, the 30-day pruning, the toolbar icon, self-reload.
content.js         Everything on the page: CSS overrides, glow, favicon dot, hotkeys, launcher, panel, bubble.
dev/               Tests, audit snippet, mock page, zip builder (not shipped).
```

### content.js, top to bottom

The file is one IIFE split into sections marked `// ---------- name ----------`:

| Section | What's there |
|---|---|
| `config` | `ACCENTS` (presets, in grid order), `THEMES`, `PALETTES` (legacy token lightness), `CDS` (design-system surface values per theme), `DEFAULTS`, `SETTINGS_VERSION` + `withDefaults()` (migrations), `HOTKEYS`, `CHAT_ROUTE` / `COMPOSE_ROUTE` |
| `state` | `S` (global settings), `tabAccent` (sessionStorage), `chats` (merged chat map), `shards` (last synced value of each `chats_*` item), `fmt` (legacy token format); `chatKey()`; `send()` to the worker |
| `color utils` | hex / HSL / RGB conversions, `luminance()`, `tok()` (writes a value in the site's legacy format) |
| `accent resolution` | `resolveAccent()`, `currentAccent()` (precedence: chat > tab > default), `accentScope()` |
| `CSS` | `buildCSS()`: the entire theme, as one string |
| `DOM nodes` | `<style id="chroma-style">`, the glow `div`, the toast |
| `favicon dot` | Redraws the site favicon with an accent dot on a canvas |
| `format detection & diagnostics` | `detectFormat()`, `dumpTokens()` (Alt+Shift+K) |
| `render` | `render()`: re-applies everything; call it after any state change |
| `persistence` | `save()` (settings), `setAccent()`, per-chat store/seen/merge |
| `SPA navigation` | `onNavigate()`: chat switches and new-chat color inheritance |
| `actions` | Hotkey and panel actions (`cycleAccent`, `cycleTheme`, `makeDefault`, `resetTab`...) |
| `hotkeys` | The window `keydown` listener (capture phase) |
| `top-bar launcher` | `buildLauncher()`, `topBarAnchor()`, `placeLauncher()` |
| `UI (panel + hover bubble)` | `UI_CSS`, `buildUI()`, `togglePanel()`, `showBubble()`, `syncPanel()`, the HSV picker |
| `boot` | First paint from cache, sync load, change listeners, observers and timers |

### Render pipeline

```
state change (setAccent / save / sync change / navigation)
  └─ render()
       ├─ ensureNodes()      re-attach <style>, glow, UI host if the app removed them
       ├─ buildCSS()  ──────> styleEl.textContent
       ├─ updateGlow()
       ├─ scheduleFavicon()  (debounced 120 ms)
       ├─ placeLauncher()
       └─ syncPanel()        updates the panel and bubble if they exist
```

`render()` is cheap (a string build and one `textContent` write), so call it freely.

### Boot order (why there's no flash)

1. `document_start`: `S` and `chats` come from **localStorage** caches (`chroma:cache`, `chroma:chats`), `tabAccent` from sessionStorage, so the first `render()` paints the right colors before claude.ai renders.
2. `chrome.storage.sync.get(null)` replaces those with the synced truth, runs settings migration, merges chat shards, marks the current chat as seen, and renders again.
3. `storage.onChanged` keeps every tab live when another tab or another computer changes something.
4. Timers: every 2 s re-attach nodes and refresh the glow; every 700 ms check the route and re-seat the launcher (React re-renders can drop it).

### Accent precedence

`currentAccent()` = the color saved for **this chat** → else **this tab's** color → else the **default**.

- Picking a color (`setAccent`) sets the tab color and, on a chat route, saves it to that chat too.
- `onNavigate()`: arriving on a chat that has no color **from a compose route** (`/new`, `/project/...`) means "a chat was just created here", so it inherits the previous route's color. Arriving from anywhere else never auto-colors.
- `glowOn()`: assigning a color (pick or inherit) turns the glow setting on.
- `glowVisible()`: the glow only shows on a chat or tab that has a color of its own, and **never for Claude orange** (even when assigned). Unassigned sessions use the default color, which is Claude orange, and don't glow, so a glowing window always means "this chat has a color".

The accent is the only per-tab setting. Everything in `S` is global and synced.

---

## 4. How the theming works

The whole theme is one generated `<style id="chroma-style">` that **re-declares claude.ai's CSS custom properties**. No element is styled directly except `html, body` (background), `::selection` and the caret.

### Why the override wins

```css
:root, .cds-root, html[data-mode], html[data-theme], [data-mode="dark"], [data-mode="light"] {
  --cds-surface-1: #000 !important; ...
}
```

- An `!important` custom-property declaration beats the site's normal declaration **on the same element**, regardless of selector specificity or source order.
- claude.ai declares its tokens on `html.cds-root` **and again on nested `.cds-root` wrappers** (layout roots, portals). Children inherit from the nearest declaring ancestor, so the override must match those wrappers too. That is why `.cds-root` is in the selector. A redesign that adds a new kind of token root needs a new selector here (audit section 4).
- Some regions intentionally redefine tokens on non-root elements (code blocks set `--cds-surface-1: var(--code-theme-bg)`). Those keep the site's colors, which is the desired result.
- The plain rules (`html,body{background-color}`) win because claude.ai's Tailwind utilities live in `@layer`, and unlayered rules beat layered ones (audit section 5).

### Two token generations

| | Legacy | Current ("cds" design system) |
|---|---|---|
| Names | `--bg-000..500`, `--text-000..500`, `--border-100..400`, `--accent-main-*`, `--brand-*`, `--accent-brand`, `--oncolor-*` | `--cds-surface-*`, `--cds-fill-*`, `--cds-role-accent-*`, `--cds-text-*`, `--cds-clay*`... |
| Format | Bare `H S% L%` triplets, used as `hsl(var(--bg-100))` | Full colors (`#191919`, `color-mix(...)`, `hsl(from ...)`) |
| Chroma writes them with | `tok()` (format auto-detected by `detectFormat()`) and `trip()` | Plain hex / `color-mix()` |
| Still matters? | Barely (a few `hsl(var(--brand-100))` utilities); kept because it costs nothing | Yes, this is what paints the UI |

Chroma 1.0 only overrode the legacy names, which is why it silently did nothing after claude.ai moved to `cds`.

### What each part of buildCSS() covers

**Accent**: skipped when the accent is `claude`, which means "leave the site alone":

| Token(s) | Paints |
|---|---|
| `--cds-fill-brand`, `-hover`, `-icon-only` | Claude-orange buttons and icons |
| `--cds-fill-accent`, `-hover`, `--cds-role-accent-fill*`, `--cds-role-accent-50..850` | The blue UI accent (toggles, selections, links) and its tint scale |
| `--cds-text-accent` | Accent-colored text, lightened for contrast on dark backgrounds |
| `--cds-bg-accent`, `-layer`, `--mix`, `--cds-border-accent` | Translucent accent backgrounds and borders |
| `--cds-composer-ring` | The message box border (a quiet way to see the chat's color) |
| `--cds-focus-shadow*`, `--cds-fizzy-lake-color-field-focus` | Focus rings |
| `--cds-on-accent`, `--cds-role-accent-on`, `--oncolor-*` | Text on filled accent buttons; dark when the accent is light (`luminance > 0.4`) |
| `--cds-clay*`, `--cds-hsl-clay*`, `--_brand-clay*` | The Claude spark logo and other "clay" brand marks |
| `--cds-chat-composer-link*`, `--accent-secondary-*` | Links, only when "Accent links" is on |

**Background**: only for Darker and AMOLED. The values in `CDS` replace:
- `surface-0/1/2/3`;
- `surface-panel` and `surface-popover`;
- the sidebar (`fizzy-lake-color-sidebar`);
- the darkest neutral steps (`neutral-0..50`).

`ground*` and `scroll-fade-strip-color` follow `surface-1`, so scroll fades match the new background.

### Glow, favicon, toast

- **Glow**: shown only when `glowVisible()` is true (section 3). A fixed full-viewport `div#chroma-glow` with an inset `box-shadow`. It ignores pointer events and sits just under the panel's z-index. Size is the blur radius; strength is the opacity.
- **Favicon dot**: draws the site's icon onto a 64px canvas with a dot in the corner. It parks the site's own `<link rel="icon">` as `rel="chroma-off-icon"` (restored when disabled) and watches `<head>` for new icon links.
- **Toast**: a fixed pill at the top center, styled with the site's popover tokens.

---

## 5. claude.ai as of November 2026

This snapshot comes from the live site while building 1.1 to 1.3. Use it as the baseline to diff against.

**Root element**

```html
<html class="cds-root ..." data-mode="dark" data-theme="claude" data-color-version="v2" data-cds-fizzy-lake="color panels type">
<body class="bg-surface-1 text-primary font-sans ...">
```

Nested wrappers carry `class="cds-root ..."` and `data-mode="dark"`, and re-declare tokens. Some elements use `data-mode="cowork"` / `"code"` for unrelated purposes, so don't key off `[data-mode]` alone.

**Dark-mode values** (before Chroma):

| Token | Value | Token | Value |
|---|---|---|---|
| `surface-0` | `#0b0b0b` | `fill-brand` | `#ba5b3c` |
| `surface-1` | `#191919` | `fill-brand-hover` | `#d97757` |
| `surface-2` / `-3` | `#1f1f1f` | `fill-accent` | `#257de0` (blue) |
| `surface-panel` | `#1f1f1f` | `text-accent` | `#6aabf1` |
| `surface-popover` | `#303030` | `clay` | `#d97757` (logo) |
| `neutral-0..50` | `#0b0b0b..#151515` | `text-primary` / `-secondary` | `#ffffffed` / `#ffffff91` |
| `border` | `#ffffff0a` | `border-line` | `#ffffff1f` |

- Surfaces are partly defined through an absolute gray ramp (`--cds-gray-10..900`, where `gray-850` = `#151515`) and partly as hard-coded hex in "fizzy-lake" rules. Overriding the semantic tokens avoids caring which.
- Legacy utilities map onto the new tokens; for example `.bg-bg-100` → `var(--cds-surface-1)` and `.bg-bg-000` → `var(--cds-surface-3)`.

**Top bar** (`header.dframe-header`):
- Chat page, left to right: sidebar toggle (`aria-label` "Hide sidebar" / "Show sidebar"), project breadcrumb, session title button, its menu, a computer indicator, then on the right **Share**, **Activity panel** and **Side panel** (`data-testid="side-panel-toggle"`).
- `/new`: on the right only **Use incognito**, inside `div.dframe-pane-actions`.
- The left sidebar has its own title row (`.df-titlebar`: brand + Chat/Code `role="radiogroup"`). When collapsed it becomes `.df-collapsed-chrome`, and **hovering near it expands the sidebar**. That's why the launcher must not live on the left.

**Routes**:
- Chats: `/chat/<uuid>`.
- Projects: `/project/<uuid>`.
- New chat: `/new`.
- Also seen: `/recents`, `/artifacts`, `/cowork/<id>`, `/code/...`.
- New chats go `/new` → `/chat/<uuid>` with `history.replaceState`, which the Navigation API reports as `currententrychange`.

---

## 6. Storage and sync

| Where | Key | Contents | Why there |
|---|---|---|---|
| `chrome.storage.sync` | `chroma` | Settings object `S` (`v`, `enabled`, `theme`, `defaultAccent`, `glow*`, `linksFollowAccent`, `faviconDot`) | Synced across browsers |
| `chrome.storage.sync` | `chats_0` … `chats_f` | `{ chatKey: [accent, lastSeenDay] }` | Synced; sharded because one sync item is capped at 8 KB |
| `sessionStorage` (claude.ai origin) | `chroma:tabAccent` | This tab's color | Per tab, survives reloads, dies with the tab |
| `localStorage` (claude.ai origin) | `chroma:cache`, `chroma:chats` | Copies of the synced data | Synchronous read at `document_start`, so no flash of default colors |

- **chatKey**: the route type's first letter plus the id with dashes removed, for example `c4997a3f136be...`.
- **accent**: a preset id (`"purple"`) or `"#rrggbb"`.
- **lastSeenDay**: whole days since the epoch (`Math.floor(Date.now() / 864e5)`). Small numbers keep entries around 45 bytes.
- **Shard choice**: `shardOf(key)` hashes the key into 16 buckets. Only background.js uses it; content.js just reads all `chats_*` keys.

### Write rules (background.js)

- Content scripts never write chat colors. They message the worker (`chroma:chat-set`, `chroma:chat-seen`), which runs every storage operation through one promise queue (`run()`). That way two tabs can't do read-modify-write on the same shard at once.
- Content debounces `chat-set` by 400 ms per chat, so dragging the picker or mashing Alt+. costs one write. `chat-seen` is sent at most once per chat per day.
- Sync limits: about 100 KB total, 8 KB per item, about 120 writes per minute and about 1800 per hour.
  - `trimShard()` keeps each shard under 7600 bytes by dropping its oldest entries.
  - On a total-quota error, `prune(0.2)` evicts the oldest 20% everywhere and retries once.
  - With roughly 1700 chats the store stays under quota (checked by `dev/test-background.js`).

### Pruning

`prune()` deletes entries whose `lastSeenDay` is more than `TTL_DAYS` (30) old and removes empty shards. It runs on install, on browser start, and every 12 hours (`chrome.alarms`, `chroma-prune`).

### Settings migration

`SETTINGS_VERSION` and `withDefaults()` exist so that **changing a default reaches people who already have saved settings**:

```js
if ((x.v || 1) < 2) x = { ...x, theme: 'amoled', glow: true };
if ((x.v || 1) < 3) x = { ...x, glowSize: 20, glowStrength: 50, glowPulse: false };
if ((x.v || 1) < 4) x = { ...x, defaultAccent: 'claude', v: 4 };
```

Only the last step sets `v`.

To change a default for existing users:
1. Update `DEFAULTS`.
2. Bump `SETTINGS_VERSION`.
3. Append a `< N` step.

Each step applies once; boot writes the migrated object back to sync.

### Sync prerequisites

Sync only works across computers when every install has the **same extension ID**. For an unpacked extension, the ID comes from the `key` in [`manifest.json`](manifest.json); without it, each folder path gets a different ID with separate storage. **Never remove or change `key`**: that resets every user's settings and chat colors. The ID is `bccbajkddmlepjgpabhoahapekaenpok`.

Brave syncs `storage.sync` when Sync has "Extensions" enabled. This was not verified end to end on two machines when it was written.

---

## 7. The UI (launcher, bubble, panel)

### Launcher (`#chroma-launcher`)

- A plain `<button>` inserted into claude.ai's DOM, right after the **rightmost visible `<button>` in the top ~56px** past 60% of the window width (`topBarAnchor()`).
- If no such button exists, it floats `position: fixed` in the top-right corner, so it is never lost.
- `placeLauncher()` runs on every `render()` and every 700 ms. A fast path skips the button scan while the launcher is still at the right end of the top bar (it is cheap on long chats).
- Hover (only when `(hover: hover) and (pointer: fine)`) opens the bubble after 120 ms; leaving closes it after 260 ms unless the pointer enters the bubble. Click or tap toggles the panel.

### Shadow-DOM UI (`#chroma-ui`)

- One zero-size fixed host holds both cards in an open shadow root, so the site's CSS can't reach them.
- `:host{all:initial}` resets inherited properties, but **custom properties still inherit** through the shadow boundary. That is how the panel uses `--cds-surface-popover`, `--cds-text-primary` and the rest, and why it follows the active theme.
- Every token in `UI_CSS` has a hard-coded fallback.

**Panel** (`.card.panel`), positioned under the launcher by `positionCard()`:
- **Main view**: scope chip (This chat / This tab / Default), reset and settings icons, a 5-column grid of `ACCENTS` plus the custom tile.
  - The grid is 19 presets + 1 = 20 cells. Keep the preset count at a multiple of 5 minus 1, or change the column count in `UI_CSS`.
  - The custom tile toggles the HSV picker: `#sv` square, `#hue` bar, `#hex` field. It uses pointer events with `setPointerCapture`, so it works by touch.
- **Settings view**: background segmented control, glow (on, size, strength, breathe), accent links, tab icon dot, default color, enable switch, collapsible shortcut list generated from `HOTKEYS`, and a synced-chat count.
- `syncPanel()` is the only function that writes UI state from `S` / accent. It's called by `render()`, so the UI never drifts from the real state.
- Closing:
  - a capture-phase `pointerdown` anywhere outside closes it;
  - Esc closes it (in settings, Esc goes back to the main view first);
  - `keydown` inside the host is stopped, so claude.ai's type-to-focus doesn't steal keystrokes.

**Bubble** (`.card.bubble`): the same swatch markup at 30px, plus a "more" tile that opens the panel. Clicking a swatch applies the color and closes it.

### Hotkeys

- The `HOTKEYS` list matches on `e.code` (layout-independent; with Option on a Mac, `e.key` would be a symbol). It falls back to `e.key` when `e.code` is empty, as in synthetic events.
- `shift: false` entries are Alt+key (color cycling); the rest are Alt+Shift+key.
- The listener runs in the capture phase on `window` and stops propagation, so the site never sees handled keys.

---

## 8. Dev tools

| File | Use |
|---|---|
| [`dev/audit.js`](dev/audit.js) | Paste into DevTools on claude.ai. Shows what changed in the site's tokens, DOM and routes (section 2) |
| [`dev/test-content.js`](dev/test-content.js) | `node dev/test-content.js [--css]`. Runs the real content script against stubs: precedence, inheritance, debouncing, migration, generated CSS. Needs Node 18+ |
| [`dev/test-background.js`](dev/test-background.js) | `node dev/test-background.js`. Runs the real worker against an in-memory sync store with real quotas: writes, prune, eviction |
| [`dev/preview.html`](dev/preview.html) | Mock claude.ai page with a `chrome.*` stub: iterate on the panel without the extension. Serve the repo root (`python -m http.server 5917 --bind 127.0.0.1`) and open `http://localhost:5917/dev/preview.html` |
| [`dev/build_zip.py`](dev/build_zip.py) | `python dev/build_zip.py`. Rebuilds `chroma.zip` (shipped files only, forward-slash paths) |

`test-content.js` reaches into the IIFE by splicing a hook before the line `render(); // instant paint`. If you rename that line, update `HOOK` in the test; it fails loudly if the line is missing.

---

## 9. Gotchas

- **Inserting into React-owned DOM**: claude.ai re-renders and may drop the launcher. That is fine because the 700 ms loop re-seats it. Never insert *between* React children that React reorders; appending after a button inside a flex container has been safe.
- **Don't put anything near the left edge of the top bar**: it is the collapsed sidebar's hover-reveal zone.
- **Extension reloads orphan old content scripts**: after a reload, open tabs still run the old script with a dead `chrome.runtime`. `send()` and every `chrome.*` call are wrapped in `safe()` for this reason. Alt+Shift+U reloads the extension *and* the tab.
- **Isolated world**: the content script shares the DOM, but not the page's JS globals. Page code can't call Chroma, and Chroma can't patch `history.pushState`, hence the Navigation API listener plus polling.
- **Light accents**: colors with `luminance > 0.4` (yellow, lime, mono, light customs) switch on-accent text to near-black. Keep that check when adding presets.
- **`chatKey()` format is persistent data**: changing it orphans saved chat colors.
- **The `key` in manifest.json is persistent identity**: changing it orphans all synced data.
- **The Windows Alt+Shift language switch**: if enabled in Windows, Alt+Shift alone flips keyboard layouts. Turn it off in Settings > Time & language > Typing > Advanced keyboard settings > Input language hot keys.
- **The site's own light mode**: Darker and AMOLED assume dark-mode text tokens. They are documented as "set claude.ai to dark".

---

## 10. Release checklist

1. `node dev/test-content.js` and `node dev/test-background.js` both pass.
2. Bump `"version"` in [`manifest.json`](manifest.json) (patch for token fixes, minor for features).
3. If a default changed, bump `SETTINGS_VERSION` and add a migration step (section 6).
4. Update [`README.md`](README.md) if what Chroma does, or its main hotkeys, changed (the full hotkey list lives in `HOTKEYS` and the panel's Shortcuts section).
5. Update section 5 of this file if you learned something new about claude.ai's structure.
6. Reload (Alt+Shift+U) and do the visual pass in section 2, step 4.
7. Run `python dev/build_zip.py`.
