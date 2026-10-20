"""Unit tests for Double DQN components (network, replay, targets, checkpoints)."""

from __future__ import annotations

import numpy as np
import pytest
import torch
from torch import nn

from rl.dqn.agent import DQNConfig, DoubleDQNAgent, double_dqn_targets
from rl.dqn.network import LOG2_NORM, QNetwork, encode_board
from rl.dqn.replay_buffer import ReplayBuffer


def make_config(**overrides) -> DQNConfig:
    values = dict(
        hidden_size=16,
        learning_rate=1e-3,
        gamma=0.5,
        batch_size=4,
        buffer_capacity=100,
        target_update_freq=2,
        grad_clip_norm=5.0,
        huber_beta=1.0,
        epsilon_start=1.0,
        epsilon_end=0.1,
        epsilon_decay_steps=100,
        learning_starts=0,
        device="cpu",
        seed=0,
        total_steps=10,
        log_frequency=0,
        eval_frequency=0,
        eval_episodes=1,
        checkpoint_frequency=0,
        checkpoint_dir="unused",
        max_episode_steps=100,
        log_csv="",
    )
    values.update(overrides)
    return DQNConfig(**values)


# ---------------------------------------------------------------------------
# Encoding and network
# ---------------------------------------------------------------------------
def test_encode_board_log2_and_empty_zero():
    board = np.array(
        [
            [0, 2, 4, 2048],
            [8, 16, 32, 64],
            [128, 256, 512, 1024],
            [4096, 8192, 16384, 32768],
        ],
        dtype=np.int64,
    )
    encoded = encode_board(board)
    assert encoded.shape == (4, 4)
    assert encoded.dtype == np.float32
    assert encoded[0, 0] == 0.0
    np.testing.assert_allclose(encoded[0, 1], 1.0 / LOG2_NORM)
    np.testing.assert_allclose(encoded[0, 3], 11.0 / LOG2_NORM)
    np.testing.assert_allclose(encoded[3, 3], 15.0 / LOG2_NORM)

    with pytest.raises(ValueError):
        encode_board(np.zeros((3, 3), dtype=np.int64))


def test_network_output_shape():
    net = QNetwork(hidden_size=32)
    out = net(torch.zeros(7, 4, 4))
    assert out.shape == (7, 4)

    single = net(torch.zeros(4, 4))
    assert single.shape == (1, 4)


# ---------------------------------------------------------------------------
# Replay buffer
# ---------------------------------------------------------------------------
def test_replay_buffer_capacity_wraparound_and_sample():
    buffer = ReplayBuffer(capacity=3, seed=0)
    for i in range(5):
        state = np.full((4, 4), i, dtype=np.float32)
        next_state = np.full((4, 4), i + 1, dtype=np.float32)
        buffer.push(
            state,
            i % 4,
            float(i),
            next_state,
            bool(i % 2),
            np.array([True, True, False, False]),
            np.array([True, False, True, False]),
        )

    assert len(buffer) == 3
    batch = buffer.sample(1000)
    assert batch["states"].shape == (1000, 4, 4)
    assert batch["states"].dtype == np.float32
    assert batch["next_states"].shape == (1000, 4, 4)
    assert batch["actions"].dtype == np.int64
    assert batch["rewards"].dtype == np.float32
    assert batch["dones"].dtype == bool
    assert batch["legal_masks"].shape == (1000, 4)
    assert batch["next_legal_masks"].shape == (1000, 4)

    # Only transitions i=2,3,4 remain; actions are 2,3,0.
    assert set(batch["actions"].tolist()) <= {2, 3, 0}
    # Rewards likewise belong to the retained transitions.
    assert set(batch["rewards"].tolist()) <= {2.0, 3.0, 4.0}


def test_replay_buffer_rejects_bad_shapes():
    buffer = ReplayBuffer(capacity=4, seed=0)
    with pytest.raises(ValueError):
        buffer.push(
            np.zeros((3, 3), dtype=np.float32),
            0,
            0.0,
            np.zeros((4, 4), dtype=np.float32),
            False,
            np.ones(4, dtype=bool),
            np.ones(4, dtype=bool),
        )
    with pytest.raises(ValueError):
        buffer.sample(1)


# ---------------------------------------------------------------------------
# Masked action selection
# ---------------------------------------------------------------------------
class FixedQ(nn.Module):
    def __init__(self, values):
        super().__init__()
        self.register_buffer("values", torch.tensor(values, dtype=torch.float32))

    def forward(self, x):
        return self.values.unsqueeze(0).expand(x.shape[0], -1)


