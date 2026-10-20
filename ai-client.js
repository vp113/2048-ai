/*
 * Client for the macroxue/2048-ai HTTP server.
 * Board encoding: 16 row-major tile ranks; 0=empty, 1=2, ..., 15=32768, G=65536.
 * Server reply: u/l/r/d, or g for game over.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.AI2048Client = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANKS = '0123456789ABCDEFG'; // rank 0..16; 16 -> G (65536)
  const MOVE_MAP = {
    u: 'up',
    r: 'right',
    d: 'down',
    l: 'left',
    g: null, // game over
  };

  function cellValue(cell) {
    return cell && typeof cell === 'object' ? cell.value : cell;
  }

  function rankOf(value) {
    const v = Number(value) || 0;
    if (v <= 0) return 0;
    const rank = Math.round(Math.log2(v));
    if (rank < 1 || rank > 16 || Math.pow(2, rank) !== v) {
      throw new Error('Unsupported tile value: ' + value);
    }
    return rank;
  }

  function boardToCode(board) {
    if (!Array.isArray(board) || board.length !== 4) {
      throw new Error('board must be a 4x4 array');
    }
    let code = '';
    for (let r = 0; r < 4; r++) {
      if (!Array.isArray(board[r]) || board[r].length !== 4) {
        throw new Error('board must be a 4x4 array');
      }
      for (let c = 0; c < 4; c++) {
        code += RANKS[rankOf(cellValue(board[r][c]))];
      }
    }
    return code;
  }

  function parseReply(text) {
    const ch = String(text).trim();
    if (!(ch in MOVE_MAP)) {
      throw new Error('Invalid AI reply: ' + JSON.stringify(ch));
    }
    return MOVE_MAP[ch];
  }

  function createClient(options) {
    const opts = options || {};
    const endpoint = opts.endpoint || '/move';
    const timeoutMs = opts.timeoutMs || 60000;
    const doFetch = opts.fetchImpl ||
      (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('fetch is not available');

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function requestMove(board) {
      const code = boardToCode(board);
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = endpoint + separator + 'board=' + code;
      let lastError = null;

      // The upstream server occasionally drops a single connection; retry a
      // few times so long unattended sessions do not stop. The algorithm and
      // move choice are unchanged.
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        try {
          const response = await doFetch(url, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error('AI server HTTP ' + response.status);
          }
          return parseReply(await response.text());
        } catch (error) {
          lastError = error;
          if (attempt < 2) await sleep(120 * (attempt + 1));
        } finally {
          clearTimeout(timer);
        }
      }

      throw lastError || new Error('AI request failed');
    }

    return { requestMove: requestMove, boardToCode: boardToCode, parseReply: parseReply };
  }

  return {
    boardToCode: boardToCode,
    parseReply: parseReply,
    createClient: createClient,
    RANKS: RANKS,
    MOVE_MAP: MOVE_MAP,
  };
});
