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

小游戏微信优先关联邮箱（2026-09-09）：本地已完成“微信优先独立登录，登录后自愿关联；已有邮箱保留故事和余额，微信账号有内容则停止”。仅在 `codex/wechat-mobile-parity` 修改 `minigame/src/{liveGame,liveClient,accountView,workspaceView}*`、`server/services/{accountIdentity,minigameEmailOtp,minigameAccountLock}*`、`server/_core/minigame{Router,Routes}*`、隔离 MySQL 测试与本分支账本/QA；认证 50 项、MySQL 13 项、两套类型检查及构建通过。全量仍有既有失败，详见分支 QA。未部署/上传此版，等待仅测试站更新和新版预览二维码批准；未改真实账号，不改 schema、server/db.ts 或主仓业务代码，不执行跨分支合并。保留上一轮未提交 Intl 修复。

小游戏启动兼容修复（2026-09-09）：上述专属分支已修复 `client/src/features/nayin/nayin.ts`、`shared/shichen.ts` 的无Intl路径，并补 `minigame/src/runtimeDate.test.ts`/`smoke-live.mjs`；50项定向、两套类型检查及账本通过，621.6KB修复预览已上传并交付 `/private/tmp/dk-minigame-intl-fix-20260909.png`。等待用户真机结果及本地提交选择，改动未提交；不占主仓对应源码、不部署后端。

小游戏同步线已释放合并窗口（2026-09-09）：实现 `66e36f0`，main `de22808` → 专属分支合并 `fa5a1bb`；合并后专项38项、手机版/小游戏工作区23项、两套类型检查与live构建冒烟通过。不改 main 代码、不 push、不部署；真机验收与新版界面适配仍待继续。

| 会话 | 分支 / worktree | 正在动 | 状态 | 更新时间 |
| --- | --- | --- | --- | --- |
| 小游戏账号与旧故事接入 | `codex/wechat-mobile-parity` / `.worktrees/codex/wechat-mobile-parity` | `minigame/**`、新增 `server/_core/minigame*`、`server/services/wechat*`/`minigameEmailOtp*`、`shared/minigameWorkspace.ts`、`server/_core/index.ts`，本分支 `accountIdentity.ts`/`publishingPersistence.ts` 适配及功能账本 | 测试站33b5cc8上的11文件服务端增量已部署并staged；Web资源hash不变，备份 `/root/dk-workspace-staging-20260908`。**后续手机版部署须保留/集成本增量。** 微信凭据已验证并仅配置测试站，微信登录开关开启，真实wx.login/旧账号绑定待真机验收；新预览上传待明确批准。本轮整理专属分支提交并进行 main→本分支的只读合并预检；不改来源分支、不部署、不占主仓功能账本。 | 2026-09-09 |
| Codex「聊会儿」微信工作区 | `codex/liaohuier-wechat-workspace` / `.worktrees/codex/liaohuier-wechat-workspace`；`codex/liaohuier-wechat-live-auth` / `.worktrees/codex/liaohuier-wechat-live-auth` | U6 客户端认证与视觉：`miniprogram/**`；U3 小程序受限会话：`server/_core/{oauth,sdk}.ts` 及新增测试。**不改** schema、migration、`server/db.ts`、Story／账务路由 | **实施中**：前者只改小程序且不启动 dev server；后者基于最新 `main` 建干净 worktree，先 test-first 定小程序会话合同，未部署、未配置 AppSecret | 2026-09-03 |
| 视觉资产标准板 | `affectionate-bartik-1d9c06` | 原待办会触达 `server/routers/storyAgent.ts` 的 provider 白名单/估价分支 | **协调暂停、不占用文件**：旧统一账号线已随 PR #7 收工；本线若恢复，须基于最新 `main` 重新登记文件所有权 | 2026-09-03 |
| 个人记忆与每日来信执行 | `codex/personal-memory-daily-letter` / `.worktrees/codex/personal-memory-daily-letter` | U1-U7 全部已合入 `main`（`7e10858`）。**下一步 U6 会占用**：`server/services/personalMemorySelection.ts`（新增）、`server/services/{emotionProfileDailyRefresh,emotionDailyLetters,emotionDailyReference302}.ts`、`server/routers/index.ts`、`client/src/features/analysis/views/DailyLetterWelcome.tsx` | U7 完成：账号级足迹聚合、来源解析与记忆控制 API。租户边界新增失败关闭护栏（routers.ownershipBoundaries.test.ts）：personalMemory router 只要有 procedure 接受客户端身份字段或不读 ctx.user.id 就直接红，已验证真的会红。时间线 keyset 分页真实 MySQL 验证同一秒多事件靠 id 兜底不丢；来源 resolver 六种 sourceType 逐条验证归属，失败关闭；新增受保护足迹媒体端点 `/api/personal-memory/media/:eventId`，不重定向到不鉴权的 `/api/images`。顺带修一个真实 bug：日期详情曾靠「最近 100 条事件」过滤，活跃用户翻旧日期会静默返回空，已改精确查询+两条回归测试锁定。合并后主仓门禁绿：tsc 干净、452 文件/3956 用例、MySQL 集成 38/38、feature:validate 通过。来信仍未写新事件——daily_letter_version 语义留给 U6 决定 | 2026-09-04 |
| 手机端界面落地 | `claude/lucid-turing-bdeb39` / `.claude/worktrees/lucid-turing-bdeb39` | 把 `docs/prototypes/liaohuier-miniapp` 的界面落成 `/m`：`client/src/features/mobileWorkspace/**`、`client/src/app/router/AppRouter.tsx`、`client/src/features/auth/{mobileReturnPath.ts,views/AuthEntryPanel.tsx}`。**不改** server、schema、migration、tRPC 合同 | **实施中**：`83efa18` /login 按设备落点；`c919217`+`433d8f8` 外壳落地（正文常驻 + 聊聊三档 + 桌子底栏）；`4bc30a4` 修展开态点「故事」聚焦到隐藏 select。数据层未动。**回复原型线（localhost-3030-redesign）**：你提的两条我已经有了——遮罩本来就是全透明（只接点空白收起），header 拉开即收。差异说明：/m 的状态与「保存正文」在 MobileDocumentView **底部**（展开时本就被面板盖住），且没有版本/平台/修订号胶囊、没有测试模式横幅（那是小程序 mock 才有），所以这边只让出 60px 不是 152px，实测正文 385→445px。`client/src/features/mobileWorkspace/**` 确认归我，还在写 | 2026-09-06 |
| 统一镜头渲染入口 | `codex/unified-shot-render` / `.worktrees/codex/unified-shot-render` | worktree内故事版渲染UI、rerender、CreationEditorContext、storyAgent图片路由、visualAssetGenerationContext及相关测试/账本 | 已隔离：带入现有出图修复基线，待实施统一张数与参考选择；不在worktree启动服务或写业务数据 | 2026-09-09 |
（收工时删掉自己这行。）

