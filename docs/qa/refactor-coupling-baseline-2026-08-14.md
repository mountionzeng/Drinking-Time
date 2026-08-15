# 耦合基线：U2（2026-08-14）

> 给 U3、U4、U5、U8 用的同一套统计口径。三类代表性改动分别记录"这件事目前
> 要触达多少个生产文件、有哪些重复的 writer/DTO 重建点/状态解释点/
> direct-db seam"。后续单元完成对应重构后，用同一方法重新统计，与本文档
> 的数字对比作为验收证据（见各单元 Success Metrics）。

## 方法

- 只数**生产代码**文件（不含 `*.test.ts`）。
- "触达"指：要正确、完整地实现这类改动，需要理解或修改的文件——包括
  writer（实际落库）、DTO 重建点（把持久化形状转成返回给调用方/UI 的形状）、
  状态解释点（对某个状态/类型字段做 if/switch 分支并据此改变行为）、
  direct-db/provider seam（绕开既有领域 persistence 模块，直接调
  `server/db.ts` 或 provider SDK 的非 persistence 层代码）。
- 行号为撰写时（2026-08-14，`codex/jb` 合并 U1 后）的快照，后续代码演进会
  漂移；重新统计时以函数名/职责定位，不必逐行核对。

---

## A. Story 文本字段（title / logline / theme / summary）

| 文件 | 角色 | 说明 |
|---|---|---|
| `server/db.ts` | writer | `createStory`（新建，2026行）、`updateStory`（整包覆盖，2056行）、`updateStoryTitle`（仅 title，2081行，无 CAS）、`updateStoryTitleIfUntitled`（仅未命名时写 title，2104行）、`updateStoryBodyIfRevision`（CAS 写 body，2148行） |
| `server/services/storyBodyPersistence.ts` | writer（封装层） | `persistPreparedStoryBody` 包一层 `getStoryById` + `updateStoryBodyIfRevision`，是 title/logline/theme/summary 随 body 一起落库时唯一带 CAS 的入口 |
| `server/routers/storyAgent.ts` | writer + mutation procedure | `storyUpsert`（经 `persistPreparedStoryBody`/`createStory`）、`storyRename`（直接调 `updateStoryTitle`，绕开 CAS 封装层）、`storyAutoRename`（直接调 `updateStoryTitleIfUntitled`） |
| `server/routers/_storyShared.ts` | DTO 重建 | `composeStoryWorkspace`（168行）把 `getStoryById` 读出的原始行组装成返回给客户端的 workspace 对象；`storyPromptLineageBody` 是另一处专门摘出 title/theme/arc 给 prompt lineage 用的 DTO |
| `client/src/features/storyAgent/StoryAgentContext.tsx` | UI 消费 + 二次写入触发 | `renameStory` 调 `storyRename` mutation；自动保存逻辑把本地 `storyTitle/storyLogline/storyTheme` 状态拼进 `storyUpsert` payload；消费 `composeStoryWorkspace` 返回值 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | DTO 重建（client 侧二次组装） | `stories`/`activeStory` 的 `useMemo` 把 tRPC 返回的 story 行再次 normalize 成本地 `CreationEditorStory` 形状（`{ id, title, logline }`），不复用 `composeStoryWorkspace` 的输出结构 |

**触达生产文件数：6**

**重复例子**
1. **title 有三条独立写入路径**，各自决定"能不能写、要不要校验 revision"，没有共用一个 title 写入函数：`storyUpsert`（经 `persistPreparedStoryBody` → `updateStoryBodyIfRevision`，有 CAS）、`storyRename`（直接调 `server/db.ts:updateStoryTitle`，无 CAS）、`storyAutoRename`（直接调 `updateStoryTitleIfUntitled`，带隐式"仅未命名才写"条件）。
2. **DTO 重组两次**：`composeStoryWorkspace`（server 端一次）与 `CreationEditorContext.tsx` 的 `stories`/`activeStory` useMemo（client 端又一次，字段集更窄）。

---

## B. 生成状态（pending / completed / failed / unknown）

