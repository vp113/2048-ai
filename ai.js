/*
 * 2048 — AI（Expectimax 搜索 + 启发式评估），无框架、无依赖。
 * 自包含：不依赖 game.js，内部使用一维数组（长度 16，0=空）做快速移动，
 * 便于在 Web Worker 与 Node 测试中复用。浏览器挂载到 window.AI2048。
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.AI2048 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 4;
  const DIRS = ['left', 'right', 'up', 'down'];

  // 新方块出现的概率：2 为 90%，4 为 10%（Expectimax 的“机会节点”）。
  const SPAWN_2 = 0.9;
  const SPAWN_4 = 0.1;

  // 启发式权重（各分量都基于 log2 尺度，便于解释与调参）。
  const W = {
    empty: 250,   // 每个空格的奖励
    mono: 12,     // 单调性奖励（行/列数值朝同一方向递减）
    smooth: 6,    // 平滑度惩罚（相邻数字差异大则惩罚）
    corner: 40,   // 最大值位于角落的奖励（乘 log2(最大值)）
  };

  // 预计算每条移动线的索引顺序（按移动方向，靠近目标边在前）。
  const LINES = {
    left:  makeRows([0, 1, 2, 3]),
    right: makeRows([3, 2, 1, 0]),
    up:    makeCols([0, 1, 2, 3]),
    down:  makeCols([3, 2, 1, 0]),
  };
  function makeRows(order) {
    const lines = [];
    for (let r = 0; r < 4; r++) lines.push(order.map((c) => r * 4 + c));
    return lines;
  }
  function makeCols(order) {
    const lines = [];
    for (let c = 0; c < 4; c++) lines.push(order.map((r) => r * 4 + c));
    return lines;
  }

  // 2 的幂的整数 log2（方块值只会是 2、4、8…），0 -> 0。
  function lg(v) { return v === 0 ? 0 : 31 - Math.clz32(v); }

  // 一维数组上的快速移动，返回 { grid, score }，不修改原数组。
  function moveFlat(grid, dir) {
    const next = new Array(16).fill(0);
    let score = 0;
    const lines = LINES[dir];
    for (let li = 0; li < 4; li++) {
      const cells = lines[li];
      const vals = [];
      for (let i = 0; i < 4; i++) {
        const v = grid[cells[i]];
        if (v) vals.push(v);
      }
      const res = [];
      let i = 0;
      while (i < vals.length) {
        if (i + 1 < vals.length && vals[i + 1] === vals[i]) {
          const v = vals[i] * 2;
          res.push(v);
          score += v;
          i += 2;
        } else {
          res.push(vals[i]);
          i += 1;
        }
      }
      for (let j = 0; j < res.length; j++) next[cells[j]] = res[j];
    }
    return { grid: next, score };
  }

  function equalGrid(a, b) {
    for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function emptyIndices(grid) {
    const e = [];
    for (let i = 0; i < 16; i++) if (grid[i] === 0) e.push(i);
    return e;
  }

  // ---- 启发式评估 ----
  // 单条线（4 个 log2 值）的单调性：取“递增总幅度”与“递减总幅度”较大者。
  function lineMono(v) {
    let inc = 0, dec = 0;
    for (let i = 1; i < 4; i++) {
      const d = v[i] - v[i - 1];
      if (d > 0) inc += d; else dec -= d;
    }
    return inc > dec ? inc : dec;
  }

  function heuristic(grid) {
    let empty = 0;
    let maxV = 0;
    for (let i = 0; i < 16; i++) {
      const v = grid[i];
      if (v === 0) empty++;
      else if (v > maxV) maxV = v;
    }

    // 单调性：4 行 + 4 列
    let mono = 0;
    for (let r = 0; r < 4; r++) {
      mono += lineMono([lg(grid[r * 4]), lg(grid[r * 4 + 1]), lg(grid[r * 4 + 2]), lg(grid[r * 4 + 3])]);
    }
    for (let c = 0; c < 4; c++) {
      mono += lineMono([lg(grid[c]), lg(grid[4 + c]), lg(grid[8 + c]), lg(grid[12 + c])]);
    }

    // 平滑度：所有相邻（右、下）数字对的 log2 差之和，越小越平滑。
    let smooth = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = lg(grid[r * 4 + c]);
        if (c + 1 < 4) smooth += Math.abs(v - lg(grid[r * 4 + c + 1]));
        if (r + 1 < 4) smooth += Math.abs(v - lg(grid[r * 4 + 4 + c]));
      }
    }

    // 最大值是否落在角落。
    let corner = 0;
    if (maxV > 0) {
      const corners = [grid[0], grid[3], grid[12], grid[15]];
      for (let i = 0; i < 4; i++) {
        if (corners[i] === maxV) { corner = lg(maxV); break; }
      }
    }

    return W.empty * empty + W.mono * mono - W.smooth * smooth + W.corner * corner;
  }

  // ---- Expectimax ----
  // 机会节点：在某个空格出现 2（90%）或 4（10%）后，取期望值。
  function chanceNode(grid, depth, stats) {
    stats.nodes++;
    const empties = emptyIndices(grid);
    if (depth <= 0 || empties.length === 0) return heuristic(grid);
    let total = 0;
    for (let i = 0; i < empties.length; i++) {
      const idx = empties[i];
      grid[idx] = 2;
      total += SPAWN_2 * maxNode(grid, depth, stats);
      grid[idx] = 4;
      total += SPAWN_4 * maxNode(grid, depth, stats);
      grid[idx] = 0;
    }
    return total / empties.length;
  }

  // 极大节点：在四个方向里取期望值最大者。
  function maxNode(grid, depth, stats) {
    stats.nodes++;
    let best = -Infinity;
    let moved = false;
    for (let d = 0; d < 4; d++) {
      const res = moveFlat(grid, DIRS[d]);
      if (equalGrid(grid, res.grid)) continue; // 该方向无变化
      moved = true;
      const val = chanceNode(res.grid, depth - 1, stats);
      if (val > best) best = val;
    }
    if (!moved) best = heuristic(grid); // 无路可走（游戏结束）
    return best;
  }

  // 顶层入口：depth = 向前看的“步数”（极大节点层数）。
  function chooseMoveFlat(grid, depth) {
    depth = Math.max(1, Math.floor(depth || 1));
    const stats = { nodes: 0 };
    const results = {};
    let best = -Infinity;
    let bestDir = null;

    for (let d = 0; d < 4; d++) {
      const dir = DIRS[d];
      const res = moveFlat(grid, dir);
      if (equalGrid(grid, res.grid)) {
        results[dir] = null;
        continue;
      }
      const val = chanceNode(res.grid, depth - 1, stats);
      results[dir] = val;
      if (val > best) { best = val; bestDir = dir; }
    }

    return {
      direction: bestDir,               // null 表示无路可走
      value: bestDir ? best : heuristic(grid),
      nodes: stats.nodes,
      depth,
      results,                          // 每个方向的期望值（用于展示/调试）
    };
  }

  // 游戏棋盘（二维对象）<-> 一维数字数组。
  function toFlat(board) {
    const g = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const t = board[r][c];
        g[r * 4 + c] = t ? t.value : 0;
      }
    }
    return g;
  }
  function chooseMove(board, depth) {
    return chooseMoveFlat(toFlat(board), depth);
  }

  return {
    DIRS, moveFlat, chooseMoveFlat, chooseMove, toFlat,
    heuristic, lineMono, lg, emptyIndices, equalGrid,
  };
});