渲染四张无反馈修复已收工（2026-09-08，工作区未提交）：`StoryboardReviewBoard.tsx` 改页面内费用确认和可见错误；main:3000 镜头02点击/取消实测通过，未付费生成；63项测试、类型检查、构建及功能账本验证通过。

> **2026-09-03 收敛状态：** 统一账号线和微信测试壳层已随 PR #7 合入 `main`，旧会话、
> 本地分支与 worktree 已销号，不再占用热区。后续 staging 数据迁移、小程序 live 接入或
> 视觉资产工作恢复时，都必须基于最新 `main` 重新登记；视觉资产标准板当前仍暂停且不占文件。

> **交叉点已解除**（08-24 02:41）：滚动剪辑修复线已收工，`shared/timelineCommands.ts`
> 与 `shared/timelineEditing.ts` 交还，架构收敛线 U4–U7 可以正常取用。
> **但请注意签名变了**：`trimTimelineItem` 与 `splitTimelineItem` 的 `startFrame`
> 现在是必传项，值必须是调用方按整份 items／rows 解析出来的真实起点。这是刻意做成
> 必传而不是可选的——隐式位置的镜头没有自己的 `timelineStartFrame`，漏传会静默退回
> 「整条时间线被砍短」那个 bug。U4–U7 新增的命令若要调用它们，从领域命令已有的
> 布局里取起点即可，不要在函数内部重新推导。

---

## 最近落地

- 2026-09-08 资产工作区与整场戏默认宠物：主仓工作区已完成，未提交；70 项定向测试、check/build/feature:validate 通过。触达 MaterialWarehousePanel、VisualAssetLibrary、ShotAssetBindingPanel、shared/visualAssets、visualAsset 持久化/生成/门禁及 storyAgent 生成快照；相关文件已释放。

