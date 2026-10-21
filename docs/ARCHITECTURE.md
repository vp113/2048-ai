# 架构说明

本文描述当前代码的实际结构与数据流。用户安装步骤、功能说明和验证数据见根目录
`README.md`；当前完成度与限制见 `docs/PROJECT_STATUS.md`。

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

另有两条脱离浏览器的路径：

```text
scripts/browser-test.js ── Headless Edge + CDP ── 真实页面
scripts/ai-benchmark.js ── Node + game.js + AI HTTP ── 报告/回放
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

## 7. 回放格式与查看器

### 7.1 Version 1 格式

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
- 基准导出还会附加 `seed`、`game`、`ended`、`truncated`；查看器只读取标准字段，
  附加字段不影响导入。

### 7.2 校验与跳转

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

### 7.3 浏览器内的最佳回放

实时游戏会维护当前局的 `initial + moves`。如果本局刷新最高分或历史最大方块，
`finishGame` 把 version 1 回放写入 localStorage；页脚提供下载。该记录与后台基准
导出的回放格式相同，但两者存储位置不同。

## 8. 持久化与产物

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
| `reports/replays/*.json` | 每局回放，Git 忽略 |
| `vendor/2048-ai/tables/` | 约 2.5 GB 查找表，Git 忽略 |
| `*.log`（忽略规则） | 本地日志，不提交 |

没有数据库、账号系统或云端持久化。

## 9. 测试边界

- `test.js`：规则、生成/结束、AI 编码与客户端、静态服务器/代理、回放校验与跳转。
- `scripts/browser-test.js`：使用 Headless Edge + CDP，启动进程内页面服务，验证
  串行 AI、DOM/棋盘一致、最终棋盘保留、自动连续关闭状态；`--replay=PATH` 额外验证
  回放最终状态和多个 seek 点。
- `scripts/test-all.js`：先跑单元测试，成功后跑 Headless 浏览器测试。
- 浏览器测试和基准都要求 AI 服务可用；单元测试不要求 Docker。

## 10. 边界与安全假设

- 这是本地工具，不提供认证；不要把 8000/8080 端口直接暴露到不可信网络。
- 页面服务器只提供白名单文件，不提供任意路径访问。
- AI 服务不保存/回传棋盘状态，只接收编码棋盘并返回一步建议。
- 搜索深度由容器命令固定为 `-d3`；当前 UI 不提供深度切换。
