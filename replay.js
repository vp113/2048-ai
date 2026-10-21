/*
 * 2048 replay validation / seeking.
 *
 * Replay format (version 1):
 *   { version, initial: 4x4 numbers, moves: [[direction, spawnIndex, spawnValue], ...],
 *     score, maxTile, finishedAt? }
 *
 * direction: 0=up, 1=right, 2=down, 3=left
 * spawnIndex: flat row-major index 0..15 (or -1/0 for the legacy "no spawn" case)
 * spawnValue: 2 or 4
 *
 * Snapshots every SNAPSHOT_INTERVAL moves keep random seeks fast: restore the
 * nearest snapshot and apply at most 99 recorded moves. The original replay
 * data is copied/read only; this module never mutates it.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.Replay2048 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRS = ['up', 'right', 'down', 'left'];
  const SNAPSHOT_INTERVAL = 100;

  class ReplayError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ReplayError';
    }
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value >= 2 && value <= 65536 &&
      Math.pow(2, Math.round(Math.log2(value))) === value;
  }

  function validTile(value) {
    return value === 0 || isPowerOfTwo(value);
  }

  function normalizeInitial(initial) {
    if (!Array.isArray(initial) || initial.length !== 4) {
      throw new ReplayError('initial 必须是 4×4 数字棋盘');
    }
    const copy = [];
    for (let r = 0; r < 4; r++) {
      if (!Array.isArray(initial[r]) || initial[r].length !== 4) {
        throw new ReplayError('initial 必须是 4×4 数字棋盘');
      }
      const row = [];
      for (let c = 0; c < 4; c++) {
        const value = Number(initial[r][c]);
        if (!Number.isInteger(value) || !validTile(value)) {
          throw new ReplayError('initial 第 ' + (r + 1) + ' 行第 ' + (c + 1) +
            ' 列不是合法方块值: ' + initial[r][c]);
        }
        row.push(value);
      }
      copy.push(row);
    }
    return copy;
  }

  function normalizeMoves(moves) {
    if (!Array.isArray(moves)) {
      throw new ReplayError('moves 必须是数组');
    }
    return moves.map(function (entry, i) {
      const label = '第 ' + (i + 1) + ' 步';
      if (!Array.isArray(entry) || entry.length !== 3) {
        throw new ReplayError(label + '格式错误，应为 [direction, spawnIndex, spawnValue]');
      }
      const direction = Number(entry[0]);
      const spawnIndex = Number(entry[1]);
      const spawnValue = Number(entry[2]);
      if (!Number.isInteger(direction) || direction < 0 || direction > 3) {
        throw new ReplayError(label + '方向无效: ' + entry[0] + '（0上 1右 2下 3左）');
      }
      if (!Number.isInteger(spawnIndex) || spawnIndex < -1 || spawnIndex > 15) {
        throw new ReplayError(label + '新方块位置无效: ' + entry[1]);
      }
      if (spawnIndex === -1) {
        if (spawnValue !== 0) {
          throw new ReplayError(label + '无生成位置时数值必须为 0');
        }
      } else if (spawnValue !== 2 && spawnValue !== 4) {
        throw new ReplayError(label + '新方块数值必须是 2 或 4: ' + entry[2]);
      }
      return [direction, spawnIndex, spawnValue];
    });
  }

  function buildReplay(data, Game) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ReplayError('回放文件不是有效的 JSON 对象');
    }
    if (data.version != null && Number(data.version) !== 1) {
      throw new ReplayError('不支持的回放版本: ' + data.version);
    }
    if (!Game || typeof Game.move !== 'function') {
      throw new ReplayError('缺少游戏规则实现');
    }

    const initial = normalizeInitial(data.initial);
    const moves = normalizeMoves(data.moves);
    let board = Game.fromNumbers(initial);
    let score = 0;
    const snapshots = [{
      index: 0,
      board: Game.toNumbers(board),
      score: 0,
      maxTile: Game.maxValue(board),
    }];

    for (let i = 0; i < moves.length; i++) {
      const step = moves[i];
      const direction = DIRS[step[0]];
      const result = Game.move(board, direction);
      if (!result.moved) {
        throw new ReplayError('第 ' + (i + 1) + ' 步移动无效（方向 ' +
          step[0] + ' 无法改变棋盘）');
      }
      board = result.board;
      score += result.score;

      const spawnIndex = step[1];
      const spawnValue = step[2];
      if (spawnIndex >= 0) {
        const r = Math.floor(spawnIndex / 4);
        const c = spawnIndex % 4;
        if (board[r][c]) {
          throw new ReplayError('第 ' + (i + 1) + ' 步生成位置 (' + r + ',' + c +
            ') 已有方块');
        }
        board[r][c] = { id: Game.nextId(), value: spawnValue };
      }

      if ((i + 1) % SNAPSHOT_INTERVAL === 0) {
        snapshots.push({
          index: i + 1,
          board: Game.toNumbers(board),
          score: score,
          maxTile: Game.maxValue(board),
        });
      }
    }

    const finalScore = score;
    const finalMax = Game.maxValue(board);
    if (snapshots[snapshots.length - 1].index !== moves.length) {
      snapshots.push({
        index: moves.length,
        board: Game.toNumbers(board),
        score: finalScore,
        maxTile: finalMax,
      });
    }

    const recordedScore = data.score;
    const recordedMax = data.maxTile != null ? data.maxTile : data.max;
    if (recordedScore != null && Number(recordedScore) !== finalScore) {
      throw new ReplayError('最终分数不一致：回放计算 ' + finalScore +
        '，文件记录 ' + recordedScore);
    }
    if (recordedMax != null && Number(recordedMax) !== finalMax) {
      throw new ReplayError('最终最大方块不一致：回放计算 ' + finalMax +
        '，文件记录 ' + recordedMax);
    }

    return {
      version: 1,
      total: moves.length,
      initial: initial,
      moves: moves,
      snapshots: snapshots,
      finalScore: finalScore,
      finalMax: finalMax,
      finishedAt: data.finishedAt || null,
    };
  }

  function findSnapshot(snapshots, index) {
    let lo = 0;
    let hi = snapshots.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (snapshots[mid].index <= index) lo = mid;
      else hi = mid - 1;
    }
    return snapshots[lo];
  }

  function stateAt(replay, index, Game) {
    if (!replay || !Array.isArray(replay.snapshots) || !Array.isArray(replay.moves)) {
      throw new ReplayError('回放尚未加载');
    }
    let target = Math.floor(Number(index));
    if (!Number.isFinite(target)) target = 0;
    target = Math.max(0, Math.min(replay.total, target));

    const snap = findSnapshot(replay.snapshots, target);
    let board = Game.fromNumbers(snap.board);
    let score = snap.score;

    for (let i = snap.index; i < target; i++) {
      const step = replay.moves[i];
      const result = Game.move(board, DIRS[step[0]]);
      if (!result.moved) {
        throw new ReplayError('回放内部状态错误：第 ' + (i + 1) + ' 步无法执行');
      }
      board = result.board;
      score += result.score;
      if (step[1] >= 0) {
        const r = Math.floor(step[1] / 4);
        const c = step[1] % 4;
        board[r][c] = { id: Game.nextId(), value: step[2] };
      }
    }

    return {
      index: target,
      board: board,
      score: score,
      maxTile: Game.maxValue(board),
    };
  }

  return {
    DIRS: DIRS,
    SNAPSHOT_INTERVAL: SNAPSHOT_INTERVAL,
    ReplayError: ReplayError,
    buildReplay: buildReplay,
    stateAt: stateAt,
  };
});
