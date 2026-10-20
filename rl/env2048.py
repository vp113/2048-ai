"""2048 reinforcement-learning environment (Gymnasium-style, NumPy only).

Action mapping
--------------
0 = up, 1 = right, 2 = down, 3 = left

Invalid-action policy
---------------------
* An action outside 0..3 raises ``ValueError`` (a programming error).
* An in-range action that does not change the board is a **no-op**:
  no new tile is spawned, reward is 0, ``info["invalid_action"]`` is True,
  and the episode does not advance.  Callers should use
  ``action_masks()`` / ``info["valid_actions"]`` and only choose legal
  actions; otherwise an episode can stall indefinitely.
* Calling ``step`` after ``terminated`` raises ``RuntimeError``;
  call ``reset()`` to start a new episode.

Other conventions
-----------------
* The observation is the raw 4x4 board (``np.int64``).
* A new episode starts with two random tiles, matching the web game.
* Reward is only the merge score of the move (no shaping).
* ``truncated`` is always False (there is no time limit).
* ``reset(seed=...)`` re-seeds the internal ``np_random`` generator, so
  replaying the same seed and actions gives identical boards.
"""

from __future__ import annotations

import operator
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

BOARD_SIZE = 4
NUM_ACTIONS = 4

ACTION_UP = 0
ACTION_RIGHT = 1
ACTION_DOWN = 2
ACTION_LEFT = 3
ACTION_NAMES = ("up", "right", "down", "left")

SPAWN_PROB_2 = 0.9
SPAWN_PROB_4 = 0.1
INITIAL_TILES = 2

Board = np.ndarray


def _validate_action(action: Any) -> int:
    """Return a Python int in [0, 3], raising on non-integers/out of range."""
    try:
        a = operator.index(action)
    except TypeError as exc:
        raise TypeError("action must be an integer in [0, 3]") from exc
    if a < 0 or a >= NUM_ACTIONS:
        raise ValueError(f"action must be in [0, {NUM_ACTIONS - 1}], got {a}")
    return a


def _slide_row_left(row: np.ndarray) -> Tuple[np.ndarray, int]:
    """Compress and merge one row toward the left.  Each tile merges once."""
    tiles = row[row != 0]
    out = np.zeros(row.shape, dtype=np.int64)
    if tiles.size == 0:
        return out, 0

    merged: List[int] = []
    score = 0
    i = 0
    while i < tiles.size:
        if i + 1 < tiles.size and tiles[i] == tiles[i + 1]:
            value = int(tiles[i]) * 2
            merged.append(value)
            score += value
            i += 2
        else:
            merged.append(int(tiles[i]))
            i += 1
    out[: len(merged)] = merged
    return out, score


def _move_left_rows(rows: np.ndarray) -> Tuple[np.ndarray, int]:
    """Apply ``_slide_row_left`` to every row of a 4x4 array."""
    out = np.zeros((rows.shape[0], BOARD_SIZE), dtype=np.int64)
    score = 0
    for r in range(rows.shape[0]):
        line, line_score = _slide_row_left(rows[r])
        out[r] = line
        score += line_score
    return out, score


