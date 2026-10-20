'use strict';

/*
 * 基准 / 对局模拟脚本（仅用于评估，不参与游戏运行）。
 *
 *   node bench.js --mode=micro
 *   node bench.js --mode=sim --ai=both --depths=3 --games=3 --seed=1000
 *
 * 旧版本 AI 从 Git 基线提取，位于 bench/ai-legacy.js。
 */

const Game = require('./game.js');
const NEW_AI = require('./ai.js');
const OLD_AI = require('./bench/ai-legacy.js');

function arg(name, def) {
  const prefix = '--' + name + '=';
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : def;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOARDS = {
  early: [2, 4, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4],
  mid: [2, 4, 8, 16, 32, 8, 4, 2, 0, 16, 0, 4, 2, 0, 32, 0],
  late: [1024, 512, 256, 128, 8, 16, 32, 64, 4, 2, 0, 0, 0, 0, 0, 0],
};

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function micro() {
  console.log('\n=== 单次决策基准（每格：耗时 / 节点数） ===');
  const header = ['棋盘', '深度', '旧版 AI', '新版 AI', '新版命中率', '提速'];
  console.log(header.join('\t'));
  for (const [name, g] of Object.entries(BOARDS)) {
    const maxDepth = parseInt(arg('maxDepth', '4'), 10);
    for (let d = 1; d <= maxDepth; d++) {
      const t0 = performance.now();
      const oldR = OLD_AI.chooseMoveFlat(g, d);
      const oldMs = performance.now() - t0;

      const t1 = performance.now();
      const newR = NEW_AI.chooseMoveFlat(g, d);
      const newMs = performance.now() - t1;

      const speedup = newMs > 0 ? (oldMs / newMs).toFixed(1) + 'x' : '—';
      console.log([
        name, d,
        oldMs.toFixed(1) + 'ms/' + fmt(oldR.nodes),
        newMs.toFixed(1) + 'ms/' + fmt(newR.nodes),
        (newR.hitRate * 100).toFixed(1) + '%',
        speedup,
      ].join('\t'));
    }
  }
}

function play(ai, depth, seed, maxSteps) {
  const rng = mulberry32(seed);
  let board = Game.createEmptyBoard();
  Game.addRandomTile(board, rng);
  Game.addRandomTile(board, rng);

  let score = 0;
  let steps = 0;
  let nodes = 0;
  let hits = 0;
  let lookups = 0;
  let decisionMs = 0;

  while (!Game.isGameOver(board) && steps < maxSteps) {
    const t0 = performance.now();
    const r = ai.chooseMove(board, depth);
    decisionMs += performance.now() - t0;
    nodes += r.nodes || 0;
    hits += r.hits || 0;
    lookups += r.lookups || 0;

    if (!r.direction) break;
    const moved = Game.move(board, r.direction);
    if (!moved.moved) break;
    score += moved.score;
    board = moved.board;
    Game.addRandomTile(board, rng);
    steps++;
  }

  return {
    seed, score, maxV: Game.maxValue(board), steps,
    ended: Game.isGameOver(board), decisionMs, nodes, hits, lookups,
  };
}

function sim(aiName, depth, games, baseSeed) {
  const ai = aiName === 'old' ? OLD_AI : NEW_AI;
  const rows = [];
  const maxSteps = parseInt(arg('maxSteps', '6000'), 10);
  for (let i = 0; i < games; i++) {
    const r = play(ai, depth, baseSeed + i * 7919, maxSteps);
    rows.push(r);
    console.log([
      '  seed=' + r.seed,
      'score=' + r.score,
      'max=' + r.maxV,
      'steps=' + r.steps,
      'ended=' + r.ended,
      'time=' + (r.decisionMs / 1000).toFixed(1) + 's',
      'avg=' + (r.decisionMs / Math.max(1, r.steps)).toFixed(2) + 'ms/步',
      'nodes=' + fmt(r.nodes),
      r.lookups ? 'hit=' + ((r.hits / r.lookups) * 100).toFixed(1) + '%' : '',
    ].join(' '));
  }
  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  return {
    ai: aiName, depth,
    avgScore: avg((r) => r.score),
    avgMax: avg((r) => r.maxV),
    minMax: Math.min(...rows.map((r) => r.maxV)),
    maxMax: Math.max(...rows.map((r) => r.maxV)),
    avgSteps: avg((r) => r.steps),
    ended: rows.filter((r) => r.ended).length + '/' + rows.length,
    totalTime: rows.reduce((s, r) => s + r.decisionMs, 0) / 1000,
    avgMs: avg((r) => r.decisionMs / Math.max(1, r.steps)),
    avgNodes: avg((r) => r.nodes),
    hitRate: (() => {
      const h = rows.reduce((s, r) => s + r.hits, 0);
      const l = rows.reduce((s, r) => s + r.lookups, 0);
      return l ? h / l : null;
    })(),
  };
}

function main() {
  const mode = arg('mode', 'all');
  if (mode === 'micro' || mode === 'all') micro();

  if (mode === 'sim' || mode === 'all') {
    const aiNames = arg('ai', 'both') === 'both' ? ['old', 'new'] : [arg('ai', 'new')];
    const depths = arg('depths', '3').split(',').map(Number);
    const games = parseInt(arg('games', '3'), 10);
    const seed = parseInt(arg('seed', '1000'), 10);

    console.log('\n=== 自动对局模拟（固定种子） ===');
    const summary = [];
    for (const d of depths) {
      for (const aiName of aiNames) {
        console.log('\n[' + aiName + ' | depth=' + d + ']');
        summary.push(sim(aiName, d, games, seed));
      }
    }

    console.log('\n=== 汇总 ===');
    console.log('版本\t深度\t平均分\t平均最大块\t最大块范围\t平均步数\t结束\t总耗时\t平均每步\t平均节点\t命中率');
    for (const s of summary) {
      console.log([
        s.ai, s.depth,
        Math.round(s.avgScore), Math.round(s.avgMax),
        s.minMax + '-' + s.maxMax,
        Math.round(s.avgSteps), s.ended,
        s.totalTime.toFixed(1) + 's', s.avgMs.toFixed(2) + 'ms',
        fmt(s.avgNodes),
        s.hitRate === null ? '—' : (s.hitRate * 100).toFixed(1) + '%',
      ].join('\t'));
    }
  }
}

main();
