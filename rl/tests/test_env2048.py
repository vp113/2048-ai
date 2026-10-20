"""Unit tests for the 2048 reinforcement-learning environment."""

from __future__ import annotations

import numpy as np
import pytest

from rl.env2048 import (
    ACTION_DOWN,
    ACTION_LEFT,
    ACTION_RIGHT,
    ACTION_UP,
    Game2048Env,
)


def b(rows) -> np.ndarray:
    return np.array(rows, dtype=np.int64)


ZERO_ROW = [0, 0, 0, 0]


# ---------------------------------------------------------------------------
# reset / API contract
# ---------------------------------------------------------------------------
def test_reset_returns_board_and_info():
    env = Game2048Env()
    obs, info = env.reset(seed=42)

    assert isinstance(obs, np.ndarray)
    assert obs.shape == (4, 4)
    assert np.issubdtype(obs.dtype, np.integer)
    assert np.count_nonzero(obs) == 2
    assert set(obs[obs != 0].tolist()) <= {2, 4}

    assert info["score"] == 0
    assert info["max_tile"] == int(obs.max())
    assert info["step_count"] == 0
    assert info["invalid_action"] is False
    assert info["valid_actions"].shape == (4,)
    assert info["valid_actions"].dtype == bool
    assert info["legal_actions"] == np.flatnonzero(info["valid_actions"]).tolist()
    assert info["legal_actions"] == env.legal_actions()


def test_reset_seed_is_reproducible():
    a = Game2048Env()
    obs_a, info_a = a.reset(seed=123)
    b_env = Game2048Env()
    obs_b, info_b = b_env.reset(seed=123)

    np.testing.assert_array_equal(obs_a, obs_b)
    np.testing.assert_array_equal(info_a["valid_actions"], info_b["valid_actions"])
    assert info_a["legal_actions"] == info_b["legal_actions"]

    # Re-seeding the same environment must also reproduce the initial board.
    obs_c, _ = a.reset(seed=123)
    np.testing.assert_array_equal(obs_a, obs_c)


def test_observation_is_a_copy():
    env = Game2048Env(seed=1)
    obs, _ = env.reset(seed=1)
    before = env.board.copy()
    obs[:] = 0
    np.testing.assert_array_equal(env.board, before)


def test_info_types_and_keys():
    env = Game2048Env(seed=0)
    _, info = env.reset(seed=0)
    assert set(info) == {
        "score", "max_tile", "valid_actions", "legal_actions",
        "step_count", "invalid_action",
    }
    assert isinstance(info["score"], int)
    assert isinstance(info["max_tile"], int)
    assert isinstance(info["step_count"], int)
    assert isinstance(info["invalid_action"], bool)
    assert isinstance(info["valid_actions"], np.ndarray)
    assert info["valid_actions"].dtype == bool
    assert isinstance(info["legal_actions"], list)
    assert all(isinstance(a, int) for a in info["legal_actions"])


