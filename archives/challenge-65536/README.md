# Archived 65536 game

This directory is the Git-tracked archive of the first successful 65536
challenge run.

## Result

- Challenge index: **53** (0-based index 52)
- Seed: **411789**
- Final score: **1,148,460**
- Final max tile: **65536**
- Total steps: **37,257**
- Total attempts in the challenge: **56**
- Game ended naturally (Game Over) after reaching 65536
- Original replay (kept, Git-ignored):
  `reports/challenge-65536/game-053-seed-411789.json`
- Archived replay:
  `archives/challenge-65536/game-053-seed-411789.json`
- Final challenge report:
  `archives/challenge-65536/final-report.json`

Final board:

```text
65536  4096   256    32
 8192  2048   128    16
 1024   512    64     8
    2     4     2     4
```

## Checksums

```text
9a82e0a8910a6472f5bc7faced3b4beb0f4441b4fd9568a4b64b309f39523d50  game-053-seed-411789.json
0f6d88a84a05ba39cee8b980de62e1a6af8cccb3fe8a83cf59cc8d9751bd3d0b  final-report.json
```

The archived replay is a byte-for-byte copy of the original success replay.
The original file in `reports/` must not be removed by normal cleanup.

## Validate and view

The replay is version 1 and compatible with the page's **导入回放** importer.
It opens on the final board and supports the full playback controls.

```powershell
# Headless validation: final board, score, max tile, and seek points
node scripts/browser-test.js --replay=archives/challenge-65536/game-053-seed-411789.json

# Start the page server without opening a browser, then import the archive
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoBrowser
```

Do not edit the JSON: the importer validates every move, spawn, score, and max
tile. `final-report.json` is the archived final state/report (compact per-game
summaries, not full replays for unsuccessful games).
