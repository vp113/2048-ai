# 新会话交接

- 日期：2026-10-21
- 分支：`main`
- 项目状态：开发完成，公开材料已本地整理；尚未创建 GitHub 仓库，尚未 push。
- 起点文档：本文件 → `CLAUDE.md` → `docs/PROJECT_STATUS.md` → `docs/ARCHITECTURE.md`。

## 1. 一句话说明

浏览器负责真实 2048 游戏；本地 Docker 中的 macroxue/2048-ai C++ Expectimax 只提供
走子建议；Node.js `serve.js` 提供静态页面和同源 `/move` 代理；Node 脚本负责后台
测试、批量基准、回放导出和 65536 挑战。

## 2. 项目结构

```text
index.html / style.css / main.js       页面、串行 AI 状态机、最终棋盘、回放 UI
game.js                                纯 2048 规则（浏览器和 Node 共用）
replay.js                              version 1 回放校验、快照与 seek
ai-client.js                           棋盘 rank 编码 + AI HTTP 客户端
serve.js                               静态文件白名单 + /move 代理（无第三方依赖）
scripts/start.ps1 / stop-ai.ps1        Docker + 页面服务启动/停止
scripts/browser-test.js                Headless Edge + CDP 测试
scripts/test-all.js                    单元测试 + Headless 测试
scripts/ai-benchmark.js                后台批量基准 + JSON/CSV + 每局回放
scripts/challenge-65536.js             可恢复、并行的 65536 挑战
test.js                                25 项 Node 单元测试
vendor/2048-ai/                        固定上游源码、最小 Docker 构建、兼容补丁
archives/challenge-65536/              首次成功 65536 回放 + 最终报告（Git 管理）
docs/assets/                           README 演示 GIF、65536 截图、素材来源
LICENSE / THIRD_PARTY_NOTICES.md        GPL-3.0 与上游来源/修改说明
reports/                               本地报告/回放（Git 忽略，不要删除）
docs/                                  架构、状态、交接文档
```

没有 `package.json`、npm 依赖、`node_modules` 或前端构建步骤。

## 3. 启动与停止

```powershell
# 正常启动（会打开浏览器）
powershell -ExecutionPolicy Bypass -File scripts\start.ps1

# 后台/无浏览器启动（页面服务隐藏运行）
powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoBrowser

# 手动只启动页面服务
node serve.js

# 停止 AI 容器和占用 8000 端口的页面服务
powershell -ExecutionPolicy Bypass -File scripts\stop-ai.ps1
```

- 页面：<http://localhost:8000>
- AI：<http://localhost:8080/move?board=...>
- 首次启动需生成约 2.5 GB Tuple 查找表，可能需要 4–8 分钟；查找表在
  `vendor/2048-ai/tables/`，不要删除或提交。
- 运行参考：约 5 GB 内存、约 3 GB 磁盘。

## 4. 测试与验收

```powershell
node test.js
node scripts/test-all.js
node scripts/browser-test.js --replay=archives/challenge-65536/game-053-seed-411789.json
```

- `node test.js`：25 项规则、协议、回放和基准中止测试，不需要 Docker。
- `test-all.js`：单元测试 + Headless Edge，需要 AI 服务和 Microsoft Edge。
- 浏览器测试默认完全不显示窗口；只有显式 `--visible` 才可见。
- 测试结束后不会自动打开浏览器。
- 归档回放已验证：37,257 步、1,148,460 分、65536，Headless Edge 导入/seek 通过。

## 5. 重要技术决策

1. **上游算法只读**：固定 macroxue/2048-ai 提交
   `fee3359d06cda82cb20a36ce312b06209ca1baad`，GPL-3.0；不修改 Expectimax、
   Tuple 表或游戏规则。唯一兼容补丁是 HTTP 响应使用 CRLF，keep-alive 保留。
2. **浏览器拥有游戏状态**：AI 只返回 `u/l/r/d/g`；移动、合并、生成、计分都在
   `game.js` 中执行，保证网页分数来自真实规则。
3. **实时播放严格串行**：请求 → 移动 → 恰好生成一个新方块 → 动画/DOM 校验 →
   等待；播放速度上限 20 步/秒，不追求引擎的数百步/秒。
