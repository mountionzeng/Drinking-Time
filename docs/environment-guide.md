# 环境指南：数据在哪、端口是谁、乱了怎么查

> 给项目所有者本人的一页说明。AI 会话的对应规则在根目录 `AGENTS.md`。
> 最后更新：2026-06-12（环境收敛日）

## 数据存放机制（理解这一条，就理解了一切乱象）

本地数据存在 **`.webdev/local-persist.json`**，路径跟"服务器从哪个目录启动"走（`server/db.ts`）。

**推论：每个 worktree 里启动的 dev server，读写的是那个 worktree 自己的数据文件。**
两个端口数据对不上 = 它们是两个目录里的两份文件，从来就不是同一份。

图片不受此影响：图片在共享目录 `.webdev/images`（`.env` 的 `LOCAL_IMAGE_DIR`），所有环境同源。

## 端口约定

- **3000 = 唯一正式环境**，主仓库 `pnpm dev`。
- 其他端口上的服务都是临时/预览性质，**不要在上面录入真实内容**。

## 社交平台趋势来源

- 小红书和抖音的趋势 provider 默认关闭；未配置合格来源时，接口只返回“未获取到可验证的实时热点”，不会猜测标签。
- 禁止通过抓网页、复用 Cookie、模拟客户端或逆向接口补齐趋势数据，也禁止把模型生成的标签标成“实时热门”。
- 启用真实 adapter 前，必须同时保存并复核：控制台可见 capability、获批 scope、当期官方或合同授权文档、脱敏真实响应、限流/留存/商用许可、来源时间与 TTL、parser 版本及弃用检查。
- Story 只保存归一化候选、来源/时间、parser、授权引用和原始响应摘要；完整 provider 响应、token 与 Cookie 不得写入 Story、日志或前端 bundle。
- 页面加载、刷新页面、切平台和切版本都不得自动请求趋势；只有用户显式打开或刷新趋势面板时才允许请求。

## 数据对不上时，三步排查

1. 跑 `pnpm env:status` —— 看有几个 dev server 在跑、各自属于哪个目录
2. 看警告 —— 有"⚠️ N 个 dev server 并行"说明数据已经在分裂，先停掉多余的
3. 对照各环境数据文件的大小和最后改动时间，判断哪份是你刚才写入的

## 已知盲点

- `pnpm dev` 的 `predev` 钩子会先杀旧的 dev server，但 **`scripts/preview-server.ts` 包装入口和 `dev-mobile.sh` 启动的服务绕过这个查杀**——这就是为什么会出现多服务并行。发现多服务先手动停。
- worktree 不只 `.claude/worktrees/`：还可能在 `.worktrees/`、目录外（如 `~/Documents/`）甚至 `/tmp`。`git worktree list` 是唯一权威来源（`pnpm env:status` 用的就是它）。

## 事故史与备份

| 日期 | 事故 | 教训/对策 |
|---|---|---|
| 2026-06-01 | 测试把真实数据文件原子覆盖 | `server/db.ts` 加了测试防误写 + 自动备份安全网 `.webdev/backups/`（保留近 N 份） |
| 2026-06-12 | 数据分裂成 6 份（6 个 worktree 各一份，id 互相冲突） | 全量手工备份 `.webdev/manual-backups-20260612/`；用 `scripts/merge-local-persist.ts` 内容去重+id 重编号合并 |

**数据疑似丢失：先去 `.webdev/backups/` 和 `.webdev/manual-backups-*/` 找，不要急着重启服务（重启可能触发覆盖）。**

## 数据合并工具（多环境数据再次分裂时用）

```
npx tsx scripts/merge-local-persist.ts <源1> <源2> ...            # dry-run 出报告
npx tsx scripts/merge-local-persist.ts --write --out 合并.json <源…>  # 确认后落盘
```

报告里重点看：故事清单是否齐全、"分叉副本"组（同一篇故事在两个环境各自改过——工具不替你选，列出来由你拍板）。

## 2026-06-12 收敛记录

已处置（提交已并入主干或 integration-ab，数据已备份并纳入合并集）：
- `~/Documents/dt-refactor`（split-godobjects，5 提交已含于 integration-ab）— 已删
- `.claude/worktrees/agent-layer-foundation`（无独有提交）— 已删
- `.worktrees/codex/art-taste-workflow`（已含于 main）— 已停服并删

暂留（等另一会话完成 main ∪ integration-ab 的分支合并后收尾）：
- `.claude/worktrees/integration-ab` — :3000 在跑、主数据所在，**分支合并+数据合并落位后删除**
- `/tmp/drinking-time-main-deploy` — 另一会话的部署预览（:3001），**确认无独有数据后删除**

收尾清单（剩余步骤）：① 另一会话完成分支合并 → ② 停 integration-ab 与 tmp-deploy 的写入 → ③ 用最新数据重跑合并工具、拍板分叉副本 → ④ 合并产物放主仓库 `.webdev/local-persist.json` → ⑤ 主仓库切到合并后分支、`pnpm dev` 起 3000 → ⑥ 核对故事清单 → ⑦ 删除两个暂留 worktree → ⑧ `pnpm env:status` 确认绿色无警告。
