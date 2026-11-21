# Chroma for claude.ai

Unofficial, lightweight theme layer for claude.ai: one content script, one small background worker, and no network calls. It works by overriding the site's CSS color tokens: the current `--cds-*` design-system tokens, plus the older `--bg-*` / `--accent-*` ones.

## Install (Chrome or Brave)
1. Put this folder somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Reload any open claude.ai tabs.

Updating from 1.0: **remove** the old Chroma first, then load this folder again. 1.1 pins the extension ID (the `key` in `manifest.json`), so Reload alone won't swap the ID. Every computer then gets the same ID, which sync needs. The ID is `bccbajkddmlepjgpabhoahapekaenpok`.

Set claude.ai itself to dark mode (Settings > Appearance). Darker and AMOLED build on top of it.

Out of the box: AMOLED background everywhere; sessions without a color of their own use Claude orange and don't glow; chats and tabs you give a color glow at size 20, strength 50, breathe off. Settings saved by an older version get these values once; after that your changes stick.

## Features
- **Per-chat accent**: pick a color on a chat and that chat keeps it, in every tab, after reloads, and on your other computers. A chat you start from a colored tab (or a colored project) inherits that color. Opening an old chat never colors it by itself; it only gets a color when you pick one.
- **Per-tab accent**: on pages that aren't chats (New chat, Recents...), a tab keeps its own color. Order of precedence: this chat's color, then this tab's color, then the default.
- **Backgrounds**: Site (unchanged), Darker (neutral near-black), AMOLED (pure black).
- **Window glow**: an accent-colored edge glow with size, strength and optional breathe. It only shows on chats and tabs that have a color assigned, and never for Claude orange, so a glowing window means "this chat has its own color". Picking a color (or a new chat inheriting one) turns the glow setting on.
- **Top-bar dot**: an accent-colored dot at the far right of claude.ai's top bar.
  - Hover it (mouse) for a bubble of colors: one click switches.
  - Click or tap it for the panel: a grid of colors, a custom color picker (the rainbow tile), and a reset button. Glow, background, links, tab-icon dot, default color and shortcuts live on the settings page (the sliders icon).
- The Claude logo, send/brand buttons, focus rings, composer border and links follow the accent. Light accents automatically get dark button text. Each tab's favicon gets an accent dot.

## Sync and cleanup
Settings and chat colors live in `chrome.storage.sync`, which Chrome Sync and Brave Sync carry between computers when:
- every computer loads this same folder (same `key`, so the same extension ID), and
- sync is on with **Extensions** (Brave: Settings > Sync > Manage your synced devices > Extensions) or "Sync everything" turned on.

Sync has a quota (about 100 KB, 8 KB per item), so:
- each chat entry is just its color plus the day it was last opened, spread over 16 items (`chats_0`..`chats_f`);
- opening a chat refreshes its date at most once a day;
- the background worker deletes the color of any chat not opened for 30 days (on browser start and every 12 hours);
- if the quota still fills up, the oldest chats are evicted first.

## Hotkeys (on claude.ai)
| Keys | Action |
|---|---|
| Alt+, / Alt+. | Previous / next color (saved to this chat, and this tab) |
| Alt+Shift+P | Open/close the panel (the dot in the top bar and the toolbar icon do this too) |
| Alt+Shift+D | Cycle background: Site, Darker, AMOLED |
| Alt+Shift+G | Glow on/off |
| Alt+Shift+R | Reset this chat's and tab's color to the default |
| Alt+Shift+M | Make the current color the default |
| Alt+Shift+X | Turn everything on/off |
| Alt+Shift+K | Log claude.ai's color tokens to the console |
| Alt+Shift+U | Reload Chroma after editing its files, then refresh the tab |
| Esc | Close the panel |

On a Mac, use Option instead of Alt. To change the keys, edit the `HOTKEYS` list near the top of `content.js`, then reload the extension. On Windows, if Alt+Shift also switches your keyboard language, turn that shortcut off in Windows Settings > Time & language > Typing > Advanced keyboard settings > Input language hot keys.

## If something stops recoloring
claude.ai renames its CSS tokens and reshapes its layout from time to time; version 1.0 broke when the site moved to `--cds-*` tokens. [MAINTAINING.md](MAINTAINING.md) has the repair playbook. In short: paste [`dev/audit.js`](dev/audit.js) into DevTools on claude.ai to see which overrides went dead and which new tokens appeared, then update `buildCSS()` / `CDS` in `content.js`.