4. **回放 version 1**：初始棋盘 + 每步方向 + 每步生成位置/值 + 最终分数/最大方块；
   导入时完整校验，默认打开最终棋盘；每 100 步快照用于快速 seek。
5. **挑战成功条件**：达到 65536 且自然 Game Over；截断不算成功。成功后只保留
   该局完整回放和统计报告；非成功局不写回放。
6. **挑战并发保守**：C++ 服务每连接一个线程，但默认并发 2、上限 4，避免共享
   Tuple 表和 CPU/内存带宽竞争。
7. **可恢复性**：挑战状态每局后原子写入；已完成的 index/seed 在恢复时跳过；
   Ctrl+C 不把在途局记为完成。
8. **DQN 已删除**：不要重新引入旧 Python RL/DQN 路线。

## 6. 首次 65536 成功与归档

- Seed：**411789**
- 最终得分：**1,148,460**
- 最大方块：**65536**
- 步数：**37,257**
- 总尝试：**56**
- Challenge index：52（第 53 局）

文件：

```text
archives/challenge-65536/game-053-seed-411789.json   Git 管理，回放归档
archives/challenge-65536/final-report.json           Git 管理，最终统计报告
archives/challenge-65536/README.md                   校验和/导入说明
reports/challenge-65536/game-053-seed-411789.json    原始回放，保留、Git 忽略
reports/challenge-65536/state.json                   原始最终报告，保留、Git 忽略
```

查看方式：启动页面（`-NoBrowser` 也可），打开 <http://localhost:8000>，点击
**导入回放**，选择 `archives/challenge-65536/game-053-seed-411789.json`。

不得删除或改写归档回放；它是项目最终成果的可验证记录。

## 7. 公开材料与发布状态

- `README.md` 已整理为英文 GitHub 首页，嵌入：
  - `docs/assets/game-demo.gif`：真实回放 29,323–29,883 步，113 帧，13.2 秒，
    约 8.2 MB；
  - `docs/assets/65536-achievement.png`：首次 65536 的第 29,823 步，分数 971,264。
- 素材来源、真实验证和裁切说明见 `docs/assets/README.md`。
- 根目录 `LICENSE` 为 GPL-3.0；`THIRD_PARTY_NOTICES.md` 记录上游和本地修改。
- `.gitignore` 已覆盖查找表、报告、日志、缓存、npm 依赖、`.env`、临时文件和
  Docker/Edge 本地数据。
- 全历史安全扫描未发现密钥/Token/密码；但提交 author/committer 元数据包含个人
  姓名和邮箱。**发布前需要仓库所有者决定邮箱处理方式；不要擅自改写历史。**
- 尚未创建 GitHub 仓库、尚未 push。得到明确确认后再执行。

## 8. 继续开发时的检查清单

1. 读 `CLAUDE.md`，查看 `git status`、`git log -5`，不要假设历史会话状态。
2. 检查 Docker/AI 是否可用；必要时运行 `scripts/start.ps1 -NoBrowser`。
3. 修改 UI/AI 播放/回放：跑 `node scripts/test-all.js`。
4. 修改基准/回放导出：跑 1 局基准，再用 Headless Edge 导入验证。
5. 修改挑战：只用 `--max-games` 做有限验收，必要时 `--target-tile` 降低目标；
   不启动无限挑战做自动化验收。
6. 不修改上游算法、查找表、Docker 核心配置或 UI 风格；不重新引入 DQN。
7. 完成后提交 Git，保持工作区干净；`reports/` 不提交，`archives/` 保留。
8. 新功能/限制变化时同步更新 `README.md`、`CLAUDE.md`、`docs/`。

## 9. 已知限制

- 本地 Docker 是硬依赖；首次生成查找表较慢。
- 搜索深度固定为 `-d3`；UI 不提供深度切换。
- 页面/AI 无认证，仅用于本地，不应暴露到不可信网络。
- 最佳分、成就和最佳回放存于浏览器 localStorage。
- 65536 挑战可能耗时很长；上游 depth-3 达到 65536 的比例约 1%。
- 状态报告随局数增长；大回放没有内置压缩/裁剪工具。
- 没有持续 CI；测试为本地/后台运行结果。