| 文件 | 角色 | 说明 |
|---|---|---|
| `shared/publishingDraft.ts` | 状态解释（权威定义） | `PublishingCoverGeneration.status` 定义为四态枚举；`isRecoverablePublishingCoverGeneration` 是唯一"官方"可恢复性判断函数 |
| `server/services/publishingPersistence.ts` | writer + 状态解释 | 写 `coverGeneration` 到 story body；对 `existing?.status === "pending"` 做过期判断 |
| `server/routers/publishingDraft.ts` | writer + 状态解释（重复判断） | `resuming`/`recoveringAcceptedTask` 对 `persistedGeneration.status` 做 pending/completed 分支；另有一处 `status === "completed"` 分支处理已完成情形，与 `isRecoverablePublishingCoverGeneration` 逻辑部分重叠但不复用 |
| `server/services/publishingVideoStoryboardPersistence.ts` | writer + 状态解释（多处重复） | 同一文件内对 `PublishingVideoOperationState.status` 独立判断达 8 处（claim/complete/existing 各自判断 pending/completed） |
| `shared/publishingVideoStoryboard.ts` | 状态解释（反序列化+分支） | `normalizeOperationState` 按 status 字段分三支重建 pending/completed/failed 三种 operation 形状 |
| `client/src/features/publishingDraft/publishingCoverGenerationState.ts` | 状态解释（client 封装） | `shouldRecoverCoverGeneration` 转调 shared 的 `isRecoverablePublishingCoverGeneration`（复用），但只覆盖"是否可恢复"，不覆盖 UI fallback 判断 |
| `client/src/features/publishingDraft/PublishingDraftWorkspace.tsx` | 状态解释（UI 分支，独立判断） | `canUseCoverFallback`（412行）自己组合 `status === "unknown"/"failed"` + `provider` + `taskId`，和 `isRecoverablePublishingCoverGeneration` 条件不同但语义重叠 |
| `server/services/localMotionVideo.ts` | 状态解释 | `current.status === "available" \|\| current.status === "failed"` 判断视频素材是否终态 |
| `server/services/startEndShotVideoWorkflow.ts` | 状态解释 | `take.status === "failed"` 独立判断视频 take 失败态 |
| `client/src/features/creationEditor/videoAssetViewModel.ts` | 状态解释（UI） | `take.status === "failed"` |
| `client/src/features/creationEditor/views/Timeline.tsx` | 状态解释（UI） | `shot.videoTakes?.find(take => take.status === "failed")` |
| `client/src/features/creationEditor/views/MaterialWarehousePanel.tsx` | 状态解释（UI） | `item.take.status === "failed" \|\| item.take.status === "timeout"`（比其他四处多判一个 `"timeout"`） |

**触达生产文件数：12**

**重复例子**
1. **"cover 生成能否用 fallback / 可否恢复"被判断了至少 3 次**：`shared/publishingDraft.ts:isRecoverablePublishingCoverGeneration`（官方）、`server/routers/publishingDraft.ts` 的 `resuming`/`recoveringAcceptedTask`（自拼一套条件）、`PublishingDraftWorkspace.tsx:canUseCoverFallback`（按 provider+status 组合再判一次）。三处对同一个 `status` 字段的"能否重试/恢复"给出不完全一致的条件表达式。
2. **video take 的失败态在 5 个文件里各自 if 判断**，`MaterialWarehousePanel.tsx` 甚至多判了一个 `"timeout"` 值，没有共用一个"take 是否失败"的判定函数。

---

## C. 资产类型（候选图 / 正式封面 / 视频首帧 / 故事版预览）

| 文件 | 角色 | 说明 |
|---|---|---|
| `server/db.ts` | writer | `createGeneratedImage`（候选图落库）、`promoteStoryImageToCurrent`（把某张图标记 `isCurrent`，即"转正"，2834行）、`createImageSignal`（记录 swipe 信号） |
| `server/services/imageAssets.ts` | 状态解释（权威投影） | `projectImageAssets`（114行）是把原始 `generatedImages` 行投影为 `kind`/`assignment`/`status`/`isPrimary` 的唯一"官方"分类函数 |
| `server/routers/storyAgent.ts` | writer（绕过 imageAssets.ts） | `recordSignal`：`swipe_right` 时直接调 `promoteStoryImageToCurrent`；另有 3 处直接调 `createGeneratedImage` 写候选图 |
| `server/routers/publishingDraft.ts` | writer（绕过 imageAssets.ts，且绕过 publishingPersistence.ts） | 出封面候选时直接 `createGeneratedImage`；"采用为正式封面"时先经 `writePublishingDraftState`（走 publishingPersistence）、再直接调 `promoteStoryImageToCurrent` |
| `server/routers/creationAgent.ts` | writer（绕过 imageAssets.ts） | 复核确认发现的第三、四、五处独立 `promoteStoryImageToCurrent` 调用点（3 处），比最初调研多出的重复面 |
| `server/services/directorAdvice.ts` | writer（绕过 imageAssets.ts） | 又一处独立 `promoteStoryImageToCurrent` 调用（273行），"转正"逻辑目前共有 6 个调用点分布在 5 个文件 |
| `server/services/publishingVideoStoryboardPersistence.ts` | writer + DTO 重建 | 管理"故事版预览（preview）"与"确认后的正式 storyboard"两种资产语义的持久化与状态机 |
| `client/src/features/storyAgent/views/StoryboardReviewBoard.tsx` | 状态解释（UI，独立词汇表） | `selectedStoryboardMedia.kind === "candidate"` vs `"image"` 是 UI 层自造的候选/正式二分，不复用 server 的 `assignment`/`status` 字段 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | 状态解释（UI，独立判定函数） | `isCurrentMaterialImage` 自己组合 `isPrimary`/`selectionSource`/`status` 三个字段判断"是不是当前生效图" |
| `client/src/features/creationAgent/imageAssetViewModel.ts` | 状态解释（UI，独立排序/分组） | `assetRank`/`buildImageAssetWorkspace` 按 `isPrimary`/`status === "pending"`/`assignment` 自行分组出 `primary`/`preview` |

