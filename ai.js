/*
 * 2048 — AI（Expectimax 搜索 + 启发式评估），无框架、无依赖。
 * 自包含：不依赖 game.js，内部用一维数组（长度 16，0=空）做快速移动，
 * 便于在 Web Worker 与 Node 测试中复用。浏览器挂载到 window.AI2048。
 *
 * 设计要点：
 *  - 机会节点严格按 90% 出 2、10% 出 4 对每个空格求期望；
 *  - 启发式只做惩罚/奖励的可解释线性组合；
 *  - 置换表（Transposition Table）以“棋盘 + 剩余深度 + 节点类型”为键；
 *  - 死亡棋盘返回强负值（TERMINAL），避免高估。
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

  // 新方块概率：2 为 90%，4 为 10%（机会节点的加权）。
  const SPAWN_2 = 0.9;
  const SPAWN_4 = 0.1;

  // 死亡棋盘（无空位且无相邻相等）的评估值。远小于任何正常启发式得分。
  const TERMINAL = -1e9;

  // 启发式权重。所有分量基于 log2 尺度：
  //   empty  : 每个空格 +100
  //   mono   : 单调性惩罚（≤ 0）×25
  //   smooth : 平滑度惩罚（≥ 0）×8，做减法
  //   corner : 最大值在角落 +35 × log2(最大值)
  const W = {
    empty: 100,
    mono: 25,
    smooth: 8,
    corner: 35,
  };

  // 置换表最多保存的条目数，防止高深度搜索耗尽内存。
  const TT_LIMIT = 300000;

  // 预计算每条移动线的索引顺序（靠近目标边在前）。
  const LINES = {
    left: makeRows([0, 1, 2, 3]),
    right: makeRows([3, 2, 1, 0]),
    up: makeCols([0, 1, 2, 3]),
    down: makeCols([3, 2, 1, 0]),
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

  // ---------------------------------------------------------------------------
  // 快速移动（无对象分配，非重入）
  // ---------------------------------------------------------------------------
  const MV = new Int32Array(8); // [0..3] 输入，[4..7] 输出
  let MOVE_SCORE = 0;

  // 搜索内部复用数组：同一“剩余深度”上同时只有一个活动分支，
  // 因此可以让所有同层 maxNode 共用同一个输出数组，避免海量分配。
  const GRID_POOL = [];
  function getGrid(level) {
    let g = GRID_POOL[level];
    if (!g) {
      g = new Array(16).fill(0);
      GRID_POOL[level] = g;
    }
    return g;
  }

  // 把移动结果写入 out，返回是否发生了移动。out 必须与 grid 不是同一数组。
  // 会完整写入 16 个位置（含 0），因此复用时无需额外清空。
  // 每个方块每次移动最多参与一次合并。
  function moveInto(grid, dir, out) {
    const lines = LINES[dir];
    let score = 0;
    let moved = false;

    for (let li = 0; li < 4; li++) {
      const cells = lines[li];
      let n = 0;
      for (let i = 0; i < 4; i++) {
        const v = grid[cells[i]];
        if (v) MV[n++] = v;
      }
      let m = 0;
      let i = 0;
      while (i < n) {
        if (i + 1 < n && MV[i] === MV[i + 1]) {
          const v = MV[i] * 2;
          MV[4 + m++] = v;
          score += v;
          i += 2;
        } else {
          MV[4 + m++] = MV[i++];
        }
      }
      if (m !== n) moved = true; // 发生过合并
      for (let j = 0; j < 4; j++) {
        const at = cells[j];
        const v = j < m ? MV[4 + j] : 0;
        out[at] = v;
        if (grid[at] !== v) moved = true; // 发生过滑动或合并
      }
    }
    MOVE_SCORE = score;
    return moved;
  }

  // 对外 API：返回 { grid, score, moved }，不修改原数组。
  function moveFlat(grid, dir) {
    const next = new Array(16).fill(0);
    const moved = moveInto(grid, dir, next);
    return { grid: next, score: MOVE_SCORE, moved };
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

  // ---------------------------------------------------------------------------
  // 行/列统计缓存
  // ---------------------------------------------------------------------------
  // 一条线由 4 个 log2 值组成，每个 0..31，用 20 位打包成整数键。
  // 缓存值打包为 ((mono + 128) << 8) | smooth，-1 表示未计算。
  const LINE_SLOTS = 1 << 20;
  const LINE_CACHE = new Int32Array(LINE_SLOTS);
  LINE_CACHE.fill(-1);
  const LINE_VALS = new Int8Array(4);

  // 真正的单调性：分别计算“保持递增”和“保持递减”两种方向下，
  // 必须付出多少反向代价；取较小的代价并取负。结果是 ≤ 0 的惩罚值，
  // 完全单调的线为 0，任一方向的混乱都会扣分（不会奖励混乱排列）。
  // 空格（0）被跳过，不当作数字 0 参与比较。
  function lineMonoValues(a, b, c, d) {
    LINE_VALS[0] = a; LINE_VALS[1] = b; LINE_VALS[2] = c; LINE_VALS[3] = d;
    let prev = -1;
    let penInc = 0; // 选择“递增”方向时，下降造成的代价
    let penDec = 0; // 选择“递减”方向时，上升造成的代价
    for (let i = 0; i < 4; i++) {
      const x = LINE_VALS[i];
      if (x === 0) continue; // 空格不参与
      if (prev >= 0) {
        const diff = x - prev;
        if (diff > 0) penDec += diff; else penInc -= diff;
      }
      prev = x;
    }
    return 0 - Math.min(penInc, penDec); // 避免 -0（测试与比较更干净）
  }

  // 平滑度：相邻（跳过空格后）数字的 log2 差之和，越小越好。
  function lineSmoothValues(a, b, c, d) {
    LINE_VALS[0] = a; LINE_VALS[1] = b; LINE_VALS[2] = c; LINE_VALS[3] = d;
    let prev = -1;
    let smooth = 0;
    for (let i = 0; i < 4; i++) {
      const x = LINE_VALS[i];
      if (x === 0) continue;
      if (prev >= 0) smooth += Math.abs(x - prev);
      prev = x;
    }
    return smooth;
  }

  function computeLineStats(key) {
    const a = key & 31;
    const b = (key >>> 5) & 31;
    const c = (key >>> 10) & 31;
    const d = (key >>> 15) & 31;
    const mono = lineMonoValues(a, b, c, d);
    const smooth = lineSmoothValues(a, b, c, d);
    return ((mono + 128) << 8) | smooth;
  }

  function lineStats(key) {
    let packed = LINE_CACHE[key];
    if (packed === -1) {
      packed = computeLineStats(key);
      LINE_CACHE[key] = packed;
    }
    return packed;
  }

  // 公开的行级函数（接受 log2 值数组，便于测试）。
  function lineMono(v) {
    return lineMonoValues(v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0);
  }
  function lineSmooth(v) {
    return lineSmoothValues(v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0);
  }

  // ---------------------------------------------------------------------------
  // 启发式评估
  // ---------------------------------------------------------------------------
  const LOG_SCRATCH = new Int8Array(16);

  // 满盘时是否存在可合并的相邻对（决定是否真的“游戏结束”）。
  function hasMerge(grid) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c;
        const v = grid[i];
        if (!v) continue;
        if (c < 3 && grid[i + 1] === v) return true;
        if (r < 3 && grid[i + 4] === v) return true;
      }
    }
    return false;
  }

  // 无对象分配的核心评估（搜索热路径）。
  function computeHeuristic(grid) {
    let empty = 0;
    let maxV = 0;
    for (let i = 0; i < 16; i++) {
      const v = grid[i];
      if (v === 0) {
        empty++;
        LOG_SCRATCH[i] = 0;
      } else {
        LOG_SCRATCH[i] = 31 - Math.clz32(v);
        if (v > maxV) maxV = v;
      }
    }

    // 死亡棋盘直接返回强负值，避免角落/大数字奖励把它抬成“好棋”。
    if (empty === 0 && !hasMerge(grid)) return TERMINAL;

    let mono = 0;
    let smooth = 0;
    for (let r = 0; r < 4; r++) {
      const b = r * 4;
      const key = LOG_SCRATCH[b] | (LOG_SCRATCH[b + 1] << 5) |
                  (LOG_SCRATCH[b + 2] << 10) | (LOG_SCRATCH[b + 3] << 15);
      const p = lineStats(key);
      mono += (p >> 8) - 128;
      smooth += p & 255;
    }
    for (let c = 0; c < 4; c++) {
      const key = LOG_SCRATCH[c] | (LOG_SCRATCH[c + 4] << 5) |
                  (LOG_SCRATCH[c + 8] << 10) | (LOG_SCRATCH[c + 12] << 15);
      const p = lineStats(key);
      mono += (p >> 8) - 128;
      smooth += p & 255;
    }

    let corner = 0;
    if (maxV > 0 && (grid[0] === maxV || grid[3] === maxV ||
                     grid[12] === maxV || grid[15] === maxV)) {
      corner = 31 - Math.clz32(maxV);
    }

    return W.empty * empty + W.mono * mono - W.smooth * smooth + W.corner * corner;
  }

  function heuristic(grid) {
    return computeHeuristic(grid);
  }

  // 供测试/展示：返回各分量（会分配对象，不在搜索热路径使用）。
  function heuristicParts(grid) {
    let empty = 0;
    let maxV = 0;
    for (let i = 0; i < 16; i++) {
      const v = grid[i];
      if (v === 0) empty++;
      else if (v > maxV) maxV = v;
    }
    if (empty === 0 && !hasMerge(grid)) {
      return { empty, maxV, mono: 0, smooth: 0, corner: 0, terminal: true, value: TERMINAL };
    }
    let mono = 0;
    let smooth = 0;
    for (let r = 0; r < 4; r++) {
      const v = [lg(grid[r * 4]), lg(grid[r * 4 + 1]), lg(grid[r * 4 + 2]), lg(grid[r * 4 + 3])];
      mono += lineMono(v);
      smooth += lineSmooth(v);
    }
    for (let c = 0; c < 4; c++) {
      const v = [lg(grid[c]), lg(grid[c + 4]), lg(grid[c + 8]), lg(grid[c + 12])];
      mono += lineMono(v);
      smooth += lineSmooth(v);
    }
    let corner = 0;
    if (maxV > 0 && (grid[0] === maxV || grid[3] === maxV ||
                     grid[12] === maxV || grid[15] === maxV)) {
      corner = lg(maxV);
    }
    return {
      empty, maxV, mono, smooth, corner, terminal: false,
      value: W.empty * empty + W.mono * mono - W.smooth * smooth + W.corner * corner,
    };
  }

  // ---------------------------------------------------------------------------
  // Expectimax + 置换表
  // ---------------------------------------------------------------------------
  let tt = null;
  let ttEntries = 0;
  let stats = null;

  // 键必须同时包含：节点类型（m/c）、剩余深度、完整棋盘。
  // 为消除字符串分配开销，棋盘按每格 6 bit 精确打包成 4 个 24 位整数
  //（空格=0，2^k -> k+1），再配合 meta（深度 + 类型）做精确校验；
  // 哈希只负责定位桶，因此哈希碰撞不会导致错误命中。
  let CUR_HASH = 0;
  let CUR_K0 = 0, CUR_K1 = 0, CUR_K2 = 0, CUR_K3 = 0;
  let CUR_META = 0;

  function makeState(grid, remaining, type) {
    const isMax = type === 'm';
    let h = (isMax ? 0x9e3779b9 : 0x85ebca6b) ^ (remaining + 0x9e3779b9);
    let k0 = 0, k1 = 0, k2 = 0, k3 = 0;
    for (let i = 0; i < 16; i++) {
      const v = grid[i];
      const code = v === 0 ? 0 : (31 - Math.clz32(v)) + 1; // 空格=0，2->2，4->3…
      const shift = (i & 3) * 6;
      if (i < 4) k0 |= code << shift;
      else if (i < 8) k1 |= code << shift;
      else if (i < 12) k2 |= code << shift;
      else k3 |= code << shift;
      h = Math.imul(h ^ code, 16777619);
    }
    CUR_HASH = h >>> 0;
    CUR_K0 = k0; CUR_K1 = k1; CUR_K2 = k2; CUR_K3 = k3;
    CUR_META = remaining | (isMax ? 32 : 0);
  }

  function ttLookup(hash, meta, k0, k1, k2, k3) {
    if (!tt) return undefined; // 显式禁用缓存
    stats.lookups++;
    let e = tt.get(hash);
    while (e) {
      if (e.meta === meta && e.k0 === k0 && e.k1 === k1 && e.k2 === k2 && e.k3 === k3) {
        stats.hits++;
        return e.value;
      }
      e = e.next; // 哈希桶冲突时继续比较
    }
    return undefined;
  }

  function ttStore(hash, meta, k0, k1, k2, k3, value) {
    if (!tt || ttEntries >= TT_LIMIT) return;
    const head = tt.get(hash);
    let e = head;
    while (e) {
      if (e.meta === meta && e.k0 === k0 && e.k1 === k1 && e.k2 === k2 && e.k3 === k3) {
        e.value = value;
        return;
      }
      e = e.next;
    }
    tt.set(hash, { meta, k0, k1, k2, k3, value, next: head || null });
    ttEntries++;
  }

  // 机会节点：先随机落子（对每个空格 90% 出 2、10% 出 4），再轮到玩家。
  // remaining 表示“此后还剩几步玩家移动”；0 表示本次落子后只做静态评估。
  function chanceNode(grid, remaining, st) {
    st.nodes++;
    makeState(grid, remaining, 'c');
    const hash = CUR_HASH;
    const meta = CUR_META, k0 = CUR_K0, k1 = CUR_K1, k2 = CUR_K2, k3 = CUR_K3;
    const cached = ttLookup(hash, meta, k0, k1, k2, k3);
    if (cached !== undefined) return cached;

    let count = 0;
    for (let i = 0; i < 16; i++) if (grid[i] === 0) count++;

    let value;
    if (count === 0) {
      // 满盘时不会落子。只要还有相邻相等，就仍可合法合并，必须继续搜索。
      value = remaining <= 0 ? computeHeuristic(grid) : maxNode(grid, remaining, st);
    } else {
      let total = 0;
      for (let i = 0; i < 16; i++) {
        if (grid[i] !== 0) continue;
        grid[i] = 2;
        total += SPAWN_2 * (remaining <= 0 ? computeHeuristic(grid) : maxNode(grid, remaining, st));
        grid[i] = 4;
        total += SPAWN_4 * (remaining <= 0 ? computeHeuristic(grid) : maxNode(grid, remaining, st));
        grid[i] = 0; // 恢复现场，保证各分支互不影响
      }
      value = total / count;
    }

    ttStore(hash, meta, k0, k1, k2, k3, value);
    return value;
  }

  // 极大节点：玩家在四个方向中取期望值最大的一个。
  function maxNode(grid, remaining, st) {
    st.nodes++;
    if (remaining <= 0) return computeHeuristic(grid);
    makeState(grid, remaining, 'm');
    const hash = CUR_HASH;
    const meta = CUR_META, k0 = CUR_K0, k1 = CUR_K1, k2 = CUR_K2, k3 = CUR_K3;
    const cached = ttLookup(hash, meta, k0, k1, k2, k3);
    if (cached !== undefined) return cached;

    let best = -Infinity;
    let moved = false;
    const out = getGrid(remaining);
    for (let d = 0; d < 4; d++) {
      if (!moveInto(grid, DIRS[d], out)) continue;
      moved = true;
      const val = chanceNode(out, remaining - 1, st);
      if (val > best) best = val;
    }
    if (!moved) best = TERMINAL; // 真正的游戏结束

    ttStore(hash, meta, k0, k1, k2, k3, best);
    return best;
  }

  // 顶层入口：depth = 向前看的玩家步数。
  // options.useCache === false 时禁用置换表（用于测试/对比）。
  function chooseMoveFlat(grid, depth, options) {
    depth = Math.max(1, Math.floor(depth || 1));
    const useCache = !options || options.useCache !== false;
    tt = useCache ? new Map() : null;
    ttEntries = 0;
    stats = { nodes: 0, hits: 0, lookups: 0 };

    const results = {};
    let best = -Infinity;
    let bestDir = null;
    const moveOut = getGrid(depth);

    for (let d = 0; d < 4; d++) {
      const dir = DIRS[d];
      if (!moveInto(grid, dir, moveOut)) {
        results[dir] = null;
        continue;
      }
      const val = chanceNode(moveOut, depth - 1, stats);
      results[dir] = val;
      if (val > best) { best = val; bestDir = dir; }
    }

    const evaluated = stats.nodes - stats.hits;
    const hitRate = stats.lookups > 0 ? stats.hits / stats.lookups : 0;
    const out = {
      direction: bestDir,          // null 表示无路可走
      value: bestDir ? best : computeHeuristic(grid),
      nodes: stats.nodes,          // 节点访问数（含缓存命中）
      evaluated,                   // 实际展开/评估的节点数
      hits: stats.hits,
      lookups: stats.lookups,
      hitRate,                     // 置换表命中率（命中 / 查询）
      depth,
      results,                     // 各方向的期望值
    };
    tt = null;
    stats = null;
    return out;
  }

  // 测试辅助：直接对“落子后的棋盘”求机会节点期望值。
  function chanceValue(grid, remaining) {
    const g = grid.slice();
    tt = new Map();
    ttEntries = 0;
    stats = { nodes: 0, hits: 0, lookups: 0 };
    const v = chanceNode(g, Math.max(0, Math.floor(remaining || 0)), stats);
    tt = null;
    stats = null;
    return v;
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
  function chooseMove(board, depth, options) {
    return chooseMoveFlat(toFlat(board), depth, options);
  }

  return {
    DIRS, SIZE, SPAWN_2, SPAWN_4, TERMINAL, WEIGHTS: W,
    moveFlat, chooseMoveFlat, chooseMove, chanceValue, toFlat,
    heuristic, heuristicParts, lineMono, lineSmooth, hasMerge,
    lg, emptyIndices, equalGrid,
  };
});
