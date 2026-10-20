"""Small end-to-end smoke test: a few Double DQN updates + checkpoint."""

from __future__ import annotations

import csv

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
        log_csv=str(tmp_path / "train.csv"),
    )

    result = train(config, verbose=False)

    assert result["env_steps"] == 80
    assert result["updates"] > 0
    assert (tmp_path / "final.pt").exists()
    assert (tmp_path / "latest.pt").exists()
    assert (tmp_path / "best.pt").exists()
    assert result["best_checkpoint"] is not None
    assert result["best_eval_score"] is not None

    agent = DoubleDQNAgent(config)
    meta = agent.load_checkpoint(tmp_path / "final.pt")
    assert meta["env_steps"] == 80

    # The CSV contains the new diagnostics columns and at least one populated row.
    with (tmp_path / "train.csv").open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        assert {
            "q_mean", "q_abs_max", "target_mean", "td_abs_mean",
            "grad_norm", "reward_mean",
        } <= set(reader.fieldnames or [])
        rows = list(reader)
    assert any(row["q_mean"] for row in rows)
    assert any(row["grad_norm"] for row in rows)

    # Per-evaluation metrics, including action frequencies, are written too.
    eval_csv = tmp_path / "eval_metrics.csv"
    assert eval_csv.exists()
    with eval_csv.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        assert {
            "avg_score", "avg_max_tile", "reach_2048_rate",
            "action_up_frac", "action_right_frac",
            "action_down_frac", "action_left_frac",
            "q_mean", "td_abs_mean", "grad_norm", "is_best",
        } <= set(reader.fieldnames or [])
        eval_rows = list(reader)
    assert eval_rows
    assert any(row["is_best"] == "1" for row in eval_rows)
