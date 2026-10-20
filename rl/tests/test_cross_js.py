"""Cross-validate Python move rules against the existing JavaScript game."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from rl.env2048 import (
    ACTION_DOWN,
    ACTION_LEFT,
    ACTION_RIGHT,
    ACTION_UP,
    Game2048Env,
)

DIR_TO_ACTION = {
    "left": ACTION_LEFT,
    "right": ACTION_RIGHT,
    "up": ACTION_UP,
    "down": ACTION_DOWN,
}

NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="Node.js is required for cross-validation")
def test_python_move_board_matches_javascript_game():
    oracle = Path(__file__).with_name("js_oracle.js")
    proc = subprocess.run(
        [NODE, str(oracle)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr

    cases = json.loads(proc.stdout)
    assert len(cases) > 0

    for index, case in enumerate(cases):
        grid = np.array(case["board"], dtype=np.int64)
        action = DIR_TO_ACTION[case["direction"]]
        new_board, score, moved = Game2048Env.move_board(grid, action)

        context = f"case #{index} dir={case['direction']}"
        assert moved == case["moved"], context
        assert score == case["score"], context
        np.testing.assert_array_equal(
            new_board,
            np.array(case["result"], dtype=np.int64),
            err_msg=context,
        )
