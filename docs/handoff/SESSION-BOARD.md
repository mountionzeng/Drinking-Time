# 会话看板 · 谁正在动什么

> **动代码之前先读这里，动之前先登记，收工之后立刻销号。**
> 这份文件是多个 AI 会话之间唯一的实时协调点。功能账本
> （`docs/features/feature-ledger.json`）记录「产品有什么能力」，这里记录
> 「此刻有谁的手在哪个文件上」。两者不重复。

建立于 2026-08-23，起因：架构收敛会话在测量基线的 20 分钟里，另一会话
（`claude/multitrack-editor-reset`）往主仓合入了三次死代码清理，触达的正是
收敛试点的隔壁文件。双方事前都不知道对方存在。

---

## 协议（四条）

1. **开工前**：在下面「当前在场」表里加一行，写清分支／worktree、正在动哪些文件、
   预计什么时候收工。同时看一眼别人占了什么。
2. **发现重叠**：不要自己绕开，也不要"顺手帮对方改"。停下来告诉用户，由用户裁决归属。
3. **收工后**：把自己那行删掉，并在「最近落地」里加一条（提交号 + 一句话 + 触达的热点文件）。
   worktree 和分支按 `AGENTS.md` 第 4 条立刻删除。
4. **热区文件**（见下表）动之前必须先登记，哪怕只改一行。

---

## 当前在场

| 会话 | 分支 / worktree | 正在动 | 状态 | 更新时间 |
| --- | --- | --- | --- | --- |
| 视觉资产标准板 | `affectionate-bartik-1d9c06` | 原待办会触达 `server/routers/storyAgent.ts` 的 provider 白名单/估价分支 | **协调暂停、不占用文件**：统一账号线到 U7 时优先接管 `storyAgent.ts`；本线若以后恢复，须等 U7 落地后重新登记并基于最新代码调整，不得并行修改 | 2026-09-02 |
| 统一账号·赠送卡·算力账本 | `codex/mobile-cross-device-workspace`（主仓，用户裁决直接在主仓工作） | **已完成**：U1 本地全部、U2 本地全部（12 张新表 + `users.sessionVersion`、migration 0016、journal 17 条）；另修好迁移链本身（0007/0008/0009/0013/0014 缺 `--> statement-breakpoint`、0015 两个外键名 65 字符 > MySQL 上限 64、`storyConversation.mysql.test.ts` 的 `execute()`→`query()`），并补三道静态门禁。**U6 核心已完成**：`shared/computeMoney.ts`、`server/services/computeBilling.ts`／`computeLedger.ts`／`computeReconciliation.ts`，`server/db.ts` 增账本落库（热区，只新增）；真实 MySQL 两进程并发 4/4 通过。已按流程在架构棘轮豁免表登记 `computeLedger.ts`。**U4 已完成（本地）**：`accountSecurity.ts`／`accountIdentity.ts`、`server/_core/oauth.ts` 新增统一账号端点、`sdk.ts` 的 JWT 带 `sessionVersion`、`productionReadiness.ts` 要求 `OTP_DIGEST_SECRET`；characterization 测试已锁住旧邀请码登录链路的既有行为。已按流程登记 `accountIdentity.ts` 豁免。**U3 本地来源盘点完成**（`scripts/inventory-account-migration.ts`，只读，报告在 `docs/qa/account-migration-inventory-local.md`）：本地 63 个用户全部无邮箱、无冲突、无近似邮箱；只有 Guest 48 持 18 项目 35 Story，标为「需要人工映射」，未给任何归属建议。**还差旧 MySQL 与 staging 两个来源的只读盘点**，等用户确认后再做。**注意**：共享主仓里带着未提交的 `db.ts` 改动时不要跑 dev server——18:56–19:02 有会话跑了服务，把新增空集合写进了 `.webdev/local-persist.json`（已核对无数据丢失）。**U7 才会动 `server/routers/storyAgent.ts`／`creationAgent.ts`**，届时再登记 | 进行中（纯本地）。远端只做过只读盘点，**未做任何测试库写入**；U1 远端等用户批准 | 2026-09-02 |
| 微信原生小程序测试壳层 | `codex/wechat-miniprogram-test-shell`（worktree `.worktrees/codex/wechat-miniprogram-test-shell`） | **仅 `miniprogram/**`**（全新目录，与现有任何文件零重叠）。唯一例外：为 U3 门禁在主仓实时 `docs/features/feature-ledger.json` 加一张 `planned` 卡（2026-09-02 用户裁决明确授权，只新增一张卡、不改统一账号线的卡）。不动 `client/**`、`server/**`、`shared/**`、`drizzle/**`、根配置 | **自动化已完成、待人工验收与合并**：U1–U3 已在分支 `codex/wechat-miniprogram-test-shell` 提交（`2ca35f7`，47 文件全在 `miniprogram/**`）；144 测试 + `tsc` 通过；开发者工具已能加载工程，但 GUI 控制权限被拒，可视验收待用户本人执行。**用户 2026-09-02 裁决：先不合并**，分支与 worktree 保留，等唯一 merge owner 接管；可视验收由用户本人执行。本行在合并并完成可视验收前不销号 | 2026-09-02 21:22 |
（收工时删掉自己这行。）

