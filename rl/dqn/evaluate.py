"""Greedy evaluation for a trained Double DQN 2048 agent."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from rl.env2048 import Game2048Env

from .agent import DoubleDQNAgent
from .network import encode_board


def summarize_results(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not results:
        raise ValueError("no evaluation results")

    scores = np.array([r["score"] for r in results], dtype=np.float64)
    max_tiles = np.array([r["max_tile"] for r in results], dtype=np.int64)
    steps = np.array([r["steps"] for r in results], dtype=np.float64)
    distribution = Counter(int(tile) for tile in max_tiles)

    return {
        "episodes": len(results),
        "average_score": float(scores.mean()),
        "average_max_tile": float(max_tiles.mean()),
        "min_max_tile": int(max_tiles.min()),
        "max_max_tile": int(max_tiles.max()),
        "max_tile_distribution": {
            str(tile): int(count) for tile, count in sorted(distribution.items())
        },
        "reach_2048_rate": float(np.mean(max_tiles >= 2048)),
        "average_steps": float(steps.mean()),
        "capped_episodes": int(sum(1 for r in results if r["capped"])),
    }


def evaluate_agent(
    agent: DoubleDQNAgent,
    episodes: int = 100,
    seed: int = 0,
    env: Optional[Game2048Env] = None,
    max_steps: int = 10_000,
) -> Dict[str, Any]:
    """Run greedy masked episodes and return aggregate statistics."""
    if episodes <= 0:
        raise ValueError("episodes must be positive")

    env = env if env is not None else Game2048Env()
    rng = np.random.default_rng(seed)
    was_training = agent.online.training
    agent.online.eval()
    results: List[Dict[str, Any]] = []

    try:
        for i in range(episodes):
            obs, info = env.reset(seed=seed + i)
            steps = 0
            capped = False

            while True:
                if not info["valid_actions"].any():
                    break

                action = agent.act(
                    encode_board(obs),
                    info["valid_actions"],
                    epsilon=0.0,
                    rng=rng,
                )
                obs, _, terminated, truncated, info = env.step(action)
                steps += 1

                if terminated or truncated:
                    break
                if steps >= max_steps:
                    capped = True
                    break

            results.append(
                {
                    "score": int(info["score"]),
                    "max_tile": int(info["max_tile"]),
                    "steps": steps,
                    "capped": capped,
                }
            )
    finally:
        agent.online.train(was_training)

    return summarize_results(results)


def print_stats(stats: Dict[str, Any]) -> None:
    print(f"Episodes: {stats['episodes']}")
    print(f"Average score: {stats['average_score']:.1f}")
    print(f"Average max tile: {stats['average_max_tile']:.1f}")
    print(f"Max tile range: {stats['min_max_tile']} - {stats['max_max_tile']}")
    print(f"Reach 2048: {stats['reach_2048_rate'] * 100:.1f}%")
    print(f"Average steps: {stats['average_steps']:.1f}")
    if stats["capped_episodes"]:
        print(f"Episodes hitting the step cap: {stats['capped_episodes']}")
    print(
        "Max tile distribution: "
        + ", ".join(f"{tile}: {count}" for tile, count in stats["max_tile_distribution"].items())
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a 2048 Double DQN checkpoint")
    parser.add_argument("--model", required=True, help="path to a .pt checkpoint")
    parser.add_argument("--episodes", type=int, default=100)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--max-steps", type=int, default=10_000)
    parser.add_argument("--json", default="", help="optional path for JSON results")
    args = parser.parse_args()

    agent, _ = DoubleDQNAgent.from_checkpoint(args.model, device=args.device)
    stats = evaluate_agent(
        agent,
        episodes=args.episodes,
        seed=args.seed,
        max_steps=args.max_steps,
    )
    print_stats(stats)

    if args.json:
        output = Path(args.json)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"Saved JSON results to {output}")


if __name__ == "__main__":
    main()
