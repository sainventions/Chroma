// Logic test for background.js, run with: node dev/test-background.js
// Runs the real worker against an in-memory chrome.storage.sync (with the real
// ~100 KB quota) and checks chat writes, the 30-day prune and quota eviction.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let db = {};
const listeners = {};
const ev = (n) => ({ addListener: (f) => { listeners[n] = f; } });
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
global.chrome = {
  storage: { sync: {
    get: async (k) => (k === null ? clone(db) : { [k]: clone(db[k]) }),
    set: async (o) => {
      if (JSON.stringify({ ...db, ...o }).length > 102400) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(db, clone(o));
    },
    remove: async (ks) => { [].concat(ks).forEach((k) => delete db[k]); },
  } },
  alarms: { get: (n, cb) => cb(null), create: () => {}, onAlarm: ev('alarm') },
  runtime: { onInstalled: ev('installed'), onStartup: ev('startup'), onMessage: ev('msg'), reload: () => {} },
  action: { onClicked: ev('click') },
  tabs: {},
};
// Indirect eval runs the worker as a global script, so its functions (shardOf...) are reachable here.
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8') + ';globalThis.__q = () => queue;');

const day = Math.floor(Date.now() / 864e5);
const settle = async () => { for (let i = 0; i < 5; i++) await globalThis.__q(); };
const allChats = () => Object.assign({}, ...Object.keys(db).filter((k) => k.startsWith('chats_')).map((k) => db[k]));
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok  ', name); };

(async () => {
  db = { chroma: { theme: 'amoled' }, chats_0: {} };
  db[shardOf('cfresh')] = { ...(db[shardOf('cfresh')] || {}), cfresh: ['teal', day - 2] };
  db[shardOf('cstale')] = { ...(db[shardOf('cstale')] || {}), cstale: ['red', day - 31] };
  listeners.installed(); await settle();
  check('prune drops chats unseen for 30+ days and keeps the rest', () => assert.deepStrictEqual(Object.keys(allChats()), ['cfresh']));
  check('prune removes empty shards', () => assert(!db.chats_0 || Object.keys(db.chats_0).length > 0));

  listeners.msg({ type: 'chroma:chat-set', key: 'cnew', accent: 'purple' });
  listeners.msg({ type: 'chroma:chat-seen', key: 'cfresh' });
  await settle();
  check('chat-set stores [accent, today]', () => assert.deepStrictEqual(db[shardOf('cnew')].cnew, ['purple', day]));
  check('chat-seen refreshes the date', () => assert.strictEqual(db[shardOf('cfresh')].cfresh[1], day));

  listeners.msg({ type: 'chroma:chat-set', key: 'cnew', accent: null }); await settle();
  check('chat-set with null deletes', () => assert(!(db[shardOf('cnew')] || {}).cnew));

  for (let i = 0; i < 3000; i++) listeners.msg({ type: 'chroma:chat-set', key: 'c' + i.toString(16).padStart(32, '0'), accent: '#a1b2c3' });
  await settle();
  const shardBytes = Object.entries(db).filter(([k]) => k.startsWith('chats_')).map(([k, v]) => k.length + JSON.stringify(v).length);
  check('3000 chats: every shard stays under the 8 KB item limit', () => assert(Math.max(...shardBytes) <= 8192));
  check('3000 chats: total stays under the ~100 KB sync quota', () => assert(JSON.stringify(db).length <= 102400));
  check('3000 chats: settings survive eviction', () => assert.strictEqual(db.chroma.theme, 'amoled'));
  console.log(`\n${passed} checks passed (${Object.keys(allChats()).length} chats kept)`);
})().catch((e) => { console.error('\nFAIL:', e.message); process.exit(1); });
