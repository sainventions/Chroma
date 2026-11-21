// Renders demo/chroma-demo.html to demo/chroma-demo.mp4 with Playwright, frame by frame.
//   cd demo && npm install && npm run render       (60 fps, 1920x1080)
//   FPS=30 npm run render
// Uses the installed Google Chrome through playwright-core (no browser download) and
// ffmpeg on PATH (or set FFMPEG). For each frame it calls window.seek(t) and pipes a
// screenshot into ffmpeg, so the output is frame-exact however slow the machine is
// (Playwright's built-in recordVideo captures in real time and drops frames).
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const FPS = Number(process.env.FPS) || 60;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = path.join(__dirname, 'chroma-demo.mp4');
const PAGE = pathToFileURL(path.join(__dirname, 'chroma-demo.html')).href + '#export';

(async () => {
  const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.seek === 'function');
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.DURATION);
    const frames = Math.round(duration * FPS);

    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffDone = new Promise((resolve) => ff.on('close', resolve));

    const t0 = Date.now();
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.seek(t), f / FPS);
      const jpg = await page.screenshot({ type: 'jpeg', quality: 95, scale: 'css', caret: 'initial' });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % FPS === 0) process.stdout.write(`\r${f}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    const code = await ffDone;
    process.stdout.write(`\r${frames}/${frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    if (code) throw new Error(`ffmpeg exited with ${code}`);
    console.log(`wrote ${OUT}`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
