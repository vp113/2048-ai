/*
 * 2048 — 界面与交互（依赖 game.js 提供的 Game2048 全局对象）
 */
(function () {
  'use strict';

  const Game = window.Game2048;
  const SIZE = Game.SIZE;
  const BEST_KEY = '2048.best.score';
  const SLIDE_MS = 120;

  // DOM
  const boardEl = document.getElementById('board');
  const cellLayer = document.getElementById('cell-layer');
  const tileLayer = document.getElementById('tile-layer');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const undoBtn = document.getElementById('undo');
  const newGameBtn = document.getElementById('new-game');
  const overlayEl = document.getElementById('message');
  const messageText = document.getElementById('message-text');
  const messageSub = document.getElementById('message-sub');
  const keepBtn = document.getElementById('keep-going');
  const tryAgainBtn = document.getElementById('try-again');

  // 状态
  let board = null;
  let score = 0;
  let best = 0;
  let history = [];
  let tileElements = {};
  let busy = false;
  let wonFlag = false;
  let animTimer = null;
  const layout = { cell: 0, gap: 0, width: 0 };

  // ---------- 高分持久化 ----------
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(BEST_KEY), 10);
      best = Number.isFinite(v) ? v : 0;
    } catch (e) {
      best = 0;
    }
  }
  function saveBest() {
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 忽略 */ }
  }

  // ---------- 布局 ----------
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

  // 背景格子层（与方块层共用同一套坐标，保证对齐）
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

  // ---------- 方块渲染 ----------
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
  function createTileElement(tile, row, col, isNew) {
    const el = document.createElement('div');
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
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = board[r][c];
        if (tile) createTileElement(tile, r, c, animateNew);
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
    el.textContent = value;
    el.className = 'tile tile-' + valueClass(value);
    applyMetrics(el, value);
    void el.offsetWidth; // 重新触发合并弹出动画
    el.classList.add('tile-merge');
  }

  function updateScores() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }
  function updateUndo() {
    undoBtn.disabled = history.length === 0;
  }

  // ---------- 提示浮层 ----------
  function showMessage(title, sub, isWin) {
    messageText.textContent = title;
    messageSub.textContent = sub;
    keepBtn.style.display = isWin ? '' : 'none';
    overlayEl.classList.add('show');
  }
  function hideMessage() {
    overlayEl.classList.remove('show');
  }

  // ---------- 移动动画 ----------
  function animateMove(moveResult, spawn) {
    busy = true;
    for (const m of moveResult.movements) moveTile(m.id, m.to.r, m.to.c);
    for (const m of moveResult.merges) moveTile(m.absorbedId, m.target.r, m.target.c);

    animTimer = setTimeout(() => {
      for (const m of moveResult.merges) {
        const absorbedEl = tileElements[m.absorbedId];
        if (absorbedEl) {
          absorbedEl.remove();
          delete tileElements[m.absorbedId];
        }
        updateTileValue(m.survivorId, m.value);
      }
      if (spawn && spawn.tile) createTileElement(spawn.tile, spawn.cell.r, spawn.cell.c, true);

      score += moveResult.score;
      if (score > best) { best = score; saveBest(); }
      updateScores();
      updateUndo();
      busy = false;
      checkEnd();
    }, SLIDE_MS);
  }

  // ---------- 核心流程 ----------
  function doMove(direction) {
    if (busy) return;
    const moveResult = Game.move(board, direction);
    if (!moveResult.moved) return;

    history.push({ board: Game.cloneBoard(board), score });
    board = moveResult.board;
    const spawn = Game.addRandomTile(board);
    animateMove(moveResult, spawn);
  }

  function undo() {
    if (busy || history.length === 0) return;
    const prev = history.pop();
    board = prev.board;
    score = prev.score;
    wonFlag = false;
    hideMessage();
    renderBoard(false);
    updateScores();
    updateUndo();
  }

  function start() {
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    busy = false;
    board = Game.createEmptyBoard(SIZE);
    score = 0;
    history = [];
    wonFlag = false;
    hideMessage();
    Game.addRandomTile(board);
    Game.addRandomTile(board);
    measure();
    buildBackground();
    renderBoard(true);
    updateScores();
    updateUndo();
  }

  function checkEnd() {
    if (!wonFlag && Game.hasWon(board)) {
      wonFlag = true;
      showMessage('你赢了！🎉', '已经凑出 2048，可以继续挑战更高分。', true);
      return;
    }
    if (Game.isGameOver(board)) {
      showMessage('游戏结束', '没有可移动的方块了，再试一次吧。', false);
    }
  }

  function relayout() {
    measure();
    buildBackground();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = board[r][c];
        if (!tile) continue;
        const el = tileElements[tile.id];
        if (!el) continue;
        applyMetrics(el, tile.value);
        moveTile(tile.id, r, c);
      }
    }
  }

  // ---------- 事件 ----------
  const keyMap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };
  document.addEventListener('keydown', (e) => {
    const dir = keyMap[e.key];
    if (dir) {
      e.preventDefault();
      doMove(dir);
    }
  });

  let touchStart = null;
  boardEl.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  boardEl.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    doMove(dir);
  }, { passive: true });

  newGameBtn.addEventListener('click', start);
  tryAgainBtn.addEventListener('click', start);
  keepBtn.addEventListener('click', hideMessage);
  undoBtn.addEventListener('click', undo);

  window.addEventListener('resize', relayout);

  // ---------- 启动 ----------
  loadBest();
  start();
})();
