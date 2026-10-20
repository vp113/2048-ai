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
├── requirements.txt       # numpy + pytest
├── README.md
└── tests/
    ├── conftest.py        # 让 pytest 从任意目录都能 import rl
    ├── test_env2048.py    # 环境单元测试
    ├── test_cross_js.py   # 与现有 JavaScript 规则交叉验证
    └── js_oracle.js       # 调用 game.js 的 Node 参考实现
```

## 安装依赖

在项目根目录（`2048-game/`）执行：

```bash
python -m pip install -r rl/requirements.txt
```

当前开发环境：Python 3.12、NumPy 1.26、pytest 7.4。

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

## 第一阶段范围

- ✅ 环境、合并规则、随机方块、掩码、终止判断、种子复现
- ✅ pytest 单元测试 + 与 JS 的交叉验证
- ✅ 随机智能体基准
- ❌ DQN / 神经网络 / 训练循环（留待后续阶段）
- ❌ Gymnasium / PyTorch 依赖
