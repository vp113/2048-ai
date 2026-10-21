# CLAUDE.md

本文件面向在本仓库工作的 Claude Code 会话。开始改动前先读本文件；需要细节时再读
`README.md`、`docs/ARCHITECTURE.md`、`docs/PROJECT_STATUS.md`、`docs/HANDOFF.md`。
不要依赖历史聊天记录。

## 项目定位

本地 2048 AI 展示项目：浏览器负责真实棋盘、移动、合并、生成、分数与动画；
macroxue/2048-ai 的 C++ Expectimax 只负责给出走子建议；Node 页面服务负责静态文件
和 `/move` 同源代理；AI 在 Docker 中运行。项目没有 `package.json`、npm 依赖或构建步骤。
公开发布版本整体按 GPL-3.0 提供（包含 GPL-3.0 上游组件）。

## 架构速览

```text
浏览器 index.html / main.js / game.js / replay.js / ai-client.js
  │  GET /move?board=<16 个 rank 字符>
  ▼
serve.js :8000（静态文件白名单 + 代理，60 s 超时，最多 3 次）
  │  GET http://127.0.0.1:8080/move?board=...
  ▼
Docker 容器 2048-ai（C++ Expectimax，-d3，Tuple10/Tuple11 查找表）
```

- 浏览器拥有游戏状态；AI 服务不保存棋盘，也不执行移动。
- 实时 AI 模式是严格串行的：请求一步 → 应用移动 → 恰好生成一个新方块 →
  完成动画/DOM 校验 → 等待下一 tick。
- 后台基准不启动浏览器，复用同一套 `game.js` 规则和 `/move` 接口。
- 65536 挑战同样后台运行，复用基准的 `playGame`/回放写入；达到目标后仍继续到
  自然 Game Over，成功时只保留该局回放和状态/统计报告。
- 首个真实成功局（seed 411789，1,148,460 分，65536，37,257 步，56 次尝试）已归档到
  `archives/challenge-65536/`；原始回放仍保留在 `reports/`。
- 回放导入只重放记录，不重新随机、不调用 AI；打开时默认停在最终棋盘。

## 关键文件

| 路径 | 作用 |
|------|------|
| `game.js` | 纯 2048 规则：移动/合并/计分/生成/结束判断/数字矩阵转换 |
| `ai-client.js` | 棋盘 rank 编码、AI HTTP 客户端、`u/l/r/d/g` 解析 |
| `main.js` | 页面状态机、串行 AI 循环、动画、最终棋盘、自动连续、回放 UI |
| `replay.js` | 回放 v1 校验、重建、每 100 步快照与 `stateAt` 跳转 |
| `serve.js` | 无依赖静态服务器（精确白名单）与 `/move` 代理 |
| `scripts/ai-benchmark.js` | 后台批量对局、JSON/CSV 报告、每局完整回放导出 |
| `scripts/challenge-65536.js` | 可恢复的 65536 后台挑战；并行、成功回放、状态报告 |
| `scripts/browser-test.js` | 默认 Headless Edge + CDP 冒烟/回放测试 |
| `scripts/test-all.js` | 单元测试，然后 Headless Edge 测试 |
| `scripts/start.ps1` / `stop-ai.ps1` | 本地 Docker/页面服务启动与停止 |
| `vendor/2048-ai/` | 固定上游版本、最小 C++ 构建、兼容补丁；核心算法不在此修改 |
| `archives/challenge-65536/` | Git 管理的首次 65536 成功回放、最终报告、校验和 |
| `docs/assets/` | 真实回放生成的 README 截图/GIF 及来源说明 |
| `LICENSE` / `THIRD_PARTY_NOTICES.md` | GPL-3.0 与上游来源/修改说明 |
| `test.js` | Node 单元测试（规则、AI 编码/客户端、服务器代理、回放） |
| `docs/ARCHITECTURE.md` | 模块边界、协议、数据流、持久化 |
| `docs/PROJECT_STATUS.md` | 当前功能、最近提交、验证结果、已知限制、后续候选 |
| `docs/HANDOFF.md` | 新会话交接：结构、启动、测试、决策、稳定状态 |

## 常用命令

```powershell
# 启动（默认会打开浏览器；后台/测试时用 -NoBrowser）
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoBrowser

# 停止 AI 容器和占用 8000 端口的页面服务
powershell -ExecutionPolicy Bypass -File scripts\stop-ai.ps1

# 只启动页面服务
node serve.js

# 测试（默认全部后台/Headless）
node test.js
node scripts/test-all.js
node scripts/browser-test.js --replay=reports/replays/game-001-seed-1.json
node scripts/browser-test.js --replay=archives/challenge-65536/game-053-seed-411789.json

# 后台 AI 基准（默认 1 局；必须已有 AI 服务）
node scripts/ai-benchmark.js
node scripts/ai-benchmark.js --games 10 --seed 7
node scripts/ai-benchmark.js --games 500 --out reports/run-500

# 65536 后台挑战（默认无限；Ctrl+C 保存进度）
node scripts/challenge-65536.js
node scripts/challenge-65536.js --seed 7 --concurrency 2
# 状态默认 reports/challenge-65536/state.json；重跑同命令即恢复，
# 新挑战使用新的 --state。开发验收必须加 --max-games，示例：
node scripts/challenge-65536.js --state reports/challenge-65536/test.json \
  --max-games 4 --target-tile 2048
```

