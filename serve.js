'use strict';

/*
 * Tiny static server + same-origin proxy for the local 2048 AI service.
 * No external dependencies.
 *
 *   node serve.js
 *   -> http://localhost:8000
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DEFAULT_AI_BASE = 'http://127.0.0.1:8080';

const STATIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/style.css': 'style.css',
  '/game.js': 'game.js',
  '/replay.js': 'replay.js',
  '/ai-client.js': 'ai-client.js',
  '/main.js': 'main.js',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res, status, body, contentType) {
  const buffer = Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

function createServer(options) {
  const opts = options || {};
  const aiBase = (opts.aiBase || DEFAULT_AI_BASE).replace(/\/$/, '');
  const root = opts.root || ROOT;

  return http.createServer(async function (req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/move') {
      if (req.method !== 'GET') {
        send(res, 405, 'Method Not Allowed');
        return;
      }
      const target = aiBase + '/move' + (url.search || '');
      let lastError = null;
      let sent = false;
      for (let attempt = 0; attempt < 3 && !sent; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 60000);
        try {
          const upstream = await fetch(target, {
            signal: controller.signal,
            cache: 'no-store',
          });
          const body = await upstream.text();
          send(res, upstream.status, body, 'text/plain; charset=utf-8');
          sent = true;
        } catch (err) {
          lastError = err;
          if (attempt < 2) {
            await new Promise(function (resolve) { setTimeout(resolve, 120 * (attempt + 1)); });
          }
        } finally {
          clearTimeout(timer);
        }
      }
      if (!sent) {
        send(res, 503, 'AI service unavailable');
      }
      return;
    }

    const file = STATIC_FILES[url.pathname];
    if (!file) {
      send(res, 404, 'Not found');
      return;
    }

    fs.readFile(path.join(root, file), function (err, data) {
      if (err) {
        send(res, 404, 'Not found');
        return;
      }
      send(res, 200, data.toString('utf8'), MIME[path.extname(file)] || 'text/plain');
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  createServer().listen(port, function () {
    console.log('2048 AI web: http://localhost:' + port);
  });
}

module.exports = { createServer: createServer, STATIC_FILES: STATIC_FILES };