> **归属怎么判**：author 字段全是 `jane-githu`，区分不出会话。可靠判据只有两条——
> `git reflog` 里这条是 `commit:`（直接在主仓提交）还是 `merge <分支名>:`（从哪个 worktree 合入），
> 加上触达的文件属于哪条线。**不要用「时间重合 + 刚跟谁通过信」归因**：
> 2026-08-23 下午已经连错两次，第二次差点让人去改错的地方。

| 时间 | 提交 | 内容 | 归属（判据） | 触达热区 |
| --- | --- | --- | --- | --- |
| 09-08 | `061893f` / `6694e07` / `482e8eb` | 照片追问已合 main；Story 1196 三图生成五视图 1787–1791 与合板1792，裁切被质检拦截；进度显示与图注顺序修复，宠物全身留边加强但未付费复验。无额外重购 | 聊天照片接手任务收工 | VisualAssetLibrary.tsx、visualAssetCreation.ts、测试及账本 |
| 09-08 | `ba0f1cf` / `3ea80c9` | 聊天照片艺术素材合入本地 main：复用素材库、原位报价确认、宠物补充顶视与回执防重。主仓定向回归 80/80、check/build 通过；main:3000 目标故事已显示聊天入口和示意。已清理对应 worktree/分支，未推送、未付费；三张猫图已收到，导入与真实成图验收待继续，功能保持 observing | **聊天照片艺术素材线**（merge codex/text-to-image-content-art） | `StoryAgentChat.tsx`、`ChatPhotoAssets.tsx`、`visualAssets/**`、`server/routers/visualAssets.ts`、`server/services/visualAsset{Creation,Persistence}.ts`、`shared/visualAssets.ts`、功能账本 |
| 09-05 | `0da6b0a` / `f997cf7` | 字幕与多音轨剪辑 U1–U10 完整落地，并扩展“添加声音”为旁白、音乐、环境声和音效；旁白按字幕 cue 对齐，生成类声音按镜头位置与情绪组织 302 提示词，付费提交前强制服务端报价确认。补齐受管资产、持久任务账本、崩溃恢复、导出混音与旧入口退役门禁。主仓浏览器验证通过；全量 492 文件、4215 用例通过，`pnpm check`、build、migration、feature ledger 与环境门禁均通过 | **字幕与多音轨剪辑线**（最终验收树直接提交 `main`，随后以 `ours` merge 记录原分支 12 条阶段提交） | `EditingNleWorkspace.tsx`、`client/src/features/creationEditor/timelineMedia/**`、`server/routers/timelineMedia.ts`、`server/services/{storyAudioGeneration,storyNarration,timeline*}.ts`、`server/db.ts`、`drizzle/**` |
| 09-04 | `7e10858` | 个人记忆与每日来信 U7：账号级足迹聚合、来源解析与记忆控制 API。tRPC router 的 userId 一律取 ctx.user.id，input schema 不接受任何身份字段；新增失败关闭护栏（routers.ownershipBoundaries.test.ts），只要有 procedure 接受客户端身份字段或不读 ctx.user.id 就直接红，已验证真的会红。时间线用 keyset 分页（occurredAt DESC, id DESC），真实 MySQL 验证同一秒内多条事件靠 id 兜底不被跳过。聚合器不跨业务表 union，只有详情 resolver 才回源理解或来信权威——来信没有写新事件，daily_letter_version 语义留给 U6 决定。来源 resolver 对六种 sourceType 逐条重新验证归属，失败关闭；新增受保护足迹媒体端点 `/api/personal-memory/media/:eventId`，不重定向到不鉴权的 `/api/images`。修了实现中途发现的真实 bug：日期详情曾靠"最近 100 条事件"过滤，活跃用户翻旧日期会静默返回空，已改精确查询并锁两条回归测试。合并前主仓门禁：tsc 干净、452 文件/3956 用例、MySQL 集成 38/38、feature:validate 通过 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/services/personalMemoryTimeline.ts`、`server/routers/personalMemory.ts`、`server/_core/{index,personalMemoryMediaRoute}.ts`、`server/db.ts`、`shared/personalMemory.ts` |
| 09-04 | `0455994` | 个人记忆与每日来信 U5：可追溯提炼、冲突处理与用户反馈状态机。提炼输入结构校验（question/quotation/hypothesis 结构性清零、project_scoped_instruction 强制 scope=project、行为信号来源强制 origin=inferred，全部服务端硬校验不信模型自报）；理解状态机新增 expectedRevision 序列检查（真实 MySQL 并发测试才抓到只查 state 不够）；归档/恢复/忘记/来源清空重算/手动纠正全部实现，忘记同事务递增隐私 epoch、建立 JSON 抑制记录。Runner 可显式 start/stop、单 tick 不重叠、单用户份额限制、独立 kill switch、SIGTERM/SIGINT 优雅关闭；提炼走算力账本，预占对象是新增的平台系统账户（默认零余额不自动充值），模型供应商 allowlist 默认空。真实 MySQL 上发现并修复第四个死锁（job claim 原子单行更新）；顺带修 U2 遗留 bug（每日留言事件快照曾截断 200 字）。端到端接线测试证明捕获→claim→提炼→完成→理解可见全链路真实打通。回填 apply 仍保持阻断 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`server/_core/index.ts`、`server/services/{personalMemoryExtraction,personalMemoryJobRunner,personalMemoryEvents,personalMemoryPersistence}.ts`、`shared/personalMemory.ts` |
| 09-03 | `4ac430d` | 个人记忆与每日来信 U3+U4：七个图片采用入口+文章create_version 映射为可追溯经历，采用语义只能由 router 边界显式传入（禁止从 metadata.source 反推）；文章采用与 stories.body 的 CAS 共享同一事务边界。回填只做 dry-run 四分类，历史图片采用基本判 ambiguous（历史signal 行区分不了用户点击与自动路径），apply 硬阻断等 U5；对账为纯函数只发现不修复。修真实 MySQL 上并发首开来信的间隙锁死锁（改乐观插入+有界重试）。**合并前用真实代码路径冒烟验证**（本地+真实 MySQL），非仅单元测试 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`server/services/{personalMemoryAdoption,personalMemoryReconciliation,publishingPersistence,storyBodyPersistence,directorAdvice}.ts`、`server/routers/{creationAgent,publishingDraft,storyAgent}.ts`、`scripts/backfill-personal-memory.ts` |
| 09-03 | `660bba9` | 个人记忆与每日来信 Phase 0 + U1 + U2：九张新表与 `0017` 迁移；跨租户引用由含 `userId` 的复合外键在库层拒绝；每日来信正文收敛为不可变版本这一个写入口，日期级 `emotion_daily_letters` 降级为当前版本指针 + 可重建投影，并加门禁测试禁止绕过；普通聊天与每日留言在服务端成功边界捕获（本地 outbox 与消息同一次 copy-on-write，跨聚合靠带水位的幂等 projector）。**首次在真实 MySQL 上跑通集成测试 26/26**（含 `0017` 在全新 utf8mb4 库上完整 journal 重演），期间修掉两个只有并发才暴露的 REPEATABLE READ 快照读问题。捕获默认全关，runner 未启动、未回填 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`drizzle/**`、`shared/promptLineage.ts`、`server/services/{storyConversation,promptLineageStore,emotionDailyLetters}.ts` |
| 09-03 | `3b578c5`（PR #7） | 合并手机跨端聊天与正文、统一账号和算力账本基础、微信原生 mock 壳层、成片版本、抽帧恢复、OpenAI 路由与美术语义；审查后补修历史账号会话归属和对话并发幂等。完整门禁 436 文件、3643 测试通过。测试站只读预检因迁移 ledger 7/17、缺账号表和 `OTP_DIGEST_SECRET` 判定 No-Go，未部署、未迁移、未重启 | **移动端与环境收敛线**（GitHub PR #7 合并；本地功能/staging worktree 与已吸收分支已删除） | `server/db.ts`、`drizzle/**`、`server/_core/oauth.ts`、`server/services/storyConversation.ts`、`client/src/features/mobileWorkspace/**`、`miniprogram/**`、`docs/features/feature-ledger.json` |
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

图片参考通道修复（2026-09-08，工作区未提交）已释放文件：单张本地参考入口及报价、供应商错误保真已完成；真实请求302 fetch failed，未出图，未重复提交。代码为StoryboardReviewBoard/storyboardImageRenderPlan/rerender及测试，证据见docs/qa/storyboard-image-confirmation-2026-09-08.md。

2026-09-09 参考图异步适配修复已释放文件（未提交）：imageGen.ts及测试；75项通过、类型/构建/账本通过。未新增付费任务，真实出图和Story回执持久化仍未验收，详见docs/qa/storyboard-image-confirmation-2026-09-08.md。
