# 2048 AI Showcase

A clean, local 2048 auto-play showcase using the original web UI style and the
high-performance C++ AI from
[macroxue/2048-ai](https://github.com/macroxue/2048-ai).

The browser owns the real game: board, moves, merges, spawning, score, and
record. A small Node server serves the page and proxies move requests to the AI
service running in Docker.

## Quick start (Windows)

Prerequisites: Docker Desktop and Node.js are installed. The first start needs
about **5 GB RAM** and **3 GB disk** for the AI lookup tables.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

The script:

1. starts Docker Desktop if necessary;
2. builds the small upstream AI image if needed;
3. starts the local AI container on port `8080`;
4. generates the lookup tables on the very first run (about 4–8 minutes);
5. starts the page server and opens <http://localhost:8000>.

Click **AI 开始** to start auto-play. To stop the background services:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop-ai.ps1
```

### Manual commands

```powershell
docker build -t 2048-ai-small vendor/2048-ai
docker run -d --name 2048-ai -p 8080:8080 -v "${PWD}/vendor/2048-ai/tables:/data" 2048-ai-small
node serve.js
```

Open <http://localhost:8000>. If the AI service is not ready, the page shows a
connection status; it does not silently fall back to a weaker AI.

## Features

- Original 2048 board, colours, layout, and slide animation.
- AI 开始 / 暂停 / 继续; restart.
- **Strictly serial AI steps**:
  - request one decision → apply one move → spawn exactly one tile →
    finish the board render → verify DOM/board consistency → wait.
  - playback options **3 / 5 / 8 / 12 / 20 moves per second**; default **8**.
  - pause finishes the current render and stops before the next step; resume
    continues the same game.
- Current score, best score, current max tile, historical max tile.
- **Game over keeps the final board**: AI movement stops immediately, the board
  stays visible, and a banner shows final score, max tile, and move count.
  **下一局** starts the next game manually.
- **自动连续挑战** switch (default **off**). When enabled, the final board and
  result stay for about **3.5 s** (at least 3 s), then the next game starts.
  Pause during that wait cancels the automatic next game. One session is capped
  at **500 games**.
- Achievements at **32768** and **65536** (localStorage, toast notification,
  and a persistent achievement label in the final banner).
- **Replay import**: load a replay JSON, open directly at the final board, then
  play/pause, step forward/back, jump to start/end, drag the progress slider,
  change replay speed, or exit. The final board remains when playback reaches
  the end.
- Best-game replay record: initial board + every move + every spawned tile,
  saved in localStorage and downloadable from the footer. It is enough to
  replay and verify a record game.
- All high scores come from real games; replay viewing never updates the best
  score/history and never requests the AI.
- No rule, spawn probability, or starting board modifications.

## Replay import and viewing

Click **导入回放**, choose a JSON file downloaded by this project. The replay
opens at the **last move** by default; use ◀ / ▶, start/end, the slider, or the
play button to inspect any step. Replaying uses only the recorded moves and
spawned tiles; it never re-randomizes tiles or calls the AI.

Supported format (version 1):

```json
{
  "version": 1,
  "initial": [[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]],
  "moves": [[0, 12, 4], [1, 0, 2]],
  "score": 12,
  "maxTile": 8,
  "finishedAt": "2026-10-21T00:00:00.000Z"
}
```

- `direction`: `0=up, 1=right, 2=down, 3=left`
- `spawnIndex`: row-major flat index `0..15` (or `-1`/`0` for a legacy no-spawn entry)
- `spawnValue`: `2` or `4`

The importer validates the initial board, every move, every spawn cell and
value, and the final score/max. Invalid files show a clear message and leave
the page usable. Import stops any live AI session, timers, and in-flight
animation/request. The file is read-only; replay does not modify it.

Replay seeking uses snapshots every 100 moves. For a 7,164-move replay this
means 73 snapshots; a random seek applies at most 99 recorded moves and is
fast enough for continuous slider dragging.

## Architecture

```
Browser
  index.html / main.js / game.js / ai-client.js
        |  /move?board=<16 chars>
        v
  serve.js (Node, port 8000)
        |  proxy
        v
  Docker: macroxue/2048-ai C++ server (port 8080)
        |  Expectimax + precomputed lookup tables
```

- Board encoding: row-major tile ranks, `0` empty, `1`=2, `2`=4, …,
  `15`=32768, `G`=65536.
- Server reply: `u` / `l` / `r` / `d`, or `g` for game over.
- The web game and the AI use the same standard 2048 rules and 90% / 10% spawn
  probabilities. The AI only suggests moves; the browser performs the actual
  move and spawn, so all displayed scores come from the real web game.

## Upstream

- Repository: <https://github.com/macroxue/2048-ai>
- Pinned commit: `fee3359d06cda82cb20a36ce312b06209ca1baad`
- License: **GPL-3.0** — see `vendor/2048-ai/LICENSE`; the vendored AI
  component is GPL-3.0.
- The small `2048` build is used (not the 27 GB `2048b` build).
- A minimal local patch in `2048.cc` changes HTTP response line endings to
  CRLF and adds `Connection: close`, so browser/Node `fetch` accepts the
  server response. The algorithm and tables are unchanged.
- The generated lookup tables are about **2.5 GB** and are excluded from Git
  (`vendor/2048-ai/tables/`, `*.log`).

### Verified games

Direct upstream game (`./2048 -d3 -i1 2050`) on this machine:

- score **1,133,392**
- max tile **65536**
- 36,430 moves
- 107.1 s, about **340 moves/s**

End-to-end web path (`game.js` + `ai-client.js` + Node proxy + Docker,
depth 3), four real games:

| game | score | max tile | moves | time | moves/s |
|------|-------|----------|-------|------|---------|
| 1 | 32,632 | 2048 | 1,680 | 5.4 s | 308 |
| 2 | 488,656 | 32768 | 16,755 | 19.5 s | 859 |
| 3 | 677,576 | 32768 | 23,216 | 21.9 s | 1,062 |
| 4 | 610,000 | 32768 | 21,427 | 19.7 s | 1,090 |

- 4-game average score: about **452,216**; 3/4 reached 32768; 0/4 reached 65536
  in this small sample. This is consistent with the upstream small-build
  1000-game depth-3 statistics (about 417k average, 37.8% 32768, 1.0% 65536),
  which are the better reference; a 4-game sample is not a statistical claim.
- The separate direct CLI game above did reach 65536.
- The table measures the **AI engine/proxy in a headless loop**, not the web
  playback rate. The web UI is deliberately strictly serial and capped at
  **3–20 moves/s** (default 8); it never plays at hundreds of moves/s.
- Browser verification (real Edge page, CDP):
  - default 8/s produced 8 moves in 1 s;
  - 5/s produced 6 moves in 1.2 s; 20/s produced 20 moves in 1 s;
  - 3/s produced about 5 moves in 1.5 s;
  - 12/s produced 15 moves in 1.2 s on a fresh board; one harder-board segment
    was slower because the serial AI decision took longer (the selected rate is
    an upper bound; decision quality is not traded for playback rate);
  - pause produced zero moves over the next 1 s; resume continued;
  - 62 moves produced exactly 62 spawned tiles;
  - after each settled step, DOM tile count/ids/values matched the logical
    board; no residual, duplicate, or pending animation state.
  - game-over with auto-continue off kept the final board for >4 s and did not
    advance the game count;
  - auto-continue on kept the final board at 3 s and started the next game by
    4.2 s; pausing during the wait prevented the automatic next game;
  - a real **7,164-step / 171,828-point / 8192-tile** replay imported straight
    to its final board; previous/start/middle/end seeks matched the recorded
    score and board; slider drag, 20-step/s play, auto-pause at the end, fast
    drag, and exit all worked; importing an invalid file showed a clear error
    and left the page in normal mode.

The benchmark is reproducible with:

```bash
node scripts/benchmark.js --games 3
```

## Tests

```bash
node test.js
```

The suite covers board rules, merge/score behaviour, spawn rules, game-over
detection, AI board encoding (including `65536 -> G`), reply mapping, the
static server/`/move` proxy, replay-record reconstruction, and replay JSON
validation/seeking (first/middle/final states, invalid moves, occupied spawn
cells, score/max mismatches, and read-only input). The browser checks above
were run against a real Edge page via CDP.

## Files

```
index.html / style.css / main.js / game.js   web game and AI controller
replay.js                                    replay validation + snapshot seeking
ai-client.js                                 board encoding + AI HTTP client
serve.js                                     static server + AI proxy
scripts/start.ps1 / stop-ai.ps1              one-command local startup/stop
scripts/benchmark.js                         headless full-game benchmark
vendor/2048-ai/                              pinned upstream source + Dockerfile
vendor/2048-ai/tables/                       generated, ignored (about 2.5 GB)
test.js                                      Node test suite
```

## Notes and limitations

- This is a **local** AI service, not a hosted/cloud game. Docker must be
  running. A pure-WASM build is not practical: the strong small build needs
  about 5 GB of lookup-table memory, beyond the browser wasm32 address space.
  Dropping those tables would produce a clearly weaker AI, which was not
  acceptable for this project.
- Search depth is fixed by the container command (`-d3`). Change
  `scripts/start.ps1` / the Dockerfile command to use another depth and restart
  the container; the UI does not expose a depth slider because a runtime
  restart would be required.
- The first table generation is long; later starts reuse `tables/`.
- One session auto-continues up to 500 games. Pause stops the loop and the
  automatic next game; the page does not start AI compute on load.
- High-score/replay records are stored in the browser's localStorage. They are
  not uploaded anywhere.
