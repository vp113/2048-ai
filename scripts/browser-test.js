'use strict';

/*
 * Headless browser smoke test (default). It launches Edge in headless mode,
 * drives the real page through CDP, and closes it. No visible window and no
 * external browser launch.
 *
 *   node scripts/browser-test.js
 *   node scripts/browser-test.js --replay=C:/path/to/replay.json
 *   node scripts/browser-test.js --visible        # explicit visible mode only
 *
 * --visible is intentionally opt-in. The default is always headless.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createServer } = require('../serve.js');
const Game = require('../game.js');
const Replay = require('../replay.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf('--' + name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes('--' + name);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function edgePath() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Microsoft Edge was not found. Set EDGE_PATH or install Edge.');
}

async function waitForJson(url, timeoutMs) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error('Timed out waiting for ' + url +
    (lastError ? ': ' + lastError.message : ''));
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  close() {
    try { this.ws.close(); } catch (e) { /* ignore */ }
  }
}

async function main() {
  const visible = hasFlag('visible');
  const replayPath = arg('replay', '');
  const timeoutMs = Number(arg('timeout', '30')) * 1000;
  const edge = edgePath();

  // The AI must be reachable; otherwise there is no point launching a browser.
  const health = await fetch('http://127.0.0.1:8080/move?board=0000000000000001');
  if (!health.ok || !/^[ulrdg]$/.test((await health.text()).trim())) {
    throw new Error('AI service is not ready on http://127.0.0.1:8080');
  }

  const pageServer = createServer();
  await new Promise((resolve, reject) => {
    pageServer.once('error', reject);
    pageServer.listen(0, '127.0.0.1', resolve);
  });
  const pagePort = pageServer.address().port;
  const pageUrl = 'http://127.0.0.1:' + pagePort + '/?test=' + (visible ? 'visible' : 'headless');

  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), '2048-edge-test-'));
  const args = [
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + debugPort,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--disable-sync',
    '--no-service-autorun',
    '--disable-background-networking',
    '--disable-default-apps',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,900',
  ];
  if (!visible) args.push('--headless=new');
  args.push(pageUrl);

  const browser = spawn(edge, args, {
    stdio: 'ignore',
    windowsHide: true,
  });
  let cdp = null;
  let browserCdp = null;
  try {
    const targets = await waitForJson(
      'http://127.0.0.1:' + debugPort + '/json/list', timeoutMs
    );
    const page = targets.find((target) =>
      target.type === 'page' && target.url.includes('127.0.0.1:' + pagePort)
    );
    if (!page) throw new Error('headless Edge page target not found');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');

    let ready = false;
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      try {
        ready = await cdp.evaluate(
          "typeof window.__2048Debug === 'object' && window.__2048Debug.snapshot().aiReady"
        );
        if (ready) break;
      } catch (e) { /* still loading */ }
    }
    if (!ready) throw new Error('page did not become AI-ready');

    const snapshot = () => cdp.evaluate('window.__2048Debug.snapshot()');
    async function settled() {
      let state = await snapshot();
      for (let i = 0; i < 100 && state.pendingAnimation; i++) {
        await sleep(10);
        state = await snapshot();
      }
      return state;
    }
    function checkDom(state, label) {
      const unique = new Set(state.domIds).size === state.domIds.length;
      if (state.domTiles !== state.boardIds.length || state.domTiles !== state.tileMapKeys || !unique) {
        throw new Error(label + ': DOM/board mismatch');
      }
      if (state.spawnCount !== state.moveCount) {
        throw new Error(label + ': spawn count != move count');
      }
      if (state.pendingAnimation) throw new Error(label + ': pending animation');
    }
    async function domValues() {
      return cdp.evaluate(
        "Array.from(document.getElementById('tile-layer').children).map(function (el) { return Number(el.textContent); }).sort(function (a,b) { return a-b; })"
      );
    }
    function boardValues(state) {
      return state.board.flat().filter((v) => v > 0).sort((a, b) => a - b);
    }

    await cdp.evaluate('window.__2048Debug.setAutoContinue(false)');
    await cdp.evaluate('window.__2048Debug.pause()');
    await cdp.evaluate("document.getElementById('restart').click()");
    await sleep(300);
    const initial = await settled();
    if (initial.speed !== 8 || initial.initialTiles !== 2 || initial.domTiles !== 2) {
      throw new Error('unexpected initial state');
    }

    await cdp.evaluate('window.__2048Debug.start()');
    await sleep(1200);
    await cdp.evaluate('window.__2048Debug.pause()');
    await sleep(200);
    const playing = await settled();
    checkDom(playing, 'serial play');
    if (playing.moveCount < 1) throw new Error('AI did not make a move');
    const dom = await domValues();
    const board = boardValues(playing);
    if (JSON.stringify(dom) !== JSON.stringify(board)) {
      throw new Error('DOM values != board values');
    }

    const beforeFinish = playing;
    await cdp.evaluate('window.__2048Debug.forceFinish()');
    await sleep(200);
    const finished = await settled();
    checkDom(finished, 'game over');
    if (!finished.finalVisible || finished.running || !finished.gameOver) {
      throw new Error('final board/banner state is wrong');
    }
    if (JSON.stringify(finished.board) !== JSON.stringify(beforeFinish.board)) {
      throw new Error('final board was cleared/changed');
    }
    await sleep(1000);
    const later = await settled();
    if (!later.finalVisible || later.gamesPlayed !== finished.gamesPlayed) {
      throw new Error('auto-continue-off advanced unexpectedly');
    }

    await cdp.evaluate("document.getElementById('next-game').click()");
    await sleep(500);
    const next = await settled();
    if (next.finalVisible || !next.running) throw new Error('next game did not start');
    await cdp.evaluate('window.__2048Debug.pause()');

    if (replayPath) {
      const data = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
      const expected = Replay.buildReplay(data, Game);
      const doc = await cdp.send('DOM.getDocument');
      const input = await cdp.send('DOM.querySelector', {
        nodeId: doc.root.nodeId, selector: '#replay-file',
      });
      await cdp.send('DOM.setFileInputFiles', { files: [path.resolve(replayPath)], nodeId: input.nodeId });
      let entered = false;
      for (let i = 0; i < 50; i++) {
        await sleep(100);
        if ((await snapshot()).replayMode) { entered = true; break; }
      }
      if (!entered) {
        await cdp.evaluate("document.getElementById('replay-file').dispatchEvent(new Event('change',{bubbles:true}))");
        for (let i = 0; i < 50; i++) {
          await sleep(100);
          if ((await snapshot()).replayMode) { entered = true; break; }
        }
      }
      if (!entered) throw new Error('replay import did not enter replay mode');
      const finalReplay = await settled();
      if (finalReplay.replayIndex !== expected.total ||
          finalReplay.replayTotal !== expected.total ||
          finalReplay.score !== expected.finalScore ||
          finalReplay.maxTile !== expected.finalMax) {
        throw new Error('replay did not open at the expected final state');
      }
      for (const index of [0, Math.floor(expected.total / 2), expected.total - 1, expected.total]) {
        await cdp.evaluate('window.__2048Debug.replaySeek(' + index + ')');
        await sleep(50);
        const state = await settled();
        const wanted = Replay.stateAt(expected, index, Game);
        if (state.replayIndex !== index ||
            state.score !== wanted.score ||
            state.maxTile !== wanted.maxTile ||
            JSON.stringify(state.board) !== JSON.stringify(Game.toNumbers(wanted.board))) {
          throw new Error('replay state mismatch at ' + index);
        }
      }
      await cdp.evaluate("document.getElementById('replay-exit').click()");
      await sleep(200);
      if ((await snapshot()).replayMode) throw new Error('replay did not exit');
      console.log('replay import/seeking in headless Edge: PASS (' + expected.total + ' steps)');
    }

    console.log('initial: speed=' + initial.speed + ', tiles=' + initial.domTiles);
    console.log('serial play: moves=' + playing.moveCount +
      ', spawns=' + playing.spawnCount + ', domTiles=' + playing.domTiles);
    console.log('game over: final board retained, banner visible, no auto next');
    console.log('HEADLESS_BROWSER_TEST_PASS mode=' + (visible ? 'visible' : 'headless'));
  } finally {
    cdp && cdp.close();
    try {
      const version = await waitForJson(
        'http://127.0.0.1:' + debugPort + '/json/version', 3000
      );
      browserCdp = new CDP(version.webSocketDebuggerUrl);
      await browserCdp.open();
      browserCdp.send('Browser.close').catch(() => {});
      await sleep(500);
    } catch (e) { /* fall through to kill */ }
    browserCdp && browserCdp.close();
    try { browser.kill(); } catch (e) { /* ignore */ }
    await new Promise((resolve) => pageServer.close(resolve));
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (e) { /* ignore */ }
  }
}

if (hasFlag('help') || hasFlag('h')) {
  console.log('Usage: node scripts/browser-test.js [--replay=PATH] [--visible] [--timeout=30]');
  console.log('Default: headless Edge, no visible window.');
  process.exit(0);
}

main().catch((error) => {
  console.error('HEADLESS_BROWSER_TEST_FAIL', error.message);
  process.exit(1);
});
