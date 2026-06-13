---
title: "refactor: 故事为唯一单位，各界面跟随同一当前故事"
type: refactor
status: completed
date: 2026-06-13
origin: docs/brainstorms/2026-06-13-story-as-single-unit-requirements.md
---

# refactor: 故事为唯一单位，各界面跟随同一当前故事

## Summary

给 `shots` 表加 `storyId` 并把现有镜头回填到所属故事；把 Creation 侧（`shot.list` 查询 + creation 聊天）从"按 projectId / 最新故事"改为"按当前故事"；把 `activeStoryId` 提升为 Story 页与 Creation 页共享的单一真相源；无当前故事时给一致空状态。

---

## Problem Frame

一个项目挂多个故事时，各界面解析"当前故事"的方式不一致：Story 页认 `activeStoryId`，Creation 聊天用 `getLatestStoryForProject`，Shot Production Table 只认 `projectId`。三者错位，用户看到"聊天、卡片、剧本、镜头表说的不是一个故事"。详见 origin（Sources & References）。

---

## Requirements

- R1. 全局唯一"当前故事"，Story 页与 Creation 页共享同一个值；复用并提升 `activeStoryId`，不新造并行状态。
- R2. Creation 侧改为跟随"当前故事"，弃用 `getLatestStoryForProject` 作为故事来源。
- R3. Shot Production Table 的镜头归属到"当前故事"；`shots` 表加 `storyId`；现有镜头迁移到所属故事。
- R4. Creation 页对镜头的增删改落到"当前故事"，同项目其他故事不受影响。
- R5. 无明确"当前故事"时，各界面一致空状态，不各自回退到不同故事。
- R6. 不改 `stories.body` 自包含结构（卡片/剧本仍存 body）。
- R7. 保留上一轮"目标注入"（goal）功能，不回退。

**Origin actors:** A1（用户）、A2（creation 聊天 Agent 小酌）、A3（Story 聊天 Agent）
**Origin flows:** F1（切换/打开故事全界面对齐）、F2（Creation 页基于当前故事改镜头）
**Origin acceptance examples:** AE1（covers R1/R2/R3）、AE2（covers R4）、AE3（covers R5）

---

## Scope Boundaries

- 不改 `stories.body` 自包含结构，不迁移卡片/剧本存储位置。
- 不做 B 方案（一项目一故事的数据合并/删故事）。
- 不回退目标注入（goal）。

### Deferred to Follow-Up Work

- buildShotList（聊天直接铺整张镜头表）：地基稳后回来做。
- 自动意图识别、真正视频合成、深化社媒/记录目标。
- **图片关联键收敛到 storyId**：`generated_images` 本次仍按 `projectId + shotNo`，同 project 多故事同 shotNo 会串图（AE2 在图片层不成立）——已知缺口，需要时单独跟进。

---

## Context & Research

### Relevant Code and Patterns

- `drizzle/schema.ts` — `shots` 表（仅 `projectId`、`userId`，无 `storyId`）；`stories` 表（`projectId` 可空，`body` JSON 自包含 cards/script/shots）。
- `server/db.ts` — `getLatestStoryForProject`（按 updatedAt 取最新，**Creation 侧故事来源，待弃用**）、`replaceDirectorShotsForProject`（按 projectId 整体替换镜头，**待改为按 storyId**）、`memoryState` + `nextIds`（local-persist 加载层）。
- `server/routers.ts` — `shot.list`（按 projectId 查询）、creation 聊天端点（1809 行附近，调 `getLatestStoryForProject` + `replyFromCreationAgent`）、剧本合成端点（1148 行，`synthesizeShotList` + `replaceDirectorShotsForProject`）、`storyShotToDbRow`（202 行）。
- `client/src/features/analysis/hooks/useProjectData.ts` — 持有 `currentProjectId`（localStorage `dt:currentProjectId` 持久化）+ `shotsQuery = trpc.shot.list({ projectId })`；**当前故事状态应提升到此层**。
- `client/src/features/storyAgent/StoryAgentContext.tsx` — 现有 `activeStoryId`（客户端 state，经 `storyAgentPersistence` 持久化）；**改为读共享源**。
- `client/src/pages/CreationPage.tsx` — 同时挂 `StoryAgentProvider` 与 `CreationAgentProvider`，都按 `currentProjectId`；是共享当前故事的天然落点。
- 迁移机制：`db:push` = `drizzle-kit generate && drizzle-kit migrate`（prod MySQL）；dev 用 `.webdev/local-persist.json`（用户真实数据在此，`nextIds.shot` 已存在）。