**触达生产文件数：10**（复核 `promoteStoryImageToCurrent` 实际调用点时，在最初调研基础上额外确认了 `server/routers/creationAgent.ts` 与 `server/services/directorAdvice.ts` 两个文件，均绕过 `imageAssets.ts`）

**重复例子**
1. **"候选图转正式"（promote to current）目前有 6 个独立调用点、分布在 5 个文件**（`server/routers/storyAgent.ts` 的 `recordSignal`、`server/routers/publishingDraft.ts` 的封面确认流程、`server/routers/creationAgent.ts` 的 3 处、`server/services/directorAdvice.ts` 1 处），全部直接调 `server/db.ts:promoteStoryImageToCurrent`、都不经过 `server/services/imageAssets.ts`。`publishingDraft.ts` 的确认流程还额外维护了 `writePublishingDraftState` 里 `cover.assetId` 这个第二份"哪张是官方封面"的真相源——一次操作要在两处（story 行的 `isCurrent` 列 + publishing draft JSON 的 `cover` 字段）分别写入才算完整转正。
2. **"这是候选还是正式资产"被至少 4 个地方各自判断**：server 端权威口径是 `imageAssets.ts:projectImageAssets` 算出的 `assignment`/`status`/`isPrimary`；但 `StoryboardReviewBoard.tsx`（`kind === "candidate"`）、`CreationEditorContext.tsx`（`isCurrentMaterialImage`）、`imageAssetViewModel.ts`（`assetRank`）三个 client 文件各自用不同字段组合重新定义了一遍"候选 vs 正式"，彼此不共用同一个判定函数。

---

## 汇总

| 代表性改动 | 触达生产文件数（基线） | 已确认的重复 writer/状态解释组数 |
|---|---|---|
| A. Story 文本字段 | 6 | 1 组重复 writer（title 三条路径）+ 1 组重复 DTO 重建 |
| B. 生成状态 | 12 | 1 组重复"可恢复性"判断（3 处）+ 1 组重复"失败态"判断（5 处） |
| C. 资产类型 | 10 | 1 组重复"转正"writer（6 个调用点）+ 1 组重复"候选/正式"判定（4 处） |

U3/U4/U5/U8 完成后，用同一方法（只数生产文件、只数尚存的独立 writer/状态解释组）重新统计，目标是三类改动的触达文件数与重复组数都低于本表。

---

## 复盘：U8 第一刀（2026-08-15）

按与上表**完全相同的口径**重新统计。诚实起见先说结论：**A 类触达文件数没有下降，
重复 writer 组下降了一组。**

| 代表性改动 | 触达生产文件数 | 变化 | 重复 writer/状态解释组 | 变化 |
|---|---|---|---|---|
| A. Story 文本字段 | 6 | 持平 | title 写入路径 3 → 2 | −1 组 |
| B. 生成状态 | 12 | 未动 | 未动 | — |
| C. 资产类型 | 10 | 未动 | 未动 | — |

**做了什么**：`updateStoryTitle` 与 `updateStoryTitleIfUntitled` 合并为
`writeStoryTitle({ id, userId, title, onlyIfUntitled })`。两者原先只差"标题是不是
占位名"这一个谓词，却各自复制了所有权校验、内存/数据库双分支和返回值语义。
`safe-story-titles` 的两条不变量（自动标题只能替换未命名标题、改名不重写 body）
现在由同一个函数的一个参数表达，判定仍留在存储写入本身（内存分支查 `row.title`，
数据库分支进 WHERE），不依赖调用方先读后写。

**为什么文件数没降**：A 类那 6 个文件里没有任何一个从路径上消失——db.ts 仍是
writer、storyBodyPersistence.ts 仍是 CAS 封装、storyAgent.ts 仍是 router、
_storyShared.ts 仍在重建 DTO、两个 client Context 仍在消费。要让这个数字下降，
必须消掉的是 **DTO 重建那一组**（`composeStoryWorkspace` 与
`CreationEditorContext` 的 `stories`/`activeStory` useMemo 各组装一次），
那属于 U8 的下一刀，不在本次范围内。计划里"触达文件数少于基线"这条验收标准
本轮**没有达成**，不做粉饰。

