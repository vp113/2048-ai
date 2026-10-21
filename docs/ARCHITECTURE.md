# 架构说明

本文描述当前代码的实际结构与数据流。用户安装步骤、功能说明和验证数据见根目录
`README.md`；当前完成度与限制见 `docs/PROJECT_STATUS.md`；新会话交接见
`docs/HANDOFF.md`。

## 1. 总览

系统由四个运行角色组成：

```text
┌────────────────────────────────────────────────────────────┐
│ 浏览器                                                      │
│ index.html / style.css / game.js / replay.js / ai-client.js │
│ main.js：实时 AI 状态机、动画、最终棋盘、回放 UI             │
└───────────────────────────┬────────────────────────────────┘
                            │ GET /move?board=<16 chars>
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Node.js 页面服务 serve.js（默认 :8000）                     │
│ - 精确静态文件白名单                                         │
│ - /move 同源代理，60 s 超时，最多 3 次重试                    │
└───────────────────────────┬────────────────────────────────┘
                            │ GET http://127.0.0.1:8080/move?...
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Docker 容器 2048-ai                                         │
│ macroxue/2048-ai 小构建，Expectimax，-d3                    │
│ 预计算 Tuple10 / Tuple11 查找表，不保存游戏状态              │
└────────────────────────────────────────────────────────────┘
```

另有几条脱离浏览器的路径：

```text
scripts/browser-test.js ── Headless Edge + CDP ── 真实页面
scripts/ai-benchmark.js ── Node + game.js + AI HTTP ── 报告/回放
scripts/challenge-65536.js ── 复用基准循环 ── 状态报告 + 成功回放
```

## 2. 游戏规则与网页界面

### 2.1 规则模块 `game.js`

`game.js` 是 UMD 模块（浏览器暴露 `window.Game2048`，Node 中可 `require`），是规则的
唯一实现：

- 4×4 棋盘；空格为 `null`，方块为 `{ id, value }`。
- `move(board, direction)` 返回 `{ board, score, moved, movements, merges }`；
  每次移动中每个方块最多合并一次。
- `addRandomTile(board, rng)` 在空位中均匀选择一格，按 90% / 10% 生成 2 / 4；
  可注入 `rng` 以便可复现测试和基准。
- 初始棋盘两个方块；每个有效移动后恰好生成一个新方块。
- `isGameOver`、`maxValue`、`toNumbers` / `fromNumbers` 等辅助函数。
- 浏览器和后台基准都使用这一份规则，避免两套规则漂移。

### 2.2 页面与控制器

`index.html` + `style.css` 提供棋盘、分数、速度、最终结果横幅、自动连续开关、
回放导入与回放控制面板。`main.js` 负责所有状态：

- 实时模式：AI 开始/暂停/继续、速度 3/5/8/12/20 步/秒（默认 8）、重新开始。
- 游戏结束：保留最终棋盘，显示得分、最大方块、步数和成就；`下一局` 手动开始。
- 自动连续挑战：默认关闭；开启后最终结果停留约 3.5 s 再开下一局；暂停会取消等待；
  单次会话最多 500 局。
- 回放模式：导入 JSON 后默认显示最终棋盘；开始/上一步/播放/下一步/结局、进度条、
  速度 2/5/10/20 步/秒、退出。
- 实时模式与回放模式互斥；导入/退出回放会停止实时循环和动画。

### 2.3 严格串行的实时 AI

`aiLoop` 的一次迭代：

1. 本地检查 `Game.isGameOver`；结束则 `finishGame()`。
2. `AIClient.requestMove(board)` 请求一步。
3. 校验请求期间没有换局/暂停；`g` 只在本地确实结束时接受。
4. `Game.move` 应用移动；若 `moved=false` 则报错暂停。
5. `Game.addRandomTile` 恰好生成一个新方块，并把
   `[direction, flatSpawnIndex, spawnValue]` 写入当前局记录。
