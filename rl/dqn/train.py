"""Training loop for the 2048 Double DQN agent.

Short smoke test (recommended before any longer run)::

    python -m rl.dqn.train --smoke

Full training is intentionally not started automatically; see README.
"""

from __future__ import annotations

import argparse
import csv
import time
from collections import deque
from dataclasses import fields
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from rl.env2048 import Game2048Env

from .agent import DQNConfig, DoubleDQNAgent, set_seed
from .evaluate import evaluate_agent
from .network import encode_board
from .replay_buffer import ReplayBuffer


def _fmt(value: Optional[float], digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def train(
    config: DQNConfig,
    resume_path: Optional[str | Path] = None,
    verbose: bool = True,
) -> Dict[str, Any]:
    """Run a (possibly short) Double DQN training run and return a summary."""
    if config.total_steps <= 0:
        raise ValueError("total_steps must be positive")
    if config.eval_frequency > 0 and config.eval_episodes <= 0:
        raise ValueError("eval_episodes must be positive when evaluation is enabled")

    set_seed(config.seed)
    env = Game2048Env()
    eval_env = Game2048Env()
    agent = DoubleDQNAgent(config)
    buffer = ReplayBuffer(config.buffer_capacity, seed=config.seed)
    action_rng = np.random.default_rng(config.seed)

    env_steps = 0
    episode_index = 0
    best_max_tile = 0
    if resume_path is not None:
        meta = agent.load_checkpoint(resume_path)
        env_steps = int(meta.get("env_steps", 0))
        episode_index = int(meta.get("episode", 0))
        best_max_tile = int(meta.get("best_max_tile", 0))
        if verbose:
            print(
                f"Resumed from {resume_path}: env_steps={env_steps}, "
                f"episode={episode_index}, train_steps={agent.train_steps}"
            )

    checkpoint_dir = Path(config.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    csv_file = None
    csv_writer = None
    if config.log_csv:
        csv_path = Path(config.log_csv)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        csv_file = csv_path.open("w", newline="", encoding="utf-8")
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(
            [
                "episode",
                "env_steps",
                "avg_score",
                "avg_max_tile",
                "best_max_tile",
                "epsilon",
                "loss",
                "elapsed_sec",
            ]
        )

    recent_scores: deque[float] = deque(maxlen=20)
    recent_max_tiles: deque[int] = deque(maxlen=20)
    loss_sum = 0.0
    loss_count = 0
    last_loss: Optional[float] = None
    updates = 0
    start_time = time.perf_counter()

    if verbose:
        print(f"Device: {agent.device}")
        print(
            "Config: "
            f"hidden={config.hidden_size}, lr={config.learning_rate}, "
            f"gamma={config.gamma}, batch={config.batch_size}, "
            f"buffer={config.buffer_capacity}, "
            f"eps={config.epsilon_start}->{config.epsilon_end} "
            f"over {config.epsilon_decay_steps} steps, "
            f"target_update={config.target_update_freq}"
        )

    def current_epsilon() -> float:
        return agent.epsilon_by_step(env_steps)

    def write_log(force: bool = False) -> None:
        nonlocal loss_sum, loss_count
        if not force and (config.log_frequency <= 0 or env_steps % config.log_frequency != 0):
            return

        avg_score = float(np.mean(recent_scores)) if recent_scores else None
        avg_max_tile = float(np.mean(recent_max_tiles)) if recent_max_tiles else None
        loss = loss_sum / loss_count if loss_count else None
        elapsed = time.perf_counter() - start_time

        if verbose:
            print(
                f"episode={episode_index + 1} env_steps={env_steps} "
                f"avg_score={_fmt(avg_score, 1)} "
                f"avg_max_tile={_fmt(avg_max_tile, 1)} "
                f"best_max_tile={best_max_tile} "
                f"epsilon={current_epsilon():.3f} "
                f"loss={_fmt(loss, 4)} elapsed={elapsed:.2f}s"
            )

        if csv_writer is not None:
            csv_writer.writerow(
                [
                    episode_index + 1,
                    env_steps,
                    "" if avg_score is None else f"{avg_score:.2f}",
                    "" if avg_max_tile is None else f"{avg_max_tile:.2f}",
                    best_max_tile,
                    f"{current_epsilon():.4f}",
                    "" if loss is None else f"{loss:.6f}",
                    f"{elapsed:.3f}",
                ]
            )
            csv_file.flush()

        loss_sum = 0.0
        loss_count = 0

    def checkpoint_meta() -> Dict[str, Any]:
        return {
            "episode": episode_index,
            "env_steps": env_steps,
            "epsilon": current_epsilon(),
            "best_max_tile": best_max_tile,
        }

    def save_checkpoint(tag: str) -> Path:
        return agent.save_checkpoint(checkpoint_dir / tag, meta=checkpoint_meta())

    obs, info = env.reset(seed=config.seed + episode_index)
    episode_steps = 0

    while env_steps < config.total_steps:
        epsilon = current_epsilon()
        action = agent.act(
            encode_board(obs),
            info["valid_actions"],
            epsilon=epsilon,
            rng=action_rng,
        )

        next_obs, reward, terminated, truncated, next_info = env.step(action)
        episode_steps += 1
        env_steps += 1

        cap_reached = episode_steps >= config.max_episode_steps
        done = bool(terminated or truncated or cap_reached)

        buffer.push(
            encode_board(obs),
            action,
            reward,
            encode_board(next_obs),
            done,
            info["valid_actions"],
            next_info["valid_actions"],
        )

        if len(buffer) >= max(config.learning_starts, config.batch_size):
            batch = buffer.sample(config.batch_size)
            loss = agent.train_step(batch)
            updates += 1
            loss_sum += loss
            loss_count += 1
            last_loss = loss

        if done:
            recent_scores.append(float(next_info["score"]))
            final_max = int(next_info["max_tile"])
            recent_max_tiles.append(final_max)
            best_max_tile = max(best_max_tile, final_max)

            episode_index += 1
            episode_steps = 0
            obs, info = env.reset(seed=config.seed + episode_index)
        else:
            obs, info = next_obs, next_info

        write_log()

        if config.checkpoint_frequency > 0 and env_steps % config.checkpoint_frequency == 0:
            save_checkpoint("latest.pt")
            save_checkpoint(f"checkpoint_step_{env_steps:07d}.pt")

        if config.eval_frequency > 0 and env_steps % config.eval_frequency == 0:
            eval_stats = evaluate_agent(
                agent,
                episodes=config.eval_episodes,
                seed=config.seed + 1_000_000 + env_steps,
                env=eval_env,
                max_steps=config.max_episode_steps,
            )
            if verbose:
                print(
                    f"  eval @ {env_steps}: avg_score={eval_stats['average_score']:.1f} "
                    f"avg_max_tile={eval_stats['average_max_tile']:.1f} "
                    f"reach_2048={eval_stats['reach_2048_rate'] * 100:.1f}%"
                )
            agent.online.train()

    write_log(force=True)
    final_path = save_checkpoint("final.pt")
    save_checkpoint("latest.pt")

    if csv_file is not None:
        csv_file.close()

    elapsed = time.perf_counter() - start_time
    result = {
        "env_steps": env_steps,
        "completed_episodes": episode_index,
        "updates": updates,
        "last_loss": last_loss,
        "elapsed_sec": elapsed,
        "device": str(agent.device),
        "checkpoint_dir": str(checkpoint_dir),
        "final_checkpoint": str(final_path),
    }
    if verbose:
        print(
            f"Done: env_steps={env_steps}, completed_episodes={episode_index}, "
            f"updates={updates}, elapsed={elapsed:.2f}s, "
            f"final={final_path}"
        )
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train a Double DQN agent on 2048")
    parser.add_argument("--smoke", action="store_true", help="use a short smoke configuration")
    parser.add_argument("--resume", default=None, help="checkpoint path to resume from")

    parser.add_argument("--hidden-size", type=int, default=None)
    parser.add_argument("--learning-rate", type=float, default=None)
    parser.add_argument("--gamma", type=float, default=None)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--buffer-capacity", type=int, default=None)
    parser.add_argument("--target-update-freq", type=int, default=None)
    parser.add_argument("--grad-clip-norm", type=float, default=None)
    parser.add_argument("--huber-beta", type=float, default=None)
    parser.add_argument("--epsilon-start", type=float, default=None)
    parser.add_argument("--epsilon-end", type=float, default=None)
    parser.add_argument("--epsilon-decay-steps", type=int, default=None)
    parser.add_argument("--learning-starts", type=int, default=None)
    parser.add_argument("--device", default=None, choices=["auto", "cpu", "cuda"])
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--total-steps", type=int, default=None)
    parser.add_argument("--log-frequency", type=int, default=None)
    parser.add_argument("--eval-frequency", type=int, default=None)
    parser.add_argument("--eval-episodes", type=int, default=None)
    parser.add_argument("--checkpoint-frequency", type=int, default=None)
    parser.add_argument("--checkpoint-dir", default=None)
    parser.add_argument("--max-episode-steps", type=int, default=None)
    parser.add_argument("--log-csv", default=None)
    return parser


def _config_from_args(args: argparse.Namespace) -> DQNConfig:
    known = {field.name for field in fields(DQNConfig)}
    overrides = {
        name: getattr(args, name)
        for name in known
        if hasattr(args, name) and getattr(args, name) is not None
    }
    config = DQNConfig(**overrides)

    if args.smoke:
        smoke = {
            "total_steps": 500,
            "learning_starts": 100,
            "batch_size": 32,
            "hidden_size": 64,
            "buffer_capacity": 10_000,
            "epsilon_decay_steps": 500,
            "target_update_freq": 100,
            "eval_frequency": 250,
            "eval_episodes": 1,
            "checkpoint_frequency": 250,
            "log_frequency": 50,
            "max_episode_steps": 5_000,
            "checkpoint_dir": "rl/checkpoints/smoke",
        }
        for name, value in smoke.items():
            # Explicit CLI options win over smoke defaults.
            if getattr(args, name, None) is None:
                setattr(config, name, value)

    return config


def main() -> None:
    args = _build_parser().parse_args()
    config = _config_from_args(args)
    train(config, resume_path=args.resume, verbose=True)


if __name__ == "__main__":
    main()
