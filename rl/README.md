# 2048 强化学习环境（第一阶段）

本目录提供一个独立的、NumPy 实现的 2048 强化学习环境，接口尽量遵循
Gymnasium 风格。第一阶段只包含环境、测试和随机智能体基准；**不包含 DQN，
也不依赖 PyTorch / Gymnasium**。

现有网页游戏、Expectimax AI、Web Worker 和界面均未修改。

## 文件结构

```
rl/
├── __init__.py            # 导出 Game2048Env 和动作常量
├── env2048.py             # 2048 环境本体
├── random_agent.py        # 随机智能体 / 性能基准脚本
├── requirements.txt       # numpy + pytest + torch
├── README.md
├── dqn/                   # 第二阶段：Double DQN
│   ├── __init__.py
│   ├── network.py         # log2 编码 + Q 网络
│   ├── replay_buffer.py   # 经验回放
│   ├── agent.py           # Double DQN、目标值、checkpoint
│   ├── train.py           # 训练循环、日志、定期评估
│   └── evaluate.py        # 独立贪心评估脚本
└── tests/
    ├── conftest.py        # 让 pytest 从任意目录都能 import rl
    ├── test_env2048.py    # 环境单元测试
    ├── test_cross_js.py   # 与现有 JavaScript 规则交叉验证
    ├── js_oracle.js       # 调用 game.js 的 Node 参考实现
    ├── test_dqn.py        # 网络/回放/掩码/目标值/checkpoint 测试
    └── test_dqn_smoke.py  # 小规模端到端训练 smoke test
```

## 安装依赖

在项目根目录（`2048-game/`）执行：

```bash
python -m pip install -r rl/requirements.txt
```

如果只需要 CPU 版 PyTorch，可使用官方 CPU 源：

```bash
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch
```

当前开发环境：Python 3.12、NumPy 1.26、pytest 7.4、PyTorch 2.14（CPU）。

## 快速开始

```python
import numpy as np
from rl.env2048 import Game2048Env

env = Game2048Env()
obs, info = env.reset(seed=42)
print(obs)
print(info["valid_actions"], info["legal_actions"])

done = False
while not done:
    legal = np.flatnonzero(env.action_masks())
    action = int(np.random.choice(legal))       # 只选择合法动作
    obs, reward, terminated, truncated, info = env.step(action)
    done = terminated or truncated

print("score:", info["score"], "max tile:", info["max_tile"])
```

## 动作与观察

| 动作 | 含义 |
|------|------|
| 0 | 上 |
| 1 | 右 |
| 2 | 下 |
| 3 | 左 |

- 观察：`np.ndarray`，形状 `(4, 4)`，`dtype=int64`，直接表示棋盘数值。
- 新一局初始有两个随机方块（与网页版一致）。
- 每步奖励：本次移动的**合并得分**，不做奖励塑形。
- `truncated` 恒为 `False`（第一阶段没有步数上限）。

## 接口

```python
reset(seed=None) -> (observation, info)
step(action)     -> (observation, reward, terminated, truncated, info)
action_masks()   -> np.ndarray(bool, shape=(4,))
legal_actions()  -> list[int]
```

`info` 包含：

| 字段 | 说明 |
|------|------|
| `score` | 当前累计得分 |
| `max_tile` | 当前最大方块 |
| `valid_actions` | 长度 4 的布尔掩码 |
| `legal_actions` | 合法动作索引列表 |
| `step_count` | 已执行的有效移动次数 |
| `invalid_action` | 本次调用是否选择了无效动作 |

此外还提供静态工具方法：

```python
Game2048Env.move_board(board, action) -> (new_board, merge_score, moved)
Game2048Env.is_game_over(board)       -> bool
```

## 无效动作的处理（重要）

- `action` 不在 `0..3`：抛出 `ValueError`；非整数：抛出 `TypeError`。
- `action` 合法范围但该方向**不改变棋盘**：
  - **不会生成新方块**；
  - 奖励为 `0`；
  - `terminated` 不变；
  - 返回的 `info["invalid_action"] == True`；
  - `step_count` 不增加。
- 在 `terminated=True` 后继续调用 `step`：抛出 `RuntimeError`，需先 `reset()`。

训练时应使用 `action_masks()` 或 `info["valid_actions"]` 屏蔽无效动作。
如果智能体反复选择无效动作，环境不会推进也不会自动结束，因此**必须**做动作掩码。

## 随机性与可复现

- 内部使用 `numpy.random.Generator`（PCG64）。
- 新方块位置在空格中均匀随机；数值先抽位置再抽值：90% 出 2，10% 出 4。
- `reset(seed=...)` 会重新播种；相同 seed + 相同动作序列会得到完全相同的棋盘和分数。
- `reset(seed=None)` 延续当前随机数流（Gymnasium 风格）。

## 运行测试

在项目根目录执行：

```bash
python -m pytest rl/tests -q
```

其中包括与现有 JavaScript `game.js` 的交叉验证（需要 Node.js）：脚本会用
固定的 250+ 个随机棋盘和边界棋盘，对四个方向逐一比较 `board / score / moved`。

## 随机智能体性能基准

```bash
python -m rl.random_agent --games 100 --seed 0
# 或者：
python rl/random_agent.py --games 100 --seed 0
```

输出平均得分、平均最大方块、平均步数、总耗时和每秒模拟步数。
随机智能体只会从合法动作中选择，因此不会因无效动作拖慢基准。