### Institutional Learnings

- `docs/solutions/2026-06-13-多worktree环境数据分裂收敛.md` — 数据改动前必备份、改后用 API 验证加载，本计划的迁移单元沿用同样的"备份+验证"纪律。

### External References

- 未使用（纯本地架构重构，drizzle/tRPC/React 均有充分本地范例）。

---

## Key Technical Decisions

- `storyId` 用**可空列 + 回填**而非 not-null：避免迁移在存量数据上卡住；回填后行为按"当前故事"，遗留 null 走空状态/兜底。
- "当前故事"提升到 `useProjectData` 同层（已管 `currentProjectId` + 持久化），作为单一真相源；StoryAgentContext 改为消费它——避免再造一套"谁是当前"。
- 迁移两条腿：drizzle 生成 MySQL 迁移（prod）+ local-persist.json 回填（dev 真实数据）；local-persist 加载层对 `storyId` 缺失容错。
- `replaceDirectorShotsForProject` → 重命名为 `replaceDirectorShotsForStory(storyId, userId, rows)` 按 storyId 归属；**必须保留现有 `intentType === "director_note"` 过滤**（只替换该故事的导演镜头，不误删其他来源镜头）；creation 聊天与剧本合成两个写入点都改。
- **镜头的单一真相源 = `shots` 表（按 storyId）**：评审发现 `shots` 表与 `story.body.shots` 是两份会打架的镜头数据（如 story 1 body.shots=6 条、shots 表仅 1 行）。本次确定 **shots 表为镜头的权威显示源**；R6"不动 body 结构"仅指不删 body 字段、不迁卡片/剧本，**但 body.shots 不再作为 Creation 侧镜头来源**。回填时以 body.shots 作为"该故事应有几条镜头"的参照来归属，不反向同步——避免两份数据的双写复杂度。
- **所有按 storyId 的镜头查询/写入必须带 `userId` 条件**：现有 `getProjectShots` 不按 userId 过滤，改 storyId 后若不加 userId 等于"猜 storyId 取他人镜头"。新 `getStoryShots(storyId, userId)` 与 `replaceDirectorShotsForStory` 两路径（memory + MySQL）都强制 `userId`；creation 聊天/inpaint 端点接 storyId 后第一步 `getStoryById(storyId, ctx.user.id)` 验归属（参照 `routers.ts:1424` generateForMobile 现有模式）。
- **回填归属改用"数量最接近 + 最近更新"而非"shotNo 精确匹配"**：评审实测 `shots.shotNo`（"SH01" 字符串）与 `body.shots[].shotNo`（数字 1）编号体系不兼容、精确匹配恒为空；且"最近更新"兜底会系统性归给空壳新故事。改为：在该 project 的故事里，归给 `body.shots.length` 与待归属镜头数最接近的故事，再以 updatedAt 兜底；每条镜头的候选与归属理由进 dry-run 报告交用户**逐条**核对。

---

## Open Questions

### Resolved During Planning

- 当前故事承载方式：提升到 `useProjectData` 同层共享状态（持久化方式仿 `currentProjectId`）。
- `getLatestStoryForProject` 处置：从 Creation 路径弃用；U6 审计其余调用方后决定保留/删除。

### Resolved After Review（评审后定稿）

- 回填归属算法：用"`body.shots.length` 最接近 + updatedAt 兜底"，**不用 shotNo 精确匹配**（实测编号体系不兼容），dry-run 逐条交用户核对——见 Key Technical Decisions 与 U2。
- 镜头真相源：shots 表为权威，body.shots 不再作 Creation 侧来源——见 Key Technical Decisions。
- 安全：所有 storyId 镜头查询/写入带 userId；端点接 storyId 先验归属——见 Key Technical Decisions 与 U3。

### Deferred to Implementation

