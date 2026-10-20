"""Board encoding and Q-network for the 2048 Double DQN agent."""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

BOARD_SIZE = 4
NUM_ACTIONS = 4

# log2 values are divided by 16 so a 65536 tile maps to 1.0 and a 2048 tile
# maps to 11/16.  Empty cells encode as 0.
LOG2_NORM = 16.0


def encode_board(board: np.ndarray) -> np.ndarray:
    """Encode a raw 4x4 board as normalized ``log2(tile)``.

    Empty cells stay 0.  The result is ``float32`` with shape ``(4, 4)``.
    """
    arr = np.asarray(board, dtype=np.float32)
    if arr.shape != (BOARD_SIZE, BOARD_SIZE):
        raise ValueError(
            f"board must have shape ({BOARD_SIZE}, {BOARD_SIZE}), got {arr.shape}"
        )
    encoded = np.zeros_like(arr, dtype=np.float32)
    occupied = arr > 0
    encoded[occupied] = np.log2(arr[occupied]) / LOG2_NORM
    return encoded


class QNetwork(nn.Module):
    """MLP: 16 normalized log2 cells -> 4 action Q-values.

    Architecture: 16 -> hidden -> hidden -> 4, with ReLU activations.
    """

    def __init__(self, hidden_size: int = 256):
        super().__init__()
        if hidden_size <= 0:
            raise ValueError("hidden_size must be positive")
        self.hidden_size = int(hidden_size)
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(BOARD_SIZE * BOARD_SIZE, self.hidden_size),
            nn.ReLU(),
            nn.Linear(self.hidden_size, self.hidden_size),
            nn.ReLU(),
            nn.Linear(self.hidden_size, NUM_ACTIONS),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Accept a single (4, 4) board as a convenience.
        if x.dim() == 2:
            x = x.unsqueeze(0)
        return self.net(x)
