# 环境指南：单一服务、单一数据源与安全排查

> 给项目所有者本人的一页说明。AI 会话的对应规则在根目录 `AGENTS.md`。
> 最后更新：2026-08-14

## 唯一允许的运行方式

- 只有 `git worktree list` 第一项所代表的主仓库可以运行开发服务。
- 开发服务固定使用端口 `3000`，从主仓库执行 `pnpm dev`。
- 其他 worktree 只用于修改代码：禁止启动 dev/preview server，也禁止写入 `.webdev/` 业务数据。
- 不再保留“换个端口临时预览”的例外。换端口不能共享业务数据，反而会掩盖环境已经分裂。

## 为什么必须只有一个环境

本地业务数据存在 `.webdev/local-persist.json`，路径跟服务启动时的
`process.cwd()` 走（见 `server/db.ts`）。提示词谱系和编辑快照也分别写入
`.webdev/prompt-lineage-local.json` 与 `.webdev/edit-snapshots-local.json`。

因此，每个 worktree 启动的服务都会读写自己目录下的一套数据。多个服务并行并非
同一环境的多个入口，而是多份互不相通、可能同时增长的数据副本。

图片目录由 `.env` 的 `LOCAL_IMAGE_DIR` 指定，通常是共享目录；这不改变业务 JSON
只能由主仓维护的规则。

## 社交平台趋势来源

- 小红书和抖音的趋势 provider 默认关闭；未配置合格来源时，接口只返回“未获取到可验证的实时热点”，不会猜测标签。
- 禁止通过抓网页、复用 Cookie、模拟客户端或逆向接口补齐趋势数据，也禁止把模型生成的标签标成“实时热门”。
- 启用真实 adapter 前，必须同时保存并复核：控制台可见 capability、获批 scope、当期官方或合同授权文档、脱敏真实响应、限流/留存/商用许可、来源时间与 TTL、parser 版本及弃用检查。
- Story 只保存归一化候选、来源/时间、parser、授权引用和原始响应摘要；完整 provider 响应、token 与 Cookie 不得写入 Story、日志或前端 bundle。
- 页面加载、刷新页面、切平台和切版本都不得自动请求趋势；只有用户显式打开或刷新趋势面板时才允许请求。

## 两个环境命令

## 数据对不上时，三步排查

### `pnpm env:status`：只读诊断

显示所有 worktree、业务数据文件、Node 监听端口以及进程所属目录。它不会停止进程、
删除数据或自动修复环境。即使部分系统信息采集失败，它也会尽量展示其余结果，适合
人工排查。

### `pnpm env:check`：严格门禁

复用同一份环境快照，但任何无法确认的状态都会以非零状态退出，包括：

- 无法读取 Git worktree、监听端口、监听进程 cwd 或任一业务数据文件元数据；
- 同时存在多个项目服务；
- 非主 worktree 正在运行服务；
- 主仓服务使用的不是端口 `3000`；
- 非主 worktree 含任一业务持久化文件。

已确认 cwd 属于其他仓库的 Node 服务不算本项目违规。测试、合并前检查和自动化门禁
应使用 `env:check`，不要从 `env:status` 的文字输出猜测是否安全。

## `pnpm dev` 启动前会做什么

`predev` 先确认命令从主仓根目录、固定端口 `3000` 启动，再执行严格环境检查。
如果端口 `3000` 上已有本项目旧服务，只在下列身份全部吻合时才停止它：

- 监听进程和进程组 leader 都属于当前用户；
- 两者 cwd 都精确等于主仓根目录；
- 监听进程入口是 `server/_core/index.ts`；
- 进程组 leader 是 `pnpm dev`。

发送 `SIGTERM` 前会再次核验 PID、进程组、用户、cwd 和命令，防止 PID 复用或环境变化；
信号按已核验的进程组发送，并等待整个进程组无成员后才算成功。任一快照缺失、身份变化或
进程组状态无法确认都会失败关闭并要求重试，不会用宽泛进程名批量杀进程，也不会自动清理
任何数据文件。

