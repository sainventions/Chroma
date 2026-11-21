// Chroma background worker.
// Owns every write to the per-chat color store so that tabs never race each
// other on the same storage item, and prunes chats that have not been seen
// for TTL_DAYS.
//
// Storage layout (chrome.storage.sync, shared across browsers by Chrome/Brave Sync):
//   chroma          -> global settings object (written by content.js)
//   chats_0..chats_f -> { <chatKey>: [accent, lastSeenDay] }
//      accent      = preset id ("purple") or "#rrggbb"
//      lastSeenDay = whole days since the Unix epoch (small and sync friendly)
// Chats are spread over 16 items because sync caps a single item at 8 KB.

const SHARDS = 16;
const TTL_DAYS = 30;
const ITEM_BUDGET = 7600; // bytes per item, under the 8192 QUOTA_BYTES_PER_ITEM
const PRUNE_ALARM = 'chroma-prune';

const today = () => Math.floor(Date.now() / 864e5);
const isShard = (k) => /^chats_[0-9a-f]$/.test(k);
const itemBytes = (k, v) => k.length + JSON.stringify(v).length;

function shardOf(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 'chats_' + (h % SHARDS).toString(16);
}

// Serialize all storage work in this worker.
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch((e) => console.warn('[Chroma]', e)));

// Drop the oldest entries of one shard until it fits the per-item budget.
function trimShard(name, map) {
  if (itemBytes(name, map) <= ITEM_BUDGET) return map;
  const entries = Object.entries(map).sort((a, b) => b[1][1] - a[1][1]); // newest first
  const out = {};
  for (const [k, v] of entries) {
    out[k] = v;
    if (itemBytes(name, out) > ITEM_BUDGET) { delete out[k]; break; }
  }
  return out;
}

async function writeShard(name, map) {
  map = trimShard(name, map);
  try {
    if (Object.keys(map).length) await chrome.storage.sync.set({ [name]: map });
    else await chrome.storage.sync.remove(name);
  } catch (e) {
    // Total sync quota (~100 KB) hit: evict the oldest 20% everywhere, then retry once.
    if (!/QUOTA/i.test(String(e && e.message))) throw e;
    await prune(0.2);
    if (Object.keys(map).length) await chrome.storage.sync.set({ [name]: map });
  }
}

async function setChat(key, accent) {
  const name = shardOf(key);
  const map = (await chrome.storage.sync.get(name))[name] || {};
  if (accent) map[key] = [accent, today()];
  else delete map[key];
  await writeShard(name, map);
}

async function touchChat(key) {
  const name = shardOf(key);
  const map = (await chrome.storage.sync.get(name))[name] || {};
  const e = map[key];
  if (!e || e[1] >= today()) return; // unknown chat, or already stamped today
  e[1] = today();
  await writeShard(name, map);
}

// Remove chats not seen for TTL_DAYS. With evictFraction > 0, also drop that
// share of the oldest remaining chats (used when the sync quota is full).
async function prune(evictFraction = 0) {
  const all = await chrome.storage.sync.get(null);
  const cutoff = today() - TTL_DAYS;
  const shards = {};
  const live = [];
  for (const [name, map] of Object.entries(all)) {
    if (!isShard(name)) continue;
    shards[name] = {};
    for (const [k, e] of Object.entries(map || {})) {
      if (Array.isArray(e) && typeof e[1] === 'number' && e[1] >= cutoff) {
        shards[name][k] = e;
        live.push([name, k, e[1]]);
      }
    }
  }
  if (evictFraction > 0 && live.length) {
    live.sort((a, b) => a[2] - b[2]);
    for (const [name, k] of live.slice(0, Math.ceil(live.length * evictFraction))) delete shards[name][k];
  }
  const set = {}, remove = [];
  for (const [name, map] of Object.entries(shards)) {
    const empty = !Object.keys(map).length;
    if (!empty && JSON.stringify(map) === JSON.stringify(all[name])) continue;
    if (!empty) set[name] = map;
    else remove.push(name);
  }
  if (remove.length) await chrome.storage.sync.remove(remove);
  if (Object.keys(set).length) await chrome.storage.sync.set(set);
}

function schedulePrune() {
  chrome.alarms.get(PRUNE_ALARM, (a) => {
    if (!a) chrome.alarms.create(PRUNE_ALARM, { delayInMinutes: 1, periodInMinutes: 720 });
  });
}

chrome.runtime.onInstalled.addListener(() => { schedulePrune(); run(() => prune()); });
chrome.runtime.onStartup.addListener(() => { schedulePrune(); run(() => prune()); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === PRUNE_ALARM) run(() => prune()); });

chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === 'chroma:reload') { chrome.runtime.reload(); return; } // picks up edited files (unpacked install)
  if (!m || typeof m.key !== 'string' || m.key.length > 120) return;
  if (m.type === 'chroma:chat-set') run(() => setChat(m.key, typeof m.accent === 'string' ? m.accent : null));
  else if (m.type === 'chroma:chat-seen') run(() => touchChat(m.key));
});

// Toolbar icon: toggle the on-page panel; if the tab isn't claude.ai, open it.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'chroma:toggle-panel' });
  } catch {
    chrome.tabs.create({ url: 'https://claude.ai/new' });
  }
});
