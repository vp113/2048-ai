'use strict';

const assert = require('assert');
const Game = require('./game.js');

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