**`updateStory` 的处置（有意保留）**：它是"整 blob 覆盖"写入口、完全绕开 CAS，
且**生产代码零调用方**，看起来是理想的删除目标。但它有一个正当用途：
`server/services/storyBodyPersistence.test.ts` 用它模拟"另一个写入者在 CAS 之外抢
先落库"，以验证赢家返回的仍是自洽快照——这个场景恰恰需要一个绕过 CAS 的写入口。
删掉它会逼那个测试改成直接操作 `memoryState`，把测试和内部结构绑死，可读性更差。
故保留，并在此登记：它是一条**随时可被误用的旁路**，若将来那个测试换了模拟方式，
应当立刻删除。

---

## D. 后续单元待收敛项（U7 补记，2026-08-15）

U7 执行期间发现、但**有意留给后续单元**的重复面。记在这里是为了不让它们悄悄沉没。

### D0. 已在 U8 第一刀关闭

- **`shared/scopedResource.ts` 的悬空导出已删除**。U2 建立合同时一并预留了
  `buildOwnerScope`、`parseScopeKey`、`parseDomainCommand`、`commitResourceRevision`、
  `bumpAggregateForProjection`、`hasResourceRevisionConflict` 六个函数与
  `ResourceKind`/`DomainCommand`/`OwnerScope`/`PayloadParseResult` 四个类型，设想由
  U3~U8 接线。U8 复核确认它们**至今零生产调用方**（仅在别处的注释里被提及），
  已全部删除；文件从 ~240 行降到 ~60 行。保留 `ScopeKey`（16 处真实引用）、
  `ScopedRevision`（4 处）和 `scopeKeysEqual`（7 处）。
  需要时从 git 历史取回当时的实现，好过留在原地让后来者以为它已经在用。

### D1. 两套并行的 scope 判定层（留给 U8 下一刀）

`client/src/features/publishingDraft/publishingOperationScope.ts`（148 行，2026-08-15 随
publishing 生命周期收敛一起合入）与 U2 的 `shared/scopedResource.ts` 是**同一件事的两套
实现**：

| 概念 | `shared/scopedResource.ts`（U2） | `publishingOperationScope.ts`（后合入） |
|---|---|---|
| 资源身份 | `ScopeKey` 判别联合 | `PublishingOperationScope` |
| 同一资源判定 | `scopeKeysEqual` | `publishingOperationScopeMatches` |
| 版本身份 | `publishingVersionScopeKey`（在 publishingDraft.ts） | `publishingVersionTransitionIdentity` / `publishingSimpleVersionIdentity` |

两者互不引用。**本轮没有动它**：它是刚合入、带完整测试的功能代码，在别人成果还没稳定
时做收敛手术风险高于收益。U8 做 seam 收敛时应当二选一，删掉另一套。

### D2. 已在 U7 关闭的项

- **跨 Story 缓存污染**：`shot.list` 是唯一带 scope 输入却被无参 `invalidate()` 的查询，
  4 个调用点（`StoryAgentContext`、`CreationAgentContext`、`CreationPage`、
  `useAnalysisOrchestration`）已全部收窄为 `invalidate({ storyId })`，并由
  `architecture-boundaries.test.ts` 的静态守卫防回归。其中 3 处原本还留着
  `// 按 storyId 后无差别失效（U5）` 这类注释，把无参失效写成既定行为而非疏漏——
  正因为它被当成设计写了下来，才更需要一个会失败的守卫而不是又一条注释。
- **经核查不是缺陷、不要改的**：`storyAgent.storyList`、`emotionAnalysis.getProfile`、
  `project.list`、`auth.me` 都不接收 scope 输入（每用户只有一条该查询），无参失效已经是
  最精确的做法；`emotionAnalysis.listDailyLetters` 的 `limit` 是分页参数而非 scope。
- **跨身份 query cache 串数据（U7 期间发现的真实缺陷，已修）**：最初以为"每条身份切换
  路径都整页跳转所以不可能串"，深度审查证明这是错的。只有登出走
  `window.location.href`；邀请码登录是 wouter SPA 跳转，会话过期后的重定向是
  `<Redirect to="/login" />`，两者都不销毁 react-query 缓存。可复现序列：A 的会话过期 →
  SPA 跳到登录页 → 以 B 登录 → B 的首屏读到 A 缓存的 `project.list`、`storyAgent.storyList`、
  `emotionAnalysis.getProfile`（这些查询不带输入，key 与用户无关）。修法是在身份切换那
  一个点清一次缓存（`useAuth.refreshAfterIdentityChange`），而不是把 `cacheUserId` 穿进
  100+ 个调用点；U2 为此预留的 `deriveClientCacheScopeKey` 因此在 U7 删除。
  相关放大风险（U8 处理）：`reference.list` 只按 `projectId` 过滤、不校验 `userId`，
  所以一份过期的 `project.list` 缓存可能把新会话无权访问的 projectId 喂进去。
