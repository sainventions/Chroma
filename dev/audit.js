// Chroma audit: paste into DevTools > Console on a claude.ai tab (dark mode, Chroma
// enabled, ideally on a chat page). Read-only; it changes nothing.
//
// It answers the questions you have after a claude.ai UI update:
//   1. Which tokens does Chroma override that claude.ai no longer defines? (dead overrides)
//   2. Which color tokens does claude.ai define now, and with what values?
//   3. Which new-looking accent/surface tokens does Chroma NOT override yet?
//   4. Which elements re-declare the tokens (nested theme roots Chroma must also target)?
//   5. Is the site's CSS inside @layer (decides whether Chroma's plain rules win)?
//   6. Where did the top-bar launcher land, and what buttons are in the top bar?
//   7. What do chat/project URLs look like (CHAT_ROUTE in content.js)?
(() => {
  const chromaEl = document.getElementById('chroma-style');
  const chromaCSS = chromaEl ? chromaEl.textContent : '';
  if (!chromaEl) console.warn('[audit] #chroma-style not found: Chroma is not running on this page (or is disabled).');

  // Walk every same-origin stylesheet except Chroma's own.
  const defined = new Map(); // token -> Set(selector)
  let layered = 0, unlayered = 0;
  const walk = (rules, inLayer) => {
    for (const r of rules) {
      const isLayer = r.constructor && r.constructor.name === 'CSSLayerBlockRule';
      if (r.cssRules) walk(r.cssRules, inLayer || isLayer);
      if (!r.style) continue;
      if (inLayer) layered++; else unlayered++;
      for (const p of r.style) {
        if (!p.startsWith('--')) continue;
        if (!defined.has(p)) defined.set(p, new Set());
        defined.get(p).add((r.selectorText || '@' + r.constructor.name).slice(0, 90));
      }
    }
  };
  for (const sh of document.styleSheets) {
    if (sh.ownerNode === chromaEl) continue;
    try { walk(sh.cssRules, false); } catch { /* cross-origin sheet */ }
  }

  // 1. Dead overrides.
  const overridden = [...new Set([...chromaCSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))];
  const dead = overridden.filter((t) => !defined.has(t));
  console.group(`[audit] 1. Chroma overrides ${overridden.length} tokens; ${dead.length} are no longer defined by claude.ai`);
  if (dead.length) console.log(dead.join('\n')); else console.log('none: every override still hits a real token');
  console.groupEnd();

  // 2. Current color tokens on <body>, grouped.
  const cs = getComputedStyle(document.body);
  const groups = {
    surfaces: /^--cds-(surface|ground|neutral-\d|gray-(8|9)\d\d)/,
    text: /^--cds-text-(primary|secondary|muted|accent)/,
    accent: /^--cds-(fill-(accent|brand)|role-accent|text-accent|bg-accent|border-accent|on-accent|focus-shadow|composer-ring|chat-composer-link)/,
    brand_logo: /^--(cds-clay|cds-hsl-clay|_brand-clay|brand-|accent-brand)/,
    legacy: /^--(bg|text|border|accent|oncolor)-\d00$/,
  };
  console.group('[audit] 2. claude.ai color tokens now (computed on <body>; * = Chroma overrides it)');
  for (const [name, re] of Object.entries(groups)) {
    const rows = {};
    [...defined.keys()].filter((t) => re.test(t)).sort().forEach((t) => {
      rows[(overridden.includes(t) ? '* ' : '  ') + t] = cs.getPropertyValue(t).trim().slice(0, 60);
    });
    console.groupCollapsed(`${name} (${Object.keys(rows).length})`);
    console.table(rows);
    console.groupEnd();
  }
  console.groupEnd();

  // 3. Likely candidates Chroma doesn't touch yet.
  const candidates = [...defined.keys()].filter((t) =>
    /^--cds-.*(surface|brand|accent|clay|primary-fill|sidebar|popover|panel)/.test(t)
    && !/tint|danger|warning|success|pro|git|editor|banner|--mix|radius|size|space|font/.test(t)
    && !overridden.includes(t));
  console.group(`[audit] 3. ${candidates.length} accent/surface-looking tokens Chroma does not override`);
  console.table(Object.fromEntries(candidates.sort().map((t) => [t, cs.getPropertyValue(t).trim().slice(0, 60)])));
  console.groupEnd();

  // 4. Where surface-1 / fill-brand get (re)declared.
  console.group('[audit] 4. Selectors that declare key tokens (Chroma\'s override selector must cover the element types here)');
  for (const t of ['--cds-surface-1', '--cds-fill-brand', '--cds-text-primary']) {
    console.log(t, [...(defined.get(t) || ['NOT DEFINED'])]);
  }
  const roots = document.querySelectorAll('.cds-root,[data-mode],[data-theme],[data-cds-theme]');
  console.log(`${roots.length} elements carry .cds-root / data-mode / data-theme / data-cds-theme.`,
    'html:', [...document.documentElement.attributes].map((a) => `${a.name}="${a.value.slice(0, 40)}"`).join(' '));
  console.groupEnd();

  // 5. Cascade layers.
  console.log(`[audit] 5. Site rules inside @layer: ${layered}, outside: ${unlayered}.`,
    'Chroma\'s non-!important rules (e.g. html,body background) only win over layered site rules.');

  // 6. Top bar and launcher.
  const topBtns = [...document.querySelectorAll('button')]
    .map((b) => [b, b.getBoundingClientRect()])
    .filter(([, r]) => r.height > 0 && r.top <= 30 && r.bottom <= 56)
    .sort((a, b) => a[1].left - b[1].left)
    .map(([b, r]) => ({ x: Math.round(r.left), w: Math.round(r.width), aria: b.getAttribute('aria-label'), testid: b.dataset.testid || '', chroma: b.id === 'chroma-launcher' }));
  console.group('[audit] 6. Buttons in the top bar (left to right). The launcher attaches after the rightmost one past 60% width.');
  console.table(topBtns);
  const l = document.getElementById('chroma-launcher');
  console.log('launcher:', l ? (l.style.position === 'fixed' ? 'FLOATING fallback (no top-bar anchor found)' : `after [${l.previousElementSibling?.getAttribute('aria-label') || l.previousElementSibling?.tagName}]`) : 'not present');
  console.groupEnd();

  // 7. Route shapes.
  const shapes = new Set([...document.querySelectorAll('a[href^="/"]')].map((a) => {
    const parts = a.getAttribute('href').split(/[?#]/)[0].split('/');
    return parts.length > 2 ? `/${parts[1]}/<${parts[2].length} chars>` : `/${parts[1]}`;
  }));
  console.log('[audit] 7. Link shapes on this page:', [...shapes].join('  '), '| current:', location.pathname.replace(/[0-9a-f-]{36}/, '<uuid>'));
})();