6. 更新分数/最大方块/成就，播放移动和合并动画。
7. `verifyDom()` 比较逻辑棋盘 id 与 DOM tile id；不一致时重新渲染修复。
8. 按速度等待，然后进入下一轮。

速度值是播放节奏的上限；AI 决策本身可能更慢，项目不会为了达到速度而降低搜索质量。

### 2.4 失败处理

- AI HTTP 失败：停止循环、显示错误、每 5 s 重试健康检查；不会静默换成弱 AI。
- 返回 `g` 但本地未结束：暂停并报告不一致。
- 返回无效移动：暂停并报告。
- 页面加载只做 AI 健康检查，不自动开始游戏。
- AI 请求和动画都有 run/game token，换局或暂停后旧结果不能写回新棋盘。

## 3. C++ Expectimax AI

### 3.1 上游与构建

- 来源：<https://github.com/macroxue/2048-ai>
- 固定提交：`fee3359d06cda82cb20a36ce312b06209ca1baad`
- 许可证：GPL-3.0（`vendor/2048-ai/LICENSE`）
- 只构建小型 `2048` 可执行文件，不使用 27 GB 级 `2048b` 构建。
- Dockerfile 编译 `2048.cc` + `board.cc`，运行时执行
  `/app/2048 -S 8080 -d3`，即固定搜索深度 3。

AI 使用 Expectimax 搜索，并结合预计算的 Tuple10 / Tuple11 走子查找表
（`tuple_moves.10a`、`tuple_moves.11a`）。这些表在首次启动时生成，约 2.5 GB，
通过 `/data` 卷持久化；运行环境参考需求约 5 GB RAM。

### 3.2 本地兼容补丁

唯一已知的上游改动在 `2048.cc`：HTTP 响应行使用 CRLF，便于浏览器/Node 的 `fetch`
解析。HTTP/1.1 keep-alive 保持启用。核心搜索、评估、规则和查找表内容未改。

### 3.3 HTTP 协议

```text
GET /move?board=<16 chars>
```

棋盘按行优先编码为方块等级：

```text
0 = 空, 1 = 2, 2 = 4, ..., 15 = 32768, G = 65536
```

响应为一个字符：

```text
u = 上, r = 右, d = 下, l = 左, g = game over
```

AI 只返回建议；网页用 `game.js` 真正执行移动和生成，因此分数来自真实网页规则。

## 4. Node 页面服务与代理

`serve.js` 不依赖第三方包：

- `GET /` 或 `/index.html` → 页面。
- 精确白名单：`/style.css`、`/game.js`、`/replay.js`、`/ai-client.js`、`/main.js`。
- `GET /move` → 代理到 `AI_BASE`（默认 `http://127.0.0.1:8080`），最多重试 3 次，
  每次 60 s 超时；上游不可用时返回 503。
- 其他路径 404；没有目录浏览或任意文件读取。
- 端口默认 8000，可用环境变量 `PORT` 覆盖。

新增前端静态文件时必须加入 `STATIC_FILES`，否则页面请求会 404。

`scripts/start.ps1` 负责启动 Docker Desktop/镜像/容器、首次生成查找表、启动页面服务；
`-NoBrowser` 不打开浏览器，并把页面服务作为隐藏进程启动。`scripts/stop-ai.ps1`
停止容器和占用 8000 端口的页面服务。

## 5. AI 客户端

`ai-client.js` 在两处使用：

- 浏览器：`endpoint: '/move'`，经同源代理。
- 后台基准：默认 `http://127.0.0.1:8080/move`。

职责：

- `boardToCode(board)`：把数字或方块对象编码为 16 个等级字符。
- `parseReply(text)`：严格接受 `u/l/r/d/g`，其他值报错。
- `requestMove(board)`：HTTP 请求，60 s 默认超时，最多 3 次重试；不会改变 AI 决策。

## 6. 后台 AI 基准与回放导出