---

# 第二阶段：Double DQN

## 网络与输入编码

- 输入：4×4 棋盘，使用 `log2(tile)` 表示数字，空格为 0。
- 归一化：`log2(tile) / 16.0`。例如 2→1/16、2048→11/16、65536→1.0。
- 网络：MLP `16 → hidden → hidden → 4`，激活函数 ReLU，输出上/右/下/左四个动作的 Q 值。
- 默认 `hidden=256`，可通过 `--hidden-size` 调整。

## Double DQN 算法

每个训练更新：

1. 从经验池采样 `(s, a, r, s', done, next_legal_mask)`。
2. 在线网络计算当前 `Q(s,a)`。
3. 在线网络在**合法**的下一动作中选择 `a* = argmax Q_online(s', ·)`；非法动作的 Q 被置为 `-inf`。
4. 目标网络评估该动作：`Q_target(s', a*)`。
5. 目标值：`y = r + γ · (1 - done) · Q_target(s', a*)`；当 `done` 或无合法动作时不 bootstrap。
6. 使用 Huber Loss（`SmoothL1Loss`）更新在线网络，并做梯度裁剪。
7. 每 `target_update_freq` 次更新，将在线网络参数硬同步到目标网络。

探索使用线性衰减的 ε-greedy；探索和利用阶段都只从合法动作中选择。

## 训练命令

短时间 smoke（约 500 步，几秒钟）：

```bash
python -m rl.dqn.train --smoke
```

自定义训练（是否长时间运行由你决定；本阶段未执行长训练）：

```bash
python -m rl.dqn.train \
  --total-steps 50000 \
  --hidden-size 256 \
  --batch-size 64 \
  --learning-rate 0.001 \
  --gamma 0.99 \
  --buffer-capacity 100000 \
  --epsilon-start 1.0 \
  --epsilon-end 0.05 \
  --epsilon-decay-steps 50000 \
  --target-update-freq 1000 \
  --eval-frequency 5000 \
  --eval-episodes 5 \
  --checkpoint-frequency 5000 \
  --checkpoint-dir rl/checkpoints \
  --log-frequency 100 \
  --seed 0
```

日志每行记录：`episode`、`env_steps`、`avg_score`、`avg_max_tile`、`best_max_tile`、`epsilon`、`loss`、`elapsed`。
可加 `--log-csv rl/logs/train.csv` 额外写入 CSV。

## 评估命令

```bash
python -m rl.dqn.evaluate \
  --model rl/checkpoints/smoke/final.pt \
  --episodes 100 \
  --seed 0
```

评估使用 ε=0 的贪心策略并屏蔽非法动作，输出：

- 平均得分
- 平均最大方块、范围
- 最大方块分布
- 达到 2048 的比例
- 平均步数
- 可选 `--json` 输出结果文件

## Checkpoint 与恢复

Checkpoint 保存：在线网络、目标网络、优化器状态、配置、训练步数和元信息。默认保存 `latest.pt`、周期性
`checkpoint_step_XXXXXXX.pt` 和最终的 `final.pt`。

```bash
python -m rl.dqn.train --resume rl/checkpoints/latest.pt --total-steps 100000
```

限制：恢复时会加载网络/优化器和计数，并开始一个新 episode；**经验池内容、当前 episode 的中间状态和随机数流不会恢复**。

训练产物在 `.gitignore` 中被忽略（`rl/checkpoints/`、`rl/logs/`、`*.pt`）。

## 测试

```bash
python -m pytest rl/tests -q
```

测试覆盖：

- Q 网络输出形状、log2 编码与归一化
- 经验回放容量、环绕覆盖、采样字段形状
- ε-greedy 下只选择合法动作；非法动作 Q 被屏蔽
- Double DQN 目标值（在线网络选动作、目标网络估值、终止/无合法动作不打 bootstrap）
- 训练一步后参数变化、目标网络定期同步
- Checkpoint 保存/加载/`from_checkpoint`
- 80 步端到端训练 smoke test

## 已知限制（第二阶段）

- 只完成代码与短时间 smoke 验证，**没有进行正式长训练**；500 步模型的评估分数没有参考意义。
- 网络是简单 MLP，未使用 CNN、dueling、prioritized replay、n-step return 等扩展。
- Checkpoint 不保存经验池，也只在 episode 边界近似恢复；随机数流不保证完全续接。
- 训练循环有 `max_episode_steps` 安全上限；达到上限时按截断（done）处理。
- 评估的平均最大方块是算术平均，具体表现请结合分布与 2048 达成率看。
- GPU 代码路径已支持（`--device cuda`），但本机只验证了 CPU。

## 阶段范围

第一阶段（已完成）：

- ✅ 环境、合并规则、随机方块、掩码、终止判断、种子复现
- ✅ pytest 单元测试 + 与 JS 的交叉验证
- ✅ 随机智能体基准

第二阶段（本次）：

- ✅ PyTorch Q 网络、经验回放、Double DQN、目标网络、ε-greedy、Huber Loss、梯度裁剪
- ✅ 合法动作掩码与终止掩码
- ✅ 训练日志、定期评估、checkpoint 保存/恢复
- ✅ 独立贪心评估脚本
- ✅ 单元测试与 80 步训练 smoke test
- ⏸️ 正式长时间训练（等待确认后再进行）
