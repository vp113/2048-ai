/*
 * 2048 — 游戏核心逻辑（无框架、无依赖）
 * 同一份代码同时用于浏览器 UI（window.Game2048）与 Node 测试（module.exports）。
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.Game2048 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 4;
  const TARGET = 2048;
  let idCounter = 0;

  function nextId() {
    idCounter += 1;
    return idCounter;
  }

  // 创建一个全是 null 的棋盘
  function createEmptyBoard(size = SIZE) {
    return Array.from({ length: size }, () => new Array(size).fill(null));
  }

  // 棋盘上空位的坐标列表
  function emptyCells(board) {
    const cells = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (!board[r][c]) cells.push({ r, c });
      }
    }
    return cells;
  }

  // 随机生成一个 2（90%）或 4（10%）到随机空位。rng 可注入以便测试。
  function addRandomTile(board, rng = Math.random) {
    const cells = emptyCells(board);
    if (cells.length === 0) return { board, tile: null, cell: null };
    const idx = Math.min(cells.length - 1, Math.floor(rng() * cells.length));
    const cell = cells[idx];
    const value = rng() < 0.9 ? 2 : 4;
    const tile = { id: nextId(), value };
    board[cell.r][cell.c] = tile;
    return { board, tile, cell };
  }

  // 依据方向，把棋盘切成若干条“行/列”，并按移动方向排列格子。
  function getLines(size, direction) {
    const lines = [];
    if (direction === 'left') {
      for (let r = 0; r < size; r++) {
        const line = [];
        for (let c = 0; c < size; c++) line.push({ r, c });
        lines.push(line);
      }
    } else if (direction === 'right') {
      for (let r = 0; r < size; r++) {
        const line = [];
        for (let c = size - 1; c >= 0; c--) line.push({ r, c });
        lines.push(line);
      }
    } else if (direction === 'up') {
      for (let c = 0; c < size; c++) {
        const line = [];
        for (let r = 0; r < size; r++) line.push({ r, c });
        lines.push(line);
      }
    } else { // down
      for (let c = 0; c < size; c++) {
        const line = [];
        for (let r = size - 1; r >= 0; r--) line.push({ r, c });
        lines.push(line);
      }
    }
    return lines;
  }

  // 对一条线做“压缩 + 合并”。items 元素为 { tile, cell }。
  // 每次移动中，每个方块最多参与一次合并。
  function slideLine(items) {
    const result = [];
    const merges = [];
    let score = 0;
    let i = 0;
    while (i < items.length) {
      const current = items[i];
      const next = items[i + 1];
      if (next && next.tile.value === current.tile.value) {
        const value = current.tile.value * 2;
        // 保留移动方向靠前的方块 id 作为“幸存者”，便于 UI 动画。
        result.push({ tile: { id: current.tile.id, value }, cell: current.cell });
        score += value;
        merges.push({
          survivorId: current.tile.id,
          absorbedId: next.tile.id,
          absorbedFrom: next.cell,
          value,
        });
        i += 2;
      } else {
        result.push(current);
        i += 1;
      }
    }
    return { result, score, merges };
  }

  // 执行一次移动，返回新棋盘、得分、是否移动，以及供 UI 动画用的轨迹。
  function move(board, direction) {
    const size = board.length;
    const newBoard = createEmptyBoard(size);
    let score = 0;
    let moved = false;
    const movements = [];
    const merges = [];

    for (const cells of getLines(size, direction)) {
      const items = [];
      for (const cell of cells) {
        const tile = board[cell.r][cell.c];
        if (tile) items.push({ tile, cell });
      }
      const slid = slideLine(items);
      score += slid.score;
      merges.push(...slid.merges);

      slid.result.forEach((entry, i) => {
        const toCell = cells[i];
        newBoard[toCell.r][toCell.c] = entry.tile;
        if (entry.cell.r !== toCell.r || entry.cell.c !== toCell.c) moved = true;
        movements.push({ id: entry.tile.id, from: entry.cell, to: toCell });
      });
    }

    if (merges.length > 0) moved = true;

    // 为每个合并补上目标位置（幸存者的落点），供 UI 动画对齐。
    for (const m of merges) {
      const surv = movements.find((mv) => mv.id === m.survivorId);
      if (surv) m.target = surv.to;
    }

    return { board: newBoard, score, moved, movements, merges };
  }

  function maxValue(board) {
    let max = 0;
    for (const row of board) {
      for (const t of row) {
        if (t && t.value > max) max = t.value;
      }
    }
    return max;
  }

  function hasWon(board) {
    return maxValue(board) >= TARGET;
  }

  function isGameOver(board) {
    const size = board.length;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!board[r][c]) return false;
        if (c + 1 < size && board[r][c + 1] && board[r][c + 1].value === board[r][c].value) return false;
        if (r + 1 < size && board[r + 1][c] && board[r + 1][c].value === board[r][c].value) return false;
      }
    }
    return true;
  }

  // 深拷贝棋盘（保留方块 id），用于“撤销”。
  function cloneBoard(board) {
    return board.map((row) => row.map((tile) => (tile ? { id: tile.id, value: tile.value } : null)));
  }

  // 测试辅助：数字矩阵 -> 棋盘；棋盘 -> 数字矩阵。
  function fromNumbers(grid) {
    return grid.map((row) => row.map((v) => (v === 0 ? null : { id: nextId(), value: v })));
  }
  function toNumbers(board) {
    return board.map((row) => row.map((tile) => (tile ? tile.value : 0)));
  }

  return {
    SIZE, TARGET, nextId, createEmptyBoard, emptyCells,
    addRandomTile, move, maxValue, hasWon, isGameOver,
    cloneBoard, fromNumbers, toNumbers,
  };
});
