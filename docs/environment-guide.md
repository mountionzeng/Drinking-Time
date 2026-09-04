# 环境指南：单一服务、单一数据源与安全排查

> 给项目所有者的一页说明。AI 会话的硬规则见根目录 `AGENTS.md`。最后更新：2026-09-01。

## 本地开发唯一允许的运行方式

- 只有 `git worktree list` 第一项代表的主仓库可以运行开发服务。
- 开发服务固定从主仓库执行 `pnpm dev`，端口固定为 `3000`。
- 其他 worktree 只改代码：禁止启动 dev/preview，禁止写 `.webdev/` 业务数据。
- 不存在“临时换端口预览”的例外；换端口会掩盖数据副本已经分裂。

## 本地 JSON 不是跨设备方案

开发数据位于 `.webdev/local-persist.json`，路径随服务的 `process.cwd()` 变化。提示词谱系和编辑快照也有各自的本地文件。不同 worktree 启动服务会得到互不相通的副本；手机和电脑访问不同副本同样不能互通。

因此：

- 本地 JSON 只服务于单机开发和恢复；
- 手机跨端生产必须使用同一 HTTPS origin、真实账号和共享 utf8mb4 MySQL；
- 不得通过合并手机/电脑本地 JSON 来模拟同步；
- 所有 Story 读写继续按 `userId + storyId`，禁止 latest Story 写回退。

图片目录即使通过 `LOCAL_IMAGE_DIR` 共享，也不会让业务 JSON 自动共享。

受管音频字节（旁白 / 音乐 / 环境声 / 原声）落在 `.webdev/audio`，可用 `LOCAL_AUDIO_DIR` 覆盖；暂存目录是它下面的 `.staging`。这份字节没有自动安全网 —— 备份和恢复用 `pnpm backup:media backup` / `pnpm backup:media restore --in <dir>`，恢复顺序固定为「先字节、后元数据」，缺文件的资产会被标成 `failed` 而不是静默当成 ready。删除故事会连带清掉它的资产行、导入操作和受管字节。服务启动时的恢复器会把中断的导入补偿为 `failed`，并清扫超过 24 小时、无操作引用的暂存文件。

## 两个环境命令

### `pnpm env:status`：只读诊断

显示 worktree、业务数据文件、Node 监听端口及进程 cwd。它不停止进程、不删除数据、不自动修复，适合开始工作或怀疑数据不一致时使用。

### `pnpm env:check`：严格门禁

复用同一快照，以下任一情况非零退出：

- Git worktree、监听器、进程 cwd 或业务数据元数据无法确认；
- 同时存在多个项目服务；
- 非主 worktree 正在运行服务或含业务持久化文件；
- 主仓项目服务不是端口 `3000`。

测试、合并和交付前使用 `env:check`，不要从 `env:status` 的文字猜结论。

## `pnpm dev` 启动前保护

`predev` 会验证主仓、端口和环境。如果端口 3000 已有本项目旧服务，只有监听进程、进程组 leader、用户、cwd 和入口全部精确匹配时才会发送 `SIGTERM`；任一信息缺失或变化都失败关闭。它不会按宽泛进程名杀服务，也不会清理数据。

## 数据或页面对不上时

1. 运行 `pnpm env:status`，确认服务实际属于哪个 worktree。
2. 运行 `pnpm env:check`；不要先重启，重启可能继续写错副本。
3. 数据疑似丢失时保存现场，检查 `.webdev/backups/` 与 `.webdev/manual-backups-*/`。
4. 只有确认数据分裂、所有源均已备份时，才使用合并工具：

```sh
npx tsx scripts/merge-local-persist.ts <源1> <源2> ...
npx tsx scripts/merge-local-persist.ts --write --out 合并.json <源…>
```

第一条只报告，第二条才写文件。同一 Story 分叉时工具只报告冲突，不替用户选版本。

## 生产 U6 闸门

生产进程会在启动前校验：

- `NODE_ENV=production` 下 `DISABLE_AUTH=false`；
- 强 `JWT_SECRET`；
- HTTPS `APP_ORIGIN` 与 `OAUTH_SERVER_URL`；
- `DATABASE_URL=mysql://...?...charset=utf8mb4`；
- 显式 HTTPS `CSP_MEDIA_ORIGINS`；
- 共享 MySQL 可执行 `SELECT 1`。

