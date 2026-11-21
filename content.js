// Chroma for claude.ai: content script
// Global settings live in chrome.storage.sync ("chroma"). Per-chat accents live in
// chrome.storage.sync too ("chats_0".."chats_f", written only by background.js), so
// they follow you to other browsers signed in to the same Chrome/Brave Sync chain.
// The per-tab accent lives in sessionStorage: scoped to one tab, survives reloads.
// Accent precedence: this chat's saved color > this tab's color > default.
(() => {
  'use strict';
  if (window.__chromaLoaded) return;
  window.__chromaLoaded = true;

  // ---------- config ----------
  const ACCENTS = [
    { id: 'claude', name: 'Claude', hex: '#D97757' }, // site default, no override
    { id: 'red', name: 'Red', hex: '#EF4444' },
    { id: 'orange', name: 'Orange', hex: '#F97316' },
    { id: 'amber', name: 'Amber', hex: '#F59E0B' },
    { id: 'yellow', name: 'Yellow', hex: '#EAB308' },
    { id: 'lime', name: 'Lime', hex: '#84CC16' },
    { id: 'green', name: 'Green', hex: '#22C55E' },
    { id: 'emerald', name: 'Emerald', hex: '#10B981' },
    { id: 'teal', name: 'Teal', hex: '#14B8A6' },
    { id: 'cyan', name: 'Cyan', hex: '#06B6D4' },
    { id: 'sky', name: 'Sky', hex: '#0EA5E9' },
    { id: 'blue', name: 'Blue', hex: '#3B82F6' },
    { id: 'indigo', name: 'Indigo', hex: '#6366F1' },
    { id: 'violet', name: 'Violet', hex: '#8B5CF6' },
    { id: 'purple', name: 'Purple', hex: '#A855F7' },
    { id: 'fuchsia', name: 'Fuchsia', hex: '#D946EF' },
    { id: 'pink', name: 'Pink', hex: '#EC4899' },
    { id: 'rose', name: 'Rose', hex: '#F43F5E' },
    { id: 'mono', name: 'Mono', hex: '#D4D4D4' },
  ];

  const THEMES = ['default', 'darker', 'amoled'];
  const THEME_NAMES = { default: 'Site', darker: 'Darker', amoled: 'AMOLED' };
  // Legacy tokens (--bg-000..500 etc., "H S% L%" triplets): lightness per step.
  const PALETTES = {
    darker: { bg: [13.5, 9.5, 7, 5, 3, 0], text: [98, 93, 74, 63, 52, 42], border: 88 },
    amoled: { bg: [8, 0, 0, 5, 7, 0], text: [100, 94, 76, 64, 54, 44], border: 92 },
  };
  // Current design-system tokens (--cds-*, full colors). Site dark values for
  // reference: surface-0 #0b0b0b, surface-1 #191919, surface-2/3 #1f1f1f,
  // popover #303030, neutral-0..50 #0b0b0b..#151515.
  const CDS = {
    darker: {
      'surface-0': '#060606', 'surface-1': '#0b0b0b', 'surface-2': '#101010', 'surface-3': '#121212',
      'surface-panel': '#0e0e0e', 'surface-popover': '#1a1a1a', 'fizzy-lake-color-sidebar': '#0e0e0e',
      'neutral-0': '#050505', 'neutral-10': '#060606', 'neutral-20': '#080808', 'neutral-30': '#090909',
      'neutral-40': '#0b0b0b', 'neutral-50': '#0d0d0d',
    },
    amoled: {
      'surface-0': '#000000', 'surface-1': '#000000', 'surface-2': '#070707', 'surface-3': '#0a0a0a',
      'surface-panel': '#000000', 'surface-popover': '#121212', 'fizzy-lake-color-sidebar': '#000000',
      'neutral-0': '#000000', 'neutral-10': '#000000', 'neutral-20': '#020202', 'neutral-30': '#040404',
      'neutral-40': '#060606', 'neutral-50': '#080808',
    },
  };
  const SETTINGS_VERSION = 4;
  const DEFAULTS = {
    v: SETTINGS_VERSION,
    enabled: true,
    theme: 'amoled',
    defaultAccent: 'claude',
    linksFollowAccent: true,
    faviconDot: true,
    glow: true,
    glowSize: 20,
    glowStrength: 50,
    glowPulse: false,
  };
  // Settings saved by older versions get the current look once (AMOLED, glow on at 20/50, no breathe);
  // after that, whatever you change sticks.
  function withDefaults(x) {
    x = x || {};
    if ((x.v || 1) < 2) x = { ...x, theme: 'amoled', glow: true };
    if ((x.v || 1) < 3) x = { ...x, glowSize: 20, glowStrength: 50, glowPulse: false };
    if ((x.v || 1) < 4) x = { ...x, defaultAccent: 'claude', v: 4 }; // unassigned sessions are Claude orange
    return { ...DEFAULTS, ...x };
  }
  // Matched on e.code, so they work on any keyboard layout (and with Option on a Mac).
  // Alt+, / Alt+. cycle colors; everything else is Alt+Shift+key.
  const HOTKEYS = [
    { code: 'Comma', shift: false, label: 'Previous color', run: () => cycleAccent(-1) },
    { code: 'Period', shift: false, label: 'Next color', run: () => cycleAccent(1) },
    { code: 'KeyP', shift: true, label: 'Open Chroma', run: () => togglePanel() },
    { code: 'KeyD', shift: true, label: 'Background', run: () => cycleTheme() },
    { code: 'KeyG', shift: true, label: 'Glow on/off', run: () => toggle('glow', 'Glow') },
    { code: 'KeyR', shift: true, label: 'Reset color', run: () => resetTab() },
    { code: 'KeyM', shift: true, label: 'Set as default', run: () => makeDefault() },
    { code: 'KeyX', shift: true, label: 'Chroma on/off', run: () => toggle('enabled', 'Chroma') },
    { code: 'KeyK', shift: true, label: 'Log color tokens', run: () => dumpTokens() },
    { code: 'KeyU', shift: true, label: 'Reload Chroma', run: () => { toast('Reloading Chroma...'); send({ type: 'chroma:reload' }); setTimeout(() => location.reload(), 600); } },
  ];
  const keyLabel = (h) => (IS_MAC ? (h.shift ? '⌥⇧' : '⌥') : h.shift ? 'Alt+Shift+' : 'Alt+')
    + ({ Comma: ',', Period: '.' }[h.code] || h.code.replace('Key', ''));
  const TAB_KEY = 'chroma:tabAccent';
  const CACHE_KEY = 'chroma:cache';
  const CHATS_CACHE_KEY = 'chroma:chats';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  // Routes that own a color. Key = type letter + id (UUID dashes dropped to save sync bytes).
  const CHAT_ROUTE = /^\/(chat|project|cowork|code)\/([A-Za-z0-9_-]{16,})/;
  // Leaving one of these for a brand-new chat hands the tab's color to that chat.
  const COMPOSE_ROUTE = /^\/(new|project\/[^/]+|cowork|code)?\/?$/;

  // ---------- state ----------
  let S = withDefaults(readCache(CACHE_KEY));
  let tabAccent = safe(() => sessionStorage.getItem(TAB_KEY), null);
  let chats = readCache(CHATS_CACHE_KEY); // { chatKey: [accent, lastSeenDay] }, merged from all shards
  let shards = {}; // last synced value of each chats_* item
  let fmt = 'triplet'; // 'triplet' = "H S% L%" (claude.ai style), 'color' = full color value

  function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  function readCache(k) { return safe(() => JSON.parse(localStorage.getItem(k)) || {}, {}); }
  function writeCache() { safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(S))); }
  function writeChatsCache() { safe(() => localStorage.setItem(CHATS_CACHE_KEY, JSON.stringify(chats))); }
  const today = () => Math.floor(Date.now() / 864e5);

  function chatKey(path = location.pathname) {
    const m = CHAT_ROUTE.exec(path);
    return m ? m[1][0] + m[2].replace(/-/g, '') : null;
  }
  // Messages to background.js; throws if the extension was reloaded under this page.
  function send(msg) {
    safe(() => { const p = chrome.runtime.sendMessage(msg); if (p && p.catch) p.catch(() => {}); });
  }

  // ---------- color utils ----------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hexToHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function hslToHex(h, s, l) {
    s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  function tok(h, s, l) {
    const H = +h.toFixed(1), Sx = +clamp(s, 0, 100).toFixed(1), L = +clamp(l, 0, 100).toFixed(1);
    return fmt === 'triplet' ? `${H} ${Sx}% ${L}%` : `hsl(${H} ${Sx}% ${L}%)`;
  }

  // ---------- accent resolution ----------
  function resolveAccent(v) {
    if (!v) return null;
    const preset = ACCENTS.find((a) => a.id === v);
    if (preset) return preset;
    if (/^#[0-9a-f]{6}$/i.test(v)) return { id: v.toLowerCase(), name: v.toUpperCase(), hex: v };
    return null;
  }
  const chatAccent = () => { const k = chatKey(); return k && chats[k] ? resolveAccent(chats[k][0]) : null; };
  const currentAccent = () => chatAccent() || resolveAccent(tabAccent) || resolveAccent(S.defaultAccent) || ACCENTS[0];
  const defaultAccent = () => resolveAccent(S.defaultAccent) || ACCENTS[0];
  const accentScope = () => (chatAccent() ? 'this chat' : resolveAccent(tabAccent) ? 'this tab' : 'default');

  // ---------- CSS ----------
  function buildCSS() {
    if (!S.enabled) return '';
    const acc = currentAccent();
    const hex = acc.hex;
    const rgb = hexToRgb(hex).join(' ');
    const decl = [];

    if (acc.id !== 'claude') {
      const [h, s, l] = hexToHsl(hex);
      const light = luminance(hex) > 0.4; // yellow, lime, mono... need dark text on fills
      // Legacy triplet tokens (still read by a few hsl(var(--brand-100)) utilities).
      const base = tok(h, s, l), deep = tok(h, s, l - 7), lift = tok(h, s, l + 8);
      decl.push(
        `--accent-brand:${base}`, `--brand-000:${deep}`, `--brand-100:${base}`, `--brand-200:${base}`,
        `--accent-000:${lift}`, `--accent-100:${base}`, `--accent-200:${base}`,
        `--accent-main-000:${deep}`, `--accent-main-100:${deep}`, `--accent-main-200:${base}`,
      );
      // Design-system tokens: Claude's orange (brand) and the blue UI accent both follow.
      const hover = hslToHex(h, s, clamp(l + 7, 0, 92));
      const deepHex = hslToHex(h, s, l - 8);
      const mix = (p, to) => `color-mix(in srgb,${hex} ${p}%,${to})`;
      const ring = `0 0 0 1px ${hex},0 0 6px 1px rgb(${rgb} / .45)`;
      decl.push(
        `--cds-fill-brand:${hex}`, `--cds-fill-brand-hover:${hover}`, `--cds-fill-brand-icon-only:${hex}`,
        `--cds-fill-accent:${hex}`, `--cds-fill-accent-hover:${hover}`,
        `--cds-role-accent-fill:${hex}`, `--cds-role-accent-fill-hover:${hover}`,
        `--cds-role-accent-50:${mix(10, '#fff')}`, `--cds-role-accent-100:${mix(22, '#fff')}`,
        `--cds-role-accent-250:${mix(55, '#fff')}`, `--cds-role-accent-300:${mix(72, '#fff')}`,
        `--cds-role-accent-400:${hover}`, `--cds-role-accent-450:${hex}`, `--cds-role-accent-600:${deepHex}`,
        `--cds-role-accent-700:${mix(55, '#000')}`, `--cds-role-accent-800:${mix(30, '#000')}`,
        `--cds-role-accent-850:${mix(20, '#000')}`,
        `--cds-text-accent:${mix(72, '#fff')}`,
        `--cds-bg-accent:${mix(12, 'transparent')}`, `--cds-bg-accent-layer:${mix(6, 'transparent')}`,
        `--cds-bg-accent--mix:${hex} 12%`, `--cds-border-accent:${mix(24, 'transparent')}`,
        `--cds-composer-ring:rgb(${rgb} / .28)`,
        `--cds-focus-shadow:inset 0 0 0 1px var(--cds-surface-1),${ring}`, `--cds-focus-shadow--ring:${ring}`,
        `--cds-fizzy-lake-color-field-focus:inset 0 0 0 1px var(--cds-surface-1),${ring}`,
        `--cds-on-accent:${light ? '#111' : '#fff'}`, `--cds-role-accent-on:${light ? '#111' : '#fff'}`,
      );
      // "Clay" is the Claude logo/spark color; --cds-hsl-* and --_brand-* are always "H S% L%".
      const trip = (L) => `${+h.toFixed(1)} ${+s.toFixed(1)}% ${+clamp(L, 0, 100).toFixed(1)}%`;
      decl.push(
        `--cds-clay:${hex}`, `--cds-clay-emphasized:${deepHex}`,
        `--cds-hsl-clay:${trip(l)}`, `--cds-hsl-clay-emphasized:${trip(l - 8)}`,
        `--_brand-clay:${trip(l)}`, `--_brand-clay-emphasized:${trip(l - 8)}`,
      );
      if (S.linksFollowAccent) {
        decl.push(
          `--accent-secondary-000:${lift}`, `--accent-secondary-100:${base}`, `--accent-secondary-200:${lift}`,
          `--cds-chat-composer-link:${mix(72, '#fff')}`, `--cds-chat-composer-link-hover:${hover}`,
        );
      }
      if (light) {
        decl.push(`--oncolor-100:${tok(0, 0, 8)}`, `--oncolor-200:${tok(0, 0, 14)}`, `--oncolor-300:${tok(0, 0, 20)}`);
      }
    }

    const pal = PALETTES[S.theme];
    const cds = CDS[S.theme];
    if (pal) {
      pal.bg.forEach((L, i) => decl.push(`--bg-${i}00:${tok(0, 0, L)}`));
      pal.text.forEach((L, i) => decl.push(`--text-${i}00:${tok(0, 0, L)}`));
      [1, 2, 3, 4].forEach((i) => decl.push(`--border-${i}00:${tok(0, 0, pal.border)}`));
      for (const [k, v] of Object.entries(cds)) decl.push(`--cds-${k}:${v}`);
      decl.push(
        '--cds-ground:var(--cds-surface-1)', '--cds-ground-line:var(--cds-surface-1)',
        '--cds-scroll-fade-strip-color:var(--cds-surface-1)',
      );
    }

    let css = '';
    if (decl.length) {
      // claude.ai re-declares its tokens on nested .cds-root wrappers, so target those too.
      // !important custom properties beat the site's own declarations on the same element.
      const sel = ':root,.cds-root,html[data-mode],html[data-theme],[data-mode="dark"],[data-mode="light"]';
      css += `${sel}{${decl.map((d) => d + ' !important').join(';')}}\n`;
    }
    if (pal) {
      css += `html{color-scheme:dark;scrollbar-color:#2a2a2a transparent}\n`;
      css += `html,body{background-color:${cds['surface-1']}}\n`;
    }
    css += `::selection{background:rgb(${rgb} / .35)}\n`;
    css += `textarea,input,[contenteditable="true"]{caret-color:rgb(${rgb})}\n`;
    css += `@keyframes chroma-breathe{0%,100%{opacity:1}50%{opacity:.45}}\n`;
    css += `@media (prefers-reduced-motion:reduce){#chroma-glow{animation:none!important}}\n`;
    return css;
  }

  // ---------- DOM nodes ----------
  const styleEl = document.createElement('style');
  styleEl.id = 'chroma-style';
  let glowEl = null, toastEl = null, toastTimer = 0;

  function ensureNodes() {
    const parent = document.head || document.documentElement;
    if (!parent) return;
    if (styleEl.parentNode !== parent) parent.appendChild(styleEl); // rules are !important, order doesn't matter
    if (glowEl && document.body && !glowEl.isConnected) document.body.appendChild(glowEl);
    if (uiHost && document.body && !uiHost.isConnected) document.body.appendChild(uiHost);
  }

  // The glow marks chats/tabs that have a color of their own. Default-colored tabs, and
  // Claude orange even when assigned, never glow.
  const glowVisible = () => S.enabled && S.glow && accentScope() !== 'default' && currentAccent().id !== 'claude';
  function updateGlow() {
    if (!glowVisible()) {
      if (glowEl) { glowEl.remove(); glowEl = null; }
      return;
    }
    if (!glowEl) {
      glowEl = document.createElement('div');
      glowEl.id = 'chroma-glow';
      glowEl.setAttribute('aria-hidden', 'true');
    }
    if (document.body && !glowEl.isConnected) document.body.appendChild(glowEl);
    const rgb = hexToRgb(currentAccent().hex).join(' ');
    const k = S.glowStrength / 100, sz = S.glowSize;
    Object.assign(glowEl.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483646',
      transition: 'box-shadow .25s ease',
      boxShadow: `inset 0 0 0 1px rgb(${rgb} / ${Math.min(1, k + 0.2).toFixed(2)}), inset 0 0 ${sz}px ${Math.round(sz / 4)}px rgb(${rgb} / ${k.toFixed(2)})`,
      animation: S.glowPulse ? 'chroma-breathe 4s ease-in-out infinite' : 'none',
    });
  }

  function toast(msg) {
    if (!document.body) return;
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'chroma-toast'; }
    if (!toastEl.isConnected) document.body.appendChild(toastEl);
    const rgb = hexToRgb(currentAccent().hex).join(' ');
    toastEl.textContent = msg;
    Object.assign(toastEl.style, {
      position: 'fixed', left: '50%', top: '18px', transform: 'translateX(-50%)', zIndex: '2147483647',
      padding: '8px 14px', borderRadius: '999px', background: 'var(--cds-surface-popover, #262626)', color: 'var(--cds-text-primary, #f2f2f2)',
      font: '500 13px/1.3 anthropic-sans,system-ui,-apple-system,"Segoe UI",sans-serif',
      border: `1px solid rgb(${rgb} / .65)`, boxShadow: `0 6px 24px rgba(0,0,0,.45),0 0 18px rgb(${rgb} / .25)`,
      pointerEvents: 'none', opacity: '1', transition: 'opacity .3s ease', whiteSpace: 'nowrap',
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 1400);
  }

  // ---------- favicon dot (tells tabs apart in the tab strip) ----------
  const fav = { src: null, key: '', ours: null, timer: 0 };
  const isIconLink = (n) => n.nodeName === 'LINK' && /\bicon\b/i.test(n.rel || '') && !n.dataset.chroma;

  function scheduleFavicon() { clearTimeout(fav.timer); fav.timer = setTimeout(applyFavicon, 120); }

  function restoreFavicon() {
    document.querySelectorAll('link[rel="chroma-off-icon"]').forEach((l) => { l.rel = l.dataset.chromaRel || 'icon'; });
    if (fav.ours) { fav.ours.remove(); fav.ours = null; }
    fav.key = '';
  }

  function drawIcon(src, hex) {
    const dot = (x) => {
      x.beginPath(); x.arc(46, 46, 15, 0, Math.PI * 2);
      x.fillStyle = hex; x.fill(); x.lineWidth = 5; x.strokeStyle = '#111'; x.stroke();
    };
    const fallback = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fillStyle = hex; x.fill();
      return c.toDataURL('image/png');
    };
    return new Promise((resolve) => {
      if (!src) return resolve(fallback());
      const img = new Image();
      if (safe(() => new URL(src, location.href).origin !== location.origin, false)) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 64;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0, 64, 64); dot(x);
          resolve(c.toDataURL('image/png'));
        } catch { resolve(fallback()); }
      };
      img.onerror = () => resolve(fallback());
      img.src = src;
    });
  }

  async function applyFavicon() {
    if (!document.head) return;
    if (!(S.enabled && S.faviconDot)) { restoreFavicon(); return; }
    const hex = currentAccent().hex;
    const live = [...document.head.querySelectorAll('link')].filter(isIconLink);
    if (live.length) {
      const pick = live.find((l) => /svg/i.test(l.type || l.href)) || live[live.length - 1];
      fav.src = pick.href;
    }
    if (!fav.src) fav.src = new URL('/favicon.ico', location.href).href;
    const key = hex + '|' + fav.src;
    if (key === fav.key && fav.ours && fav.ours.isConnected && !live.length) return;
    fav.key = key;
    const url = await drawIcon(fav.src, hex);
    if (fav.key !== key) return; // a newer request won
    live.forEach((l) => { l.dataset.chromaRel = l.rel; l.rel = 'chroma-off-icon'; });
    if (!fav.ours) {
      fav.ours = document.createElement('link');
      fav.ours.rel = 'icon'; fav.ours.type = 'image/png'; fav.ours.dataset.chroma = '1';
    }
    fav.ours.href = url;
    if (!fav.ours.isConnected) document.head.appendChild(fav.ours);
  }

  // ---------- format detection & diagnostics ----------
  function detectFormat() {
    if (!document.documentElement) return;
    const saved = styleEl.textContent;
    styleEl.textContent = '';
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue('--bg-100').trim();
    const cds = cs.getPropertyValue('--cds-surface-1').trim();
    styleEl.textContent = saved;
    const next = !v || /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/.test(v) ? 'triplet' : 'color';
    if (!cds && document.readyState === 'complete' && !detectFormat.warned) {
      detectFormat.warned = true;
      console.warn('[Chroma] --cds-surface-1 not found on this page. claude.ai may have renamed its tokens; press Alt+Shift+K to log what exists.');
    }
    if (next !== fmt) { fmt = next; render(); }
  }

  function dumpTokens() {
    const names = new Set();
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules) walk(r.cssRules);
        if (r.style) for (const p of r.style) if (/^--(cds-(surface|text|fill|bg|border|role-accent|on-|focus|ground|neutral-[0-9]|composer)|bg|text|border|accent|oncolor|brand)/.test(p)) names.add(p);
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* cross-origin sheet */ } }
    const cs = getComputedStyle(document.documentElement);
    const rows = {};
    [...names].sort().forEach((n) => { rows[n] = cs.getPropertyValue(n).trim(); });
    console.log('[Chroma] <html> attributes:', [...document.documentElement.attributes].map((a) => `${a.name}="${a.value}"`).join(' '));
    console.log('[Chroma] token format detected:', fmt);
    console.table(rows);
    toast(`${names.size} color tokens logged to console`);
  }

  // ---------- render ----------
  function render() {
    ensureNodes();
    styleEl.textContent = buildCSS();
    updateGlow();
    scheduleFavicon();
    placeLauncher();
    syncPanel();
  }

  // ---------- persistence ----------
  let syncTimer = 0;
  function save(patch) {
    S = { ...S, ...patch };
    writeCache();
    render();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => safe(() => chrome.storage.sync.set({ chroma: S })), 300);
  }
  function storeTabAccent(v) {
    tabAccent = v || null;
    safe(() => (tabAccent ? sessionStorage.setItem(TAB_KEY, tabAccent) : sessionStorage.removeItem(TAB_KEY)));
  }

  // Per-chat colors. The local copy updates immediately; background.js does the
  // synced write (debounced, so cycling colors with a hotkey costs one write).
  const chatWrites = new Map();
  function storeChatAccent(key, v) {
    if (v) chats[key] = [v, today()];
    else delete chats[key];
    writeChatsCache();
    clearTimeout(chatWrites.get(key));
    chatWrites.set(key, setTimeout(() => {
      chatWrites.delete(key);
      send({ type: 'chroma:chat-set', key, accent: v || null });
    }, 400));
  }
  function markSeen(key) {
    const e = key && chats[key];
    if (!e || e[1] >= today()) return; // at most one synced write per chat per day
    e[1] = today();
    writeChatsCache();
    send({ type: 'chroma:chat-seen', key });
  }

  // Picking a color applies to this tab and, on a chat page, is saved for that chat.
  function setAccent(v) {
    storeTabAccent(v);
    const key = chatKey();
    if (key) storeChatAccent(key, v);
    if (v) glowOn();
    render();
  }
  // Assigning a color through Chroma switches the window glow on.
  function glowOn() { if (!S.glow) save({ glow: true }); }

  // Rebuild the merged chat map from the synced shards.
  function mergeShards() {
    const next = {};
    for (const map of Object.values(shards)) Object.assign(next, map);
    // Keep local writes that are still waiting for their debounce.
    for (const key of chatWrites.keys()) { if (chats[key]) next[key] = chats[key]; else delete next[key]; }
    chats = next;
    writeChatsCache();
  }

  // ---------- SPA navigation ----------
  let lastPath = location.pathname;
  function onNavigate() {
    const path = location.pathname;
    if (path === lastPath) return;
    const prevPath = lastPath;
    lastPath = path;
    const key = chatKey(path);
    if (key) {
      if (chats[key]) markSeen(key);
      else if (COMPOSE_ROUTE.test(prevPath)) {
        // A chat was just started from this tab: it keeps the color it was started with.
        const prevKey = chatKey(prevPath);
        const inherited = (prevKey && chats[prevKey] && chats[prevKey][0]) || tabAccent;
        if (inherited) { storeChatAccent(key, inherited); glowOn(); }
      }
    }
    render();
  }

  // ---------- actions ----------
  function cycleAccent(dir) {
    const cur = currentAccent();
    let i = ACCENTS.findIndex((a) => a.id === cur.id);
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = ACCENTS[(i + dir + ACCENTS.length) % ACCENTS.length];
    setAccent(next.id);
    toast(`${next.name} · ${accentScope()}`);
  }
  function cycleTheme() {
    const t = THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length];
    save({ theme: t });
    toast(`Background: ${THEME_NAMES[t]}`);
  }
  function toggle(key, label) {
    save({ [key]: !S[key] });
    toast(`${label}: ${S[key] ? 'on' : 'off'}`);
  }
  function makeDefault() {
    const a = currentAccent();
    storeTabAccent(null); // the tab now just follows the default; a chat keeps its saved color
    save({ defaultAccent: a.id });
    toast(`Default accent: ${a.name}`);
  }
  function resetTab() {
    storeTabAccent(null);
    const key = chatKey();
    if (key && chats[key]) storeChatAccent(key, null);
    render();
    toast(`Accent: ${currentAccent().name} · default`);
  }

  // ---------- hotkeys ----------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen()) { togglePanel(false); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    // e.code is layout-independent; fall back to e.key for synthetic/odd keyboards.
    const code = e.code || { '.': 'Period', ',': 'Comma', '>': 'Period', '<': 'Comma' }[e.key]
      || (/^[a-z]$/i.test(e.key) ? 'Key' + e.key.toUpperCase() : '');
    const hk = HOTKEYS.find((h) => h.code === code && h.shift === e.shiftKey);
    if (!hk) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    hk.run();
  }, true);

  // ---------- top-bar launcher ----------
  // An accent dot at the far right of claude.ai's top bar. Click: open the panel.
  // Hover (mouse only): a small bubble of colors for one-click switching.
  let launcher = null;
  const canHover = () => safe(() => matchMedia('(hover: hover) and (pointer: fine)').matches, false);
  function buildLauncher() {
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'chroma-launcher';
    launcher.setAttribute('aria-label', 'Chroma colors');
    launcher.setAttribute('aria-haspopup', 'dialog');
    const dot = document.createElement('span');
    launcher.appendChild(dot);
    Object.assign(launcher.style, {
      width: '32px', height: '32px', flexShrink: '0', display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', padding: '0', border: '0', borderRadius: '8px', background: 'transparent',
      cursor: 'pointer', transition: 'background-color .15s ease', touchAction: 'manipulation',
    });
    Object.assign(dot.style, { width: '14px', height: '14px', borderRadius: '50%', transition: 'background .2s, box-shadow .2s' });
    launcher.addEventListener('mouseenter', () => {
      launcher.style.backgroundColor = 'var(--cds-fill-ghost-hover, rgba(255,255,255,.08))';
      if (canHover() && !panelOpen()) bubbleSoon(true);
    });
    launcher.addEventListener('mouseleave', () => { launcher.style.backgroundColor = 'transparent'; bubbleSoon(false); });
    launcher.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showBubble(false); togglePanel(); });
  }
  // Right after the rightmost button in the top bar (Share / side panel / incognito,
  // depending on the page). Kept away from the left edge, where hovering opens the
  // collapsed sidebar.
  function topBarAnchor() {
    let best = null, bestRight = innerWidth * 0.6;
    for (const b of document.querySelectorAll('button')) {
      if (b === launcher) continue;
      const r = b.getBoundingClientRect();
      if (r.height === 0 || r.top > 30 || r.bottom > 56 || r.right <= bestRight) continue;
      best = b; bestRight = r.right;
    }
    return best;
  }
  function placeLauncher() {
    if (!document.body) return;
    if (!launcher) buildLauncher();
    // Fast path: still seated at the right end of the top bar, so skip the button scan.
    const lr = launcher.isConnected && !launcher.style.position && launcher.previousElementSibling
      ? launcher.getBoundingClientRect() : null;
    const seated = lr && lr.height > 0 && lr.top < 30 && lr.right > innerWidth - 80;
    const anchor = seated ? launcher.previousElementSibling : topBarAnchor();
    if (anchor) {
      if (launcher.previousElementSibling !== anchor) anchor.after(launcher);
      Object.assign(launcher.style, { position: '', top: '', right: '', zIndex: '', margin: '0 0 0 2px' });
    } else {
      // No top bar found (layout changed or page still loading): float in the corner.
      if (launcher.parentElement !== document.body) document.body.appendChild(launcher);
      Object.assign(launcher.style, { position: 'fixed', top: '8px', right: '10px', zIndex: '2147483645', margin: '0' });
    }
    const hex = currentAccent().hex;
    const dot = launcher.firstChild;
    dot.style.background = S.enabled ? hex : 'transparent';
    dot.style.boxShadow = S.enabled ? `0 0 0 3px ${hex}33,0 0 10px ${hex}99` : `inset 0 0 0 2px ${hex}`;
  }

  // ---------- UI (panel + hover bubble) ----------
  // One shadow root so claude.ai's CSS can't leak in. Colors come from claude.ai's own
  // tokens (inherited through the shadow boundary), so the UI follows Site/Darker/AMOLED
  // and light mode like the site's own menus do.
  let uiHost = null, U = null, view = 'main', pickerOpen = false, dragging = false;
  let pk = { h: 0, s: 0, v: 1 }; // custom picker state (HSV)
  let bubbleTimer = 0;
  const panelOpen = () => !!U && !U.panel.hidden;

  const ICON = {
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    tune: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const svg = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  function hexToHsv(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }
  function hsvToHex({ h, s, v }) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }

  const UI_CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0}