`scripts/ai-benchmark.js` 不使用浏览器或 DOM，直接组合 `game.js`、`ai-client.js` 和
本地 AI 服务：

```text
playGame:
  mulberry32(seed)
  → 两个初始方块
  → 请求 AI → Game.move → 恰好一个 addRandomTile
  → 记录 [direction, spawnIndex, spawnValue]
  → 直到游戏结束或达到 --max-moves

main:
  → JSON/CSV 统计报告（--out）
  → 每局 version 1 回放 JSON（reports/replays/）
```

### 6.1 选项与可复现性

- 默认 1 局；`--games N` 指定局数。
- `--seed S` 指定起始种子；第 `i` 局使用 `S + i * 7919`。
- `--max-moves N` 默认 100,000，防止异常情况无限运行。
- `--endpoint URL` 默认 `http://127.0.0.1:8080/move`。
- `--out BASE` 控制统计报告路径；回放目录固定为 `reports/replays/`。

### 6.2 统计报告

JSON 报告包含：

- `generatedAt` / `startedAt` / `finishedAt`、endpoint、seed、maxMoves；
- `summary`：完成/截断局数、平均/最佳分数、平均/最佳最大方块、最大方块分布、
  2048/4096/8192/16384/32768/65536 达成率、平均步数/时间、总吞吐；
- `games[]`：每局 `score`、`maxTile`、`steps`、`seconds`、`movesPerSecond`、
  `ended`、`truncated`、`replayFile`；
- `replayDirectory`。

CSV 保持固定统计列，不包含回放路径。两者默认写入 `reports/`，该目录被 Git 忽略。

### 6.3 回放导出（已完成）

每局导出到：

```text
reports/replays/game-<局号三位>-seed-<seed>.json
例：reports/replays/game-001-seed-1.json
```

- 使用独占创建（`wx`）；同名已存在时尝试 `-1`、`-2`…，并发运行也不会覆盖。
- 每局终端输出路径；统计 JSON 中记录 `replayFile`。
- 回放文件是紧凑 JSON，不包含最终棋盘；最终棋盘由初始棋盘 + 每步移动/生成重建。
- 若因 `--max-moves` 截断，回放记录到截断点，并带 `truncated: true`；正常结束则
  `ended: true`。

实际使用：

```powershell
node scripts/ai-benchmark.js --games 1 --seed 1
# 终端出现：
#   replay: reports/replays/game-001-seed-1.json

# 验证真实回放（Headless Edge）
node scripts/browser-test.js --replay=reports/replays/game-001-seed-1.json
```

然后在页面点击 **导入回放** 选择该 JSON 即可；默认直接打开最终棋盘并支持完整回放。

## 7. 65536 自动挑战

`scripts/challenge-65536.js` 复用 `ai-benchmark.js` 的 `playGame`、`saveReplay`、
`summarize`，以及同一套 `game.js` 规则和本地 `/move` 服务。它不启动浏览器。

### 7.1 调度、种子与并发

- 默认目标为 **65536**；第 `i` 局种子为 `baseSeed + i * 7919`。
- 默认并发 **2**；`--concurrency` 可设 1–4，超过 4 会被截到 4 并警告。
- 上游 HTTP 服务在 `RunServer` 中为每个连接创建 detached `std::thread`，监听
  backlog 为 10，因此支持并发请求。当前 Docker 容器没有额外 CPU/内存限额，但
  Tuple 查找表由请求线程共享，默认仍采用保守并发，避免 CPU/内存带宽竞争和潜在的
  惰性查表写入竞争。
- 已做小规模并发检查：16 个并发 `/move` 请求全部返回有效动作；2 局完整游戏并行
  运行无错误。挑战仍建议默认 2，不建议盲目提高。
- 状态文件记录已完成局的 `index`（种子由 index 推导），恢复时跳过这些 index，
  从最小未完成 index 继续。
- `--max-games N` 仅用于测试/采样：按已完成局数封顶；`0` 表示默认的无限挑战。