- `shot.list` 是否保留 projectId 兼容期：**倾向一次性切 storyId 并同步改全部调用方**（见 U5 调用方清单），避免双键期 invalidate 与 query 键不一致；若保留兼容期，需定义"projectId 与 storyId 同传时以谁为准"并同步加固旧路径的 userId 过滤。
- `generated_images` 仍按 `projectId + shotNo` 关联图片：同 project 多故事同 shotNo 会串图（AE2 在图片层被打破）。本次**不收敛图片关联键**，记为已知缺口（见 Scope Boundaries → Deferred）；是否随后续把图片也归到 storyId 留作跟进。
- prod MySQL 回填的触发方式与数据来源：dev 的 10 条在 local-persist，prod 是否有同形数据未知；prod 腿需独立 dry-run 验证，不能假设 dev 验证过即 prod 安全。
- local-persist 回填脚本与 drizzle 迁移复用同一归属纯函数（建议，执行时确认）。

---

## High-Level Technical Design

> *以下说明意图与方向，供评审验证，不是实现规范。实现者当作上下文，而非照抄的代码。*

各界面"取镜头/取故事"的键，重构前后对照：

| 界面 / 路径 | 重构前的键 | 重构后的键 |
|---|---|---|
| Story 页（卡片/剧本/镜头） | `activeStoryId` → `story.body` | 不变（已是故事维度） |
| Shot Production Table (`shot.list`) | `projectId` | **当前故事 storyId** |
| creation 聊天（小酌） | `getLatestStoryForProject(projectId)` | **当前故事 storyId** |
| 镜头写入（合成/编辑） | `replaceDirectorShotsForProject(projectId)` | **按 storyId 归属** |
| "当前故事"真相源 | StoryAgentContext 私有 | **提升到 useProjectData 同层，跨页共享** |

数据流（目标态）：用户在 Story 页选定故事 → 写入共享"当前故事" → Creation 页 shot.list 与 creation 聊天都读它 → 镜头读写按该 storyId → 回 Story 页一致。

---

## Implementation Units

### U1. shots 表加 storyId（schema + 迁移脚手架）

**Goal:** 给 `shots` 表增加可空 `storyId` 列，生成 drizzle 迁移，并让 local-persist 加载层对缺失 `storyId` 容错。

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `drizzle/schema.ts`（shots 表加 `storyId: int("storyId")` 可空）
- Create: `drizzle/00NN_*.sql`（drizzle-kit 生成的迁移）
- Modify: `server/db.ts`（InsertShot/Shot 类型流转；memoryState 加载对 storyId 缺失容错）

**Approach:**
- 列可空，不加外键约束硬绑定（与现有 `shots` 表风格一致——现有外键都是裸 int 列）。
- 仅加列与类型流转，不在本单元改查询/写入行为（行为改动在 U3），保证本单元可独立落地、回归为零。

**Execution note:** 改 schema 前先备份 `.webdev/local-persist.json`（沿用 docs/solutions 的数据纪律）。

**Patterns to follow:**
- `drizzle/schema.ts` 现有 int 外键列（如 `shots.projectId`、`generatedImages.storyId`——后者已是 storyId 先例）。

**Test scenarios:**
- Happy path: 加载含老镜头（无 storyId）的 local-persist，镜头正常读出，storyId 为 null/undefined，不报错。
- Edge case: `nextIds.shot` 不受影响，新建镜头 id 连续。

**Verification:**
- `npm run check` 通过；`drizzle-kit generate` 产出迁移；既有镜头测试全绿；dev 启动加载老数据无错。

---

### U2. 现有镜头回填 storyId（数据迁移，用户在环）

**Goal:** 把现有镜头（dev：local-persist 10 条；prod：MySQL）回填到其所属故事的 storyId。

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Create: `scripts/backfill-shot-storyid.ts`（回填脚本 + 归属纯函数）
- Create: `scripts/backfill-shot-storyid.test.ts`（归属逻辑单测）

**Approach:**
- ⚠️ **评审实测：不能用 shotNo 精确匹配**——`shots.shotNo` 是 "SH01" 字符串、`body.shots[].shotNo` 是数字 1，编号体系不兼容，精确匹配恒为空；且"最近更新"单独兜底会系统性归给空壳新故事（如 project 1 会归给空的 story 2 而非有 6 条镜头的 story 1）。
- 归属纯函数 `assignStoryIdForShot(projectShots, projectStories)` 按 project 整体归属（不是逐条）：在该 project 的故事里，归给 `body.shots.length` 与该 project 待归属镜头数**最接近**的故事；数量并列或都不接近时，以 updatedAt 最近兜底。
- 脚本默认 dry-run 出报告：每条镜头打印**所有候选故事及其 `body.shots.length`、updatedAt、拟归属与理由**，交用户**逐条核对**后再写；写前备份。
- 同一归属纯函数供 prod 迁移（如需）复用；prod 数据分布未知，prod 腿需独立 dry-run。
- **承认存在无唯一解的情形**（如 project 5 的 story 14/15 同名、body.shots 都=2、updatedAt 相差一天）：这类镜头 dry-run 显式标注"歧义、需用户裁决"，不擅自兜底写入。

