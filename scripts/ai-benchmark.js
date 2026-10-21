'use strict';

/*
 * Headless AI benchmark: plays full 2048 games through the local C++ AI
 * /move endpoint using the same game.js rules as the web page. No browser,
 * no DOM, no animation.
 *
 *   node scripts/ai-benchmark.js --games 10
 *   node scripts/ai-benchmark.js --games 100 --seed 7
 *   node scripts/ai-benchmark.js --games 500 --out reports/run-500
 *
 * Reports are written as JSON and CSV under reports/ by default. Every game
 * also writes a web-compatible version-1 replay to reports/replays/. The
 * default is ONE game: large runs are never started automatically.
 */

const fs = require('node:fs');
const path = require('node:path');
const Game = require('../game.js');
const AIClient = require('../ai-client.js');

const THRESHOLDS = [2048, 4096, 8192, 16384, 32768, 65536];
const DIR_INDEX = { up: 0, right: 1, down: 2, left: 3 };
const REPLAY_DIR = path.resolve('reports', 'replays');

function displayPath(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf('--' + name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function intArg(name, fallback, min) {
  const value = Number(arg(name, String(fallback)));
  if (!Number.isInteger(value) || value < min) {
    throw new Error('--' + name + ' must be an integer >= ' + min);
  }
  return value;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

async function playGame(client, index, seed, maxMoves) {
  const rng = mulberry32(seed);
  let board = Game.createEmptyBoard();
  Game.addRandomTile(board, rng);
  Game.addRandomTile(board, rng);

  const initial = Game.toNumbers(board);
  const moves = [];
  let score = 0;
  let steps = 0;
  let ended = false;
  let truncated = false;
  const started = performance.now();

  while (true) {
    if (Game.isGameOver(board)) { ended = true; break; }
    if (steps >= maxMoves) { truncated = true; break; }

    const move = await client.requestMove(board);
    if (move === null) {
      if (!Game.isGameOver(board)) {
        throw new Error('AI returned game-over (g), but the local board is not over');
      }
      ended = true;
      break;
    }

    const result = Game.move(board, move);
    if (!result.moved) {
      throw new Error('AI returned an invalid move at step ' + (steps + 1) + ': ' + move);
    }
    score += result.score;
    board = result.board;

    const spawn = Game.addRandomTile(board, rng); // exactly one spawn per valid move
    moves.push([
      DIR_INDEX[move],
      spawn.tile ? spawn.cell.r * 4 + spawn.cell.c : -1,
      spawn.tile ? spawn.tile.value : 0,
    ]);
    steps += 1;
  }

  const elapsed = (performance.now() - started) / 1000;
  const finalMax = Game.maxValue(board);
  const stats = {
    game: index + 1,
    seed: seed,
    score: score,
    maxTile: finalMax,
    steps: steps,
    seconds: elapsed,
    movesPerSecond: steps / Math.max(elapsed, 0.001),
    ended: ended,
    truncated: truncated,
  };
  const replay = {
    version: 1,
    initial: initial,
    moves: moves,
    score: score,
    maxTile: finalMax,
    seed: seed,
    game: index + 1,
    ended: ended,
    truncated: truncated,
    finishedAt: new Date().toISOString(),
  };
  return { stats: stats, replay: replay };
}

function saveReplay(replay, gameNumber, seed) {
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
  const stem = 'game-' + String(gameNumber).padStart(3, '0') + '-seed-' + seed;
  const payload = JSON.stringify(replay); // compact JSON keeps large replays small
  let suffix = 0;
  while (true) {
    const file = path.join(REPLAY_DIR, stem + (suffix ? '-' + suffix : '') + '.json');
    let fd;
    try {
      // "wx" creates exclusively: concurrent runs can never overwrite a replay.
      fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, payload, 'utf8');
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    suffix += 1;
  }
}

function summarize(games) {
  const scores = games.map((g) => g.score);
  const maxTiles = games.map((g) => g.maxTile);
  const steps = games.map((g) => g.steps);
  const seconds = games.map((g) => g.seconds);
  const distribution = {};
  maxTiles.forEach((tile) => {
    distribution[tile] = (distribution[tile] || 0) + 1;
  });
  const sortedDistribution = {};
  Object.keys(distribution).map(Number).sort((a, b) => a - b).forEach((tile) => {
    sortedDistribution[tile] = distribution[tile];
  });

  const achievements = {};
  THRESHOLDS.forEach((tile) => {
    const count = maxTiles.filter((t) => t >= tile).length;
    achievements[tile] = {
      count: count,
      rate: games.length ? count / games.length : 0,
    };
  });

  const totalSteps = steps.reduce((a, b) => a + b, 0);
  const totalSeconds = seconds.reduce((a, b) => a + b, 0);
  return {
    games: games.length,
    completed: games.filter((g) => g.ended).length,
    truncated: games.filter((g) => g.truncated).length,
    averageScore: mean(scores),
    bestScore: scores.length ? Math.max(...scores) : 0,
    averageMaxTile: mean(maxTiles),
    bestMaxTile: maxTiles.length ? Math.max(...maxTiles) : 0,
    maxTileDistribution: sortedDistribution,
    achievements: achievements,
    averageSteps: mean(steps),
    averageSeconds: mean(seconds),
    totalSteps: totalSteps,
    totalSeconds: totalSeconds,
    movesPerSecond: totalSteps / Math.max(totalSeconds, 0.001),
  };
}

function printSummary(summary, jsonPath, csvPath, endpoint, seed) {
  const rates = THRESHOLDS.map((tile) => {
    const entry = summary.achievements[tile];
    return tile + '=' + (entry.rate * 100).toFixed(1) + '%';
  }).join('  ');
  const distribution = Object.keys(summary.maxTileDistribution)
    .map((tile) => tile + ':' + summary.maxTileDistribution[tile])
    .join(', ');

  console.log('AI benchmark: ' + summary.games + ' games, seed ' + seed);
  console.log('Endpoint: ' + endpoint);
  console.log('Average score: ' + summary.averageScore.toFixed(1));
  console.log('Best score: ' + summary.bestScore);
  console.log('Average max tile: ' + summary.averageMaxTile.toFixed(1) +
    ' (best ' + summary.bestMaxTile + ')');
  console.log('Max tile distribution: ' + (distribution || '-'));
  console.log('Achievement rates: ' + rates);
  console.log('Average steps: ' + summary.averageSteps.toFixed(1) +
    '  average time: ' + summary.averageSeconds.toFixed(2) + 's');
  console.log('Total: ' + summary.totalSteps + ' moves in ' +
    summary.totalSeconds.toFixed(1) + 's (' + summary.movesPerSecond.toFixed(1) + ' moves/s)');
  console.log('Completed: ' + summary.completed + '/' + summary.games +
    '  truncated: ' + summary.truncated);
  console.log('JSON: ' + jsonPath);
  console.log('CSV:  ' + csvPath);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node scripts/ai-benchmark.js [--games N] [--seed S] [--max-moves N]');
    console.log('       [--endpoint URL] [--out BASE_PATH]');
    console.log('Default: 1 game. Examples: --games 10, --games 100, --games 500.');
    console.log('Every game also saves a replay to reports/replays/game-NNN-seed-S.json.');
    return;
  }

  const gameCount = intArg('games', 1, 1);
  const seed = intArg('seed', 1, 0);
  const maxMoves = intArg('max-moves', 100000, 1);
  const endpoint = arg('endpoint', process.env.AI_ENDPOINT || 'http://127.0.0.1:8080/move');
  const client = AIClient.createClient({ endpoint: endpoint, timeoutMs: 120000 });

  // Fail early and clearly if the local AI service is unavailable.
  try {
    await client.requestMove([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  } catch (error) {
    throw new Error('AI service unavailable at ' + endpoint + ' (' + error.message + ')');
  }

  const startedAt = new Date();
  const games = [];
  for (let i = 0; i < gameCount; i++) {
    const gameSeed = seed + i * 7919;
    process.stdout.write('game ' + (i + 1) + '/' + gameCount + ' (seed ' + gameSeed + ')... ');
    const result = await playGame(client, i, gameSeed, maxMoves);
    const replayFile = saveReplay(result.replay, i + 1, gameSeed);
    const game = result.stats;
    game.replayFile = displayPath(replayFile);
    games.push(game);
    console.log('score=' + game.score + ' max=' + game.maxTile +
      ' steps=' + game.steps + ' ' + game.seconds.toFixed(1) + 's');
    console.log('  replay: ' + game.replayFile);
  }
  const finishedAt = new Date();
  const summary = summarize(games);

  let base = arg('out', path.join('reports', 'ai-benchmark-' + timestamp()));
  base = base.replace(/\.(json|csv)$/i, '');
  const jsonPath = path.resolve(base + '.json');
  const csvPath = path.resolve(base + '.csv');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });

  const report = {
    generatedAt: finishedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    endpoint: endpoint,
    seed: seed,
    maxMoves: maxMoves,
    requestedGames: gameCount,
    replayDirectory: displayPath(REPLAY_DIR),
    summary: summary,
    games: games,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const header = ['game', 'seed', 'score', 'max_tile', 'steps', 'seconds',
    'moves_per_second', 'ended', 'truncated'];
  const rows = games.map((g) => [
    g.game, g.seed, g.score, g.maxTile, g.steps, g.seconds.toFixed(3),
    g.movesPerSecond.toFixed(2), g.ended, g.truncated,
  ]);
  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
  fs.writeFileSync(csvPath, csv, 'utf8');

  printSummary(summary, jsonPath, csvPath, endpoint, seed);
  console.log('Replay directory: ' + displayPath(REPLAY_DIR) +
    ' (' + games.length + ' replay' + (games.length === 1 ? '' : 's') + ' from this run)');
}

main().catch((error) => {
  console.error('AI BENCHMARK FAILED:', error.message);
  process.exit(1);
});
