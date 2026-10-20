"""Double DQN agent, configuration, target computation, and checkpoints."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import torch
from torch import nn

from .network import NUM_ACTIONS, QNetwork, encode_board

# Re-exported for convenience.
__all__ = [
    "DQNConfig",
    "DoubleDQNAgent",
    "double_dqn_targets",
    "set_seed",
    "encode_board",
]


@dataclass
class DQNConfig:
    """Hyperparameters for the agent and the training/evaluation schedule."""

    # Network / optimisation
    hidden_size: int = 256
    learning_rate: float = 1e-3
    gamma: float = 0.99
    batch_size: int = 64
    buffer_capacity: int = 100_000
    target_update_freq: int = 1_000
    grad_clip_norm: float = 10.0
    huber_beta: float = 1.0
    reward_scale: float = 1.0  # 1.0 = original raw merge-score reward
    collect_diagnostics: bool = True

    # Exploration
    epsilon_start: float = 1.0
    epsilon_end: float = 0.05
    epsilon_decay_steps: int = 50_000
    learning_starts: int = 1_000

    # Runtime / reproducibility
    device: str = "auto"
    seed: int = 0

    # Training schedule
    total_steps: int = 20_000
    log_frequency: int = 100
    eval_frequency: int = 5_000
    eval_episodes: int = 5
    eval_seed: int = 1_000_000  # fixed evaluation set, shared by all checkpoints
    checkpoint_frequency: int = 5_000
    checkpoint_dir: str = "rl/checkpoints"
    max_episode_steps: int = 10_000
    log_csv: str = ""


def set_seed(seed: int) -> None:
    """Seed Python, NumPy, and PyTorch."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_device(device: str) -> torch.device:
    if device == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")
    return torch.device(device)


def double_dqn_targets(
    q_online_next: torch.Tensor,
    q_target_next: torch.Tensor,
    rewards: torch.Tensor,
    dones: torch.Tensor,
    next_legal_masks: torch.Tensor,
    gamma: float,
) -> torch.Tensor:
    """Compute Double DQN targets with legal-action and terminal masking.

    The online network selects the best **legal** next action; the target
    network evaluates that action.  Terminal transitions and states with no
    legal actions do not bootstrap.
    """
    neg_inf = torch.finfo(q_online_next.dtype).min
    masked_online = q_online_next.masked_fill(~next_legal_masks, neg_inf)
    best_actions = masked_online.argmax(dim=1, keepdim=True)

    q_target_selected = q_target_next.gather(1, best_actions).squeeze(1)
    has_legal = next_legal_masks.any(dim=1)
    bootstrap = (~dones) & has_legal

    return rewards + gamma * q_target_selected * bootstrap.to(q_target_selected.dtype)


