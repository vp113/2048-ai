# Upstream: macroxue/2048-ai

- Repository: https://github.com/macroxue/2048-ai
- Pinned commit: `fee3359d06cda82cb20a36ce312b06209ca1baad`
- License: **GPL-3.0** (see `LICENSE`; this vendored component remains GPL-3.0)
- Upstream documentation: `README.md`
- Local compatibility patch: the HTTP response lines in `2048.cc` now use CRLF
  so browser/Node `fetch` accepts them; HTTP/1.1 keep-alive remains enabled.
  The upstream algorithm, tables, and game rules are unchanged.

## What is vendored

The minimal source set needed for the small `2048` binary:

```
2048.cc board.cc board.h node.h plan.h snake.h tuple.h tuple_move.h
array.h cache.h compact_map.h makefile
```

The big `2048b` build (27GB RAM / 18GB disk) is not built here. The small
build needs about 5GB RAM and 3GB disk for its lookup tables.

## Build / run

This directory builds a Linux container:

```bash
docker build -t 2048-ai-small .
mkdir -p tables
docker run -d --name 2048-ai -p 8080:8080 \
  -v "$PWD/tables:/data" 2048-ai-small
```

The first start computes `tuple_moves.10a` and `tuple_moves.11a` (several GB)
and can take several minutes. Later starts reuse the files in `tables/`.
The server prints `Server ready` when ready.

## HTTP interface used by the web page

```text
GET /move?board=<16 chars>
```

Board characters are row-major tile ranks:

```
0 = empty, 1 = 2, 2 = 4, ..., 15 = 32768, G = 65536
```

Reply is one of `u`, `l`, `r`, `d`, or `g` (game over). Responses include
`Access-Control-Allow-Origin: *`.

The web game keeps its own board, score, spawns, and rules; the server only
returns the suggested move.
