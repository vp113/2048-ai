# 项目状态

- 快照日期：2026-10-21
- 分支：`main`
- 功能基线：`9140d34`（Save complete replay for every AI benchmark game；本次文档整理前）
- 状态：功能可用，工作区干净；后台测试与每局回放导出已完成。

本文件只记录可验证的当前事实。安装步骤与用户功能说明见 `README.md`，模块细节见
`docs/ARCHITECTURE.md`。

## 1. 当前已实现

### 网页与游戏

- 原生 HTML/CSS/JS 的 4×4 2048 展示页，保持原有视觉风格、配色和滑动动画。
- 规则集中在 `game.js`：合并、计分、90%/10% 生成 2/4、游戏结束判断。
- 当前页面是 AI 展示页：AI 开始/暂停/继续、重新开始；没有键盘手动游玩入口。
- 严格串行实时 AI：请求 → 移动 → 恰好生成一个新方块 → 动画/DOM 校验 → 等待。
- 速度 3/5/8/12/20 步/秒，默认 8；暂停会完成当前渲染后停止。
- 分数、最高分、当前最大方块、历史最大方块显示。
- 游戏结束后保留最终棋盘，显示得分、最大方块、步数和成就；`下一局` 手动开始。
- 自动连续挑战：默认关闭，结果停留约 3.5 s，暂停可取消，单次会话上限 500 局。
- 32768 / 65536 成就写入 localStorage，并在最终横幅显示。
- DOM/逻辑棋盘一致性校验；发现残留或不同步时重新渲染修复。
- AI 服务不可用时显示错误并定时重试，不静默降级。

### 回放

- version 1 JSON 回放导入、严格校验、每 100 步快照、任意位置跳转。
- 导入后默认显示最终棋盘；支持开始/上一步/播放/下一步/结局、进度条、2/5/10/20
  步/秒、退出。
- 回放只读，不调用 AI、不随机生成、不修改最高分/历史纪录或当前实时局。
- 实时模式与回放模式互斥；导入/退出会清理循环、自动连续计时器和动画。
- 刷新纪录的游戏自动保存到 localStorage，可从页脚下载。
- 后台基准每局自动导出完整回放（见下文），可直接导入网页。

### 后台基准与回放导出

已完成，提交 `9140d34`：

```powershell
node scripts/ai-benchmark.js
node scripts/ai-benchmark.js --games 10 --seed 7
node scripts/ai-benchmark.js --games 500 --out reports/run-500
```

- 默认 1 局，不自动发起大规模长跑。
- 复用 `game.js` 和本地 C++ `/move`，不启动浏览器/DOM。
- 每局保存到 `reports/replays/game-<局号三位>-seed-<seed>.json`。
- 同名不覆盖：独占创建，冲突时追加 `-1`、`-2`…。
- 终端逐局打印回放路径；统计 JSON 的 `games[].replayFile` 和 `replayDirectory`
  也可查到。
- 回放是网页导入器同款 version 1 格式；已在 Headless Edge 中验证最终棋盘和
  多位置 seek。
- 统计报告仍是 JSON + CSV；`reports/` 被 Git 忽略。

实际导入：

```powershell
node scripts/ai-benchmark.js --games 1 --seed 1
# 记录终端输出的 reports/replays/game-001-seed-1.json
# 打开 http://localhost:8000 → 导入回放 → 选择该文件
```

无头验证：

```powershell
node scripts/browser-test.js --replay=reports/replays/game-001-seed-1.json
```

### 工程与测试

- 无 `package.json`、无 npm 依赖、无构建步骤；Node 仅使用内置模块。
- 单元测试 24 项：规则、生成/结束、AI 编码/客户端、静态服务器/代理、回放校验/跳转。
- Headless Edge + CDP 测试：串行 AI、DOM/棋盘一致、最终棋盘、自动连续关闭、
  可选真实回放导入与 seek。
- `scripts/test-all.js` 串联单元测试和 Headless 浏览器测试。
- Docker 启动/停止脚本、查找表持久化、首次生成流程均已存在。
- 上游来源、固定提交、许可证和兼容补丁记录在 `vendor/2048-ai/UPSTREAM.md`。

## 2. 最近重要 Git 提交

| 提交 | 内容 |
|------|------|
| `9140d34` | 每局 AI 基准自动保存完整回放；终端/报告输出路径；防覆盖 |
| `f147794` | 后台 Headless 测试、AI 基准入口、`start.ps1 -NoBrowser` |
| `3d46ce2` | 最终棋盘保留、自动连续挑战、JSON 回放查看器 |
| `911247c` | 修复串行 AI 播放与棋盘/DOM 渲染同步 |
| `9b2e03f` | 引入 C++ Expectimax 高性能 AI 网页展示架构 |
| `d8a1ca9` | 删除 DQN 和 Python RL 组件，确定当前产品路线 |

更早的 RL/DQN 提交只保留在 Git 历史中，不属于当前代码路线；不要重新引入。

## 3. 已通过的验证

### 2026-10-21 当前版本

- `node test.js`：**24 passed, 0 failed**。
- `node scripts/test-all.js`：24 项单测通过 + Headless Edge 冒烟测试
  `HEADLESS_BROWSER_TEST_PASS mode=headless`。
- 1 局基准（seed 1）：
  - 得分 **469,056**
  - 最大方块 **32,768**
  - **15,887** 步，18.2 s
  - 回放 `reports/replays/game-001-seed-1.json`