**Execution note:** 破坏性写入前 dry-run 报告交用户逐条核对；先备份 local-persist（沿用 docs/solutions 数据纪律）。

**Patterns to follow:**
- `scripts/merge-local-persist.ts` 的 dry-run + 备份 + 纯函数可测 + 分叉副本人工裁决结构。

**Test scenarios:**
- Happy path: project 有 1 个故事 → 该 project 所有镜头归该故事。
- Covers R3. Edge case: project 有多故事、待归属镜头数=7，候选故事 body.shots 分别为 11 和 7 → 归 body.shots=7 的那个（数量最接近），而非 updatedAt 最近的那个。
- Edge case: 数量并列/都不接近 → updatedAt 兜底，报告标注"数量未命中、按时间兜底"。
- Edge case: 多故事数量与同名都无法区分（歧义）→ 报告标注"需用户裁决"，不自动写入。
- Edge case: project 下无故事 → storyId 保持 null，报告告警，不崩。
- 归属后校验: 每条 shot 的 `userId` 与其拟归属 story 的 `userId` 一致（不跨用户污染）。

**Verification:**
- dry-run 报告每条镜头都列出候选与理由，歧义项已标注；用户逐条确认后写入；写入后每条 `shot.storyId` 指向同 project、同 userId 的真实故事 id；无镜头丢失；project 2 的 7 条归到 body.shots=7 的故事（验证数量启发式生效）。

---

### U3. 服务端镜头读写改为按 storyId

**Goal:** `shot.list` 按 storyId 查询；镜头写入（剧本合成、creation 聊天触发的）按 storyId 归属；creation 聊天故事来源从 `getLatestStoryForProject` 改为传入的当前故事。

**Requirements:** R2, R3, R4（F2）

**Dependencies:** U1

**Files:**
- Modify: `server/db.ts`（`getProjectShots` → 新增 `getStoryShots(storyId, userId)` **带 userId 过滤**；`replaceDirectorShotsForProject` → `replaceDirectorShotsForStory(storyId, userId, rows)`，**保留 `intentType==="director_note"` 过滤 + userId 条件**）
- Modify: `server/routers.ts`（`shot.list` 入参改 storyId 并传 `ctx.user.id`；creation 聊天端点【约 1810 行】与 inpaint 端点【约 1896 行】两处都改读传入 storyId、并先 `getStoryById(storyId, ctx.user.id)` 验归属；剧本合成端点【约 1148 行】入参加 storyId 并向 `storyShotToDbRow`/`replaceDirectorShotsForStory` 传递）
- Modify: `server/services/creationAgent.ts`（入参加 storyId，写入归属）
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（剧本合成由 Story 页 classify 触发，classify 入参补传当前 storyId——评审发现该写入链漏接）
- Test: 新增 `server/routers.shot.test.ts`

**Approach:**
- **一次性切 storyId**，不留 projectId 兼容期（避免双键期 invalidate/query 不一致，见 U5 调用方清单）。
- `getStoryShots(storyId, userId)` 两路径（memory + MySQL）都 `WHERE storyId AND userId`——**评审发现现有 `getProjectShots` 无 userId 过滤，改 storyId 后不加 userId 等于"猜 storyId 取他人镜头"**。`shot.list` 路由把 `ctx.user.id` 传入，而非只传 storyId。
- `storyShotToDbRow` 输出带 storyId；`replaceDirectorShotsForStory(storyId, userId, rows)` 只替换该故事的 `director_note` 镜头（**保留现有 intentType 过滤，否则会误删非导演镜头**），不动同 project 其他故事的镜头（R4/AE2 核心）。
- creation 聊天 + inpaint 两端点都不再调 `getLatestStoryForProject`，改用传入 storyId，并第一步 `getStoryById(storyId, ctx.user.id)`（null 即拒绝）——既验归属又顺带拿 artDirection/referenceImages（参照 `routers.ts:1424` generateForMobile 现有模式，零额外成本）。
- 剧本合成端点（synthesizeShotList 那条）入参原本只有 projectId，需补 storyId 字段，否则 `storyShotToDbRow` 拿不到 storyId 写入会是 undefined。

