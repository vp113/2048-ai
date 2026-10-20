"""Fixed-capacity experience replay buffer for 2048 Double DQN."""

from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np

BOARD_SIZE = 4
NUM_ACTIONS = 4


class ReplayBuffer:
    """Preallocated replay buffer storing encoded states and legal masks.

    States are expected to be normalized ``log2`` boards (float32, 4x4),
    as produced by :func:`rl.dqn.network.encode_board`.
    """

    def __init__(self, capacity: int, seed: Optional[int] = None):
        if capacity <= 0:
            raise ValueError("capacity must be positive")

        self.capacity = int(capacity)
        self._size = 0
        self._index = 0
        self.rng = np.random.default_rng(seed)

        self.states = np.zeros((capacity, BOARD_SIZE, BOARD_SIZE), dtype=np.float32)
        self.next_states = np.zeros((capacity, BOARD_SIZE, BOARD_SIZE), dtype=np.float32)
        self.actions = np.zeros(capacity, dtype=np.int64)
        self.rewards = np.zeros(capacity, dtype=np.float32)
        self.dones = np.zeros(capacity, dtype=bool)
        self.legal_masks = np.zeros((capacity, NUM_ACTIONS), dtype=bool)
        self.next_legal_masks = np.zeros((capacity, NUM_ACTIONS), dtype=bool)

    def __len__(self) -> int:
        return self._size

    def push(
        self,
        state: np.ndarray,
        action: int,
        reward: float,
        next_state: np.ndarray,
        done: bool,
        legal_mask: np.ndarray,
        next_legal_mask: np.ndarray,
    ) -> None:
        state = np.asarray(state, dtype=np.float32)
        next_state = np.asarray(next_state, dtype=np.float32)
        if state.shape != (BOARD_SIZE, BOARD_SIZE):
            raise ValueError(f"state must be {(BOARD_SIZE, BOARD_SIZE)}, got {state.shape}")
        if next_state.shape != (BOARD_SIZE, BOARD_SIZE):
            raise ValueError(
                f"next_state must be {(BOARD_SIZE, BOARD_SIZE)}, got {next_state.shape}"
            )

        action = int(action)
        if action < 0 or action >= NUM_ACTIONS:
            raise ValueError(f"action must be in [0, {NUM_ACTIONS - 1}], got {action}")

        legal_mask = np.asarray(legal_mask, dtype=bool).reshape(-1)
        next_legal_mask = np.asarray(next_legal_mask, dtype=bool).reshape(-1)
        if legal_mask.shape != (NUM_ACTIONS,) or next_legal_mask.shape != (NUM_ACTIONS,):
            raise ValueError("legal masks must have shape (4,)")

        i = self._index
        self.states[i] = state
        self.next_states[i] = next_state
        self.actions[i] = action
        self.rewards[i] = float(reward)
        self.dones[i] = bool(done)
        self.legal_masks[i] = legal_mask
        self.next_legal_masks[i] = next_legal_mask

        self._index = (i + 1) % self.capacity
        self._size = min(self._size + 1, self.capacity)

    def sample(
        self, batch_size: int, rng: Optional[np.random.Generator] = None
    ) -> Dict[str, Any]:
        """Sample a batch with replacement.

        Returns NumPy arrays; the training loop converts them to tensors.
        """
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if self._size == 0:
            raise ValueError("cannot sample from an empty buffer")

        generator = rng if rng is not None else self.rng
        idx = generator.integers(0, self._size, size=batch_size)

        return {
            "states": self.states[idx],
            "actions": self.actions[idx],
            "rewards": self.rewards[idx],
            "next_states": self.next_states[idx],
            "dones": self.dones[idx],
            "legal_masks": self.legal_masks[idx],
            "next_legal_masks": self.next_legal_masks[idx],
        }
