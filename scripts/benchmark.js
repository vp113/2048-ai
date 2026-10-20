'use strict';

/*
 * Headless integration benchmark: plays full games through the local AI
 * server using the same game.js rules as the web page.
 *
 *   node scripts/benchmark.js --games 1
 */

const Game = require('../game.js');
const AIClient = require('../ai-client.js');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const found = process.argv.find(function (item) { return item.startsWith(prefix); });
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf('--' + name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const games = Math.max(1, Number(arg('games', '1')) || 1);
const maxMoves = Math.max(1, Number(arg('max-moves', '100000')) || 100000);
const endpoint = process.env.AI_ENDPOINT || 'http://127.0.0.1:8080/move';
const client = AIClient.createClient({ endpoint: endpoint, timeoutMs: 120000 });

async function main() {
  for (let game = 1; game <= games; game++) {
    let board = Game.createEmptyBoard();
    Game.addRandomTile(board);
    Game.addRandomTile(board);
    let score = 0;
    let moves = 0;
    const start = performance.now();

    while (!Game.isGameOver(board) && moves < maxMoves) {
      const move = await client.requestMove(board);
      if (!move) break;
      const result = Game.move(board, move);
      if (!result.moved) {
        throw new Error('AI returned an invalid move: ' + move);
      }
      score += result.score;
      board = result.board;
      Game.addRandomTile(board);
      moves += 1;
      if (moves % 2000 === 0) {
        process.stdout.write('\rgame ' + game + ': ' + moves + ' moves, score ' + score + '   ');
      }
    }

    const elapsed = (performance.now() - start) / 1000;
    const maxTile = Game.maxValue(board);
    const movesPerSecond = moves / Math.max(elapsed, 0.001);
    process.stdout.write('\n');
    console.log(
      'game ' + game + ': score=' + score +
      ' max=' + maxTile +
      ' moves=' + moves +
      ' elapsed=' + elapsed.toFixed(1) + 's' +
      ' moves/s=' + movesPerSecond.toFixed(1)
    );
  }
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