**Patterns to follow:**
- `routers.ts:1424` generateForMobile 的 `getStoryById(storyId, ctx.user.id)` 归属校验模式。
- 现有 `replaceDirectorShotsForProject` 的 `intentType==="director_note"` 过滤 + userId 条件（db.ts 的 memory 分支与 MySQL 分支），缩作用域到 storyId 时原样保留。

**Test scenarios:**
- Covers AE2. Integration: project 含故事 X、Y；对 X 写入镜头集合，再查 Y → 不含 X 的镜头；查 X → 含。
- Happy path: `getStoryShots(storyId, userId)` 只返回该故事该用户的镜头。
- Error path: storyId 属于他人 → `getStoryShots` 返回空、creation/inpaint 端点 `getStoryById` 返回 null 即拒绝，不泄漏他人镜头/不向他人故事写入。
- Edge case: 对故事 X `replace` 两次 → X 的 director_note 镜头被新集合替换，X 的非 director_note 镜头与 Y 的镜头都不受影响。
- Edge case: 剧本合成带 storyId → 写入镜头的 storyId 非 undefined。

**Verification:**
- 写入故事 X 不污染同 project 故事 Y；跨用户取/写被拒；`intentType` 非 director_note 的镜头不被误删；剧本合成写入带正确 storyId。

---

### U4. "当前故事"提升为跨页共享状态

**Goal:** 把 `activeStoryId` 从 StoryAgentContext 私有提升到 `useProjectData` 同层，成为 Story 页与 Creation 页共享的单一真相源，并持久化。

**Requirements:** R1

**Dependencies:** None（与 U1–U3 并行，但 U5 依赖它）

**Files:**
- Modify: `client/src/features/analysis/hooks/useProjectData.ts`（新增 `activeStoryId` + setter + 持久化，仿 `currentProjectId`）
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（改为消费共享当前故事，而非自持 state）
- Modify: `client/src/features/storyAgent/storyAgentPersistence.ts`（若 activeStoryId 持久化迁出，调整对应读写）

**Approach:**
- 单一真相源放 `useProjectData`（已管 currentProjectId + localStorage）。**持久化按 project 维度分槽**（key 形如 `dt:activeStoryId:{projectId}`）——评审指出现有 `storyAgentPersistence` 就是 per-project hydrate，若改全局单 key 会"切到另一项目仍显示上一个项目的故事"。同时**键含或随 userId 清除**：同浏览器换账户（登出/登入）必须重置 activeStoryId，避免后一用户加载前一用户的 storyId。
- StoryAgentContext 现有 `setActiveStoryId`/`loadStory`/hydrate effect/delete handler/newStory handler 等**全部读写点**改为指向共享源；保持其对外 API 不变以减少波及面，但需逐一核对（评审提示这里有 7+ 处读写，遗漏会造成共享源与 context 内部不同步）。
- 从 `storyAgentPersistence.ts` 移除 `activeStoryId` 字段，避免两处持久化并存。
- **删除当前故事时**：若被删 story 正是 activeStoryId，必须把共享源置空（而非只清 StoryAgentContext 旧 state）——评审发现悬空 storyId 会让 U5 的 query 去查已删故事而非落空状态。

**Patterns to follow:**
- `useProjectData` 里 `currentProjectId` 的 useState + localStorage 持久化 + reload 范式。

**Test scenarios:**
- Happy path: 设置当前故事 → Story 侧与读取共享源处拿到同一 id。
- Edge case: 切换 project → 读到对应 project 分槽的 activeStoryId（不串项目）。
- Edge case: 刷新页面 → 之前显式打开的当前故事被恢复（沿用现有 hydrate 语义）。
- Edge case: Story 页新建故事（setActiveStoryId(-1)→真 id）/删除当前故事（→null）→ 共享源同步更新。
- Edge case: 用户 A 登出、用户 B 登入 → activeStoryId 重置为 null（不加载 A 的故事）。

**Verification:**
- Story 侧与 Creation 侧读到的当前故事恒为同一值；切 project / 刷新 / 新建 / 删除 / 换账户行为均可预期，无悬空 storyId。

---

### U5. Creation 页接当前故事 + 空状态

