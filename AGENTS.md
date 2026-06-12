# AGENTS.md — 本项目所有 AI 编码会话必须遵守的规则

## 环境铁律（2026-06-12 环境收敛后生效）

1. **只有主仓库可以跑 dev server**，固定端口 3000（`pnpm dev`）。
2. **worktree 只用于改代码**：禁止在 worktree 内启动 dev server、preview server，禁止向 worktree 的 `.webdev/` 写入业务数据。
3. 要看运行效果，回主仓库的 3000 端口验证——不要在 worktree 里"跑起来看看"。
4. 改完尽快合并回主干；**合并后立刻删除 worktree 和分支**，不留尾巴。
5. 同一时间只允许一个会话做跨分支合并/收敛类操作；动手前先确认没有别的会话在做同样的事。
6. 诊断任何环境问题，第一步先跑 `pnpm env:status`（worktree / 端口 / 数据文件一览，多服务并行会有醒目警告）。

## 为什么是铁律

本地数据文件 `.webdev/local-persist.json` 的路径跟 `process.cwd()` 走（见 `server/db.ts`）：
**每个 worktree 里启动的服务读写的是自己目录下的那份数据**。多个 dev server 并行 = 数据分裂成多份互不相通的副本。

这不是假设：2026-06-01 数据被测试覆盖（`server/db.ts` 注释有案底），2026-06-12 数据分裂成 6 份、靠内容去重+id 重编号才合回来（`scripts/merge-local-persist.ts`）。复原成本极高，别让它发生第三次。

## 更多信息

- 人类可读的环境说明（数据机制、排查三步、事故史与备份）：`docs/environment-guide.md`
- 数据疑似丢失先看：`.webdev/backups/`（自动安全网）与 `.webdev/manual-backups-*/`
