/*
 * 2048 AI showcase controller.
 * The local Docker service (macroxue/2048-ai) computes moves; this file owns
 * the board, score, spawns, animation, records, and continuous-play session.
 */
(function () {
  'use strict';

  const Game = window.Game2048;
  const AIClient = window.AI2048Client;
  const SIZE = Game.SIZE;

  const SLIDE_MS = 120;
  const FAST_SLIDE_MS = 45;
  const NORMAL_PACE = 220;
  const FAST_PACE = 70;
  const EXTREME_RENDER_MS = 50;
  const MAX_GAMES = 500;
  const DIRS = ['up', 'right', 'down', 'left'];
  const DIR_INDEX = { up: 0, right: 1, down: 2, left: 3 };

  const BEST_KEY = '2048.ai.best.score';
  const BEST_MAX_KEY = '2048.ai.best.max';
  const ACH_KEY = '2048.ai.achievements';
  const REPLAY_KEY = '2048.ai.replay.best';

  const $ = function (id) { return document.getElementById(id); };
  const boardEl = $('board');
  const cellLayer = $('cell-layer');
  const tileLayer = $('tile-layer');
  const scoreEl = $('score');
  const bestEl = $('best');
  const maxEl = $('max-tile');
  const toggleBtn = $('ai-toggle');
  const restartBtn = $('restart');
  const speedEl = $('speed');
  const sessionEl = $('session');
  const statusEl = $('ai-status');
  const achEl = $('achievements');
  const replayLink = $('replay-download');
  const toastEl = $('toast');
  const overlayEl = $('message');
  const msgText = $('message-text');
  const msgSub = $('message-sub');
  const msgAction = $('message-action');

  const ai = AIClient.createClient({ endpoint: '/move', timeoutMs: 60000 });
  const HEALTH_BOARD = [
    [2, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];

  let board = null;
  let score = 0;
  let best = 0;
  let bestMax = 0;
  let currentMax = 0;
  let gamesPlayed = 0;
  let running = false;
  let hasStarted = false;
  let gameOver = true;
  let speed = 'normal';

  let tileElements = {};
  let layout = { cell: 0, gap: 0, width: 0 };
  let record = null;
  let gameId = 0;
  let runId = 0;
  let autoTimer = null;
  let toastTimer = null;
  let lastRender = 0;

  let aiReady = false;
  let aiChecking = false;
  let aiRetry = null;
  let achievements = {};

  // ------------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------------
  function readInt(key) {
    try {
      var value = parseInt(localStorage.getItem(key), 10);
      return Number.isFinite(value) ? value : 0;
    } catch (e) {
      return 0;
    }
  }

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function loadStore() {
    best = readInt(BEST_KEY);
    bestMax = readInt(BEST_MAX_KEY);
    try {
      var parsed = JSON.parse(safeGet(ACH_KEY) || '{}');
      achievements = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      achievements = {};
    }
    updateReplayLink();
  }

  function saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(best));
      localStorage.setItem(BEST_MAX_KEY, String(bestMax));
    } catch (e) { /* storage may be full or disabled */ }
  }

  function saveAchievements() {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(achievements)); } catch (e) { /* ignore */ }
  }

  function updateReplayLink() {
    replayLink.hidden = !safeGet(REPLAY_KEY);
  }

  function saveReplayRecord() {
    if (!record) return;
    var data = {
      version: 1,
      initial: record.initial,
      moves: record.moves,
      score: score,
      maxTile: currentMax,
      finishedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(REPLAY_KEY, JSON.stringify(data));
      updateReplayLink();
    } catch (e) {
      showToast('回放保存失败：浏览器存储空间不足');
    }
  }

  // ------------------------------------------------------------------
  // Small UI helpers
  // ------------------------------------------------------------------
  function fmt(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3500);
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  }

  function showOverlay(title, sub, actionText) {
    msgText.textContent = title;
    msgSub.textContent = sub;
    msgAction.textContent = actionText || '继续挑战';
    overlayEl.classList.add('show');
  }

  function hideOverlay() {
    overlayEl.classList.remove('show');
  }

  function updateScores() {
    scoreEl.textContent = fmt(score);
    bestEl.textContent = fmt(Math.max(best, score));
    maxEl.textContent = fmt(currentMax);
    sessionEl.textContent = gameOver
      ? '已完成 ' + gamesPlayed + ' 局'
      : '第 ' + (gamesPlayed + 1) + ' 局 · 已完成 ' + gamesPlayed + ' 局';

    var badges = [];
    if (achievements['32768']) badges.push('32768 ✓');
    if (achievements['65536']) badges.push('65536 ✓');
    var parts = [];
    if (bestMax) parts.push('历史最大 ' + fmt(bestMax));
    if (badges.length) parts.push(badges.join(' · '));
    achEl.textContent = parts.join(' · ');
  }

  function updateButton() {
    toggleBtn.textContent = running
      ? 'AI 暂停'
      : (gameOver || !hasStarted ? 'AI 开始' : 'AI 继续');
    toggleBtn.classList.toggle('active', running);
  }

  // ------------------------------------------------------------------
  // AI availability
  // ------------------------------------------------------------------
  function stopRetry() {
    if (aiRetry) { clearInterval(aiRetry); aiRetry = null; }
  }

  function scheduleRetry() {
    if (!aiRetry) aiRetry = setInterval(checkAI, 5000);
  }

  async function checkAI() {
    if (aiChecking) return;
    aiChecking = true;
    try {
      await ai.requestMove(HEALTH_BOARD);
      aiReady = true;
      setStatus('AI 已连接 · depth 3', 'ok');
      stopRetry();
    } catch (e) {
      aiReady = false;
      setStatus('AI 服务未连接 · 请运行 scripts/start.ps1', 'err');
      scheduleRetry();
    } finally {
      aiChecking = false;
    }
  }

  // ------------------------------------------------------------------
  // Layout and rendering (reuses the original visual style)
  // ------------------------------------------------------------------
  function measure() {
    var width = boardEl.clientWidth || 400;
    var gap = Math.round(width * 0.03);
    var cell = Math.floor((width - gap * (SIZE + 1)) / SIZE);
    layout.cell = cell;
    layout.gap = gap;
    layout.width = width;
  }

  function positionOf(row, col) {
    return {
      x: layout.gap + col * (layout.cell + layout.gap),
      y: layout.gap + row * (layout.cell + layout.gap),
    };
  }

  function fontScale(value) {
    if (value < 100) return 0.5;
    if (value < 1000) return 0.42;
    if (value < 10000) return 0.34;
    return 0.26;
  }

  function valueClass(value) {
    return value <= 2048 ? String(value) : 'super';
  }

  function buildBackground() {
    cellLayer.innerHTML = '';
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.width = layout.cell + 'px';
        cell.style.height = layout.cell + 'px';
        var pos = positionOf(r, c);
        cell.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';
        cellLayer.appendChild(cell);
      }
    }
  }

  function applyMetrics(el, value) {
    el.style.width = layout.cell + 'px';
    el.style.height = layout.cell + 'px';
    el.style.fontSize = Math.round(layout.cell * fontScale(value)) + 'px';
  }

  function place(el, row, col) {
    var pos = positionOf(row, col);
    el.style.setProperty('--tx', pos.x + 'px');
    el.style.setProperty('--ty', pos.y + 'px');
  }

  function createTileElement(tile, row, col, isNew) {
    var el = document.createElement('div');
    el.className = 'tile tile-' + valueClass(tile.value);
    el.textContent = tile.value;
    applyMetrics(el, tile.value);
    place(el, row, col);
    if (isNew) el.classList.add('tile-new');
    tileLayer.appendChild(el);
    tileElements[tile.id] = el;
    return el;
  }

  function clearTiles() {
    tileLayer.innerHTML = '';
    tileElements = {};
  }

  function renderBoard(animateNew) {
    clearTiles();
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var tile = board[r][c];
        if (tile) createTileElement(tile, r, c, animateNew);
      }
    }
  }

  function moveTile(id, row, col) {
    var el = tileElements[id];
    if (el) place(el, row, col);
  }

  function updateTileValue(id, value) {
    var el = tileElements[id];
    if (!el) return;
    el.textContent = value;
    el.className = 'tile tile-' + valueClass(value);
    applyMetrics(el, value);
    void el.offsetWidth;
    el.classList.add('tile-merge');
  }

  function animateMove(moveResult, spawn, duration, token) {
    return new Promise(function (resolve) {
      var i;
      for (i = 0; i < moveResult.movements.length; i++) {
        var movement = moveResult.movements[i];
        moveTile(movement.id, movement.to.r, movement.to.c);
      }
      for (i = 0; i < moveResult.merges.length; i++) {
        var merge = moveResult.merges[i];
        moveTile(merge.absorbedId, merge.target.r, merge.target.c);
      }
      setTimeout(function () {
        if (token !== gameId) { resolve(); return; }
        for (var j = 0; j < moveResult.merges.length; j++) {
          var m = moveResult.merges[j];
          var absorbed = tileElements[m.absorbedId];
          if (absorbed) {
            absorbed.remove();
            delete tileElements[m.absorbedId];
          }
          updateTileValue(m.survivorId, m.value);
        }
        if (spawn && spawn.tile) {
          createTileElement(spawn.tile, spawn.cell.r, spawn.cell.c, true);
        }
        resolve();
      }, duration);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ------------------------------------------------------------------
  // Game lifecycle
  // ------------------------------------------------------------------
  function cancelAuto() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function newGame() {
    cancelAuto();
    gameId += 1;
    hasStarted = false;
    board = Game.createEmptyBoard(SIZE);
    score = 0;
    currentMax = 0;
    gameOver = false;
    Game.addRandomTile(board);
    Game.addRandomTile(board);
    currentMax = Game.maxValue(board);
    record = { version: 1, initial: Game.toNumbers(board), moves: [] };
    measure();
    buildBackground();
    renderBoard(true);
    updateScores();
    hideOverlay();
  }

  function startLoop() {
    const id = ++runId;
    running = true;
    hasStarted = true;
    updateButton();
    aiLoop(id);
  }

  function stopLoop() {
    running = false;
    runId += 1;
    cancelAuto();
    updateButton();
  }

  function pauseAI() {
    var ended = gameOver;
    stopLoop();
    if (ended) {
      showOverlay('已暂停', '本局得分 ' + fmt(score) + '，最大方块 ' + fmt(currentMax) + '。', '继续挑战');
    }
  }

  function toggleAI() {
    if (running) { pauseAI(); return; }
    if (!aiReady) {
      setStatus('正在连接 AI 服务…');
      checkAI();
      return;
    }
    if (gameOver) {
      if (gamesPlayed >= MAX_GAMES) gamesPlayed = 0;
      newGame();
    }
    hideOverlay();
    startLoop();
  }

  function restart() {
    var wasRunning = running;
    stopLoop();
    newGame();
    if (wasRunning) startLoop();
    else updateButton();
  }

  function setSpeed(nextSpeed) {
    speed = nextSpeed;
    boardEl.classList.remove('speed-fast', 'speed-extreme');
    if (speed === 'fast') boardEl.classList.add('speed-fast');
    if (speed === 'extreme') boardEl.classList.add('speed-extreme');
    var buttons = speedEl.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-speed') === speed);
    }
  }

  function checkAchievements() {
    var reached = [];
    if (currentMax >= 65536 && !achievements['65536']) {
      achievements['65536'] = true;
      reached.push(65536);
    }
    if (currentMax >= 32768 && !achievements['32768']) {
      achievements['32768'] = true;
      reached.push(32768);
    }
    if (reached.length) {
      saveAchievements();
      updateScores();
      showToast('成就达成：' + fmt(Math.max.apply(null, reached)) + '！');
    }
  }

  function finishGame() {
    if (gameOver) return;
    gameOver = true;
    if (speed === 'extreme') renderBoard(false);

    var previousBest = best;
    var previousMax = bestMax;
    var isRecord = score > previousBest || currentMax > previousMax;
    if (score > best) best = score;
    if (currentMax > bestMax) bestMax = currentMax;
    if (score > previousBest || currentMax > previousMax) saveBest();
    if (isRecord) saveReplayRecord();

    gamesPlayed += 1;
    updateScores();
    showToast('第 ' + gamesPlayed + ' 局结束 · ' + fmt(score) + ' 分 · 最大 ' + fmt(currentMax));

    if (gamesPlayed >= MAX_GAMES) {
      stopLoop();
      showOverlay(
        '连续挑战完成',
        '已完成 ' + gamesPlayed + ' 局，历史最高 ' + fmt(best) + ' 分，最大方块 ' + fmt(bestMax) + '。',
        '继续挑战'
      );
      return;
    }

    if (!running) {
      showOverlay('本局结束', '得分 ' + fmt(score) + '，最大方块 ' + fmt(currentMax) + '。', '继续挑战');
      updateButton();
      return;
    }

    var delay = speed === 'extreme' ? 150 : 700;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (!running) return;
      newGame();
      startLoop();
    }, delay);
  }

  async function applyMove(direction) {
    var result = Game.move(board, direction);
    if (!result.moved) return false;

    var spawn = Game.addRandomTile(board);
    record.moves.push([
      DIR_INDEX[direction],
      spawn.tile ? spawn.cell.r * SIZE + spawn.cell.c : -1,
      spawn.tile ? spawn.tile.value : 0,
    ]);

    score += result.score;
    var nextMax = Game.maxValue(board);
    if (nextMax > currentMax) currentMax = nextMax;
    updateScores();
    checkAchievements();

    if (speed === 'extreme') {
      if (performance.now() - lastRender >= EXTREME_RENDER_MS) {
        lastRender = performance.now();
        renderBoard(false);
      }
    } else {
      var duration = speed === 'normal' ? SLIDE_MS : FAST_SLIDE_MS;
      await animateMove(result, spawn, duration, gameId);
    }
    return true;
  }

  async function aiLoop(id) {
    while (running && id === runId) {
      if (gameOver) return;
      if (Game.isGameOver(board)) { finishGame(); return; }

      var myGame = gameId;
      var moveStart = performance.now();
      var move;
      try {
        move = await ai.requestMove(board);
      } catch (e) {
        if (id !== runId) return;
        aiReady = false;
        stopLoop();
        setStatus('AI 服务错误：' + e.message, 'err');
        scheduleRetry();
        return;
      }

      if (myGame !== gameId) return;
      if (!running || id !== runId) {
        if (!gameOver && Game.isGameOver(board)) finishGame();
        return;
      }
      if (move === null) {
        if (Game.isGameOver(board)) { finishGame(); return; }
        stopLoop();
        setStatus('AI 返回 g，但游戏未结束，已暂停', 'err');
        return;
      }

      var ok = await applyMove(move);
      if (myGame !== gameId) return;
      if (!running || id !== runId) {
        if (!gameOver && Game.isGameOver(board)) finishGame();
        return;
      }
      if (!ok) {
        stopLoop();
        setStatus('AI 返回了无效动作，已暂停', 'err');
        return;
      }
      if (Game.isGameOver(board)) { finishGame(); return; }

      var pace = speed === 'normal' ? NORMAL_PACE : (speed === 'fast' ? FAST_PACE : 0);
      var elapsed = performance.now() - moveStart;
      if (pace > 0 && elapsed < pace) await sleep(pace - elapsed);
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  toggleBtn.addEventListener('click', toggleAI);
  restartBtn.addEventListener('click', restart);
  speedEl.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-speed]');
    if (button) setSpeed(button.getAttribute('data-speed'));
  });

  msgAction.addEventListener('click', function () {
    hideOverlay();
    if (gamesPlayed >= MAX_GAMES) gamesPlayed = 0;
    if (!aiReady) {
      setStatus('正在连接 AI 服务…');
      checkAI();
      return;
    }
    if (gameOver) newGame();
    startLoop();
  });

  replayLink.addEventListener('click', function (event) {
    event.preventDefault();
    var raw = safeGet(REPLAY_KEY);
    if (!raw) return;
    var blob = new Blob([raw], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '2048-ai-replay-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  window.addEventListener('resize', function () {
    if (running) pauseAI();
    measure();
    buildBackground();
    renderBoard(false);
  });

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  loadStore();
  newGame();
  updateButton();
  checkAI();
})();
