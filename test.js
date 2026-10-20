'use strict';

const assert = require('assert');
const Game = require('./game.js');
const AI = require('./ai.js');

const board = (nums) => Game.fromNumbers(nums);
const nums = (b) => Game.toNumbers(b);

const tests = [];

function test(name, fn) { tests.push({ name, fn }); }
function eq(actual, expected, msg) { assert.deepStrictEqual(actual, expected, msg); }

// —— 合并规则 ——
test('左移：四个 2 合并为两个 4', () => {
  const r = Game.move(board([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  eq(nums(r.board), [[4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 8);
  assert.strictEqual(r.moved, true);
});

test('左移：隔空合并 [2,0,0,2] -> [4,...]', () => {
  const r = Game.move(board([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  eq(nums(r.board), [[4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 4);
});

test('右移：同行两次独立合并 [2,2,4,4] -> [0,0,4,8]', () => {
  const r = Game.move(board([[2, 2, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right');
  eq(nums(r.board), [[0, 0, 4, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 12);
});

test('上移：列合并', () => {
  const r = Game.move(board([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]), 'up');
  eq(nums(r.board), [[4, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 4);
});

test('下移：列合并', () => {
  const r = Game.move(board([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]), 'down');
  eq(nums(r.board), [[0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]]);
  assert.strictEqual(r.score, 4);
});

test('单次移动不重复合并：[2,2,4] -> [4,4] 而非 [8]', () => {
  const r = Game.move(board([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  eq(nums(r.board), [[4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 4);
});

test('合并结果不参与同次再合并：[4,4,8] -> [8,8]', () => {
  const r = Game.move(board([[4, 4, 8, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  eq(nums(r.board), [[8, 8, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(r.score, 8);
});

test('无法移动时 moved=false，可移动时 moved=true', () => {
  // [2,4,0,0] 已贴左边：左移不变；右移会滑到右边。
  const b = board([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(Game.move(b, 'left').moved, false);
  assert.strictEqual(Game.move(b, 'right').moved, true);
});

// —— 随机生成 ——
test('addRandomTile：按注入 rng 生成 2 到 (0,0)', () => {
  const b = Game.createEmptyBoard();
  let i = 0;
  const seq = [0, 0.5]; // 第 0 次选空位，第 1 次决定 2/4
  const rng = () => seq[i++ % seq.length];
  const added = Game.addRandomTile(b, rng);
  assert.ok(added.tile);
  assert.strictEqual(added.tile.value, 2);
  assert.strictEqual(b[0][0], added.tile);
});

test('addRandomTile：满盘返回 null', () => {
  const b = board([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 4096], [8192, 16384, 32768, 65536]]);
  assert.strictEqual(Game.addRandomTile(b).tile, null);
});

test('addRandomTile：数值只会是 2 或 4', () => {
  const b = Game.createEmptyBoard();
  for (let k = 0; k < 100; k++) {
    const a = Game.addRandomTile(b);
    if (a.tile) assert.ok(a.tile.value === 2 || a.tile.value === 4);
  }
});

// —— 胜负判断 ——
test('isGameOver：无空位且无相邻相等 -> true', () => {
  const b = board([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 4096], [8192, 16384, 32768, 65536]]);
  assert.strictEqual(Game.isGameOver(b), true);
});

test('isGameOver：存在相邻相等 -> false', () => {
  const b = board([[2, 2, 4, 8], [16, 32, 64, 128], [256, 512, 1024, 2048], [4096, 8192, 16384, 32768]]);
  assert.strictEqual(Game.isGameOver(b), false);
});

test('isGameOver：存在空位 -> false', () => {
  const b = board([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 4096], [8192, 16384, 32768, 0]]);
  assert.strictEqual(Game.isGameOver(b), false);
});

test('hasWon / maxValue', () => {
  assert.strictEqual(Game.hasWon(board([[2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])), true);
  assert.strictEqual(Game.maxValue(board([[2, 4, 0, 0], [0, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])), 1024);
});

// —— 动画元数据 ——
test('合并产生 survivor/absorbed 元数据与目标位置', () => {
  const r = Game.move(board([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.strictEqual(r.merges.length, 1);
  assert.strictEqual(r.merges[0].value, 4);
  assert.notStrictEqual(r.merges[0].survivorId, r.merges[0].absorbedId);
  assert.ok(r.merges[0].target, 'merge target should be set');
  eq([r.merges[0].target.r, r.merges[0].target.c], [0, 0]);
});

// —— AI：移动逻辑交叉验证 ——
test('AI 快速移动与 game.js 移动结果一致（随机棋盘 × 4 方向）', () => {
  let seed = 20261019;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 300; iter++) {
    const flat = [];
    for (let i = 0; i < 16; i++) {
      flat[i] = rand() < 0.35 ? 0 : (1 << (1 + Math.floor(rand() * 6))); // 0 或 2..64
    }
    const grid2d = [flat.slice(0, 4), flat.slice(4, 8), flat.slice(8, 12), flat.slice(12, 16)];
    const b = Game.fromNumbers(grid2d);
    for (const dir of ['left', 'right', 'up', 'down']) {
      const gm = Game.move(b, dir);
      const expected = Game.toNumbers(gm.board);
      const ai = AI.moveFlat(AI.toFlat(b), dir);
      const actual = [ai.grid.slice(0, 4), ai.grid.slice(4, 8), ai.grid.slice(8, 12), ai.grid.slice(12, 16)];
      assert.deepStrictEqual(actual, expected, '棋盘不一致 dir=' + dir);
      assert.strictEqual(ai.score, gm.score, '得分不一致 dir=' + dir);
      assert.strictEqual(ai.moved, gm.moved, '移动标志不一致 dir=' + dir);
    }
  }
});

// —— AI：搜索决策 ——
test('AI 深度1：合并两个 4 优于不合并的竖移', () => {
  const r = AI.chooseMoveFlat([4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 1);
  assert.ok(['left', 'right'].includes(r.direction), '应选 left/right，实际 ' + r.direction);
});

test('AI 保持最大值在角落：[[32,0,0,2]] 的走法不把 32 移出角落', () => {
  const g = [32, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = AI.chooseMoveFlat(g, 1);
  // 左移或下移都能让 32 继续留在某个角落。
  assert.ok(['left', 'down'].includes(r.direction), '意外方向: ' + r.direction);
  const after = AI.moveFlat(g, r.direction).grid;
  const pos = after.indexOf(32);
  assert.ok([0, 3, 12, 15].includes(pos), '32 被移出角落，位置=' + pos);
});

test('AI 在游戏结束棋盘上返回 direction=null', () => {
  const g = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
  assert.strictEqual(AI.chooseMoveFlat(g, 2).direction, null);
});

test('AI 对象棋盘 chooseMove 返回合法方向且节点数 > 0', () => {
  const b = Game.fromNumbers([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const r = AI.chooseMove(b, 2);
  assert.ok(['left', 'right', 'up', 'down'].includes(r.direction));
  assert.ok(r.nodes > 0);
});

// —— AI：启发式 ——
test('heuristic：空格越多分数越高（空棋盘 > 一个2）', () => {
  const empty = new Array(16).fill(0);
  const one = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(AI.heuristic(empty) > AI.heuristic(one));
});

test('heuristic：最大值在角落优于在中心', () => {
  const corner = [16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const center = [0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.ok(AI.heuristic(corner) > AI.heuristic(center));
});

// —— 优化后新增：单调性 ——
test('lineMono：完全单调的线为 0（递增、递减都可以）', () => {
  assert.strictEqual(AI.lineMono([1, 2, 3, 4]), 0);
  assert.strictEqual(AI.lineMono([4, 3, 2, 1]), 0);
});

test('lineMono：混乱排列被惩罚（旧实现会误奖）', () => {
  // [2,4,1,3] 的相邻变化为 +2,-3,+2：两个方向都必须付出代价。
  assert.ok(AI.lineMono([2, 4, 1, 3]) < 0);
  assert.ok(AI.lineMono([2, 4, 1, 3]) < AI.lineMono([1, 2, 3, 4]));
});

test('lineMono：空格被跳过，不当作数字 0 参与比较', () => {
  // 跳过空格后 [1,2] 仍单调递增；若把空格当 0，会算成 1→0→2 的混乱排列。
  assert.strictEqual(AI.lineMono([1, 0, 2, 0]), 0);
  assert.strictEqual(AI.lineMono([0, 1, 0, 2]), 0);
  // 跳过空格后为 [1,3,2]：+2,-1，两个方向都有反向代价 → -1。
  assert.strictEqual(AI.lineMono([1, 0, 3, 2]), -1);
});

// —— 优化后新增：平滑度 ——
test('lineSmooth：相邻差之和，跳过空格', () => {
  assert.strictEqual(AI.lineSmooth([1, 2, 3, 4]), 3);
  assert.strictEqual(AI.lineSmooth([2, 2, 2, 2]), 0);
  // 旧实现把 0 当数字：|1-0|+|0-0|+|0-2| = 3；正确做法是只看非空相邻 → 1。
  assert.strictEqual(AI.lineSmooth([1, 0, 0, 2]), 1);
});

// —— 优化后新增：随机节点概率 ——
test('机会节点严格按 90% / 10% 加权', () => {
  // 满盘前留一格；含 2,2 相邻对，落子后仍不是死局。
  const base = [2, 2, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 0];
  const g2 = base.slice(); g2[15] = 2;
  const g4 = base.slice(); g4[15] = 4;
  const expected = 0.9 * AI.heuristic(g2) + 0.1 * AI.heuristic(g4);
  const got = AI.chanceValue(base, 0);
  assert.ok(Math.abs(got - expected) < 1e-6, '期望值不符: got=' + got + ' expected=' + expected);

  // 如果错误地当成 50/50，结果应当不同，说明权重确实生效。
  const half = 0.5 * AI.heuristic(g2) + 0.5 * AI.heuristic(g4);
  assert.ok(Math.abs(half - got) > 1e-6);
});

test('机会节点覆盖所有空格位置（而非只取第一个）', () => {
  const base = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // depth 0 时，应是对 15 个空位分别落 2/4 的期望；只要实现漏掉空格，结果就会偏离。
  let expected = 0;
  for (let i = 1; i < 16; i++) {
    const a = base.slice(); a[i] = 2;
    const b = base.slice(); b[i] = 4;
    expected += (0.9 * AI.heuristic(a) + 0.1 * AI.heuristic(b)) / 15;
  }
  const got = AI.chanceValue(base, 0);
  assert.ok(Math.abs(got - expected) < 1e-6);
});

// —— 优化后新增：置换表正确性 ——
test('缓存与禁用缓存的结果完全一致（随机棋盘 × 深度 1-3）', () => {
  let seed = 998244353;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iter = 0; iter < 12; iter++) {
    const g = [];
    for (let i = 0; i < 16; i++) {
      g[i] = rand() < 0.3 ? 0 : (1 << (1 + Math.floor(rand() * 7)));
    }
    for (const depth of [1, 2, 3]) {
      const cached = AI.chooseMoveFlat(g, depth);
      const plain = AI.chooseMoveFlat(g, depth, { useCache: false });
      assert.strictEqual(cached.direction, plain.direction, '方向不一致 d=' + depth);
      assert.strictEqual(cached.value, plain.value, '评估值不一致 d=' + depth);
      assert.ok(cached.nodes <= plain.nodes, '缓存不应增加访问节点');
    }
  }
});

test('置换表在中盘深度 3 有实际命中', () => {
  const g = [2, 4, 8, 16, 32, 8, 4, 2, 0, 16, 0, 4, 2, 0, 32, 0];
  const r = AI.chooseMoveFlat(g, 3);
  assert.ok(r.hits > 0, '命中数应为正，实际 ' + r.hits);
  assert.ok(r.hitRate > 0 && r.hitRate <= 1);
});

test('搜索不会修改传入的棋盘', () => {
  const g = [2, 4, 8, 16, 32, 8, 4, 2, 0, 16, 0, 4, 2, 0, 32, 0];
  const copy = g.slice();
  AI.chooseMoveFlat(g, 3);
  assert.deepStrictEqual(g, copy);
});

test('递归分支互不影响：重复搜索同一棋盘结果完全一致', () => {
  const g = [2, 4, 8, 16, 32, 8, 4, 2, 0, 16, 0, 4, 2, 0, 32, 0];
  const copy = g.slice();
  const a = AI.chooseMoveFlat(g, 3);
  const b = AI.chooseMoveFlat(g, 3);
  assert.deepStrictEqual(g, copy, '输入棋盘被修改');
  assert.strictEqual(a.direction, b.direction);
  assert.strictEqual(a.value, b.value);
  assert.strictEqual(a.nodes, b.nodes);
});

// —— 优化后新增：游戏结束评估 ——
test('死亡棋盘启发式返回强负值，不会被角落奖励高估', () => {
  const dead = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
  assert.strictEqual(AI.heuristic(dead), AI.TERMINAL);
  assert.ok(AI.TERMINAL < -1e8);
});

test('满盘但存在相邻相等时仍会继续搜索合并走法', () => {
  const full = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2, 4, 8, 16, 32, 32];
  const b = Game.fromNumbers([full.slice(0, 4), full.slice(4, 8), full.slice(8, 12), full.slice(12, 16)]);
  assert.strictEqual(Game.isGameOver(b), false);
  const r = AI.chooseMoveFlat(full, 2);
  assert.notStrictEqual(r.direction, null, '满盘可合并时不应判为无路可走');
});

// —— 运行 ——
let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  ✓ ' + t.name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + t.name);
    console.error('      ' + (e && e.message ? e.message : e));
  }
}
console.log('');
console.log(passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