[hidden]{display:none!important}
.ui{--bg:var(--cds-surface-popover,#262626);--fg:var(--cds-text-primary,#f2f2f2);--fg2:var(--cds-text-secondary,#a3a3a3);
  --line:var(--cds-border-line,rgba(255,255,255,.12));--hover:var(--cds-fill-ghost-hover,rgba(255,255,255,.07));
  --field:var(--cds-fill-field,rgba(255,255,255,.05));--acc:#d97757;
  font:14px/1.4 anthropic-sans,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased}
.card{position:fixed;background:var(--bg);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 12px 40px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.25);transform-origin:top right;animation:pop .14s ease-out}
@keyframes pop{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
.panel{width:min(312px,calc(100vw - 16px));overflow:auto;overscroll-behavior:contain;padding:8px 12px 14px}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
header{display:flex;align-items:center;gap:2px;min-height:44px;margin:0 -4px 4px}
.sp{flex:1}
.icon{width:40px;height:40px;display:grid;place-items:center;border-radius:10px;color:var(--fg2)}
.icon:hover{background:var(--hover);color:var(--fg)}
.icon:disabled{opacity:.35;pointer-events:none}
.chip{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px 0 10px;border-radius:999px;background:var(--field);font-size:13px;color:var(--fg)}
.chip i{width:10px;height:10px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc)}
.title{font-weight:500;font-size:15px;padding-left:4px}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.sw{position:relative;aspect-ratio:1;min-height:44px;border-radius:14px;display:grid;place-items:center}
.sw:hover{background:var(--hover)}
.sw b{width:34px;height:34px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);transition:transform .12s ease,box-shadow .12s ease;display:grid;place-items:center;color:var(--on,#fff)}
.sw:hover b{transform:scale(1.07)}
.sw[aria-pressed="true"] b{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--c)}
.sw b svg{opacity:0;transition:opacity .12s}
.sw[aria-pressed="true"] b svg{opacity:1}
.sw.custom b{background:conic-gradient(from 90deg,#f43f5e,#f59e0b,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ec4899,#f43f5e);color:#fff}
.sw.custom b svg{opacity:1}
.sw.custom[data-active] b{border:3px solid transparent;background:linear-gradient(var(--c),var(--c)) padding-box,conic-gradient(from 90deg,#f43f5e,#f59e0b,#22c55e,#06b6d4,#3b82f6,#a855f7,#f43f5e) border-box}
.sw.custom[data-active] b svg{opacity:0}
.picker{margin-top:12px;display:grid;gap:12px}
.sv{position:relative;height:148px;border-radius:12px;touch-action:none;cursor:crosshair;
  background:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(var(--h) 100% 50%))}
.hue{position:relative;height:24px;border-radius:999px;touch-action:none;cursor:pointer;
  background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.knob{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid #fff;
  box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 6px rgba(0,0,0,.4);background:var(--k);pointer-events:none}
.hue .knob{top:50%}
.hexrow{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:10px;background:var(--field);border:1px solid var(--line)}
.hexrow i{width:18px;height:18px;border-radius:50%;background:var(--acc)}
.hexrow input{flex:1;min-width:0;font:inherit;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:var(--fg);background:none;border:0;outline:none;text-transform:uppercase}
.list{display:grid;gap:10px}
.group{background:var(--field);border:1px solid var(--line);border-radius:12px;padding:2px 12px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:46px}
.row+.row{border-top:1px solid var(--line)}
.row>span{color:var(--fg)}
label.row{cursor:pointer}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:3px;margin:2px 0 10px;border-radius:10px;background:var(--hover)}
.seg button{height:36px;border-radius:8px;color:var(--fg2);font-size:13px}
.seg button[aria-pressed="true"]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px rgba(0,0,0,.3)}
.lab{display:block;padding:12px 0 8px;color:var(--fg2);font-size:13px}
input[type=checkbox]{appearance:none;flex:none;width:40px;height:24px;border-radius:999px;background:var(--line);position:relative;cursor:pointer;transition:background .15s}
input[type=checkbox]::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
input[type=checkbox]:checked{background:var(--acc)}
input[type=checkbox]:checked::after{transform:translateX(16px)}
.range{display:grid;grid-template-columns:72px 1fr 28px;align-items:center;gap:10px;min-height:44px}
.range span{color:var(--fg2);font-size:13px}
.range output{text-align:right;color:var(--fg2);font-size:12px;font-variant-numeric:tabular-nums}
input[type=range]{width:100%;accent-color:var(--acc);height:24px;margin:0;cursor:pointer}
.pill{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--line);font-size:13px}
.pill:hover{background:var(--hover)}
.pill i{width:12px;height:12px;border-radius:50%;background:var(--d)}
.pill:disabled{cursor:default;color:var(--fg2)}
.pill:disabled:hover{background:none}
details{border-radius:12px}
summary{list-style:none;display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 12px;border-radius:12px;color:var(--fg2);cursor:pointer;font-size:13px}
summary::-webkit-details-marker{display:none}
summary:hover{background:var(--hover)}
.keys{display:grid;grid-template-columns:auto 1fr;gap:8px 12px;padding:4px 12px 8px;font-size:12.5px;color:var(--fg2);align-items:center}
kbd{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--fg);background:var(--hover);border:1px solid var(--line);border-radius:6px;padding:2px 6px;white-space:nowrap;justify-self:start}
.foot{padding:4px 12px 0;color:var(--fg2);font-size:12px}
.off .main .grid,.off .main .picker{opacity:.4}
.bubble{padding:8px;border-radius:14px}
.bubble .grid{grid-template-columns:repeat(5,30px);gap:4px}
.bubble .sw{min-height:0;width:30px;height:30px;border-radius:9px}
.bubble .sw b{width:20px;height:20px}
.bubble .sw[aria-pressed="true"] b{box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--c)}
.bubble .sw b svg{display:none}
.bubble::before{content:"";position:absolute;left:0;right:0;top:-10px;height:10px}
`;

  const swatchHTML = (a) => `<button class="sw" data-accent="${a.id}" aria-label="${a.name}" title="${a.name}" style="--c:${a.hex};--on:${luminance(a.hex) > 0.4 ? '#111' : '#fff'}"><b>${svg('check', 16)}</b></button>`;

  function buildUI() {
    uiHost = document.createElement('div');
    uiHost.id = 'chroma-ui';
    Object.assign(uiHost.style, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', zIndex: '2147483647' });
    const root = uiHost.attachShadow({ mode: 'open' });
    const keys = HOTKEYS.map((h) => `<kbd>${keyLabel(h)}</kbd><span>${h.label}</span>`).join('');
    root.innerHTML = `<style>${UI_CSS}</style>