class Game2048Env:
    """A minimal Gymnasium-compatible 2048 environment.

    Parameters
    ----------
    seed:
        Optional seed for the internal ``numpy.random.Generator``.
        The constructor initialises one episode immediately, so the
        environment is usable without calling ``reset`` first.
    """

    metadata = {"render_modes": []}
    n_actions = NUM_ACTIONS
    observation_shape = (BOARD_SIZE, BOARD_SIZE)

    def __init__(self, seed: Optional[int] = None):
        self.np_random = np.random.default_rng(seed)
        self.board = np.zeros((BOARD_SIZE, BOARD_SIZE), dtype=np.int64)
        self.score = 0
        self.step_count = 0
        self.terminated = False
        self._legal = np.zeros(NUM_ACTIONS, dtype=bool)
        self._move_cache: List[Tuple[Board, int, bool]] = []
        self.reset()

    # ------------------------------------------------------------------
    # Core Gymnasium-style API
    # ------------------------------------------------------------------
    def reset(
        self, seed: Optional[int] = None
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Start a new episode and return ``(observation, info)``.

        If ``seed`` is not None the RNG is re-seeded.  If it is None, the
        existing RNG stream continues (standard Gymnasium behaviour).
        """
        if seed is not None:
            self.np_random = np.random.default_rng(seed)

        self.board = np.zeros((BOARD_SIZE, BOARD_SIZE), dtype=np.int64)
        self.score = 0
        self.step_count = 0
        self.terminated = False

        for _ in range(INITIAL_TILES):
            self._spawn_tile()

        self._refresh_legal_actions()
        return self.board.copy(), self._make_info()

    def step(
        self, action: int
    ) -> Tuple[np.ndarray, int, bool, bool, Dict[str, Any]]:
        """Apply an action.

        Returns ``(observation, reward, terminated, truncated, info)``.
        """
        if self.terminated:
            raise RuntimeError("Episode is terminated; call reset() before step().")

        action = _validate_action(action)
        new_board, move_score, moved = self._move_cache[action]

        if not moved:
            # Illegal move: no tile spawns and the state does not change.
            return (
                self.board.copy(),
                0,
                False,
                False,
                self._make_info(invalid_action=True),
            )

        self.board = new_board
        self.score += move_score
        self.step_count += 1
        self._spawn_tile()
        self._refresh_legal_actions()
        self.terminated = not bool(self._legal.any())

        return (
            self.board.copy(),
            int(move_score),
            self.terminated,
            False,
            self._make_info(),
        )

    # ------------------------------------------------------------------
    # Action masks / diagnostics
    # ------------------------------------------------------------------
    def action_masks(self) -> np.ndarray:
        """Boolean mask of shape (4,): True means the action is legal."""
        return self._legal.copy()

    def legal_actions(self) -> List[int]:
        """List of legal action indices."""
        return np.flatnonzero(self._legal).tolist()

    def _make_info(self, invalid_action: bool = False) -> Dict[str, Any]:
        return {
            "score": int(self.score),
            "max_tile": int(self.board.max()) if self.board.size else 0,
            "valid_actions": self._legal.copy(),
            "legal_actions": self.legal_actions(),
            "step_count": int(self.step_count),
            "invalid_action": bool(invalid_action),
        }

    # ------------------------------------------------------------------
    # Board mechanics (pure functions, also useful for tests)
    # ------------------------------------------------------------------
    @staticmethod
    def move_board(board: Board, action: int) -> Tuple[np.ndarray, int, bool]:
        """Apply a move to a board without spawning.

        Returns ``(new_board, merge_score, moved)``.  The input is not
        modified.
        """
        action = _validate_action(action)
        b = np.asarray(board, dtype=np.int64)
        if b.shape != (BOARD_SIZE, BOARD_SIZE):
            raise ValueError(
                f"board must have shape ({BOARD_SIZE}, {BOARD_SIZE}), got {b.shape}"
            )

        if action == ACTION_LEFT:
            new_board, score = _move_left_rows(b)
        elif action == ACTION_RIGHT:
            reversed_board, score = _move_left_rows(np.fliplr(b))
            new_board = np.fliplr(reversed_board)
        elif action == ACTION_UP:
            transposed, score = _move_left_rows(b.T)
            new_board = transposed.T
        else:  # ACTION_DOWN
            reversed_columns = np.fliplr(b.T)
            slid, score = _move_left_rows(reversed_columns)
            new_board = np.fliplr(slid).T

        new_board = np.ascontiguousarray(new_board, dtype=np.int64)
        moved = not np.array_equal(new_board, b)
        return new_board, int(score), moved

    @staticmethod
    def is_game_over(board: Board) -> bool:
        """True iff no direction changes the supplied board."""
        b = np.asarray(board, dtype=np.int64)
        for action in range(NUM_ACTIONS):
            if Game2048Env.move_board(b, action)[2]:
                return False
        return True

    # ------------------------------------------------------------------
    # Random tile spawning
    # ------------------------------------------------------------------
    def _spawn_tile(self) -> bool:
        """Place one tile (90% -> 2, 10% -> 4) in a uniformly random empty cell.

        The RNG draws the **position first**, then the value.  Returns
        False if the board is full.
        """
        empty = np.flatnonzero(self.board == 0)
        if empty.size == 0:
            return False

        idx = int(self.np_random.integers(0, empty.size))
        value = 2 if float(self.np_random.random()) < SPAWN_PROB_2 else 4
        self.board.reshape(-1)[int(empty[idx])] = value
        return True

    def _refresh_legal_actions(self) -> None:
        """Recompute the legal mask and cache each move result."""
        cache: List[Tuple[Board, int, bool]] = []
        mask = np.zeros(NUM_ACTIONS, dtype=bool)
        for action in range(NUM_ACTIONS):
            new_board, score, moved = self.move_board(self.board, action)
            cache.append((new_board, score, moved))
            mask[action] = moved
        self._move_cache = cache
        self._legal = mask

    # ------------------------------------------------------------------
    def __repr__(self) -> str:
        return (
            f"Game2048Env(score={self.score}, steps={self.step_count}, "
            f"terminated={self.terminated})"
        )