# ---------------------------------------------------------------------------
# Move / merge rules
# ---------------------------------------------------------------------------
def test_move_left_and_right():
    grid = b([
        [2, 0, 0, 2],
        [4, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ])

    left, score, moved = Game2048Env.move_board(grid, ACTION_LEFT)
    np.testing.assert_array_equal(left, b([
        [4, 0, 0, 0],
        [8, 0, 0, 0],
        ZERO_ROW,
        ZERO_ROW,
    ]))
    assert score == 12
    assert moved is True

    right, score, moved = Game2048Env.move_board(grid, ACTION_RIGHT)
    np.testing.assert_array_equal(right, b([
        [0, 0, 0, 4],
        [0, 0, 0, 8],
        ZERO_ROW,
        ZERO_ROW,
    ]))
    assert score == 12
    assert moved is True


def test_move_up_and_down():
    grid = b([
        [2, 4, 0, 0],
        [2, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ])

    up, score, moved = Game2048Env.move_board(grid, ACTION_UP)
    np.testing.assert_array_equal(up, b([
        [4, 8, 0, 0],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ]))
    assert score == 12
    assert moved is True

    down, score, moved = Game2048Env.move_board(grid, ACTION_DOWN)
    np.testing.assert_array_equal(down, b([
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
        [4, 8, 0, 0],
    ]))
    assert score == 12
    assert moved is True


@pytest.mark.parametrize(
    "row, expected, expected_score",
    [
        ([2, 2, 2, 2], [4, 4, 0, 0], 8),   # two independent merges
        ([2, 2, 4, 0], [4, 4, 0, 0], 4),   # merged 4 must not merge with 4 again
        ([4, 4, 8, 0], [8, 8, 0, 0], 8),   # merged 8 must not merge with 8 again
        ([2, 2, 2, 0], [4, 2, 0, 0], 4),   # leftmost pair merges, third does not chain
        ([2, 0, 0, 2], [4, 0, 0, 0], 4),   # merge across a gap
    ],
)
def test_single_merge_per_tile(row, expected, expected_score):
    grid = b([row, ZERO_ROW, ZERO_ROW, ZERO_ROW])
    new_board, score, moved = Game2048Env.move_board(grid, ACTION_LEFT)
    np.testing.assert_array_equal(new_board, b([expected, ZERO_ROW, ZERO_ROW, ZERO_ROW]))
    assert score == expected_score
    assert moved is True


def test_slide_without_merge():
    grid = b([
        [0, 2, 0, 4],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
    ])
    new_board, score, moved = Game2048Env.move_board(grid, ACTION_LEFT)
    np.testing.assert_array_equal(new_board, b([
        [2, 4, 0, 0],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ]))
    assert score == 0
    assert moved is True


def test_invalid_move_is_detected():
    grid = b([
        [2, 4, 8, 16],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ])
    new_board, score, moved = Game2048Env.move_board(grid, ACTION_LEFT)
    np.testing.assert_array_equal(new_board, grid)
    assert score == 0
    assert moved is False


def test_action_mask_matches_moves_on_random_boards():
    rng = np.random.default_rng(2026)
    env = Game2048Env(seed=0)
    for _ in range(120):
        grid = np.where(
            rng.random((4, 4)) < 0.35,
            0,
            2 ** rng.integers(1, 7, size=(4, 4)),
        ).astype(np.int64)
        env.board = grid
        env._refresh_legal_actions()
        mask = env.action_masks()
        assert mask.shape == (4,)
        for action in range(4):
            assert mask[action] == Game2048Env.move_board(grid, action)[2]


# ---------------------------------------------------------------------------
# Step semantics, invalid actions, spawning, rewards
# ---------------------------------------------------------------------------
def test_invalid_action_is_a_noop_without_spawn():
    env = Game2048Env(seed=0)
    env.board = b([
        [2, 4, 8, 16],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ])
    env.score = 0
    env.step_count = 0
    env.terminated = False
    env._refresh_legal_actions()

    assert not env.action_masks()[ACTION_UP]
    before = env.board.copy()
    obs, reward, terminated, truncated, info = env.step(ACTION_UP)

    np.testing.assert_array_equal(obs, before)
    np.testing.assert_array_equal(env.board, before)
    assert reward == 0
    assert terminated is False
    assert truncated is False
    assert info["invalid_action"] is True
    assert info["score"] == 0
    assert info["step_count"] == 0
    np.testing.assert_array_equal(info["valid_actions"], env.action_masks())


def test_out_of_range_and_non_integer_actions_raise():
    env = Game2048Env(seed=0)
    env.reset(seed=0)
    with pytest.raises(ValueError):
        env.step(4)
    with pytest.raises(ValueError):
        env.step(-1)
    with pytest.raises(TypeError):
        env.step(1.5)


def test_valid_step_spawns_exactly_one_tile():
    env = Game2048Env(seed=1)
    env.board = b([
        [0, 2, 0, 0],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ])
    env.score = 0
    env.step_count = 0
    env.terminated = False
    env._refresh_legal_actions()

    obs, reward, terminated, truncated, info = env.step(ACTION_RIGHT)

    assert reward == 0
    assert terminated is False
    assert truncated is False
    assert np.count_nonzero(obs) == 2      # original tile + exactly one spawn
    assert obs[0, 3] == 2                   # the original tile slid right
    assert info["step_count"] == 1
    assert info["invalid_action"] is False


def test_reward_is_the_merge_score():
    env = Game2048Env(seed=2)
    env.board = b([
        [2, 2, 4, 4],
        ZERO_ROW,
        ZERO_ROW,
        ZERO_ROW,
    ])
    env.score = 0
    env.step_count = 0
    env.terminated = False
    env._refresh_legal_actions()

    _, reward, _, truncated, info = env.step(ACTION_LEFT)

    assert reward == 12
    assert info["score"] == 12
    assert truncated is False


# ---------------------------------------------------------------------------
# Random tile generation
# ---------------------------------------------------------------------------
def test_spawn_value_probabilities_and_positions():
    env = Game2048Env(seed=123)
    samples = 10_000
    values = []
    positions = []

    for _ in range(samples):
        env.board[:] = 0
        assert env._spawn_tile() is True
        flat = int(np.flatnonzero(env.board)[0])
        positions.append(flat)
        values.append(int(env.board.reshape(-1)[flat]))

    p2 = values.count(2) / samples
    assert 0.88 <= p2 <= 0.92, f"P(2)={p2}"
    assert set(values) == {2, 4}
    assert set(positions) == set(range(16))

    counts = np.bincount(positions, minlength=16)
    assert counts.min() > 400, counts
    assert counts.max() < 850, counts


def test_spawn_threshold_and_position_selection():
    class FakeRng:
        def __init__(self, value):
            self.value = value

        def integers(self, low, high):
            return 0

        def random(self):
            return self.value

    env = Game2048Env(seed=0)

    env.board[:] = 0
    env.np_random = FakeRng(0.899)
    assert env._spawn_tile() is True
    assert env.board[0, 0] == 2

    env.board[:] = 0
    env.np_random = FakeRng(0.9)
    assert env._spawn_tile() is True
    assert env.board[0, 0] == 4

    # With a single empty cell, the only possible position must be chosen.
    env.board[:] = 2
    env.board[2, 3] = 0
    env.np_random = FakeRng(0.1)
    assert env._spawn_tile() is True
    assert env.board[2, 3] == 2
    assert np.count_nonzero(env.board) == 16


# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------
def _play_deterministically(seed: int, max_steps: int = 80):
    env = Game2048Env()
    obs, info = env.reset(seed=seed)
    boards = [obs.copy()]
    rewards = []

    for _ in range(max_steps):
        legal = np.flatnonzero(env.action_masks())
        if legal.size == 0:
            break
        obs, reward, terminated, truncated, info = env.step(int(legal[0]))
        boards.append(obs.copy())
        rewards.append(reward)
        if terminated or truncated:
            break

    return boards, rewards, env.score, env.step_count, info["max_tile"]


def test_seed_replays_identical_episode():
    boards_a, rewards_a, score_a, steps_a, max_a = _play_deterministically(42)
    boards_b, rewards_b, score_b, steps_b, max_b = _play_deterministically(42)

    assert len(boards_a) == len(boards_b)
    for a, b_board in zip(boards_a, boards_b):
        np.testing.assert_array_equal(a, b_board)
    assert rewards_a == rewards_b
    assert score_a == score_b
    assert steps_a == steps_b
    assert max_a == max_b


# ---------------------------------------------------------------------------
# Game over and termination
# ---------------------------------------------------------------------------
def test_game_over_detection():
    dead = b([
        [2, 4, 8, 16],
        [32, 64, 128, 256],
        [512, 1024, 2048, 4096],
        [8192, 16384, 32768, 65536],
    ])
    assert Game2048Env.is_game_over(dead) is True
    for action in range(4):
        assert Game2048Env.move_board(dead, action)[2] is False

    alive = b([
        [2, 2, 4, 8],
        [16, 32, 64, 128],
        [256, 512, 1024, 2048],
        [4096, 8192, 16384, 32768],
    ])
    assert Game2048Env.is_game_over(alive) is False


def test_termination_when_last_cell_is_filled():
    env = Game2048Env(seed=0)
    env.board = b([
        [2, 4, 8, 16],
        [32, 64, 128, 256],
        [512, 1024, 2048, 4096],
        [8192, 16384, 32768, 0],
    ])
    env.score = 0
    env.step_count = 0
    env.terminated = False
    env._refresh_legal_actions()

    assert env.action_masks()[ACTION_RIGHT]
    obs, reward, terminated, truncated, info = env.step(ACTION_RIGHT)

    assert reward == 0
    assert terminated is True
    assert truncated is False
    assert np.count_nonzero(obs) == 16
    assert not env.action_masks().any()
    assert info["legal_actions"] == []
    assert env.step_count == 1

    with pytest.raises(RuntimeError):
        env.step(ACTION_LEFT)
