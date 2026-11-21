// Logic test for content.js, run with: node dev/test-content.js
// Runs the real content script against a stubbed DOM / chrome.* and checks the
// per-chat color rules, settings migration and the generated CSS. No browser needed.
// Pass --css to also print the CSS that buildCSS() produces.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'content.js');
// Expose internals: the IIFE keeps everything private, so splice a hook in just
// before the boot render.
const HOOK = 'render(); // instant paint';
const raw = fs.readFileSync(SRC, 'utf8');
assert(raw.includes(HOOK), `content.js no longer contains "${HOOK}"; update the hook in dev/test-content.js`);
const src = raw.replace(HOOK, 'globalThis.__t = { buildCSS, setAccent, onNavigate, resetTab, makeDefault, chats: () => chats, currentAccent, glowVisible, accentScope, chatKey, S: () => S, setS: (x) => { S = { ...S, ...x }; } };\n  ' + HOOK);

// ---- stubs ----
const noop = () => {};
const node = () => new Proxy(function () {}, {
  get: (t, k) => (k === 'style' || k === 'dataset' ? {} : k === 'isConnected' ? true : k === 'textContent' ? '' : k === Symbol.toPrimitive ? () => '' : node()),
  apply: () => node(),
  set: () => true,
});
const mkStorage = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
const today = Math.floor(Date.now() / 864e5);
const sent = [];
const synced = {
  chroma: { v: 2, theme: 'darker', defaultAccent: 'purple', glow: true, glowSize: 8, glowStrength: 35, glowPulse: true }, // a 1.2.0-era save
  chats_3: { cdeadbeefdeadbeefdeadbeefdeadbeef: ['teal', today - 3] },
};
const stubs = {
  window: { addEventListener: noop, navigation: { addEventListener: noop } },
  document: {
    createElement: () => node(), head: node(), body: node(), documentElement: node(), readyState: 'complete',
    addEventListener: noop, querySelectorAll: () => [], querySelector: () => null, styleSheets: [],
  },
  navigator: { platform: 'Win32' },
  location: { pathname: '/new', href: 'https://claude.ai/new', origin: 'https://claude.ai' },
  localStorage: mkStorage(),
  sessionStorage: mkStorage(),
  getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--bg-100' ? '0 0% 0%' : n === '--cds-surface-1' ? '#191919' : '') }),
  MutationObserver: class { observe() {} disconnect() {} },
  Image: class {},
  innerWidth: 1600, innerHeight: 900,
  matchMedia: () => ({ matches: true }),
  chrome: {
    storage: { sync: { get: (k, cb) => cb(synced), set: noop }, onChanged: { addListener: noop } },
    runtime: { sendMessage: (m) => { sent.push(m); return Promise.resolve(); }, onMessage: { addListener: noop } },
  },
};
// defineProperty, not assignment: Node 21+ ships a read-only global `navigator`.
for (const [k, v] of Object.entries(stubs)) Object.defineProperty(global, k, { value: v, writable: true, configurable: true });
const realSetInterval = global.setInterval;
global.setInterval = () => 0; // the script's polling loops aren't needed here
eval(src);
global.setInterval = realSetInterval;