- `scripts/browser-test.js` 与 AI 基准/挑战都需要 `http://127.0.0.1:8080/move` 可用。
- 浏览器测试默认使用 Headless Edge，只有显式 `--visible` 才创建可见窗口。
- 挑战默认并发 2，安全上限 4；不要在开发验收中启动默认无限挑战。
- `reports/`（包括 `reports/replays/` 与 `reports/challenge-65536/`）被 Git 忽略；
  不要提交。`archives/challenge-65536/` 是唯一有意纳入 Git 的成功回放归档。
- 回放导出格式和实际用法见 `docs/ARCHITECTURE.md`，功能状态见
  `docs/PROJECT_STATUS.md`，交接摘要见 `docs/HANDOFF.md`。

## 必须遵守的项目约束

1. **不要随意修改上游 AI**：除非用户明确要求，不修改 `vendor/2048-ai/` 的核心算法、
   Expectimax 逻辑、Tuple 查找表或 Docker 核心配置。当前唯一已知兼容补丁是 HTTP
   响应使用 CRLF（算法/规则/查找表不变）。
2. **不要重新引入 DQN/旧 Python RL**：相关代码已在 `67870e4` 删除；当前产品路线是
   C++ Expectimax + 本地服务。
3. **测试默认后台**：不打开/切换可见 Edge，不抢占焦点，不自动打开外部浏览器；
   只有用户显式要求或 `--visible` 才可视化。
4. **不要自动发起大规模长跑**：基准默认 1 局；10/100/500 局必须由用户指定。
   65536 挑战开发验收必须用 `--max-games` 限局，必要时用 `--target-tile` 降低目标；
   不要启动默认的无限挑战。
5. **保持回放兼容**：网页导入器使用 version 1 格式。修改字段、方向或生成位置语义时，
   必须同步更新 `replay.js`、`test.js`、回放 UI 和 Headless 测试。
6. **优先修复根因**：不做无关重构，不为性能牺牲正确性，不改变视觉风格。
7. **完成后验证并提交**：重要改动要跑相关测试，确认 Git 状态，提交清晰信息；
   测试失败或跳过必须如实报告。
8. **不提交敏感/大文件**：不写入 API Key、密钥、个人绝对路径；不提交查找表、
   `reports/`、日志或浏览器 profile。`archives/challenge-65536/` 的归档回放是
   明确例外，必须保留；不要删除 `reports/` 中的原始成功回放。
9. **公开发布合规**：项目包含 GPL-3.0 上游代码，整体以 GPL-3.0 发布；保留
   `LICENSE`、`vendor/2048-ai/LICENSE`、`THIRD_PARTY_NOTICES.md` 和来源说明。
   不要删除上游版权/许可证，也不要在未获授权时改写 Git 历史或 push。
10. **素材必须真实**：`docs/assets/` 的截图/GIF 必须来自归档真实回放和真实网页
   界面；不得手绘、修改或合成棋盘/分数。回放模式显示的最高分为 0 是真实行为。
11. **静态文件有白名单**：新增浏览器脚本/样式时，必须同时更新 `serve.js` 的
   `STATIC_FILES`，否则页面会 404。
12. **文档以代码和 Git 为准**：不确定的内容不要编造；更新功能时同步更新本文件或
   `docs/` 中受影响的部分。

## 完成标准

- 规则/AI 客户端/服务端改动：`node test.js` 通过。
- UI、实时 AI、最终棋盘、回放改动：`node scripts/test-all.js` 通过；必要时用
  `--replay=PATH` 验证真实回放。
- 基准或回放导出改动：至少跑 1 局，检查报告、回放路径，并用 `replay.js` 或
  Headless Edge 验证最终棋盘/分数一致。
- 65536 挑战改动：用 `--max-games` 跑有限局，验证并发、恢复、目标+自然结束判定，
  以及成功回放的最终棋盘/得分/步数一致；不得用真实无限挑战做验收。
- 归档/交接改动：验证 `archives/challenge-65536/` 回放可重建并与原始文件一致；
  用 Headless Edge 导入；不要删除原始 `reports/` 回放或查找表。
- 公开素材/发布改动：检查 `README` 相对路径、`LICENSE`/第三方声明和敏感信息；
  不要伪造截图/GIF，不要在未获用户确认时 push 或改写历史。
- 工作区干净，提交信息说明用户可见行为与验证结果。