## 页面或数据对不上时

1. 先运行 `pnpm env:status`，确认服务和数据实际属于哪个 worktree。
2. 再运行 `pnpm env:check`，按违规代码处理；`DATA_COLLECTION_FAILED` 表示业务数据文件
   无法检查，`LISTENER_COLLECTION_FAILED` 表示监听进程采集不完整。不要先重启，重启可能
   继续写错数据副本。
3. 数据疑似丢失时，先检查主仓 `.webdev/backups/` 和
   `.webdev/manual-backups-*/`，保存现场后再决定是否合并。

## 数据合并工具

只有确认发生过数据分裂、并已备份所有源文件时才使用：

```sh
npx tsx scripts/merge-local-persist.ts <源1> <源2> ...
npx tsx scripts/merge-local-persist.ts --write --out 合并.json <源…>
```

第一条只生成 dry-run 报告；第二条才落盘。重点核对故事清单和“分叉副本”组：同一故事
在不同环境都修改过时，工具只报告冲突，不替人选择版本。

## 事故史与安全网

| 日期 | 事故 | 教训与现有保护 |
|---|---|---|
| 2026-06-01 | 测试原子覆盖真实数据文件 | `server/db.ts` 增加测试防误写和 `.webdev/backups/` 自动备份 |
| 2026-06-12 | 6 个 worktree 各自产生数据，ID 相互冲突 | 完整备份后按内容去重、重编号合并；从此确立主仓单服务规则 |
| 2026-08-14 | 旧诊断只能提示，旧 `predev` 依赖宽泛进程名处理 | 增加 fail-closed `env:check`，并将旧服务终止收窄到经过二次身份核验的主仓进程组 |

环境工具只负责发现风险和安全拒绝，不会自动删除 worktree、业务数据或备份。

## 自动启动预览服务（2026-08-24：已停用）

`~/Library/LaunchAgents/com.yuandai.drinking-time-local.preview.plist` 曾经想用
launchd 常驻守着 3000 端口，**但它从来没成功启动过一次**。

根因是 macOS TCC：launchd 拉起的子进程拿不到 `~/Documents` 的访问权限，
于是每 2 秒失败重试一次，日志一路滚到 92MB。2026-08-24 用绝对路径、去掉
shell 包装重测，仍然是 `Operation not permitted`——**这一点改 plist 改不掉**。

当天做的处理：

- 任务已 `launchctl bootout` 并在 plist 里标记 `Disabled`，不会在下次登录时回来；
- 原 plist 备份在同目录的 `.bak-20260824-100738`；
- 日志改到 `~/Library/Logs/drinking-time/preview-server.log`（移出仓库）；
- 失败重试间隔 2 秒 → 60 秒；
- 那份 92MB 的 `.webdev/preview-server.launchd.log` 已清空。

### 现在怎么起服务

```bash
pnpm preview:3000
```

主 checkout 上**不要**跑 `pnpm dev`：`predev` 会对整个进程组发 SIGTERM，
把别人的服务连锅端掉。`.claude/launch.json` 已改为指向 `preview:3000`。

### 如果将来还是想要自动启动

三条路，按推荐排序：

1. **把仓库移出 `~/Documents`**（例如 `~/Projects/`）。TCC 只保护
   Documents / Desktop / Downloads 这几个位置，搬出去就没这个问题。
   代价是若干处硬编码的绝对路径要跟着改。
2. **不要自动启动**。本项目 AGENTS.md 规定同一时间只能有一个 dev server，
   一个 KeepAlive 常驻任务会和手动启动、和编辑器的 preview 工具争同一个端口。
   这也是当前的选择。
3. **给解释器授予「完全磁盘访问权限」**。系统设置 → 隐私与安全性 →
   完全磁盘访问权限。注意要授的是 `/bin/sh` 这类解释器，授权面很宽，
   不建议为了一个 dev server 这么做。
