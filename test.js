'use strict';

const assert = require('assert');
const http = require('node:http');

const Game = require('./game.js');
const AIClient = require('./ai-client.js');
const { createServer } = require('./serve.js');

const board = (nums) => Game.fromNumbers(nums);
const nums = (b) => Game.toNumbers(b);
const DIRS = ['up', 'right', 'down', 'left'];

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function eq(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
}

// ---------------------------------------------------------------------------
// Board rules
// ---------------------------------------------------------------------------
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

test('单次移动不重复合并：[2,2,4] -> [4,4]', () => {
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
  const b = board([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(Game.move(b, 'left').moved, false);
  assert.strictEqual(Game.move(b, 'right').moved, true);
});

test('addRandomTile：可注入 rng，90/10 生成', () => {
  const b = Game.createEmptyBoard();
  let i = 0;
  const seq = [0, 0.5];
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

test('合并产生 survivor/absorbed 元数据与目标位置', () => {
  const r = Game.move(board([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.strictEqual(r.merges.length, 1);
  assert.strictEqual(r.merges[0].value, 4);
  assert.notStrictEqual(r.merges[0].survivorId, r.merges[0].absorbedId);
  assert.ok(r.merges[0].target);
  eq([r.merges[0].target.r, r.merges[0].target.c], [0, 0]);
});

// ---------------------------------------------------------------------------
// AI client
// ---------------------------------------------------------------------------
test('boardToCode：空格、行列顺序与 65536 -> G', () => {
  const empty = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  assert.strictEqual(AIClient.boardToCode(empty), '0'.repeat(16));

  const full = [
    [2, 4, 0, 0],
    [8, 16, 32, 64],
    [128, 256, 512, 1024],
    [2048, 4096, 8192, 65536],
  ];
  assert.strictEqual(
    AIClient.boardToCode(full),
    '1200' + '3456' + '789A' + 'BCDG'
  );

  const tiles = [[{ value: 2 }, null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]];
  assert.strictEqual(AIClient.boardToCode(tiles), '1' + '0'.repeat(15));
});

test('parseReply：u/l/r/d/g 映射', () => {
  assert.strictEqual(AIClient.parseReply('u'), 'up');
  assert.strictEqual(AIClient.parseReply('l'), 'left');
  assert.strictEqual(AIClient.parseReply('r'), 'right');
  assert.strictEqual(AIClient.parseReply('d'), 'down');
  assert.strictEqual(AIClient.parseReply('g'), null);
  assert.throws(() => AIClient.parseReply('x'));
});

test('AI client：请求编码与响应解析', async () => {
  let requested = '';
  const fakeFetch = async (url) => {
    requested = url;
    return { ok: true, text: async () => 'r' };
  };
  const client = AIClient.createClient({
    endpoint: '/move',
    fetchImpl: fakeFetch,
    timeoutMs: 1000,
  });
  const move = await client.requestMove([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.strictEqual(move, 'right');
  assert.ok(requested.startsWith('/move?board=1'));

  const badReply = AIClient.createClient({
    endpoint: '/move',
    fetchImpl: async () => ({ ok: true, text: async () => 'x' }),
  });
  await assert.rejects(() => badReply.requestMove([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));

  const badStatus = AIClient.createClient({
    endpoint: '/move',
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  await assert.rejects(() => badStatus.requestMove([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]));
});

// ---------------------------------------------------------------------------
// Local web server / proxy
// ---------------------------------------------------------------------------
test('静态页面与 /move 代理', async () => {
  const mock = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('d');
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));

  const proxy = createServer({ aiBase: 'http://127.0.0.1:' + mock.address().port });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + proxy.address().port;

  try {
    const move = await fetch(base + '/move?board=0000000000000001');
    assert.strictEqual(move.status, 200);
    assert.strictEqual(await move.text(), 'd');

    const page = await fetch(base + '/');
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('<title>2048</title>'));
    assert.ok(html.includes('ai-client.js'));

    const missing = await fetch(base + '/nope');
    assert.strictEqual(missing.status, 404);
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => mock.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Replay record format
// ---------------------------------------------------------------------------
test('回放记录：移动 + 指定的新方块可重建分数与最大方块', () => {
  const record = {
    initial: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    moves: [[1, 2, 4]], // right, spawn flat 2 (row 0 col 2) with value 4
  };
  let b = Game.fromNumbers(record.initial);
  let score = 0;
  for (const move of record.moves) {
    const result = Game.move(b, DIRS[move[0]]);
    assert.strictEqual(result.moved, true);
    score += result.score;
    b = result.board;
    const flat = move[1];
    const value = move[2];
    if (flat >= 0) {
      const r = Math.floor(flat / 4);
      const c = flat % 4;
      assert.strictEqual(b[r][c], null);
      b[r][c] = { id: Game.nextId(), value: value };
    }
  }
  assert.strictEqual(score, 4);
  assert.strictEqual(Game.maxValue(b), 4);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
(async function () {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      console.log('  ✓ ' + t.name);
    } catch (error) {
      failed += 1;
      console.error('  ✗ ' + t.name);
      console.error('      ' + (error && error.message ? error.message : error));
    }
  }
  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
})();