- 该回放由 `replay.js` 重建后，最终棋盘、得分、最大方块与基准记录一致。
- 该回放在 Headless Edge 中实际导入：默认最终棋盘正确；开局、中段、倒数一步、
  最终步的棋盘/得分/最大方块全部一致；退出正常。
- 同名回放测试（`--max-moves 100` 重跑 seed 1）生成 `-1`、`-2` 后缀文件，
  原完整回放哈希不变，没有覆盖。

### 更早的验收样本

- 3 局基准（seed 1，`reports/acceptance-3.json`）：
  - 3/3 完成，平均 **558,009.3** 分，最佳 **629,824**；
  - 3/3 达到 32768；
  - 共 58,085 步 / 92.8 s，约 **626.1 moves/s**。
  - 这是 3 局小样本，不是统计结论。
- README 记录了真实 Edge 的性能/交互验证、7,164 步真实回放导入、最终棋盘保留、
  自动连续开关、暂停取消等结果；这些属于开发验收记录，不等同于持续 CI。
- 上游直连样本曾达到 1,133,392 分 / 65536；网页路径与直连路径的统计口径不同，
  详见 README。

## 4. 已修复的重要问题

- **实时移动后棋盘未替换**：`applyMove` 未把 `Game.move` 的新棋盘赋回，导致实际
  棋盘与动画/生成脱节、出现大量重复 2；已修复并加入串行循环和 DOM 校验。
- **DOM 残留/不同步**：增加 `verifyDom()`，以逻辑棋盘 id 为准检查并重新渲染。
- **回放脚本 404**：`serve.js` 静态白名单漏掉 `/replay.js`，导致
  `window.Replay2048` 未定义；已加入白名单。
- **回放进度条拖动回跳**：原逻辑先刷新 slider 再读取目标值；已改为先读取用户目标，
  再暂停并 seek。
- **上游 HTTP 行尾**：上游响应仅 LF，浏览器/Node `fetch` 不接受；本地补丁改为 CRLF，
  保持 keep-alive，算法和查找表未变。
- **后台/无头测试被节流**：Headless 启动参数加入禁用后台计时器/渲染节流，避免测试
  在后台被降速。
- **可见浏览器干扰**：测试默认 Headless、`windowsHide`，只有 `--visible` 才显示。
- **未完成的 RL 路线**：DQN/Python RL 已删除，避免与当前 C++ AI 产品混淆。
- **README 旧描述**：已修正“添加 `Connection: close`”的过时说法；当前实际是 CRLF +
  keep-alive。

## 5. 当前已知限制

- 依赖本地 Docker 和 AI 容器；页面本身不是纯静态托管版本。
- 首次生成查找表约 4–8 分钟（取决于机器），查找表约 2.5 GB，整体约需 3 GB 磁盘和
  5 GB 内存；查找表不提交 Git。
- 纯 WASM 强 AI 不现实：查找表规模超出 wasm32 地址空间；项目不提供弱化版 AI。
- 搜索深度固定为容器命令的 `-d3`；UI 没有深度切换，改深度需要改启动配置并重启容器。
- 页面服务/AI 端口面向本地使用，无认证；不应直接暴露到不可信网络。
- 最高分、成就和最佳回放只存在浏览器 localStorage；换浏览器/清存储会丢失。
- 单次自动连续会话上限 500 局；自动下一局等待约 3.5 s。
- UI 播放速度上限 20 步/秒；AI 基准的数百步/秒是引擎/代理吞吐量，不是网页播放速度。
- 回放文件是完整移动+生成记录；局数很多且不做清理时，`reports/replays/` 会持续增长。
- 回放导入上限 20 MB；大回放若超过需先裁剪/转换（当前无内置工具）。
- Headless 测试要求 Microsoft Edge（`EDGE_PATH` 或标准安装路径）和已启动的 AI 服务；
  单元测试不依赖 Docker。
- 没有持续 CI 流水线；当前测试结果为本地/后台手动运行结果。

## 6. 下一步可能开展（候选，不是承诺）

1. 增加独立的回放校验 CLI，批量检查 `reports/replays/` 的格式、最终分数/棋盘一致性。
2. 为大批量基准提供回放压缩/归档或清理工具，避免 500 局产生过多文件。
3. 在基准 JSON/CSV 中加入可选的 `replayFile` 列或汇总清单，便于批量导入/追踪。
4. 建立可选的 CI/自动验收流程（含 Docker AI 服务与 Headless Edge 的可用性处理）。
5. 提供 Linux/macOS 启动脚本，保持 Windows 脚本行为不变。
6. 在不修改上游算法的前提下，调研更适合分享的回放体积优化（需保持 version 1 兼容）。

不建议的方向：重新引入 DQN/旧 Python RL、改用无查找表的弱 AI、为速度牺牲规则正确性、
未经验证地修改 macroxue 核心算法或查找表。

## 7. 新会话继续开发

1. 先读 `CLAUDE.md`，再按需读本文件和 `docs/ARCHITECTURE.md`。
2. 检查 `git status`、`git log -5`，不要假设历史工作区状态。
3. 确认服务：页面 `:8000`、AI `:8080`；后台测试不要打开可见浏览器。
4. 改动后至少跑相关测试；涉及 UI/AI 循环/回放时跑 `node scripts/test-all.js`。
5. 涉及回放导出时跑 1 局基准，并用 `scripts/browser-test.js --replay=...` 验证。
6. 提交前检查 Git 状态，确保没有 `reports/`、查找表、日志或敏感信息进入提交。