<div class="ui">
  <div class="card panel" role="dialog" aria-label="Chroma" hidden>
    <div class="main">
      <header>
        <span class="chip" id="scope"><i></i><span></span></span>
        <span class="sp"></span>
        <button class="icon" data-act="reset" aria-label="Reset to default color" title="Reset to default">${svg('reset')}</button>
        <button class="icon" data-act="settings" aria-label="Settings" title="Settings">${svg('tune')}</button>
      </header>
      <div class="grid" id="grid">${ACCENTS.map(swatchHTML).join('')}<button class="sw custom" data-act="custom" aria-label="Custom color" title="Custom color" aria-expanded="false"><b>${svg('plus', 16)}</b></button></div>
      <div class="picker" id="picker" hidden>
        <div class="sv" id="sv"><div class="knob"></div></div>
        <div class="hue" id="hue"><div class="knob"></div></div>
        <label class="hexrow"><i></i><input id="hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color"></label>
      </div>
    </div>
    <div class="settings" hidden>
      <header>
        <button class="icon" data-act="back" aria-label="Back">${svg('back', 20)}</button>
        <span class="title">Settings</span><span class="sp"></span>
        <button class="icon" data-act="close" aria-label="Close">${svg('close')}</button>
      </header>
      <div class="list">
        <div class="group">
          <span class="lab">Background</span>
          <div class="seg" id="theme">${THEMES.map((t) => `<button data-theme="${t}">${THEME_NAMES[t]}</button>`).join('')}</div>
        </div>
        <div class="group">
          <label class="row"><span>Glow</span><input type="checkbox" role="switch" id="glow"></label>
          <div class="row range"><span>Size</span><input type="range" min="4" max="90" id="glowSize" aria-label="Glow size"><output id="glowSizeV"></output></div>
          <div class="row range"><span>Strength</span><input type="range" min="10" max="100" id="glowStrength" aria-label="Glow strength"><output id="glowStrengthV"></output></div>
          <label class="row"><span>Breathe</span><input type="checkbox" role="switch" id="glowPulse"></label>
        </div>
        <div class="group">
          <label class="row"><span>Accent links</span><input type="checkbox" role="switch" id="linksFollowAccent"></label>
          <label class="row"><span>Tab icon dot</span><input type="checkbox" role="switch" id="faviconDot"></label>
          <div class="row"><span>Default color</span><button class="pill" data-act="make-default" id="defBtn"><i></i><span></span></button></div>
        </div>
        <div class="group">
          <label class="row"><span>Chroma</span><input type="checkbox" role="switch" id="enabled"></label>
        </div>
        <details><summary>Shortcuts<span>›</span></summary><div class="keys">${keys}</div></details>
        <div class="foot" id="foot"></div>
      </div>
    </div>
  </div>
  <div class="card bubble" role="menu" aria-label="Quick colors" hidden>
    <div class="grid">${ACCENTS.map(swatchHTML).join('')}<button class="sw" data-act="open" aria-label="More options" title="More">${svg('tune', 16)}</button></div>
  </div>
