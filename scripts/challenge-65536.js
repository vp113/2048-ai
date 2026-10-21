'use strict';

/*
 * Background 65536 challenge.
 *
 * Continuously plays seeded games through the local C++ /move service until a
 * game reaches the target tile AND ends naturally, then verifies and keeps its
 * complete version-1 replay. Non-success games store only a compact summary.
 * The state file is written after every completed game, so rerunning the same
 * command resumes without repeating completed seeds.
 *
 *   node scripts/challenge-65536.js
 *   node scripts/challenge-65536.js --seed 7 --concurrency 2
 *   node scripts/challenge-65536.js --state reports/challenge-65536/run-2.json
 *
 * Testing only:
 *   --max-games N     stop after N completed games (0 = unlimited)
 *   --target-tile N   lower target to exercise the success path quickly
 */

const fs = require('node:fs');
const path = require('node:path');
const Game = require('../game.js');
const AIClient = require('../ai-client.js');
const Replay = require('../replay.js');
const bench = require('./ai-benchmark.js');

const DEFAULT_STATE = path.resolve('reports', 'challenge-65536', 'state.json');
const DEFAULT_TARGET = 65536;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
const SEED_STRIDE = 7919;

function usage() {
  console.log('Usage: node scripts/challenge-65536.js [options]');
  console.log('  --seed S          starting seed (default 1)');
  console.log('  --concurrency N   parallel games, 1-' + MAX_CONCURRENCY +
    ' (default ' + DEFAULT_CONCURRENCY + ')');
  console.log('  --max-moves N     safety cap per game (default 100000)');
  console.log('  --endpoint URL    AI endpoint (default http://127.0.0.1:8080/move)');
  console.log('  --state PATH      checkpoint/report path');
  console.log('                    (default reports/challenge-65536/state.json)');
  console.log('  --max-games N     stop after N completed games; 0 = unlimited (test/sampling)');
  console.log('  --target-tile N   target tile (default 65536; lower only for testing)');
  console.log('');
  console.log('A game only succeeds after reaching the target and ending naturally.');
  console.log('Rerun the same command to resume; use a different --state for a new challenge.');
}

function nowIso() {
  return new Date().toISOString();
}

function configFor(args) {
  return {
    seed: args.seed,
    concurrency: args.concurrency,
    maxMoves: args.maxMoves,
    maxGames: args.maxGames,
    targetTile: args.targetTile,
    endpoint: args.endpoint,
  };
}

function newState(config) {
  const now = nowIso();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    config: config,
    attempted: 0,
    games: [],
    summary: bench.summarize([]),
    success: null,
  };
}

function loadState(statePath, config) {
  if (!fs.existsSync(statePath)) return { state: newState(config), resumed: false };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new Error('Cannot parse state file ' + statePath + ': ' + error.message);
  }
  if (!state || state.version !== 1 || !Array.isArray(state.games)) {
    throw new Error('State file is not a version-1 65536 challenge report: ' + statePath);
  }
  const saved = state.config || {};
  const fixed = ['seed', 'maxMoves', 'targetTile'];
  for (const key of fixed) {
    if (saved[key] !== config[key]) {
      throw new Error('State config mismatch for ' + key + ': saved=' + saved[key] +
        ', requested=' + config[key] + '. Use the same options or a new --state path.');
    }
  }
  state.config.concurrency = config.concurrency;
  state.config.maxGames = config.maxGames;
  state.config.endpoint = config.endpoint;
  if (!Number.isInteger(state.attempted) || state.attempted < state.games.length) {
    state.attempted = state.games.length;
  }
  return { state: state, resumed: true };
}

function persist(statePath, state) {
  state.updatedAt = nowIso();
  state.summary = bench.summarize(state.games);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = statePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, statePath);
}

function printStateSummary(state) {
  const s = state.summary;
  console.log('Games: ' + s.games + '  completed: ' + s.completed +
    '  truncated: ' + s.truncated);
  console.log('Average score: ' + s.averageScore.toFixed(1) +
    '  best score: ' + s.bestScore);
  console.log('Best max tile: ' + s.bestMaxTile +
    '  distribution: ' + JSON.stringify(s.maxTileDistribution));
  console.log('Total: ' + s.totalSteps + ' moves in ' + s.totalSeconds.toFixed(1) + 's');
}

function printSuccess(statePath, state) {
  const success = state.success;
  console.log('');
  console.log('CHALLENGE SUCCESS');
  console.log('target tile: ' + state.config.targetTile +
    (state.config.targetTile === DEFAULT_TARGET ? '' : ' (test override)'));
  console.log('final score: ' + success.score);
  console.log('final max tile: ' + success.maxTile);
  console.log('steps: ' + success.steps);
  console.log('seed: ' + success.seed);
  console.log('total attempts: ' + state.attempted);
  console.log('replay: ' + success.replayFile);
  console.log('report: ' + bench.displayPath(statePath));
  console.log('verification: PASS (final board, score, max tile and steps match)');
}