> **2026-09-02 用户协调裁决：** 统一账号线是 U1–U9 的唯一实现会话；其他会话不得
> 并行修改其已登记文件。本线当前只占用 U1/U2 列出的文件；到 U7 前必须再次更新本表，
> 再接管 `server/routers/storyAgent.ts` / `server/routers/creationAgent.ts`。视觉资产标准板线
> 保持暂停且不占文件，待 U7 落地后才能重新登记。图生图对话框已经收工，已从“当前在场”移除。

> **交叉点已解除**（08-24 02:41）：滚动剪辑修复线已收工，`shared/timelineCommands.ts`
> 与 `shared/timelineEditing.ts` 交还，架构收敛线 U4–U7 可以正常取用。
> **但请注意签名变了**：`trimTimelineItem` 与 `splitTimelineItem` 的 `startFrame`
> 现在是必传项，值必须是调用方按整份 items／rows 解析出来的真实起点。这是刻意做成
> 必传而不是可选的——隐式位置的镜头没有自己的 `timelineStartFrame`，漏传会静默退回
> 「整条时间线被砍短」那个 bug。U4–U7 新增的命令若要调用它们，从领域命令已有的
> 布局里取起点即可，不要在函数内部重新推导。

---

## 最近落地

> **归属怎么判**：author 字段全是 `jane-githu`，区分不出会话。可靠判据只有两条——
> `git reflog` 里这条是 `commit:`（直接在主仓提交）还是 `merge <分支名>:`（从哪个 worktree 合入），
> 加上触达的文件属于哪条线。**不要用「时间重合 + 刚跟谁通过信」归因**：
> 2026-08-23 下午已经连错两次，第二次差点让人去改错的地方。

| 时间 | 提交 | 内容 | 归属（判据） | 触达热区 |
| --- | --- | --- | --- | --- |
| 08-26 00:01 | `5c9d750` | 统一所有视觉层的对象选择、移动、剪辑、抽帧、复制粘贴、删除、会话撤销与普通镜头生成采用；抽帧资产永久留仓，Story/Timeline/Take 聚合写入原子化；同步保留刷新延迟优化。合并前门禁 380 文件、3193 测试全绿 | **统一视觉图层剪辑线**（reflog 为 `merge codex/feat-unified-visual-clip-operations:`） | `EditingNleWorkspace.tsx`、`StoryboardEditRow.tsx`、`StoryAgentContext.tsx`、`creationAgent.ts`、`storyAgent.ts`、`storyMaterials.ts`、`visualClipEditing.ts`、`server/db.ts` |
| 08-23 17:43 | `8d19b94` | 删掉图生图链路里没被用上的代码 | **图生图对话框线**（reflog 为 `commit:`，直接在主仓提交；文件全属图生图链路） | `chatImageRefs.ts`、`useChatImageRemix.ts`、`useAssetSwapProposal.ts` |
| 08-23 17:47 | `f0ce930` / `1f89f5b` | 清掉多轨剪辑重构留下的死代码 | **clip-move 线**（`1f89f5b` 的第二父提交来自 `claude/multitrack-editor-reset`）。该线当日收工，worktree 与分支已按规矩删除 | `visualClipEditing.ts` −27、`visualClipModel.ts`、`creationAgent.ts` −14、`EditingNleWorkspace.tsx`、`StoryboardEditRow.tsx` |
| 08-23 18:07 | `8e85541` | 视觉资产：参考图改走自有 OSS、一致性闸门按小句判定、冲突裁决逐条配对 | **视觉资产标准板线**（08-22 完成未落库，由架构收敛会话代为提交；原作者已核对提交信息属实）。这批是真实付费验出来的，累计 ¥31.29 | `imageGen.ts`、`storyAgent.ts`、`visualAsset*` |
| 08-23 18:12 | `6aed6d2` / `41d1797` | 补齐三份未落库交接文档；新增架构收敛需求文档与用户裁决 | **架构收敛线** | 无（纯文档） |
| 08-23 18:25 | `414331b` | 新增本看板 | **架构收敛线** | 无（纯文档） |
| 08-24 02:30 | `4cd2241` | tsconfig 移除 `**/*.test.ts` exclude 的摸底报告：exclude 系初始提交的模板默认值；移除后 208 个既有错误全在测试文件内，生产代码零错误 | **tsconfig 类型检查线**（reflog 为 `commit:`；只新增 `docs/qa/` 一个文件） | 无（纯文档，未动 `tsconfig.json`） |
| 08-24 02:42 | `8ae55a8` | tsconfig 棘轮：240 个测试文件纳入 `tsc --noEmit`，58 个存量失败文件冻结为基线；补漏写的 `target: ES2022` 并钉住 `useDefineForClassFields: false`（产物逐字节不变）。存量 208 个错误按设计未修 | **tsconfig 类型检查线**（reflog 为 `commit:`；只动 `tsconfig.json` + 新增守卫 + `docs/qa/`） | `tsconfig.json`（全库门禁，新增热区候选） |
| 08-24 02:41 | `86465a1` | 滚动剪辑在隐式位置下不再砍短总片长：`trimTimelineItem`／`splitTimelineItem` 改为必传调用方已解析的真实 `startFrame`，删掉 `buildTimelineLayout([item])` 单元素重建；隐式与显式两种形状各补一条「总结束时间不变」回归测试；顺带把 U2 搬家后账本里三处 `timelineActions` 旧路径修正，`feature:validate` 恢复通过 | **滚动剪辑修复线**（reflog 为 `commit:`；由架构收敛线开卡、用户裁决归本线执行） | `shared/timelineEditing.ts`、`shared/timelineCommands.ts`、`server/routers/storyAgent.ts`（**仅** `splitTimelineItem` 调用点一行） |
| 08-23 18:16 | `9ba6e2d` | 修竞态：素材库未拉回时，「换成素材里的人物」被静默放行给通用改写 | **图生图对话框线**（reflog 为 `commit:`；文件全属该链路） | 无（未动 `server/`） |
| 08-25 | `7325a83`→`91b0b49`（三次 `merge:` + 三次账本证据提交） | 刷新延迟修复，按 Phase A→B→C 落地：A 把 CreationEditorContext 十项 query 的 `isLoading` 拆出 `initialStoryLoading`（新增 `isStoryScopeReady()`/`resolveInitialStoryLoading()` 纯函数），EditingNleWorkspace 的整页 spinner 门改用它；B 给 `storyList`/`storyGet` 两个初始化 query key 各加 5 秒窄 `staleTime`（`recentStoryListCache.ts`），`refreshStoryList` 新增 `allowRecentColdEntryCache`，手动刷新/删除/backToList 都不受影响；C 本地模式读单 Story 提示词投影不再复制整份仓库，新增 `getLocalPromptLineageStateForStory()`/`getLocalPromptCompilationHeadsForStory()`（先筛后 clone）与 `loadStoryPromptCompilationHeads()`，`storyMaterials.getStoryMaterialState` 改用窄函数。主仓 3000 用 Story 1186 连续 3 次整页刷新实测：镜头立即可见、`storyList`/`storyGet(1186)` 各恰好 1 次请求、`getStoryMaterialState` 热调用 45-48ms→9-13ms。证据已写入 `recent-story-entry.history`/`prompt-lineage.history` | **刷新延迟修复线**（reflog 为 `merge:`，从 `.worktrees/story-refresh-latency` / 分支 `claude/story-refresh-latency` 合入；已按 AGENTS.md 收工删除） | `client/src/features/creationEditor/CreationEditorContext.tsx`、`client/src/features/creationEditor/views/EditingNleWorkspace.tsx`、`client/src/features/storyAgent/StoryAgentContext.tsx`、`server/db.ts`、`server/services/promptLineageStore.ts`、`server/services/promptLineage.ts`、`server/services/storyMaterials.ts` |