</div>`;
    const $ = (s) => root.querySelector(s);
    U = {
      root, ui: $('.ui'), panel: $('.panel'), main: $('.main'), settings: $('.settings'), bubble: $('.bubble'),
      scope: $('#scope span'), grid: $('#grid'), custom: $('.sw.custom'), picker: $('#picker'),
      sv: $('#sv'), svKnob: $('#sv .knob'), hue: $('#hue'), hueKnob: $('#hue .knob'), hex: $('#hex'),
      theme: $('#theme'), defBtn: $('#defBtn'), foot: $('#foot'), reset: $('[data-act="reset"]'),
    };

    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const inBubble = U.bubble.contains(b);
      if (b.dataset.accent) {
        setAccent(b.dataset.accent);
        if (inBubble) showBubble(false);
        return;
      }
      if (b.dataset.theme) { save({ theme: b.dataset.theme }); return; }
      switch (b.dataset.act) {
        case 'custom': pickerOpen = !pickerOpen; if (pickerOpen) pk = hexToHsv(currentAccent().hex); syncPanel(); break;
        case 'settings': setView('settings'); break;
        case 'back': setView('main'); break;
        case 'close': togglePanel(false); break;
        case 'reset': resetTab(); break;
        case 'make-default': makeDefault(); break;
        case 'open': showBubble(false); togglePanel(true); break;
      }
    });
    for (const id of ['glow', 'glowPulse', 'linksFollowAccent', 'faviconDot', 'enabled']) {
      root.getElementById(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
    }
    for (const id of ['glowSize', 'glowStrength']) {
      root.getElementById(id).addEventListener('input', (e) => save({ [id]: +e.target.value }));
    }
    // Custom picker: drag on the saturation/brightness square and the hue bar.
    const drag = (el, onMove) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = true;
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
          applyPicker();
        };
        const up = () => { dragging = false; el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        move(e);
      });
    };
    drag(U.sv, (x, y) => { pk.s = x; pk.v = 1 - y; });
    drag(U.hue, (x) => { pk.h = x * 360; });
    U.hex.addEventListener('change', () => {
      const v = U.hex.value.trim().replace(/^#?/, '#');
      if (/^#[0-9a-f]{6}$/i.test(v)) { pk = hexToHsv(v); setAccent(v.toLowerCase()); }
      else syncPanel();
    });
    U.hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') U.hex.blur(); });
    // Bubble stays open while the pointer is over it.
    U.bubble.addEventListener('mouseenter', () => clearTimeout(bubbleTimer));
    U.bubble.addEventListener('mouseleave', () => bubbleSoon(false));
    // Keep the site's global key handlers (type-to-focus composer etc.) out of the UI.
    uiHost.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (view === 'settings') setView('main'); else togglePanel(false); }
      e.stopPropagation();
    });
    document.body.appendChild(uiHost);
  }

  function applyPicker() {
    const hex = hsvToHex(pk);
    if (hex !== currentAccent().hex.toLowerCase()) setAccent(hex);
    else syncPanel();
  }

  // Panel and bubble hang below the launcher, right-aligned to it.
  function positionCard(card) {
    const r = launcher && launcher.isConnected && launcher.getClientRects().length
      ? launcher.getBoundingClientRect() : { bottom: 44, right: innerWidth - 10 };
    const top = Math.round(r.bottom + 8);
    card.style.top = `${top}px`;
    card.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 2))}px`;
    if (card === U.panel) card.style.maxHeight = `${Math.max(200, innerHeight - top - 12)}px`;
  }

  function setView(v) {
    view = v;
    U.main.hidden = v !== 'main';
    U.settings.hidden = v !== 'settings';
    U.panel.scrollTop = 0;
    syncPanel();
  }

  function togglePanel(force) {
    if (!document.body) return;
    if (!uiHost) buildUI();
    if (!uiHost.isConnected) document.body.appendChild(uiHost);
    const open = force ?? !panelOpen();
    if (open) {
      showBubble(false);
      positionCard(U.panel);
      U.panel.hidden = false;
      setView('main');
    } else {
      U.panel.hidden = true;
      pickerOpen = false;
    }
  }

  function bubbleSoon(show) {
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => showBubble(show), show ? 120 : 260);
  }
  function showBubble(show) {
    clearTimeout(bubbleTimer);
    if (!show) { if (U) U.bubble.hidden = true; return; }
    if (!document.body || panelOpen()) return;
    if (!uiHost) buildUI();
    if (!uiHost.isConnected) document.body.appendChild(uiHost);
    positionCard(U.bubble);
    U.bubble.hidden = false;
    syncPanel();
  }

  function syncPanel() {
    if (!U) return;
    const acc = currentAccent();
    const hex = acc.hex.toLowerCase();
    const isPreset = ACCENTS.some((a) => a.id === acc.id);
    U.ui.style.setProperty('--acc', acc.hex);
    U.ui.classList.toggle('off', !S.enabled);
    U.root.querySelectorAll('.sw[data-accent]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accent === acc.id)));
    if (U.panel.hidden) return;
    const scope = accentScope();
    U.scope.textContent = scope === 'this chat' ? 'This chat' : scope === 'this tab' ? 'This tab' : 'Default';
    U.reset.disabled = scope === 'default';
    // Custom tile shows the custom color once one is in use.
    if (isPreset) { U.custom.removeAttribute('data-active'); U.custom.style.removeProperty('--c'); }
    else { U.custom.setAttribute('data-active', ''); U.custom.style.setProperty('--c', acc.hex); }
    U.custom.setAttribute('aria-pressed', String(!isPreset));
    U.custom.setAttribute('aria-expanded', String(pickerOpen));
    U.picker.hidden = !pickerOpen;
    if (pickerOpen) {
      if (!dragging && hsvToHex(pk) !== hex) pk = hexToHsv(hex);
      U.sv.style.setProperty('--h', pk.h.toFixed(1));
      U.svKnob.style.left = `${pk.s * 100}%`;
      U.svKnob.style.top = `${(1 - pk.v) * 100}%`;
      U.svKnob.style.setProperty('--k', hex);
      U.hueKnob.style.left = `${(pk.h / 360) * 100}%`;
      U.hueKnob.style.setProperty('--k', `hsl(${pk.h.toFixed(1)} 100% 50%)`);
      if (U.root.activeElement !== U.hex) U.hex.value = hex.toUpperCase();
    }
    if (view === 'settings') {
      U.theme.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === S.theme)));
      for (const id of ['glow', 'glowPulse', 'linksFollowAccent', 'faviconDot', 'enabled']) U.root.getElementById(id).checked = !!S[id];
      for (const id of ['glowSize', 'glowStrength']) {
        U.root.getElementById(id).value = S[id];
        U.root.getElementById(id + 'V').textContent = S[id];
      }
      const def = defaultAccent();
      const same = def.id === acc.id;
      U.defBtn.style.setProperty('--d', same ? def.hex : acc.hex);
      U.defBtn.querySelector('span').textContent = same ? def.name : 'Make default';
      U.defBtn.disabled = same;
      const n = Object.keys(chats).length;
      U.foot.textContent = `${n} chat color${n === 1 ? '' : 's'} synced`;
    }
  }

  // Close on outside click / tap; keep the panel under the launcher on resize.
  document.addEventListener('pointerdown', (e) => {
    if (!panelOpen()) return;
    const path = e.composedPath();
    if (path.includes(uiHost) || path.includes(launcher)) return;
    togglePanel(false);
  }, true);
  window.addEventListener('resize', () => {
    if (panelOpen()) positionCard(U.panel);
    if (U && !U.bubble.hidden) positionCard(U.bubble);
  });

  // ---------- boot ----------
  render(); // instant paint from localStorage cache

  safe(() => {
    chrome.storage.sync.get(null, (all) => {
      all = all || {};
      S = withDefaults(all.chroma);
      writeCache();
      if (!all.chroma || all.chroma.v !== S.v) safe(() => chrome.storage.sync.set({ chroma: S })); // persist migration
      shards = {};
      for (const [k, v] of Object.entries(all)) if (/^chats_[0-9a-f]$/.test(k)) shards[k] = v || {};
      mergeShards();
      markSeen(chatKey());
      render();
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync') return;
      let shardChanged = false;
      for (const [k, c] of Object.entries(ch)) {
        if (!/^chats_[0-9a-f]$/.test(k)) continue;
        shardChanged = true;
        if (c.newValue) shards[k] = c.newValue; else delete shards[k];
      }
      if (shardChanged) mergeShards();
      if (ch.chroma) { S = withDefaults(ch.chroma.newValue); writeCache(); }
      if (shardChanged || ch.chroma) render();
    });
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === 'chroma:toggle-panel') togglePanel();
    });
  });

  const onReady = () => { render(); detectFormat(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
  window.addEventListener('load', () => { detectFormat(); setTimeout(detectFormat, 2000); }, { once: true });

  // Re-attach nodes if the app re-renders <head>/<body>, and re-badge new favicons.
  // Only <head> is watched, so chat streaming in <body> costs nothing.
  const headObs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (isIconLink(n)) { scheduleFavicon(); return; }
  });
  const watchHead = () => {
    if (!document.head) return false;
    headObs.observe(document.head, { childList: true });
    return true;
  };
  if (!watchHead()) {
    const waitHead = new MutationObserver(() => { if (watchHead()) { waitHead.disconnect(); render(); } });
    waitHead.observe(document, { childList: true, subtree: true }); // tiny DOM at this point
  }
  setInterval(() => { ensureNodes(); updateGlow(); }, 2000);

  // claude.ai is a single-page app: route changes don't reload the page. The
  // Navigation API reports pushState/replaceState; the poll covers browsers without it.
  safe(() => window.navigation.addEventListener('currententrychange', () => setTimeout(onNavigate, 0)));
  window.addEventListener('popstate', onNavigate);
  setInterval(() => { onNavigate(); placeLauncher(); }, 700); // also re-seats the launcher after React re-renders
})();
