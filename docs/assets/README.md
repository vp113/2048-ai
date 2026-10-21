# Documentation assets

Both assets were captured from the real web replay UI in Headless Microsoft
Edge. No board, score, or AI result was edited or synthesized.

Source replay:

```text
archives/challenge-65536/game-053-seed-411789.json
```

## 65536-achievement.png

- Real replay step: **29,823** (the first step where max tile is 65536)
- Score at this step: **971,264**
- Max tile: **65536**
- Final board is not shown here; this is the first 65536 state. The game
  continued to the recorded final score of 1,148,460.
- Cropped to the real page header and board; replay controls were outside the
  crop.
- The “best score 0” cell is genuine replay-mode UI: replaying does not modify
  high scores.

## game-demo.gif

- Source: the same archived replay, real steps **29,323–29,883**.
- 113 captured states, every 5 replay moves, shown at about 10 fps.
- The 65536 tile appears at frame 100 (replay step 29,823).
- Final frame is held for 2 seconds; total duration **13.2 seconds**.
- Size: 640×711, approximately **8.2 MB**.
- The replay UI is intentionally advanced by seeking real recorded states; no
  tile changes are generated or interpolated by hand.

## Validation

The archived replay and these states were checked with `Replay.buildReplay` /
`Replay.stateAt` and imported in Headless Edge. See
`archives/challenge-65536/README.md` and `docs/PROJECT_STATUS.md`.

SHA-256:

```text
d1739a1d1dac9edfd0dbdb387e16e446e37d86ddd8f3071ddfae3f542063e42b  65536-achievement.png
4be821ba2c60e3a90e49b91694d29092eca1f000f6f7d715f498808b87b8f43c  game-demo.gif
```