---

## 热区文件（改动必须先登记）

同一事实目前仍有多个写入者，或多条线同时在改：

| 文件 | 为什么是热区 |
| --- | --- |
| `server/routers/creationAgent.ts` | `updateStoryTimeline` 仍接收整份 items；是架构收敛第一刀的目标 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | `saveTimelineItems` 22 处引用，整份 timeline 写回的唯一来源 |
| `server/services/visualClipEditing.ts` / `shared/visualClipModel.ts` | 新落地的 `moveVisualClip` 家族，与上面两处争同一个事实 |
| `client/src/features/creationEditor/views/EditingNleWorkspace.tsx` | 底部时间轴，第二个可编辑表面 |
| `client/src/features/creationEditor/views/StoryboardEditRow.tsx` | 上方 Storyboard 图层，第一个可编辑表面 |
| `server/routers/storyAgent.ts` | 视觉资产、图生图、剧本三条线共用 |
| `server/db.ts` | 109 个导出、53 个文件直接引用，任何改动扩散面最大 |

---

## 当前待决（用户已知，未拍板）

- 用户对**两个剪辑界面**（上方 Storyboard 图层 / 底部 Timeline）都不满意，倾向合并成一个。
  合并范围尚未确定，见 `docs/brainstorms/2026-08-23-architecture-convergence-requirements.md`。
- 架构收敛的第一刀已获批：关闭整份 timeline 写入口，位置只走 `moveVisualClip` 家族，
  批量操作（撤销、整层重排）也必须表达成服务端领域命令（用户选了严格方案）。
  **这会改动上表前三个热区文件**，其他会话请避让或先协调。
- `server/routers/storyAgent.ts` 上有两条线会碰面：架构收敛（timeline 写入口）与视觉资产标准板
  （provider 白名单 + 估价分支）。后者尚未动手，动手前会先更新本看板。
- 视觉资产标准板线在等用户两件事：OSS 凭据；是否放开 gpt-image
  （用户一小时前在两个方案里选了另一个，图生图线希望改判——**这是用户的决定，任何会话不得代为翻案**）。