### 7.2 成功条件与验证

一局必须同时满足以下条件才算成功：

1. 棋盘曾达到目标方块（最终 `maxTile >= targetTile`；方块只增不减）；
2. 该局自然 `Game Over`（`ended === true`）。

因此，达到 65536 不会结束当前局；脚本继续请求 AI、移动、生成，直到自然结束。
若因 `--max-moves` 截断，即使已经达到目标也**不算成功**，不会保存回放。

成功后，脚本用 `replay.js` 重建整局：

- `Replay.buildReplay` 校验回放格式、移动和最终分数/最大方块；
- `Replay.stateAt(replay, total)` 重建最终棋盘；
- 与 `playGame` 记录的实际最终棋盘、得分、最大方块、步数逐项比较；
- 全部一致后才写入回放并标记成功。

### 7.3 状态/统计报告与恢复

默认状态/报告路径：

```text
reports/challenge-65536/state.json
```

可用 `--state PATH` 指定；回放写在同一个目录。状态文件在每局完成后原子写入
（临时文件 + rename），主要字段：

- `version: 1`、`createdAt`、`updatedAt`、`status`
- `config`: seed、concurrency、maxMoves、maxGames、targetTile、endpoint
- `attempted`: 已启动的局数（含因成功而被中止的并行局）
- `games[]`: 每局简要记录（index、seed、score、maxTile、steps、seconds、
  ended、truncated、reachedTarget），**不包含 moves 或最终棋盘**
- `summary`: 平均/最佳分数、最大方块分布、成就率、总步数/时间
- `success`: 成功时的 index、seed、score、maxTile、steps、finalBoard、
  `replayFile`、验证时间

恢复行为：

- 重跑相同命令会读取已有状态，跳过已完成的 index；配置中的 seed、maxMoves、
  targetTile 必须一致，否则要求使用新的 `--state`。
- 并发数和 `--max-games` 可以在恢复时调整；后者可用于先跑小批量、再继续。
- `Ctrl+C` 会设置 `interrupted` 并写入状态；正在请求中的局不记为完成，恢复时重试。
- 状态已是 `success` 时再次运行只打印成功摘要，不启动新局。

### 7.4 产物与清理

- **非成功局不写任何回放文件**，只在状态报告中保留简要统计。
- 成功局通过 `saveReplay` 写入状态目录；`wx` 独占创建，同名自动加 `-1`、`-2`，
  不覆盖已有文件。
- 代码不删除任何既有回放或报告；因为非成功局没有临时回放，成功时无需额外清理，
  最终目录只包含状态/统计报告和成功回放（以及用户此前已有的文件）。
- 成功后停止调度其他局；已发出的请求最多等 3 秒，然后进程退出。
- 首个真实成功局已从 `reports/challenge-65536/` 复制到 Git 管理的
  `archives/challenge-65536/`（回放 + 最终报告 + 校验和）。原始回放仍保留；
  归档文件不应改写或删除。

### 7.5 常用选项

```powershell
node scripts/challenge-65536.js
node scripts/challenge-65536.js --seed 7 --concurrency 2
node scripts/challenge-65536.js --state reports/challenge-65536/run-2.json
node scripts/challenge-65536.js --state reports/challenge-65536/test.json `
  --max-games 4 --target-tile 2048
