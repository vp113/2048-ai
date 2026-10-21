/*
 * 2048 AI showcase controller.
 *
 * Live mode: strictly serial AI steps.
 * Replay mode: read-only snapshots of a JSON replay; it never requests the AI.
 */
(function () {
  'use strict';

  const Game = window.Game2048;
  const AIClient = window.AI2048Client;
  const Replay = window.Replay2048;
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
  const AUTO_NEXT_DELAY = 3500;
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

  const autoContinueEl = $('auto-continue');
  const importBtn = $('import-replay');
  const fileInput = $('replay-file');
  const importNote = $('import-note');

  const finalBanner = $('final-banner');
  const finalScoreEl = $('final-score');
  const finalMaxEl = $('final-max');
  const finalMovesEl = $('final-moves');
  const finalNoteEl = $('final-note');
  const finalAchievementEl = $('final-achievement');
  const nextGameBtn = $('next-game');

  const replayPanel = $('replay-panel');
  const replaySourceEl = $('replay-source');
  const replayExitBtn = $('replay-exit');
  const replayStartBtn = $('replay-start');
  const replayPrevBtn = $('replay-prev');
  const replayPlayBtn = $('replay-play');
  const replayNextBtn = $('replay-next');
  const replayEndBtn = $('replay-end');
  const replayProgress = $('replay-progress');
  const replayCounter = $('replay-counter');
  const replayScoreEl = $('replay-score');
  const replayMaxEl = $('replay-max');
  const replaySpeedEl = $('replay-speed');
  const replayNoteEl = $('replay-note');

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
  let autoContinue = false;

  let tileElements = {};
  let layout = { cell: 0, gap: 0, width: 0 };
  let record = null;
  let gameId = 0;
  let runId = 0;
  let loopActive = false;
  let pendingAnimation = null;
  let autoTimer = null;
  let toastTimer = null;

  let replayMode = false;
  let replayData = null;
  let replayIndex = 0;
  let replayPlaying = false;
  let replayTimer = null;

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

  function updateScores() {
    scoreEl.textContent = fmt(score);
    bestEl.textContent = fmt(replayMode ? best : Math.max(best, score));
    maxEl.textContent = fmt(currentMax);
    sessionEl.textContent = replayMode
      ? '回放模式'
      : (gameOver
        ? '已完成 ' + gamesPlayed + ' 局'
        : '第 ' + (gamesPlayed + 1) + ' 局 · 已完成 ' + gamesPlayed + ' 局');

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

  function hideImportNote() {
    importNote.hidden = true;
    importNote.textContent = '';
  }

  function showImportError(message) {
    importNote.textContent = '回放导入失败：' + message;
    importNote.hidden = false;
  }

  // ------------------------------------------------------------------
  // Final-state banner / auto-continue
  // ------------------------------------------------------------------
  function showFinalBanner() {
    finalScoreEl.textContent = fmt(score);
    finalMaxEl.textContent = fmt(currentMax);
    finalMovesEl.textContent = fmt(record ? record.moves.length : 0);
    const achieved = [];
    if (currentMax >= 65536) achieved.push('65536');
    if (currentMax >= 32768) achieved.push('32768');
    finalAchievementEl.textContent = achieved.length ? '成就 ' + achieved.join(' / ') : '';
    finalBanner.hidden = false;
    updateFinalNote();
  }

  function hideFinalBanner() {
    finalBanner.hidden = true;
  }

  function updateFinalNote() {
    if (finalBanner.hidden) return;
    if (gamesPlayed >= MAX_GAMES) {
      finalNoteEl.textContent = '本次连续挑战已完成 ' + MAX_GAMES + ' 局。点击「下一局」重新开始挑战。';
      return;
    }
    if (autoContinue && running && autoTimer) {
      finalNoteEl.textContent = '约 3 秒后自动开始下一局；点击「AI 暂停」可取消。';
    } else if (autoContinue && running) {
      finalNoteEl.textContent = '准备开始下一局…';
    } else if (autoContinue) {
      finalNoteEl.textContent = '已暂停；点击「下一局」或「AI 开始」继续。';
    } else {
      finalNoteEl.textContent = '点击「下一局」继续；开启「自动连续挑战」可自动开始。';
    }
  }

  function cancelAuto() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function scheduleAutoNext() {
    cancelAuto();
    if (replayMode || !autoContinue || !gameOver || !running || gamesPlayed >= MAX_GAMES) {
      updateFinalNote();
      return;
    }
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (!running || !autoContinue || replayMode || !gameOver) {
        updateFinalNote();
        return;
      }
      startNextGame();
    }, AUTO_NEXT_DELAY);
    updateFinalNote();
  }

  function startNextGame() {
    if (replayMode) return;
    cancelAuto();
    stopLoop();
    hideFinalBanner();
    if (gamesPlayed >= MAX_GAMES) gamesPlayed = 0;
    newGame();
    startLoop();
  }

  function applyAutoContinue(value) {
    autoContinue = !!value;
    autoContinueEl.checked = autoContinue;
    if (!autoContinue) {
      cancelAuto();
      if (gameOver && running && !replayMode) stopLoop();
      updateFinalNote();
      return;
    }
    if (gameOver && running && !replayMode) scheduleAutoNext();
    else updateFinalNote();
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
      if (!replayMode) setStatus('AI 已连接 · depth 3', 'ok');
      stopRetry();
    } catch (e) {
      aiReady = false;
      if (!replayMode) setStatus('AI 服务未连接 · 请运行 scripts/start.ps1', 'err');
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
  // Live game lifecycle
  // ------------------------------------------------------------------
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
    hideFinalBanner();
    hideImportNote();
    updateScores();
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
    if (replayMode) return;
    const ended = gameOver;
    finishPendingAnimation(true);
    stopLoop();
    if (ended) updateFinalNote();
  }

  function toggleAI() {
    if (replayMode) return;
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
    hideFinalBanner();
    startLoop();
  }

  function restart() {
    if (replayMode) return;
    const wasRunning = running;
    finishPendingAnimation(false);
    stopLoop();
    hideFinalBanner();
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
    if (gameOver || replayMode) return;
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
    showFinalBanner();

    if (gamesPlayed >= MAX_GAMES) {
      stopLoop();
      updateFinalNote();
      return;
    }

    if (autoContinue) {
      scheduleAutoNext();
      updateButton();
      return;
    }

    stopLoop();
    updateFinalNote();
  }

  async function applyMove(direction) {
    const result = Game.move(board, direction);
    if (!result.moved) return false;

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
  // Replay mode
  // ------------------------------------------------------------------
  function clearReplayTimer() {
    if (replayTimer) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
  }

  function updateReplayUI() {
    if (!replayMode || !replayData) return;
    replayProgress.value = String(replayIndex);
    replayCounter.textContent = fmt(replayIndex) + ' / ' + fmt(replayData.total);
    replayScoreEl.textContent = fmt(score);
    replayMaxEl.textContent = fmt(currentMax);
    replayPlayBtn.textContent = replayPlaying ? '暂停' : '播放';
  }

  function seekReplay(index) {
    if (!replayMode || !replayData) return;
    try {
      const state = Replay.stateAt(replayData, index, Game);
      board = state.board;
      score = state.score;
      currentMax = state.maxTile;
      replayIndex = state.index;
      renderBoard();
      verifyDom();
      updateScores();
      updateReplayUI();
    } catch (error) {
      pauseReplay();
      replayNoteEl.textContent = '回放错误：' + error.message;
      showToast('回放错误：' + error.message);
    }
  }

  function pauseReplay() {
    replayPlaying = false;
    clearReplayTimer();
    if (replayMode) {
      if (replayData && replayIndex >= replayData.total) {
        replayNoteEl.textContent = '已到达结局；可倒退或拖动进度条查看。';
      } else {
        replayNoteEl.textContent = '已暂停；拖动进度条查看任意一步。';
      }
      updateReplayUI();
    }
  }

  function scheduleReplayTick() {
    clearReplayTimer();
    if (!replayMode || !replayPlaying) return;
    const speedValue = Math.max(1, Number(replaySpeedEl.value) || 5);
    replayTimer = setTimeout(function () {
      replayTimer = null;
      if (!replayMode || !replayPlaying) return;
      if (replayIndex >= replayData.total) { pauseReplay(); return; }
      seekReplay(replayIndex + 1);
      if (replayIndex >= replayData.total) { pauseReplay(); return; }
      scheduleReplayTick();
    }, 1000 / speedValue);
  }

  function toggleReplayPlay() {
    if (!replayMode || !replayData) return;
    if (replayPlaying) { pauseReplay(); return; }
    if (replayIndex >= replayData.total) seekReplay(0);
    replayPlaying = true;
    replayNoteEl.textContent = '正在播放；可随时拖动进度条查看任意一步。';
    updateReplayUI();
    scheduleReplayTick();
  }

  function enterReplay(replay, name) {
    cancelAuto();
    finishPendingAnimation(false);
    stopLoop();
    gameId += 1;
    replayMode = true;
    replayData = replay;
    replayIndex = 0;
    replayPlaying = false;
    clearReplayTimer();
    hideFinalBanner();
    hideImportNote();
    document.body.classList.add('replay-mode');
    replayPanel.hidden = false;
    replaySourceEl.textContent =
      (name ? name + ' · ' : '') + fmt(replay.total) + ' 步 · 最终 ' +
      fmt(replay.finalScore) + ' 分 · ' + fmt(replay.finalMax);
    replayProgress.max = String(replay.total);
    replaySpeedEl.value = '5';
    replayNoteEl.textContent = '导入后默认显示最终棋盘；拖动进度条查看任意一步。';
    stopRetry();
    setStatus('回放模式');
    updateButton();
    seekReplay(replay.total);
  }

  function exitReplay() {
    pauseReplay();
    replayMode = false;
    replayData = null;
    replayIndex = 0;
    clearReplayTimer();
    document.body.classList.remove('replay-mode');
    replayPanel.hidden = true;
    hideImportNote();
    newGame();
    updateButton();
    if (aiReady) {
      setStatus('AI 已连接 · depth 3', 'ok');
    } else {
      setStatus('AI 服务未连接 · 请运行 scripts/start.ps1', 'err');
      scheduleRetry();
    }
  }

  async function handleReplayFile(file) {
    if (!file) return;
    hideImportNote();
    if (replayMode) {
      showImportError('请先退出当前回放');
      fileInput.value = '';
      return;
    }
    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('文件超过 20MB 限制');
      }
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('JSON 解析失败：' + error.message);
      }
      const replay = Replay.buildReplay(data, Game);
      enterReplay(replay, file.name);
    } catch (error) {
      showImportError(error && error.message ? error.message : String(error));
    } finally {
      fileInput.value = '';
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
  autoContinueEl.addEventListener('change', function () {
    applyAutoContinue(autoContinueEl.checked);
  });
  nextGameBtn.addEventListener('click', startNextGame);

  importBtn.addEventListener('click', function () {
    if (replayMode) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) {
      handleReplayFile(fileInput.files[0]);
    }
  });

  replayStartBtn.addEventListener('click', function () {
    pauseReplay(); seekReplay(0);
  });
  replayPrevBtn.addEventListener('click', function () {
    pauseReplay(); seekReplay(replayIndex - 1);
  });
  replayNextBtn.addEventListener('click', function () {
    pauseReplay(); seekReplay(replayIndex + 1);
  });
  replayEndBtn.addEventListener('click', function () {
    pauseReplay(); seekReplay(replayData ? replayData.total : 0);
  });
  replayPlayBtn.addEventListener('click', toggleReplayPlay);
  replayProgress.addEventListener('input', function () {
    // Read the user's target before pauseReplay() refreshes the slider.
    const target = Number(replayProgress.value);
    pauseReplay();
    seekReplay(target);
  });
  replaySpeedEl.addEventListener('change', function () {
    if (replayPlaying) {
      clearReplayTimer();
      scheduleReplayTick();
    }
  });
  replayExitBtn.addEventListener('click', exitReplay);

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
    if (replayMode) {
      measure();
      buildBackground();
      renderBoard();
      return;
    }
    if (running) pauseAI();
    finishPendingAnimation(true);
    measure();
    buildBackground();
    renderBoard();
  });

  // Read-only browser test hook.
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
        autoContinue: autoContinue,
        finalVisible: !finalBanner.hidden,
        replayMode: replayMode,
        replayIndex: replayIndex,
        replayTotal: replayData ? replayData.total : 0,
        replayPlaying: replayPlaying,
      };
    },
    start: toggleAI,
    pause: pauseAI,
    setSpeed: setSpeed,
    verifyDom: verifyDom,
    setAutoContinue: applyAutoContinue,
    forceFinish: function () {
      if (replayMode || gameOver) return;
      finishPendingAnimation(true);
      runId += 1;
      loopActive = false;
      finishGame();
    },
    importReplayData: function (data, name) {
      const replay = Replay.buildReplay(data, Game);
      enterReplay(replay, name || 'debug.json');
    },
    replaySeek: seekReplay,
    replayPlay: toggleReplayPlay,
    replayPause: pauseReplay,
    exitReplay: exitReplay,
    startNextGame: startNextGame,
  };

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  loadStore();
  setSpeed(DEFAULT_SPEED);
  autoContinue = false;
  autoContinueEl.checked = false;
  newGame();
  updateButton();
  checkAI();
})();
