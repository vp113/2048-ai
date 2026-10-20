"""Random-agent benchmark for the 2048 RL environment.

The agent only chooses legal actions (using the environment's action mask).
It is not expected to score well; this script validates correctness and
measures throughput.

Usage (from the project root)::

    python -m rl.random_agent --games 100 --seed 0
    # or
    python rl/random_agent.py --games 100 --seed 0
"""

from __future__ import annotations

import argparse
import time
from collections import Counter

import numpy as np

try:  # works with ``python -m rl.random_agent``
    from rl.env2048 import Game2048Env
except ImportError:  # works with ``python rl/random_agent.py``
    from env2048 import Game2048Env


def run_episode(
    env: Game2048Env,
    action_rng: np.random.Generator,
    max_steps: int,
    seed: int | None = None,
):
    """Play one episode choosing uniformly from legal actions."""
    _, info = env.reset(seed=seed)
    steps = 0
    truncated_by_cap = False

    while True:
        legal = np.flatnonzero(env.action_masks())
        if legal.size == 0:
            break

        action = int(action_rng.choice(legal))
        _, _, terminated, truncated, info = env.step(action)
        steps += 1

        if terminated or truncated:
            break
        if steps >= max_steps:
            truncated_by_cap = True
            break

    return {
        "score": int(info["score"]),
        "max_tile": int(info["max_tile"]),
        "steps": steps,
        "truncated_by_cap": truncated_by_cap,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="2048 random-agent benchmark")
    parser.add_argument("--games", type=int, default=100, help="number of episodes")
    parser.add_argument("--seed", type=int, default=0, help="base seed")
    parser.add_argument(
        "--max-steps",
        type=int,
        default=100_000,
        help="safety cap per episode (the environment has no time limit)",
    )
    args = parser.parse_args()

    env = Game2048Env()
    results = []
    total_steps = 0
    start = time.perf_counter()

    for i in range(args.games):
        # Per-episode seeds make the whole run reproducible.
        action_rng = np.random.default_rng(args.seed + i)
        result = run_episode(env, action_rng, args.max_steps, seed=args.seed + i)
        results.append(result)
        total_steps += result["steps"]

    elapsed = time.perf_counter() - start

    scores = [r["score"] for r in results]
    max_tiles = [r["max_tile"] for r in results]
    steps = [r["steps"] for r in results]
    tile_counts = Counter(max_tiles)
    capped = sum(1 for r in results if r["truncated_by_cap"])

    # Deliberately ASCII labels: Windows consoles may use a non-UTF-8 code page.
    print(f"Games: {args.games}")
    print(f"Average score: {np.mean(scores):.1f}")
    print(f"Average max tile: {np.mean(max_tiles):.1f}")
    print(f"Max tile range: {min(max_tiles)} - {max(max_tiles)}")
    print(f"Average steps: {np.mean(steps):.1f}")
    print(f"Total steps: {total_steps}")
    print(f"Total time: {elapsed:.3f} s")
    print(f"Steps per second: {total_steps / elapsed:.1f} steps/s")
    if capped:
        print(f"Episodes hitting the safety cap: {capped}")
    print("Max tile distribution: " + ", ".join(
        f"{tile}: {count}" for tile, count in sorted(tile_counts.items())
    ))


if __name__ == "__main__":
    main()