function verifyReplay(result, stats) {
  const replay = Replay.buildReplay(result.replay, Game);
  const final = Replay.stateAt(replay, replay.total, Game);
  const replayBoard = Game.toNumbers(final.board);
  if (replay.total !== stats.steps) {
    throw new Error('Replay step mismatch: replay=' + replay.total + ', game=' + stats.steps);
  }
  if (replay.finalScore !== stats.score) {
    throw new Error('Replay score mismatch: replay=' + replay.finalScore + ', game=' + stats.score);
  }
  if (replay.finalMax !== stats.maxTile) {
    throw new Error('Replay max tile mismatch: replay=' + replay.finalMax +
      ', game=' + stats.maxTile);
  }
  if (JSON.stringify(replayBoard) !== JSON.stringify(result.finalBoard)) {
    throw new Error('Replay final board does not match the played final board');
  }
  return { finalBoard: replayBoard, replay: replay };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const seed = bench.intArg('seed', 1, 0);
  const requestedConcurrency = bench.intArg('concurrency', DEFAULT_CONCURRENCY, 1);
  const concurrency = Math.min(requestedConcurrency, MAX_CONCURRENCY);
  if (requestedConcurrency > MAX_CONCURRENCY) {
    console.warn('Concurrency capped at ' + MAX_CONCURRENCY + ' to protect the shared AI service.');
  }
  const maxMoves = bench.intArg('max-moves', 100000, 1);
  const maxGames = bench.intArg('max-games', 0, 0);
  const endpoint = bench.arg('endpoint', process.env.AI_ENDPOINT ||
    'http://127.0.0.1:8080/move');
  const statePath = path.resolve(bench.arg('state', DEFAULT_STATE));
  const targetTile = Number(bench.arg('target-tile', String(DEFAULT_TARGET)));
  if (!Number.isInteger(targetTile) || targetTile < 2 || targetTile > DEFAULT_TARGET ||
      (targetTile & (targetTile - 1)) !== 0) {
    throw new Error('--target-tile must be a power of two from 2 to ' + DEFAULT_TARGET);
  }

  const config = configFor({
    seed: seed,
    concurrency: concurrency,
    maxMoves: maxMoves,
    maxGames: maxGames,
    targetTile: targetTile,
    endpoint: endpoint,
  });
  const loaded = loadState(statePath, config);
  const state = loaded.state;

  console.log('65536 challenge');
  console.log('Target: ' + targetTile + (targetTile === DEFAULT_TARGET ? '' : ' (test override)'));
  console.log('Seed: ' + seed + '  concurrency: ' + concurrency +
    '  max moves: ' + maxMoves + (maxGames ? '  max games: ' + maxGames : ''));
  console.log('Endpoint: ' + endpoint);
  console.log('State: ' + bench.displayPath(statePath));

  if (state.success) {
    printSuccess(statePath, state);
    return;
  }

  if (maxGames > 0 && state.games.length >= maxGames) {
    persist(statePath, state);
    console.log('No new games: state already has ' + state.games.length +
      ' completed game(s), limit ' + maxGames + '.');
    printStateSummary(state);
    process.exitCode = 2;
    return;
  }

  const client = AIClient.createClient({ endpoint: endpoint, timeoutMs: 120000 });
  try {
    await client.requestMove([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  } catch (error) {
    throw new Error('AI service unavailable at ' + endpoint + ' (' + error.message + ')');
  }

  // Validate persisted indices before scheduling.
  const used = new Set();
  for (const game of state.games) {
    if (!Number.isInteger(game.index) || game.index < 0) {
      throw new Error('State contains an invalid game index: ' + game.index);
    }
    if (game.seed !== seed + game.index * SEED_STRIDE) {
      throw new Error('State seed mismatch at game index ' + game.index);
    }
    if (used.has(game.index)) {
      throw new Error('State contains duplicate game index ' + game.index);
    }
    used.add(game.index);
  }

  if (loaded.resumed) {
    console.log('Resuming with ' + state.games.length + ' completed game(s).');
  }
  state.status = 'running';
  delete state.error;
  persist(statePath, state);

  let stopping = false;
  let fatal = null;
  let nextIndex = 0;
  const inFlight = new Set();

  function allocateIndex() {
    if (stopping || state.success) return null;
    if (maxGames > 0 && state.games.length + inFlight.size >= maxGames) return null;
    while (used.has(nextIndex)) nextIndex += 1;
    const index = nextIndex;
    nextIndex += 1;
    used.add(index);
    inFlight.add(index);
    state.attempted += 1;
    return index;
  }

  function commitSuccess(index, gameSeed, result, record) {
    // Stop other workers immediately; they only finish/abort their current request.
    stopping = true;
    if (!result.stats.ended) {
      throw new Error('Target reached but the game did not end naturally');
    }
    const verified = verifyReplay(result, result.stats);
    // Non-success games never write a replay, so this is the only replay file
    // produced by the challenge. Existing files are never removed.
    const replayFile = bench.saveReplay(result.replay, index + 1, gameSeed,
      path.dirname(statePath));
    state.games.push(record);
    state.success = {
      index: index,
      seed: gameSeed,
      score: result.stats.score,
      maxTile: result.stats.maxTile,
      steps: result.stats.steps,
      seconds: result.stats.seconds,
      finalBoard: verified.finalBoard,
      replayFile: bench.displayPath(replayFile),
      verifiedAt: nowIso(),
    };
    state.status = 'success';
    persist(statePath, state);
    printSuccess(statePath, state);
    // Do not wait for a slow in-flight request from another worker.
    setTimeout(function () { process.exit(0); }, 3000).unref();
  }

  function recordGame(index, gameSeed, result) {
    const s = result.stats;
    return {
      index: index,
      seed: gameSeed,
      score: s.score,
      maxTile: s.maxTile,
      steps: s.steps,
      seconds: s.seconds,
      movesPerSecond: s.movesPerSecond,
      ended: s.ended,
      truncated: s.truncated,
      reachedTarget: s.maxTile >= targetTile,
      completedAt: nowIso(),
    };
  }

  async function worker() {
    while (!stopping) {
      const index = allocateIndex();
      if (index === null) return;
      const gameSeed = seed + index * SEED_STRIDE;
      let announcedTarget = false;
      try {
        const result = await bench.playGame(client, index, gameSeed, maxMoves, {
          shouldStop: function () { return stopping; },
          onStep: function (progress) {
            if (!announcedTarget && progress.maxTile >= targetTile) {
              announcedTarget = true;
              console.log('  game ' + (index + 1) + ' seed ' + gameSeed +
                ' reached ' + targetTile + ' at step ' + progress.steps +
                '; continuing until natural game over');
            }
          },
        });
        if (result.stats.aborted) continue;
        if (state.status === 'success') continue;

        const record = recordGame(index, gameSeed, result);
        if (result.stats.ended && result.stats.maxTile >= targetTile) {
          commitSuccess(index, gameSeed, result, record);
          return;
        }

        state.games.push(record);
        persist(statePath, state);
        console.log('[' + state.games.length + '] seed=' + gameSeed +
          ' score=' + record.score + ' max=' + record.maxTile +
          ' steps=' + record.steps + ' ' + record.seconds.toFixed(1) + 's' +
          (record.truncated ? ' (truncated)' : ''));
      } catch (error) {
        // A success/interrupt stops other workers; only their own abort is ignored.
        if (state.status === 'success' || fatal) return;
        fatal = error;
        stopping = true;
        state.status = 'error';
        state.error = error.message;
        try { persist(statePath, state); } catch (e) { /* keep original error */ }
        return;
      } finally {
        inFlight.delete(index);
      }
    }
  }

  process.on('SIGINT', function () {
    stopping = true;
    if (state.status !== 'success') {
      state.status = 'interrupted';
      try { persist(statePath, state); } catch (e) { /* exit anyway */ }
      console.error('\nInterrupted. Progress saved to ' + bench.displayPath(statePath) +
        '. Rerun the same command to resume.');
    }
    process.exit(130);
  });

  await Promise.all(Array.from({ length: concurrency }, function () { return worker(); }));

  if (state.status === 'success') return;
  if (fatal) {
    console.error('CHALLENGE FAILED:', fatal.message);
    console.error('Progress saved to ' + bench.displayPath(statePath) +
      '; rerun the same command to retry the unfinished game.');
    process.exitCode = 1;
    return;
  }
  if (maxGames > 0 && state.games.length >= maxGames) {
    state.status = 'limit';
    persist(statePath, state);
    console.log('Challenge limit reached without ' + targetTile + '.');
    printStateSummary(state);
    console.log('Report: ' + bench.displayPath(statePath));
    process.exitCode = 2;
    return;
  }

  state.status = 'stopped';
  persist(statePath, state);
  console.log('Challenge stopped without target.');
  printStateSummary(state);
  process.exitCode = 2;
}

main().catch(function (error) {
  console.error('CHALLENGE FAILED:', error.message);
  process.exit(1);
});