class DoubleDQNAgent:
    """Double DQN agent with a replay sampler, target network, and checkpoints."""

    def __init__(self, config: DQNConfig):
        self.config = config

        if config.batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if config.buffer_capacity < config.batch_size:
            raise ValueError("buffer_capacity must be >= batch_size")
        if config.hidden_size <= 0:
            raise ValueError("hidden_size must be positive")
        if config.target_update_freq <= 0:
            raise ValueError("target_update_freq must be positive")
        if not (0.0 <= config.gamma <= 1.0):
            raise ValueError("gamma must be in [0, 1]")
        if config.reward_scale <= 0:
            raise ValueError("reward_scale must be positive")

        set_seed(config.seed)
        self.device = resolve_device(config.device)

        self.online = QNetwork(config.hidden_size).to(self.device)
        self.target = QNetwork(config.hidden_size).to(self.device)
        self.target.load_state_dict(self.online.state_dict())
        self.target.eval()
        for parameter in self.target.parameters():
            parameter.requires_grad_(False)

        self.optimizer = torch.optim.Adam(
            self.online.parameters(), lr=config.learning_rate
        )
        self.loss_fn = nn.SmoothL1Loss(beta=config.huber_beta)
        self.train_steps = 0
        self.last_train_metrics: Dict[str, float] = {}

    # ------------------------------------------------------------------
    # Acting
    # ------------------------------------------------------------------
    def epsilon_by_step(self, step: int) -> float:
        """Linear epsilon decay, clamped at ``epsilon_end``."""
        if self.config.epsilon_decay_steps <= 0:
            return float(self.config.epsilon_end)
        fraction = min(1.0, max(0.0, step / self.config.epsilon_decay_steps))
        return float(
            self.config.epsilon_start
            + (self.config.epsilon_end - self.config.epsilon_start) * fraction
        )

    def act(
        self,
        encoded_state: np.ndarray,
        legal_mask: np.ndarray,
        epsilon: float = 0.0,
        rng: Optional[np.random.Generator] = None,
    ) -> int:
        """Choose an action with epsilon-greedy, masking illegal actions."""
        legal = np.asarray(legal_mask, dtype=bool).reshape(-1)
        if legal.shape != (NUM_ACTIONS,):
            raise ValueError("legal_mask must have shape (4,)")
        if not legal.any():
            raise ValueError("no legal actions available")

        generator = rng if rng is not None else np.random.default_rng()
        if epsilon > 0.0 and float(generator.random()) < epsilon:
            return int(generator.choice(np.flatnonzero(legal)))

        state = np.asarray(encoded_state, dtype=np.float32)
        if state.shape != (4, 4):
            raise ValueError(f"encoded_state must have shape (4, 4), got {state.shape}")
        tensor = torch.as_tensor(state, dtype=torch.float32, device=self.device).unsqueeze(0)
        with torch.no_grad():
            q_values = self.online(tensor).squeeze(0).cpu().numpy()

        q_values = np.where(legal, q_values, -np.inf)
        return int(np.argmax(q_values))

    def q_values(self, encoded_state: np.ndarray) -> np.ndarray:
        """Return raw Q-values (no masking)."""
        state = np.asarray(encoded_state, dtype=np.float32)
        if state.shape != (4, 4):
            raise ValueError(f"encoded_state must have shape (4, 4), got {state.shape}")
        tensor = torch.as_tensor(state, dtype=torch.float32, device=self.device).unsqueeze(0)
        with torch.no_grad():
            return self.online(tensor).squeeze(0).cpu().numpy()

    # ------------------------------------------------------------------
    # Learning
    # ------------------------------------------------------------------
    def train_step(
        self,
        batch: Dict[str, np.ndarray],
        collect_diagnostics: Optional[bool] = None,
    ) -> float:
        """One Double DQN update; returns the scalar Huber loss.

        Diagnostics are cheap scalar reductions over the replay batch.  They
        can be disabled per call or globally via ``config.collect_diagnostics``.
        """
        collect = (
            self.config.collect_diagnostics
            if collect_diagnostics is None
            else bool(collect_diagnostics)
        )

        states = torch.as_tensor(
            batch["states"], dtype=torch.float32, device=self.device
        )
        actions = torch.as_tensor(
            batch["actions"], dtype=torch.long, device=self.device
        )
        raw_rewards = torch.as_tensor(
            batch["rewards"], dtype=torch.float32, device=self.device
        )
        rewards = raw_rewards * float(self.config.reward_scale)
        next_states = torch.as_tensor(
            batch["next_states"], dtype=torch.float32, device=self.device
        )
        dones = torch.as_tensor(
            batch["dones"], dtype=torch.bool, device=self.device
        )
        next_legal_masks = torch.as_tensor(
            batch["next_legal_masks"], dtype=torch.bool, device=self.device
        )

        self.online.train()
        q_values = self.online(states).gather(1, actions.unsqueeze(1)).squeeze(1)

        with torch.no_grad():
            q_online_next = self.online(next_states)
            q_target_next = self.target(next_states)
            targets = double_dqn_targets(
                q_online_next,
                q_target_next,
                rewards,
                dones,
                next_legal_masks,
                self.config.gamma,
            )

        metrics: Dict[str, float] = {}
        if collect:
            with torch.no_grad():
                metrics = {
                    "q_mean": float(q_values.mean().item()),
                    "q_abs_max": float(q_values.abs().max().item()),
                    "target_mean": float(targets.mean().item()),
                    "td_abs_mean": float((targets - q_values).abs().mean().item()),
                    "reward_mean": float(raw_rewards.mean().item()),
                }

        loss = self.loss_fn(q_values, targets)
        self.optimizer.zero_grad(set_to_none=True)
        loss.backward()
        grad_norm = torch.nn.utils.clip_grad_norm_(
            self.online.parameters(), self.config.grad_clip_norm
        )
        self.optimizer.step()

        self.train_steps += 1
        if self.train_steps % self.config.target_update_freq == 0:
            self.target.load_state_dict(self.online.state_dict())

        if collect:
            metrics["grad_norm"] = float(grad_norm.item())
            self.last_train_metrics = metrics
        else:
            self.last_train_metrics = {}

        return float(loss.item())

    # ------------------------------------------------------------------
    # Checkpoints
    # ------------------------------------------------------------------
    def save_checkpoint(
        self,
        path: str | Path,
        meta: Optional[Dict[str, Any]] = None,
    ) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "online": self.online.state_dict(),
            "target": self.target.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "config": asdict(self.config),
            "train_steps": int(self.train_steps),
            "meta": meta or {},
        }
        torch.save(payload, path)
        return path

    def load_checkpoint(
        self,
        path: str | Path,
        load_optimizer: bool = True,
    ) -> Dict[str, Any]:
        path = Path(path)
        payload = torch.load(
            path, map_location=self.device, weights_only=False
        )

        saved_config = payload.get("config", {})
        saved_hidden = saved_config.get("hidden_size")
        if saved_hidden is not None and int(saved_hidden) != self.config.hidden_size:
            raise ValueError(
                "checkpoint hidden_size does not match this agent: "
                f"{saved_hidden} vs {self.config.hidden_size}"
            )

        self.online.load_state_dict(payload["online"])
        self.target.load_state_dict(payload["target"])
        if load_optimizer and "optimizer" in payload:
            self.optimizer.load_state_dict(payload["optimizer"])
        self.train_steps = int(payload.get("train_steps", 0))
        return dict(payload.get("meta", {}))

    @classmethod
    def from_checkpoint(
        cls, path: str | Path, device: Optional[str] = None
    ) -> Tuple["DoubleDQNAgent", Dict[str, Any]]:
        """Build an agent using the checkpoint's saved config and weights."""
        path = Path(path)
        # First read only the config metadata (small tensors are not needed yet).
        payload_cpu = torch.load(path, map_location="cpu", weights_only=False)
        saved_config = payload_cpu.get("config", {})
        known = {field.name for field in fields(DQNConfig)}
        kwargs = {key: value for key, value in saved_config.items() if key in known}
        config = DQNConfig(**kwargs)
        if device is not None:
            config.device = device

        target_device = resolve_device(config.device)
        payload = torch.load(path, map_location=target_device, weights_only=False)

        agent = cls(config)
        agent.online.load_state_dict(payload["online"])
        agent.target.load_state_dict(payload["target"])
        if "optimizer" in payload:
            agent.optimizer.load_state_dict(payload["optimizer"])
        agent.train_steps = int(payload.get("train_steps", 0))
        return agent, dict(payload.get("meta", {}))
