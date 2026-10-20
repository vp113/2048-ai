'use strict';

/*
 * Cross-validation oracle: uses the existing web-game logic (game.js) to
 * compute move results for a deterministic set of boards.  The Python test
 * compares these results with the RL environment.
 *
 * Prints one JSON array to stdout.  No dependencies.
 */

const path = require('path');
const Game = require(path.join(__dirname, '..', '..', 'game.js'));

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x5eed1234);
const boards = [];

function pushFlat(flat) {
  boards.push([
    flat.slice(0, 4),
    flat.slice(4, 8),
    flat.slice(8, 12),
    flat.slice(12, 16),
  ]);
}

// Hand-written edge cases: merges, gaps, no double merges, blocked moves.
const fixed = [
  [2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 2, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 4, 0, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
];
for (const flat of fixed) pushFlat(flat);

// Random boards, biased toward spawn-density situations similar to real play.
for (let k = 0; k < 250; k++) {
  const flat = new Array(16);
  for (let i = 0; i < 16; i++) {
    flat[i] = rng() < 0.35 ? 0 : (1 << (1 + Math.floor(rng() * 7)));
  }
  pushFlat(flat);
}

const dirs = ['left', 'right', 'up', 'down'];
const cases = [];

for (const grid of boards) {
  const board = Game.fromNumbers(grid);
  for (const dir of dirs) {
    const result = Game.move(board, dir);
    cases.push({
      board: grid,
      direction: dir,
      moved: result.moved,
      score: result.score,
      result: Game.toNumbers(result.board),
    });
  }
}

process.stdout.write(JSON.stringify(cases));
