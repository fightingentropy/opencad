#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromePath = [
  process.env.CHROME_PATH,
  DEFAULT_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => candidate && existsSync(candidate));
const url = process.env.VISUAL_URL || process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = resolve(process.env.VISUAL_OUT_DIR || 'visual-artifacts');
const width = Number(process.env.VISUAL_WIDTH || 1440);
const height = Number(process.env.VISUAL_HEIGHT || 1000);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForDevtoolsUrl(proc, profileDir) {
  let buffer = '';
  let failure;
  proc.stderr.on('data', (chunk) => { buffer = (buffer + chunk.toString()).slice(-20000); });
  proc.once('error', (error) => { failure = error; });
  proc.once('exit', (code, signal) => {
    failure = new Error(`Chrome exited before DevTools was ready (code ${code ?? signal ?? 'unknown'}).`);
  });
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const logged = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (logged) return logged[1];
      // Chrome can publish its endpoint before (or without) the stderr banner.
      try {
        const [port, browserPath] = (await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535 && browserPath?.startsWith('/devtools/browser/')) {
          return `ws://127.0.0.1:${port}${browserPath}`;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await sleep(100);
    }
    throw new Error('Chrome did not expose a DevTools websocket within 30 seconds.');
  } catch (error) {
    throw new Error(`${error.message}\nChrome startup output:\n${buffer || '(no output)'}`, { cause: error });
  } finally {
    await writeFile(join(outDir, 'chrome-startup.log'), buffer || '(no startup output)\n');
  }
}

async function openPageTarget(browserWsUrl) {
  const browserUrl = new URL(browserWsUrl);
  const targetUrl = `http://${browserUrl.host}/json/new?${encodeURIComponent(url)}`;
  const response = await fetch(targetUrl, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`Could not create Chrome target: ${response.status} ${response.statusText}`);
  }
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error('Chrome target did not return a page websocket URL.');
  return target.webSocketDebuggerUrl;
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = new Map();
  let nextId = 1;

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result ?? {});
      return;
    }
    const listeners = events.get(message.method);
    if (listeners) {
      for (const listener of listeners) listener(message.params ?? {});
    }
  });

  const opened = new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('Could not connect to Chrome DevTools.')), { once: true });
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
      });
    },
    on(method, listener) {
      const listeners = events.get(method) ?? [];
      listeners.push(listener);
      events.set(method, listeners);
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
  }
  return result.result?.value;
}

async function waitForCanvas(client) {
  const deadline = Date.now() + 15000;
  let latest;
  while (Date.now() < deadline) {
    latest = await evaluate(client, `new Promise(resolve => requestAnimationFrame(() => {
      const canvas = document.querySelector('.site-render-surface canvas');
      const bodyText = document.body?.innerText || '';
      if (!canvas) return resolve({ ready: false, reason: '3D renderer not mounted', bodyText: bodyText.slice(0, 160) });
      const rect = canvas.getBoundingClientRect();
      let pixelSignal = null;
      try {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          const pixels = new Uint8Array(4);
          gl.readPixels(
            Math.max(0, Math.floor(gl.drawingBufferWidth / 2)),
            Math.max(0, Math.floor(gl.drawingBufferHeight / 2)),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels
          );
          pixelSignal = Array.from(pixels);
        }
      } catch (error) {
        pixelSignal = String(error?.message || error);
      }
      resolve({
        ready: rect.width > 200 && rect.height > 200 && Array.isArray(pixelSignal) && pixelSignal[3] > 0
          && !document.querySelector('.canvas-3d-fallback'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pixelSignal,
        bodyText: bodyText.slice(0, 160)
      });
    }))`);
    if (latest?.ready) return latest;
    await sleep(250);
  }
  throw new Error(`3D canvas was not ready. Last state: ${JSON.stringify(latest)}`);
}

async function main() {
  if (!chromePath) {
    throw new Error('Chrome/Chromium was not found. Set CHROME_PATH to run the visual smoke test.');
  }
  const profileDir = await mkdtemp(join(tmpdir(), 'opencad-visual-'));
  await mkdir(outDir, { recursive: true });

  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const browserWsUrl = await waitForDevtoolsUrl(chrome, profileDir);
    const pageWsUrl = await openPageTarget(browserWsUrl);
    const client = createCdpClient(pageWsUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url });

    let loaded = false;
    client.on('Page.loadEventFired', () => {
      loaded = true;
    });
    const loadDeadline = Date.now() + 10000;
    while (!loaded && Date.now() < loadDeadline) await sleep(100);

    const canvas = await waitForCanvas(client);
    await sleep(Number(process.env.VISUAL_SETTLE_MS || 1200));

    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = join(outDir, `site-3d-${stamp}.png`);
    await writeFile(outPath, Buffer.from(screenshot.data, 'base64'));

    client.close();
    console.log(JSON.stringify({
      ok: true,
      url,
      screenshot: outPath,
      canvas,
    }, null, 2));
  } finally {
    chrome.kill('SIGTERM');
    await rm(profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 150,
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