```

`--target-tile` 只用于测试降低目标，默认必须保持 65536。

## 8. 回放格式与查看器

### 8.1 Version 1 格式

```json
{
  "version": 1,
  "initial": [[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]],
  "moves": [[0, 12, 4], [1, 0, 2]],
  "score": 12,
  "maxTile": 8,
  "finishedAt": "2026-10-21T00:00:00.000Z"
}
```

- `direction`：`0=上, 1=右, 2=下, 3=左`。
- `spawnIndex`：行优先 `0..15`；兼容旧记录的 `-1`（表示无生成，值必须为 0）。
- `spawnValue`：2 或 4。
- `score` / `maxTile`：最终值；导入时用于一致性校验。
- 基准/挑战导出还会附加 `seed`、`game`、`ended`、`truncated`；查看器只读取标准字段，
  附加字段不影响导入。

### 8.2 校验与跳转

`replay.js`：

- 校验 `initial` 为 4×4、合法数值；逐条校验方向、生成位置/值、移动是否有效、
  生成格是否为空、最终分数和最大方块是否一致。
- `buildReplay` 从初始棋盘顺序重放，每 100 步保存快照。
- `stateAt(replay, index, Game)` 取最近快照，再最多应用 99 步；越界索引会夹到
  `[0, total]`。随机拖动进度条不需要从头重放。
- 输入数据只读，不修改原始 JSON 对象。

`main.js` 的导入上限为 20 MB；无效文件显示错误并保持页面可用。导入会：

1. 停止实时 AI、自动连续等待、动画和重试；
2. `buildReplay` 校验并构建快照；
3. 进入只读回放模式，默认 `seekReplay(total)` 显示最终棋盘；
4. 播放/拖动只调用 `stateAt`，不调用 AI、不随机生成、不更新最高分。

### 8.3 浏览器内的最佳回放

实时游戏会维护当前局的 `initial + moves`。如果本局刷新最高分或历史最大方块，
`finishGame` 把 version 1 回放写入 localStorage；页脚提供下载。该记录与后台基准
导出的回放格式相同，但两者存储位置不同。

## 9. 持久化与产物

浏览器 localStorage：

| Key | 内容 |
|-----|------|
| `2048.ai.best.score` | 最高分 |
| `2048.ai.best.max` | 历史最大方块 |
| `2048.ai.achievements` | 32768 / 65536 成就 |
| `2048.ai.replay.best` | 最近一次刷新纪录的回放 JSON |

文件产物：

| 路径 | 说明 |
|------|------|
| `reports/ai-benchmark-*.json` / `.csv` | 后台统计报告，Git 忽略 |
| `reports/replays/*.json` | 基准每局回放，Git 忽略 |
| `reports/challenge-65536/state.json` | 挑战状态/统计报告，默认路径，Git 忽略 |
| `reports/challenge-65536/game-*.json` | 挑战成功回放，Git 忽略 |
| `archives/challenge-65536/` | 首次 65536 成功回放、最终报告、校验和，纳入 Git |
| `vendor/2048-ai/tables/` | 约 2.5 GB 查找表，Git 忽略 |
| `*.log`（忽略规则） | 本地日志，不提交 |

没有数据库、账号系统或云端持久化。

## 10. 测试边界

- `test.js`：规则、生成/结束、AI 编码与客户端、静态服务器/代理、回放校验与跳转，
  以及 `playGame` 的中止/最终棋盘一致性。
- `scripts/browser-test.js`：使用 Headless Edge + CDP，启动进程内页面服务，验证
  串行 AI、DOM/棋盘一致、最终棋盘保留、自动连续关闭状态；`--replay=PATH` 额外验证
  回放最终状态和多个 seek 点。
- `scripts/test-all.js`：先跑单元测试，成功后跑 Headless 浏览器测试。
- `scripts/challenge-65536.js` 需要 AI 服务；它不在 `test-all.js` 中自动启动无限
  挑战。验收使用 `--max-games`，必要时配 `--target-tile`。
- 浏览器测试、基准和挑战都要求 AI 服务可用；单元测试不要求 Docker。

## 11. 边界与安全假设

- 这是本地工具，不提供认证；不要把 8000/8080 端口直接暴露到不可信网络。
- 页面服务器只提供白名单文件，不提供任意路径访问。
- AI 服务不保存/回传棋盘状态，只接收编码棋盘并返回一步建议。
- 搜索深度由容器命令固定为 `-d3`；当前 UI 不提供深度切换。
