"""Small end-to-end smoke test: a few Double DQN updates + checkpoint."""

from __future__ import annotations

from rl.dqn.agent import DQNConfig, DoubleDQNAgent
from rl.dqn.train import train


def test_training_smoke(tmp_path):
    config = DQNConfig(
        hidden_size=32,
        learning_rate=1e-3,
        gamma=0.99,
        batch_size=4,
        buffer_capacity=500,
        target_update_freq=10,
        grad_clip_norm=10.0,
        huber_beta=1.0,
        epsilon_start=1.0,
        epsilon_end=0.1,
        epsilon_decay_steps=80,
        learning_starts=8,
        device="cpu",
        seed=0,
        total_steps=80,
        log_frequency=20,
        eval_frequency=40,
        eval_episodes=1,
        checkpoint_frequency=40,
        checkpoint_dir=str(tmp_path),
        max_episode_steps=1_000,
        log_csv="",
    )

    result = train(config, verbose=False)

    assert result["env_steps"] == 80
    assert result["updates"] > 0
    assert (tmp_path / "final.pt").exists()
    assert (tmp_path / "latest.pt").exists()

    agent = DoubleDQNAgent(config)
    meta = agent.load_checkpoint(tmp_path / "final.pt")
    assert meta["env_steps"] == 80
