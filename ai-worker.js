/*
 * 2048 — AI Web Worker。
 * 加载 ai.js 后在独立线程执行 Expectimax 搜索，避免阻塞页面交互。
 */
importScripts('ai.js');

self.onmessage = function (e) {
  const msg = e.data;
  if (msg && msg.type === 'move') {
    const result = AI2048.chooseMoveFlat(msg.grid, msg.depth);
    self.postMessage({ type: 'result', id: msg.id, result });
  }
};
