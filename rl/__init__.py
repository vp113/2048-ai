"""2048 reinforcement-learning environment (phase 1)."""

from .env2048 import (
    ACTION_DOWN,
    ACTION_LEFT,
    ACTION_NAMES,
    ACTION_RIGHT,
    ACTION_UP,
    BOARD_SIZE,
    NUM_ACTIONS,
    Game2048Env,
)

__all__ = [
    "Game2048Env",
    "BOARD_SIZE",
    "NUM_ACTIONS",
    "ACTION_UP",
    "ACTION_RIGHT",
    "ACTION_DOWN",
    "ACTION_LEFT",
    "ACTION_NAMES",
]