生产只信任 loopback nginx 代理。Cookie 从 Express 已验证的 `req.protocol` 决定 `Secure`，始终 `SameSite=Lax`；状态变更 `/api` 请求必须携带与 `APP_ORIGIN` 完全一致的 Origin。HTTP 跳 HTTPS、HSTS 和 CSP 由应用/nginx共同保证。

`/healthz` 只表示进程存活，`/readyz` 才表示生产配置和 MySQL 当前可用。公网 `/m` 只能在两者都通过后启用。

本地开发不要求 MySQL/HTTPS/生产认证，仍走固定主仓 3000；这不构成公网跨设备验收证据。

## 社交平台趋势来源

- 小红书/抖音 provider 默认关闭；没有合格来源时只返回“未获取到可验证的实时热点”。
- 禁止抓网页、复用 Cookie、模拟客户端、逆向接口或把模型标签冒充实时热门。
- 启用前必须留存获批 scope、授权文档、脱敏响应、限流/留存/商用许可、来源时间/TTL、parser 版本和弃用检查。
- 页面加载、刷新、切平台/版本不得自动请求；只允许用户显式打开或刷新趋势面板。

## 事故史与安全网

| 日期 | 事故 | 现有保护 |
|---|---|---|
| 2026-06-01 | 测试覆盖真实本地数据 | `server/db.ts` 测试防误写与 `.webdev/backups/` |
| 2026-06-12 | 6 个 worktree 各自产生数据并冲突 | 主仓单服务、`env:status`、`env:check` |
| 2026-08-14 | 旧 predev 依赖宽泛进程名 | 二次身份核验后才终止精确进程组 |

环境工具只发现风险和安全拒绝，不会自动删除 worktree、业务数据或备份。

## 自动启动说明

旧 launchd 预览任务因 macOS TCC 无法读取 `~/Documents`，已经停用且不得恢复为 KeepAlive；它会与“同一时间一个服务”的规则冲突。需要运行时从主仓显式使用 `pnpm dev`。若未来迁出 `~/Documents`，也仍须遵守单服务、固定 3000 和先运行 `pnpm env:status` 的规则。

## 个人记忆回填与对账（U4，2026-09-03）

```bash
pnpm memory:backfill      # 只做 dry-run，输出分类报告；不写任何数据
```

**apply 目前一律被拒绝**，而且这不是「还没写完」——回填会一次性产生大量提炼
任务，而 U5 的 runner、暂停开关和积压指标还不存在，跑下去没有办法叫停。
解除条件写在 `scripts/backfill-personal-memory.ts` 的 `assertApplyAllowed`
注释里，四条要逐条核对，不要只把那个函数删掉。

报告把历史分成四类，**说不清楚的一律不写**：

| 分类 | 含义 |
| --- | --- |
| `deterministic` | 能证明来源、归属与时间，可以写 |
| `source_incomplete` | 缺 `userId`／`storyId`／时间，或跨账号污染 |
| `ambiguous` | 记录完整，但分不清是用户选择还是系统自动 |
| `rejected_not_adoption` | 能证明它不是用户采用（自动路径写入） |

一个需要产品裁决的结论：**历史图片采用基本落在 `ambiguous`**。
`promoteStoryImageToCurrent` 无论被用户点击还是被自动路径调用，写下的
`imageSignals` 行形状完全一样，历史行区分不了。U3 之后新产生的采用带显式凭据，
旧数据没有。宁可留一个可解释的缺口，也不拿当前状态倒推用户当年的选择。

文章采用是唯一自带用户意图凭据的历史来源：发布链路持久化了
`versionOperationReceipts`，一条收据 = 一次带令牌的明确 create_version。

对账（`server/services/personalMemoryReconciliation.ts`）是纯函数，任何时刻都能
安全地跑，包括召回还关着的现在。它只发现不修复，扫五类：经历没有成功提炼、
活跃理解失去全部证据、卡死的 lease、孤立证据边、来信 payload 残留。
