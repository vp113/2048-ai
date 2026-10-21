/*
 * 2048 AI showcase controller.
 *
 * One strictly serial step:
 *   request AI move -> apply move -> spawn exactly one tile -> finish render
 *   -> verify DOM -> wait for the selected step interval -> next step.
 */
(function () {
  'use strict';

  const Game = window.Game2048;
  const AIClient = window.AI2048Client;
  const SIZE = Game.SIZE;

  const SPEEDS = {
    3: { interval: 1000 / 3, anim: 180 },
    5: { interval: 200, anim: 120 },
    8: { interval: 125, anim: 80 },
    12: { interval: 1000 / 12, anim: 55 },
    20: { interval: 50, anim: 30 },
  };
  const DEFAULT_SPEED = 8;
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
  let speed = DEFAULT_SPEED;

  let tileElements = {};
  let layout = { cell: 0, gap: 0, width: 0 };
  let record = null;
  let gameId = 0;
  let runId = 0;
  let loopActive = false;
  let pendingAnimation = null;
  let autoTimer = null;
  let toastTimer = null;

  let aiReady = false;
  let aiChecking = false;
  let aiRetry = null;
  let achievements = {};

  // ------------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------------
  function readInt(key) {
    try {
      const value = parseInt(localStorage.getItem(key), 10);
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
      const parsed = JSON.parse(safeGet(ACH_KEY) || '{}');
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
    } catch (e) { /* ignore */ }
  }

  function saveAchievements() {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(achievements)); } catch (e) { /* ignore */ }
  }

  function updateReplayLink() {
    replayLink.hidden = !safeGet(REPLAY_KEY);
  }

  function saveReplayRecord() {
    if (!record) return;
    const data = {
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
  // UI helpers
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

    const badges = [];
    if (achievements['32768']) badges.push('32768 ✓');
    if (achievements['65536']) badges.push('65536 ✓');
    const parts = [];
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

  function setSpeed(nextSpeed) {
    const value = Number(nextSpeed);
    if (!SPEEDS[value]) return;
    speed = value;
    boardEl.style.setProperty('--tile-ms', SPEEDS[value].anim + 'ms');
    const buttons = speedEl.querySelectorAll('button');
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle(
        'active',
        Number(buttons[i].getAttribute('data-speed')) === speed
      );
    }
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
  // Layout and rendering
  // ------------------------------------------------------------------
  function measure() {
    const width = boardEl.clientWidth || 400;
    const gap = Math.round(width * 0.03);
    const cell = Math.floor((width - gap * (SIZE + 1)) / SIZE);
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
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.style.width = layout.cell + 'px';
        cell.style.height = layout.cell + 'px';
        const pos = positionOf(r, c);
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
    const pos = positionOf(row, col);
    el.style.setProperty('--tx', pos.x + 'px');
    el.style.setProperty('--ty', pos.y + 'px');
  }

  function createTileElement(tile, row, col) {
    const el = document.createElement('div');
    el.className = 'tile tile-' + valueClass(tile.value);
    el.textContent = String(tile.value);
    el.dataset.id = String(tile.id);
    applyMetrics(el, tile.value);
    place(el, row, col);
    tileLayer.appendChild(el);
    tileElements[tile.id] = el;
    return el;
  }

  function clearTiles() {
    tileLayer.innerHTML = '';
    tileElements = {};
  }

  function renderBoard() {
    clearTiles();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = board[r][c];
        if (tile) createTileElement(tile, r, c);
      }
    }
  }

  function moveTile(id, row, col) {
    const el = tileElements[id];
    if (el) place(el, row, col);
  }

  function updateTileValue(id, value) {
    const el = tileElements[id];
    if (!el) return;
    el.textContent = String(value);
    el.className = 'tile tile-' + valueClass(value);
    applyMetrics(el, value);
  }

  function expectedBoardIds() {
    const ids = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c]) ids.push(String(board[r][c].id));
      }
    }
    return ids;
  }

  function verifyDom() {
    const expected = expectedBoardIds();
    const children = Array.prototype.slice.call(tileLayer.children);
    const domIds = children.map(function (el) { return el.dataset.id; });
    const expectedSet = new Set(expected);
    const domSet = new Set(domIds);
    const ok =
      expected.length === children.length &&
      expectedSet.size === expected.length &&
      domSet.size === domIds.length &&
      expected.every(function (id) { return domSet.has(id); }) &&
      domIds.every(function (id) { return expectedSet.has(id); }) &&
      Object.keys(tileElements).length === expected.length;
    if (!ok) {
      console.warn('2048: repaired DOM tile desync');
      renderBoard();
    }
  }

  function animateMove(moveResult, spawn, duration, token) {
    return new Promise(function (resolve) {
      for (let i = 0; i < moveResult.movements.length; i++) {
        const movement = moveResult.movements[i];
        moveTile(movement.id, movement.to.r, movement.to.c);
      }
      for (let i = 0; i < moveResult.merges.length; i++) {
        const merge = moveResult.merges[i];
        moveTile(merge.absorbedId, merge.target.r, merge.target.c);
      }

      function finish() {
        if (token !== gameId) {
          pendingAnimation = null;
          resolve();
          return;
        }
        for (let i = 0; i < moveResult.merges.length; i++) {
          const merge = moveResult.merges[i];
          const absorbed = tileElements[merge.absorbedId];
          if (absorbed) {
            absorbed.remove();
            delete tileElements[merge.absorbedId];
          }
          updateTileValue(merge.survivorId, merge.value);
        }
        if (spawn && spawn.tile) {
          createTileElement(spawn.tile, spawn.cell.r, spawn.cell.c);
        }
        pendingAnimation = null;
        resolve();
      }

      const timer = setTimeout(finish, duration);
      pendingAnimation = { timer: timer, finish: finish, resolve: resolve, token: token };
    });
  }

  function finishPendingAnimation(applyFinal) {
    const pending = pendingAnimation;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingAnimation = null;
    if (applyFinal && pending.token === gameId) pending.finish();
    else pending.resolve();
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
    finishPendingAnimation(false);
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
    renderBoard();
    updateScores();
    hideOverlay();
  }

  function startLoop() {
    if (loopActive) return;
    loopActive = true;
    const id = ++runId;
    running = true;
    hasStarted = true;
    updateButton();
    aiLoop(id)
      .catch(function (error) {
        if (id === runId) {
          stopLoop();
          setStatus('AI 循环错误：' + error.message, 'err');
        }
      })
      .finally(function () {
        if (id === runId) loopActive = false;
      });
  }

  function stopLoop() {
    running = false;
    runId += 1;
    loopActive = false;
    cancelAuto();
    updateButton();
  }

  function pauseAI() {
    const ended = gameOver;
    finishPendingAnimation(true);
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
    const wasRunning = running;
    finishPendingAnimation(false);
    stopLoop();
    newGame();
    if (wasRunning) startLoop();
    else updateButton();
  }

  function checkAchievements() {
    const reached = [];
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

    const previousBest = best;
    const previousMax = bestMax;
    const isRecord = score > previousBest || currentMax > previousMax;
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

    const delay = speed >= 12 ? 300 : 700;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (!running) return;
      newGame();
      startLoop();
    }, delay);
  }

  async function applyMove(direction) {
    const result = Game.move(board, direction);
    if (!result.moved) return false;

    // Apply the move first; spawning on the old board caused stale boards
    // and a screen full of leftover "2" tiles.
    board = result.board;

    // Exactly one new tile per valid move (the initial board adds two).
    const spawn = Game.addRandomTile(board);
    record.moves.push([
      DIR_INDEX[direction],
      spawn.tile ? spawn.cell.r * SIZE + spawn.cell.c : -1,
      spawn.tile ? spawn.tile.value : 0,
    ]);

    score += result.score;
    const nextMax = Game.maxValue(board);
    if (nextMax > currentMax) currentMax = nextMax;
    updateScores();
    checkAchievements();

    const duration = SPEEDS[speed].anim;
    await animateMove(result, spawn, duration, gameId);
    verifyDom();
    return true;
  }

  async function aiLoop(id) {
    while (running && id === runId) {
      if (gameOver) return;
      if (Game.isGameOver(board)) { finishGame(); return; }

      const myGame = gameId;
      const stepStart = performance.now();
      let move;
      try {
        move = await ai.requestMove(board);
      } catch (error) {
        if (id !== runId) return;
        aiReady = false;
        stopLoop();
        setStatus('AI 服务错误：' + error.message, 'err');
        scheduleRetry();
        return;
      }

      if (myGame !== gameId) return;
      if (!running || id !== runId) return;
      if (move === null) {
        if (Game.isGameOver(board)) { finishGame(); return; }
        stopLoop();
        setStatus('AI 返回 g，但游戏未结束，已暂停', 'err');
        return;
      }

      const ok = await applyMove(move);
      if (myGame !== gameId) return;
      if (!running || id !== runId) return;
      if (!ok) {
        stopLoop();
        setStatus('AI 返回了无效动作，已暂停', 'err');
        return;
      }
      if (Game.isGameOver(board)) { finishGame(); return; }

      const interval = SPEEDS[speed].interval;
      const elapsed = performance.now() - stepStart;
      if (elapsed < interval) await sleep(interval - elapsed);
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  toggleBtn.addEventListener('click', toggleAI);
  restartBtn.addEventListener('click', restart);
  speedEl.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-speed]');
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
    const raw = safeGet(REPLAY_KEY);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '2048-ai-replay-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  window.addEventListener('resize', function () {
    if (running) pauseAI();
    finishPendingAnimation(true);
    measure();
    buildBackground();
    renderBoard();
  });

  // Small read-only hook used by browser smoke tests.
  window.__2048Debug = {
    snapshot: function () {
      const boardIds = expectedBoardIds();
      const domIds = Array.prototype.map.call(
        tileLayer.children,
        function (el) { return el.dataset.id; }
      );
      const moveCount = record ? record.moves.length : 0;
      const spawnCount = record
        ? record.moves.filter(function (m) { return m[1] >= 0; }).length
        : 0;
      return {
        board: Game.toNumbers(board),
        score: score,
        maxTile: currentMax,
        best: best,
        bestMax: bestMax,
        running: running,
        gameOver: gameOver,
        hasStarted: hasStarted,
        speed: speed,
        aiReady: aiReady,
        pendingAnimation: !!pendingAnimation,
        loopActive: loopActive,
        moveCount: moveCount,
        spawnCount: spawnCount,
        initialTiles: record
          ? record.initial.reduce(function (sum, row) {
              return sum + row.filter(function (v) { return v > 0; }).length;
            }, 0)
          : 0,
        domTiles: domIds.length,
        domIds: domIds,
        boardIds: boardIds,
        tileMapKeys: Object.keys(tileElements).length,
        gamesPlayed: gamesPlayed,
      };
    },
    start: toggleAI,
    pause: pauseAI,
    setSpeed: setSpeed,
    verifyDom: verifyDom,
  };

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  loadStore();
  setSpeed(DEFAULT_SPEED);
  newGame();
  updateButton();
  checkAI();
})();