const t = globalThis.__t;
const go = (p) => { location.pathname = p; t.onNavigate(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { await wait(450); return sent.splice(0); }; // chat writes are debounced 400 ms
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok  ', name); };

(async () => {
  check('old settings migrate to v4 (glow 20/50, breathe off, default Claude orange) and keep the chosen background', () => {
    const S = t.S();
    assert.strictEqual(S.v, 4);
    assert.strictEqual(S.theme, 'darker');
    assert.strictEqual(S.defaultAccent, 'claude');
    assert.deepStrictEqual([S.glow, S.glowSize, S.glowStrength, S.glowPulse], [true, 20, 50, false]);
  });

  check('an unassigned session is Claude orange and does not glow (glow setting on)', () => {
    assert.strictEqual(t.accentScope(), 'default');
    assert.strictEqual(t.currentAccent().id, 'claude');
    assert.strictEqual(t.glowVisible(), false);
  });
  t.setS({ glow: false });

  t.setAccent('purple');
  check('picking a color on /new sets the tab color and turns glow on', () => {
    assert.strictEqual(t.currentAccent().id, 'purple');
    assert.strictEqual(t.accentScope(), 'this tab');
    assert.strictEqual(t.S().glow, true);
    assert.strictEqual(t.glowVisible(), true);
  });
  t.setAccent('claude');
  check('Claude orange never glows, even when assigned', () => {
    assert.strictEqual(t.accentScope(), 'this tab');
    assert.strictEqual(t.glowVisible(), false);
  });
  t.setAccent('purple');

  go('/chat/11111111-2222-3333-4444-555555555555');
  check('a chat started from a colored tab inherits and saves that color', () => assert.strictEqual(t.accentScope(), 'this chat'));
  let msgs = await flush();
  check('...and asks the background worker to store it', () => assert.deepStrictEqual(msgs, [{ type: 'chroma:chat-set', key: 'c11111111222233334444555555555555', accent: 'purple' }]));

  go('/chat/deadbeef-dead-beef-dead-beefdeadbeef');
  check('opening a chat with a synced color shows that color', () => assert.strictEqual(t.currentAccent().id, 'teal'));
  check('...and stamps it as seen today (once)', () => assert.deepStrictEqual(sent.splice(0), [{ type: 'chroma:chat-seen', key: 'cdeadbeefdeadbeefdeadbeefdeadbeef' }]));

  go('/recents'); go('/chat/99999999-2222-3333-4444-555555555555');
  check('an old chat opened from elsewhere is not auto-colored', () => {
    assert.strictEqual(t.accentScope(), 'this tab');
    assert.strictEqual(t.chats().c99999999222233334444555555555555, undefined);
  });

  t.setAccent('#123abc'); t.setAccent('red'); t.setAccent('blue');
  msgs = await flush();
  check('rapid color changes produce one debounced write', () => assert.deepStrictEqual(msgs, [{ type: 'chroma:chat-set', key: 'c99999999222233334444555555555555', accent: 'blue' }]));

  t.resetTab();
  msgs = await flush();
  check('reset clears the chat color and the tab color', () => {
    assert.strictEqual(t.accentScope(), 'default');
    assert.deepStrictEqual(msgs, [{ type: 'chroma:chat-set', key: 'c99999999222233334444555555555555', accent: null }]);
  });

  check('chat keys: type letter + id without dashes', () => {
    assert.strictEqual(t.chatKey('/chat/4997a3f1-36be-4638-bff7-6813207d2397'), 'c4997a3f136be4638bff76813207d2397');
    assert.strictEqual(t.chatKey('/project/0198c0de-aaaa-bbbb-cccc-1234567890ab'), 'p0198c0deaaaabbbbcccc1234567890ab');
    assert.strictEqual(t.chatKey('/new'), null);
    assert.strictEqual(t.chatKey('/cowork/settings'), null);
  });

  go('/new'); t.setAccent('emerald'); t.setS({ theme: 'amoled' });
  const css = t.buildCSS();
  check('CSS overrides the design-system tokens', () => {
    for (const tok of ['--cds-fill-brand:#10B981', '--cds-fill-accent:#10B981', '--cds-clay:#10B981', '--cds-surface-1:#000000', '--cds-surface-popover:#121212']) {
      assert(css.includes(tok), `missing ${tok}`);
    }
    assert(css.startsWith(':root,.cds-root,'), 'override selector must include .cds-root (claude.ai nests token roots)');
  });

  if (process.argv.includes('--css')) console.log('\n' + css);
  console.log(`\n${passed} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('\nFAIL:', e.message); process.exit(1); });
