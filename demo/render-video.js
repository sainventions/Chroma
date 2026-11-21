// Renders demo/chroma-demo.html to demo/chroma-demo.mp4, frame by frame.
//   node demo/render-video.js            (60 fps, 1920x1080)
//   FPS=30 node demo/render-video.js
// Needs Google Chrome and ffmpeg on PATH (or set CHROME / FFMPEG).
// Talks to headless Chrome over --remote-debugging-pipe (no network port): for each
// frame it calls window.seek(t) and pipes a screenshot into ffmpeg, so the output is
// frame-exact no matter how slow the machine is.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FPS = Number(process.env.FPS) || 60;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = path.join(__dirname, 'chroma-demo.mp4');
const PAGE = 'file:///' + path.join(__dirname, 'chroma-demo.html').replace(/\\/g, '/') + '#export';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chroma-render-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1', '--window-size=1920,1080',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];

// CDP over the pipe: NUL-terminated JSON messages.
let nextId = 0;
const pending = new Map();
let chunks = [];
fromChrome.on('data', (d) => {
  let start = 0, nul;
  while ((nul = d.indexOf(0, start)) !== -1) {
    chunks.push(d.subarray(start, nul));
    const msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    chunks = [];
    start = nul + 1;
    const p = msg.id && pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
  }
  if (start < d.length) chunks.push(d.subarray(start));
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  toChrome.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
});

(async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url: PAGE });
  const evaluate = async (expression) => (await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  for (let i = 0; i < 100 && !(await evaluate('typeof window.seek === "function"')); i++) await new Promise((r) => setTimeout(r, 100));
  await evaluate('document.fonts.ready.then(() => true)');
  const duration = await evaluate('window.DURATION');
  const frames = Math.round(duration * FPS);

  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((r) => ff.on('close', r));

  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await evaluate(`seek(${(f / FPS).toFixed(5)})`);
    const { data } = await S('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
    if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % FPS === 0) process.stdout.write(`\r${f}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  const code = await ffDone;
  process.stdout.write(`\r${frames}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  toChrome.write(JSON.stringify({ id: ++nextId, method: 'Browser.close' }) + '\0');
  setTimeout(() => { try { chrome.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code ? 1 : 0); }, 500);
  console.log(code ? `ffmpeg failed (${code})` : `wrote ${OUT}`);
})().catch((e) => { console.error(e); try { chrome.kill(); } catch {} process.exit(1); });