**Goal:** Shot Production Table 与 creation 聊天改为读"当前故事"；无当前故事时一致空状态。

**Requirements:** R2, R5（F1, AE1, AE3）

**Dependencies:** U3, U4

**Files:**
- Modify: `client/src/features/analysis/hooks/useProjectData.ts`（`shotsQuery` 改按 `activeStoryId` 触发与过滤）
- Modify: `client/src/pages/CreationPage.tsx`（把当前故事透传给 ShotTable 与 CreationAgentProvider；**两处 `utils.shot.list.invalidate({ projectId })` 改按 storyId**——评审发现的失效点）
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`（chat 请求带当前 storyId）
- Modify: `client/src/features/analysis/views/ShotTable.tsx`（无当前故事时空状态）
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（`utils.shot.list.invalidate` 改按 storyId）
- Modify: `client/src/features/analysis/hooks/useAnalysisOrchestration.ts`（`utils.shot.list.invalidate` 改按 storyId）

**Approach:**
- `shotsQuery` 的 `enabled` 强化为 **`activeStoryId != null` 且该 story 存在于当前 project 的故事列表**（让指向已删故事的悬空 id 也落到空状态），入参 `{ storyId: activeStoryId }`。
- **一次性把全部 `shot.list` 的 query 与 invalidate 调用统一改为 storyId 键**——评审三方一致发现：query 改 storyId 但 invalidate 仍按 projectId，键不匹配会导致剧本合成/改镜头后表不刷新。已知失效点：`CreationPage.tsx`（两处）、`StoryAgentContext.tsx`、`useAnalysisOrchestration.ts`。开工前先全量 grep `shot.list` 的 query 与 invalidate 两类用法确认无遗漏（含确认 `client/src/archive/` 下是否仍有活引用）。
- 无当前故事：ShotTable 显示"请先选择/打开一个故事"，creation 聊天不擅自加载某故事（R5/AE3）。

**Patterns to follow:**
- `useProjectData` 里 `refsQuery`/`shotsQuery` 的 `enabled: currentProjectId !== null` 条件查询范式。

**Test scenarios:**
- Covers AE1. Integration: 打开故事 X 后进 Creation 页 → 表与聊天都是 X。
- Covers AE3. Edge case: 无当前故事 → 表显示空状态，聊天不加载任意故事镜头。
- Covers AE3. Edge case: activeStoryId 指向已删故事（悬空）→ 落空状态，不查已删故事。
- Happy path: 切换当前故事 → 表镜头随之切换。
- Integration: 在 X 下改/合成镜头后 → 镜头表刷新显示新镜头（验证 invalidate 键已对齐 storyId，不出现"改完不刷新"）。

**Verification:**
- 三界面对同一当前故事一致；空状态不串故事；悬空 storyId 落空状态；改/合成镜头后表正确刷新（invalidate 全部对齐 storyId）。

---

### U6. 审计并清理 getLatestStoryForProject 调用方

**Goal:** 排查 `getLatestStoryForProject` 的全部调用方，确认 Creation 路径已不依赖它，决定保留（其他合法用途）或删除。

**Requirements:** R2

**Dependencies:** U3

**Files:**
- Modify: `server/routers.ts` / `server/db.ts`（按审计结果清理无用调用）

**Approach:**
- 全仓库 grep 调用方。**评审已确认 server 有两处**：creation 聊天端点（约 1810 行，U3 已改）与 **inpaint 端点（约 1896 行，取 storyArtRecipe/referenceImages，U3 已纳入改为按 storyId）**。U6 以"grep 计数归零/仅剩合法用途"为准，不依赖记忆中的单一行号。
- 两处都迁走后，若 `getLatestStoryForProject` 无其他调用方则删函数，否则保留并加注释说明其合法用途。

**Test scenarios:**
- Test expectation: none —— 审计/清理单元；正确性由 U3/U5 的集成测试与全量回归保证。

**Verification:**
- `getLatestStoryForProject` 不再出现在任何"当前故事来源"路径（creation 聊天 + inpaint 两处都迁走）；grep 计数归零或仅剩注明的合法用途；全量测试绿。

---

## System-Wide Impact

- **Interaction graph:** 触及 storyId 故事来源的 server 端点共三处——剧本合成（~1148）、creation 聊天（~1810）、inpaint（~1896），三处都要接 storyId 并验归属。
- **真相源收敛:** 镜头权威源从"projectId 的 shots 表 + body.shots 两份"收敛为"storyId 的 shots 表一份"；body.shots 仅在回填时作"应有几条"的参照，之后不再作 Creation 侧来源（见 Key Technical Decisions）。
- **图片关联未收敛（已知缺口）:** `generated_images` 仍按 `projectId + shotNo` 关联（`getImagesByShotNo`），同 project 多故事同 shotNo（如都有 SH01）会串图，AE2 在图片层不成立。本次不动图片关联键，记入 Scope Boundaries → Deferred；需要时单独跟进。
- **State lifecycle risks:** 当前故事是新共享 state，切 project / 刷新 / 删当前故事 / 换账户都需正确重置（U4 已逐项覆盖）；删当前故事必须置空共享源，否则 U5 的 query 会查已删故事。
- **API surface parity:** `shot.list` 的 query 与 invalidate 两类用法**一次性全改 storyId**，不留兼容期；已知触点见 U5 Files。
- **数据所有权:** 所有 storyId 镜头查询/写入带 userId；端点接 storyId 先 `getStoryById(storyId,userId)` 验归属——防"猜 storyId 取/写他人镜头"。
- **Unchanged invariants:** `stories.body` 字段结构、卡片/剧本存储位置、goal 注入、Story 页自身取数逻辑均不变（但 body.shots 的"消费方"语义改变——见真相源收敛）。
- **Integration coverage:** "写 X 不污染 Y" 仅靠单测 mock 证明不了，U3 必须有真实双故事的集成测试。

---

## Risks & Dependencies

| 风险 | 缓解 |
|------|------|
| 回填把镜头归错故事（编号不兼容、空壳故事吸走镜头） | 改用"body.shots 数量最接近 + 时间兜底"，**不用 shotNo 精确匹配**；dry-run 逐条列候选+理由交用户核对；歧义项标注需裁决不自动写；写前备份可回退（U2） |
| 同名同数量故事无唯一解（如 project 5 的 story 14/15） | dry-run 标注"歧义、需用户裁决"，由用户二选一，不替用户做不可逆决定 |
| `shot.list` query/invalidate 键不一致 → 改完不刷新 | 一次性全改 storyId，不留兼容期；U5 列出已知 4 处触点 + 开工前全量 grep（含 archive） |
| 跨用户取/写他人镜头（storyId 无 userId 过滤） | `getStoryShots`/`replace` 带 userId；端点先 `getStoryById(storyId,userId)` 验归属（U3） |
| `replaceDirectorShotsForStory` 误删非导演镜头 | 保留现有 `intentType==="director_note"` 过滤（U3 明确） |
| shots 表与 body.shots 两份镜头打架 | 定 shots 表为权威源，body.shots 不再作 Creation 来源；回填只读不反写（Key Technical Decisions） |
| U4 提升波及 StoryAgentContext 7+ 处读写 | 保持对外 API 不变只换真相源；逐处核对；分 U4 独立落地先验证；删当前故事必置空共享源 |
| 回填(U2)与代码上线(U3)的时序 | dev：先备份→dry-run→确认→写入→API 验证再测 U5；prod：加列(U1)上线后、回填(U2)完成前，未回填镜头 storyId=null 走空状态（不崩、不串） |
| prod 数据分布未知 | prod 腿独立 dry-run，不假设 dev 验证过即安全 |

---

## Documentation / Operational Notes

- 重构落地后更新 `docs/environment-guide.md` 或新增一条 docs/solutions：说明"故事是唯一单位、镜头按 storyId"的新模型，避免未来 AI 会话退回 projectId 思路。
- 迁移在用户真实数据上跑，遵循备份→dry-run→确认→写入→API 验证的顺序。

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-13-story-as-single-unit-requirements.md](../brainstorms/2026-06-13-story-as-single-unit-requirements.md)
- 相关代码：`drizzle/schema.ts`、`server/db.ts`（getLatestStoryForProject / replaceDirectorShotsForProject）、`server/routers.ts`（shot.list / creation 聊天端点）、`client/src/features/analysis/hooks/useProjectData.ts`、`client/src/features/storyAgent/StoryAgentContext.tsx`、`client/src/pages/CreationPage.tsx`
- 相关学习：`docs/solutions/2026-06-13-多worktree环境数据分裂收敛.md`（数据迁移纪律）