def test_act_masks_illegal_actions():
    agent = DoubleDQNAgent(make_config())
    agent.online = FixedQ([1.0, 100.0, 2.0, 3.0])

    state = np.zeros((4, 4), dtype=np.float32)
    legal = np.array([True, False, True, False])

    # The illegal action 1 has the highest Q but must not be selected.
    assert agent.act(state, legal, epsilon=0.0) == 2

    rng = np.random.default_rng(0)
    explored = {
        agent.act(state, legal, epsilon=1.0, rng=rng) for _ in range(200)
    }
    assert explored <= {0, 2}

    with pytest.raises(ValueError):
        agent.act(state, np.zeros(4, dtype=bool), epsilon=0.0)


# ---------------------------------------------------------------------------
# Double DQN target
# ---------------------------------------------------------------------------
def test_double_dqn_target_uses_online_argmax_and_legal_mask():
    q_online_next = torch.tensor(
        [
            [1.0, 5.0, 2.0, 0.0],   # action 1 is illegal despite Q=5
            [10.0, 0.0, 0.0, 0.0],
            [1.0, 2.0, 3.0, 4.0],   # no legal actions
        ]
    )
    q_target_next = torch.tensor(
        [
            [10.0, 20.0, 30.0, 40.0],
            [1.0, 2.0, 3.0, 4.0],
            [5.0, 6.0, 7.0, 8.0],
        ]
    )
    legal = torch.tensor(
        [
            [False, False, True, False],
            [True, False, False, False],
            [False, False, False, False],
        ]
    )
    rewards = torch.tensor([1.0, 2.0, 3.0])
    dones = torch.tensor([False, True, False])

    targets = double_dqn_targets(
        q_online_next, q_target_next, rewards, dones, legal, gamma=0.5
    )

    # Row 0: best legal online action is 2 -> target Q 30 -> 1 + 0.5*30 = 16.
    # Row 1: terminal -> reward 2.
    # Row 2: no legal action -> reward 3.
    expected = torch.tensor([16.0, 2.0, 3.0])
    assert torch.allclose(targets, expected)


def test_epsilon_schedule():
    agent = DoubleDQNAgent(
        make_config(epsilon_start=1.0, epsilon_end=0.1, epsilon_decay_steps=100)
    )
    assert agent.epsilon_by_step(0) == pytest.approx(1.0)
    assert agent.epsilon_by_step(50) == pytest.approx(0.55)
    assert agent.epsilon_by_step(100) == pytest.approx(0.1)
    assert agent.epsilon_by_step(200) == pytest.approx(0.1)


# ---------------------------------------------------------------------------
# Training step and checkpoints
# ---------------------------------------------------------------------------
def _make_batch(buffer: ReplayBuffer, size: int = 8):
    rng = np.random.default_rng(1)
    for i in range(16):
        buffer.push(
            rng.normal(size=(4, 4)).astype(np.float32),
            i % 4,
            float(i % 3),
            rng.normal(size=(4, 4)).astype(np.float32),
            bool(i % 5 == 0),
            np.array([True, True, True, True]),
            np.array([True, True, True, False]),
        )
    return buffer.sample(size)


def test_train_step_updates_parameters_and_target():
    config = make_config(seed=1, batch_size=8, target_update_freq=2)
    agent = DoubleDQNAgent(config)
    buffer = ReplayBuffer(100, seed=1)
    batch = _make_batch(buffer, 8)

    before = [p.detach().clone() for p in agent.online.parameters()]
    loss = agent.train_step(batch)

    assert np.isfinite(loss)
    assert agent.train_steps == 1
    assert any(
        not torch.equal(old, new)
        for old, new in zip(before, agent.online.parameters())
    )

    # Second update triggers the hard target synchronisation.
    agent.train_step(batch)
    for online_param, target_param in zip(
        agent.online.parameters(), agent.target.parameters()
    ):
        assert torch.allclose(online_param, target_param)


def test_checkpoint_roundtrip(tmp_path):
    config = make_config(seed=3)
    agent = DoubleDQNAgent(config)

    with torch.no_grad():
        for parameter in agent.online.parameters():
            parameter.add_(0.0123)
    agent.target.load_state_dict(agent.online.state_dict())

    path = tmp_path / "checkpoint.pt"
    agent.save_checkpoint(path, meta={"episode": 7, "env_steps": 123})
    assert path.exists()

    loaded = DoubleDQNAgent(config)
    meta = loaded.load_checkpoint(path)
    assert meta == {"episode": 7, "env_steps": 123}

    for original, restored in zip(agent.online.parameters(), loaded.online.parameters()):
        assert torch.allclose(original, restored)
    for original, restored in zip(agent.target.parameters(), loaded.target.parameters()):
        assert torch.allclose(original, restored)

    from_checkpoint, meta2 = DoubleDQNAgent.from_checkpoint(path, device="cpu")
    assert meta2["env_steps"] == 123
    assert from_checkpoint.config.hidden_size == config.hidden_size
    for original, restored in zip(
        agent.online.parameters(), from_checkpoint.online.parameters()
    ):
        assert torch.allclose(original, restored)
