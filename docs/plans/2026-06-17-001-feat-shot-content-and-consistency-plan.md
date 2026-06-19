---
title: "feat: 出图内容正确性 + 跨镜头一致性（两阶段 + 前置 spike）"
type: feat
status: active
date: 2026-06-17
deepened: 2026-06-17
origin: docs/brainstorms/shot-content-and-consistency-requirements.md
---

# feat: 出图内容正确性 + 跨镜头一致性（两阶段 + 前置 spike）

## Summary

先用一个**前置 spike** 验证 MJ `--cref/--sref` 在本账号是否真能跨镜头锁定（此前从未验证成功），spike 结论决定后续锚点逻辑形状。然后分两阶段：**阶段一**新增服务端结构化画面分析内核，让出图内容由对话语境驱动、出图前对话确认（不需要固定人物时默认空镜）；**阶段二**接通跨镜头一致性——把 cref/sref 注入抽成**两条出图路径共用**的 helper、新增**服务端锚点持久化**、对话设锚点与照片重绘成锚点。全程对话驱动、不加按钮。

> **本版为 ce-doc-review 深度评审后的修订版**（2026-06-17）。评审发现两个 P0 架构错误并已修正：①agent 出图路径绕过 generateForMobile，cref/sref 注入碰不到它；②服务端不存在写 `role:'character'` 锚点的路径。详见各单元与 Key Technical Decisions。

---

## Problem Frame

出图内容不结合聊天语境（图好看但不是用户要的），且跨镜头人物/画风对不上、每次重渲。内容正确性比一致性更底层（一致的错图=零价值），故先内容、后一致，二者共享分析内核。背景见 origin：`docs/brainstorms/shot-content-and-consistency-requirements.md`。

**评审暴露的关键现实**：出图有**两条独立代码路径**——(a) `generateForMobile`（tRPC，剪辑器 rerender / DrawThisMomentPanel / mobileChat 直调，已含 cref 注入）；(b) `creationAgent` 的 `generateImage` 工具（直调 `editImage/generateImage`，只传 `{provider}`，**完全不经过 generateForMobile**）。原计划假设"两条线都走 generateForMobile"是错的。本版以一个共享注入 helper 统一两条路径。

---

## Requirements

- R1. 出图前对最近对话 + 选中卡片做结构化画面分析，得出该呈现什么（主体、是否人物、是否反复出镜角色、动作、情绪、关键元素、是否需要人物锚点、分析置信度）。
- R2. 分析结果在出图前以**对话形式**向用户确认（含"要不要画人"这个决策本身），用户可纠偏；确认后才出图。不新增 UI 按钮。
- R3. 不需要固定人物时镜头默认画无人/空镜，不凭空造脸；空镜是经用户确认的明确决策，不与"出图失败"混淆。
- R4. 跨镜头人物一致（`--cref`）：对话设 `role:'character'` 锚点，**两条出图路径都注入**。
- R5. 跨镜头画风一致（`--sref`）：人物镜头用锚点同图做 `--sref`；空镜镜头不注入 `--sref`（画风靠提示词文本），避免肖像构图污染场景。
- R6. 用户对话里给人物照片时，结合画风重绘成风格化人物图，确认后持久化为锚点；设为锚点的是风格化图，且必须确认重绘真用了照片（非静默文生图回落）。
- R7. 真出图验证 `--cref/--sref` 确实锁定（前置 spike）；v6 不行则切 v7 `--oref/--ow`。

**Origin actors:** 用户（讲素材、确认画面、给人物照）、Agent（分析、确认、出图、设锚点）。

---

## Scope Boundaries

- 不新增 UI 按钮；确认/设锚点走对话。照片上传**复用现有 img2img 上传入口**（见 U5），不算新按钮。
- 不重造 imageGen 的 `--cref/--sref` 注入语义（**例外**：spike 若判定需切 v7，允许改 `--cref→--oref`，见 U1 与 Codex 契约）。
- 多角色管理（一个故事多个固定人物）不在本次，先按单主角。
- 手部解剖等 MJ 固有质量问题不在本次。

### Deferred to Follow-Up Work

- **图片 → 视频（图+提示词）**：已有框架，单独 brainstorm/plan。本计划完成只是让图"够格当视频输入"。
- **真人照片完整隐私/合规审查**：本次仅落最小数据最小化护栏（见 U8），完整合规评审单独进行。

---

## Context & Research

### Relevant Code and Patterns

- `server/routers.ts:1508-1661` `generateForMobile`：出图主入口之一。已注入 `--cref/--cw`（`:1574-1576,:1623-1632`）；`styleHint` 仅文本拼接（`:1561-1563`），**未**走 `--sref`。
- `server/services/creationAgent.ts`：第二条出图路径。`replyFromCreationAgent`→`generateNextImage` 直调 `editImage/generateImage`，仅传 `{provider}`（`:384-395`），**无 cref/sref/锚点派生**。工具：`generateImage`/`buildShotList`/`reviseImage` 等（`:59-101`），靠 `buildSystemPrompt`（`:143`）驱动；`buildShotList` 自动铺镜头表（`:199`，无"非必要不画人"克制）。
- `server/services/imageGen.ts`：`GenerationOptions` 含 `characterRef`/`styleRef`（`:46-48`）；`buildPrompt` 注入 `--cref`（`:278`）/`--sref`（`:285-287`）；`editImage`/`generateImage` 已透传二者（`:939-940`）。**注入管道就绪**。注意 `editImage` MJ 图生图失败会**静默回落纯文生图**（`:856-868`）——重绘照片场景必须防。
- `shared/artDirection.ts`：`characterReferenceOf`（`:262`）、`ArtReferenceRole="character"`（`:5`）、`normalizeStoryArtDirection`（`:219`）。
- `client/.../StoryAgentContext.tsx` `setCharacterReferenceByUrl`（约 `:2040`）：**纯客户端 React state**，仅经整故事 body upsert 落库——**服务端无写 `role:'character'` 的路径**（评审 P0-2 的依据）。
- `server/archive/storyReply.ts:290` `deriveMobileImagePrompt`：当前对话→prompt 现编；受 `ENV.forgeApiKey` 闸控（无 key 返回空串）。
- `client/src/features/creationEditor/CreationEditorContext.tsx:219,309-320`（rerender 直调 generateForMobile）、`client/src/features/storyAgent/views/DrawThisMomentPanel.tsx:99-171`（按钮直调 generateForMobile，非对话式分层架构）。
- `server/services/imageGen.ts:353` `storagePut('character-refs/...')`：公网桶，无 ACL/过期；`toPublicImageUrl` 经此拿公网 URL（cref/sref 必需）。

### Institutional Learnings

- `docs/plans/2026-06-15-002-feat-story-visual-identity-plan.md`：上版一致性；v6 `--cref` / v7 `--oref` 遗留待真出图确认（R7）。
- 偏好：对话驱动不加按钮；先诊断根因再动手、不反复打补丁。

---

## Key Technical Decisions

- **【拍板】两条出图路径共用一个注入 helper**：把"取锚点 → `toPublicImageUrl` → 决定 cref/sref（空镜跳过 sref）"抽成共享函数，`generateForMobile` 与 `creationAgent.generateNextImage` 都调用。Rationale：评审 P0-1——agent 路径不经 generateForMobile，不接入则 agent 生成的镜头毫无一致性。
- **【拍板】空镜镜头不注入 `--sref`**：人物镜头用锚点同图做 cref+sref；`needsCharacterAnchor=false` 的空镜/远景不加 sref，画风靠提示词文本。Rationale：评审发现人物肖像当画风参照会把场景也拉成肖像构图，与"该空镜时空镜"打架。
- **【拍板】spike 若需切 v7，预先解禁 imageGen `--cref→--oref`**：仅此一处解除全局禁碰。Rationale：这是 origin 已记的遗留内备选。
- **新增服务端锚点持久化**：服务端 mutation 读 `story.body`→`normalizeStoryArtDirection`→**替换**（非堆叠）`role:'character'`→写回，并处理与客户端整体 body upsert 的并发覆盖。Rationale：评审 P0-2——既有"复用路径"不存在。
- **分析内核服务端共享函数**：供两条路径复用。
- **照片锚点存风格化图**：原照仅作重绘输入，且必须确认 img2img 真生效（防 MJ 静默文生图回落把无关图设成锚点）。

---

## High-Level Technical Design

> 方向性说明，非实现规范。

**阶段间接口契约（`shared/sceneAnalysis.ts`，ce-plan 钉死，实现不得擅改驱动字段）：**

```ts
type SceneAnalysis = {
  subjectDescription: string;
  isPerson: boolean;
  recurringCharacter: { key: string; name?: string } | null;
  action: string;
  emotion: string;
  keyElements: string[];
  needsCharacterAnchor: boolean;   // 阶段二唯一消费的驱动字段
  confidence: 0 | 25 | 50 | 75 | 100; // 低置信强制走确认
};
```

**共享注入 helper 契约（两条路径共用）：**

```ts
// 输入 story + sceneAnalysis，输出注入参数；空镜不给 styleRef
deriveInjection(story, analysis?): { characterRef?: string; characterWeight?: number; styleRef?: string }
```

**数据流：**

```
[U1 spike] 手动喂公网图 → 验 --cref/--sref 是否锁 → 决定 v6/v7 ──(gates)──▶ 后续单元

对话/卡片 ─▶ [U2] analyzeScene ─▶ SceneAnalysis ─▶ [U5] 对话复述确认(含"要不要画人")
                                                          │ 确认
                          [U4] composePrompt(分析) ──┬─ needsCharacterAnchor=false ▶ 空镜 prompt, 无 --sref
                                                     └─ true ▶ [U7]设锚点/[U8]照片重绘 ─▶ role:'character'
        两条出图路径(generateForMobile / agent generateNextImage)
              └─▶ [U3] deriveInjection ─▶ --cref + (人物镜头)--sref
```

---

## Codex 执行契约（贯穿，仅本计划）

交 Codex 执行。**U1 spike 为门，先行**；阶段一先于阶段二；每单元独立交付，自带白名单 / 禁碰 / 接口契约 / 验证判据。`git diff --stat` 应只命中各单元白名单；`pnpm typecheck` 与相关测试通过。

**全局禁碰**：`shared/artDirection.ts` 的 `characterReferenceOf`；`imageGen.ts` 的 `buildPrompt`/注入内部逻辑——**唯一例外**：U1 spike 判定需切 v7 时，允许把 `--cref/--cw` 改为 `--oref/--ow`（仅此改动，需在该单元说明）。

---

## Implementation Units

### U1. 前置 spike：真出图验证 `--cref/--sref`（门，无产品代码）

**Goal:** 在投入阶段二工程量前，证实 MJ 锚点参照是否真能跨镜头锁定，决定 v6/v7。

**Requirements:** R7

**Dependencies:** None（用 imageGen 既有 `characterRef`/`styleRef` 入参手动喂图即可，代码已就绪）

**Files:** 无产品代码改动；结论记入本计划或新 `docs/solutions/` 学习。

**Approach（主仓库 3000 端口，AGENTS.md 铁律）：**
1. 取一张现成公网人物图当锚点，手动调 imageGen 用 `characterRef`+`styleRef` 连出 2~3 个不同镜头。
2. 判定（给可复现的判据，而非纯"好看"）：**人物**——三张里同一张脸的身份可辨识为同一人（五官/发型/服装一致）；**画风**——色调/线条/质感一致。
3. v6 `--cref` 达不到 → 改 `--cref/--cw`→`--oref/--ow`（**本单元唯一解禁 imageGen 的地方**）重验。
4. 记录结论（v6 是否够用、是否切 v7），作为 U3/U7/U8 锚点逻辑的输入。

**Execution note:** 会烧 302 额度，每锚点 2~3 张足够。属执行期验证。

**Test expectation:** none —— 验证型，结论以判据 + 记录为准。

**Verification:** 产出一组同锚点跨镜头图并按上述判据给出"锁定成功/需切 v7"的明确结论。

---

### U2. SceneAnalysis 类型 + 结构化画面分析服务

**Goal:** 定义共享类型，新增服务端 `analyzeScene` 从对话+卡片+故事产出结构化 `SceneAnalysis`（含置信度）。

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Create: `shared/sceneAnalysis.ts`、`server/services/sceneAnalysis.ts`、`server/services/sceneAnalysis.test.ts`

**Approach:**
- `analyzeScene({history, cardHint, story})` → `SceneAnalysis`，强约束结构化输出。
- `needsCharacterAnchor` 仅当主体是反复出镜的具体人物时 true；环境/物件/空镜/一次性路人为 false。
- `confidence` 反映分类把握，低置信由 U5 强制走确认。

**禁止触碰:** `deriveMobileImagePrompt`（U4）、imageGen、artDirection。

**Patterns to follow:** `creationAgent.ts` 的 LLM 结构化输出约束；现有 `*.test.ts`。

**Test scenarios:**
- Happy：明确反复出镜人物 → `isPerson=true`、`recurringCharacter`非空、`needsCharacterAnchor=true`。
- Happy：纯环境/物件 → `isPerson=false`、`needsCharacterAnchor=false`。
- Edge：一次性路人 → `needsCharacterAnchor=false`。
- Edge：`history` 空但有 `cardHint` → 从 cardHint 产出主体。
- Edge：分类边界模糊 → 给出较低 `confidence`（驱动 U5 强制确认）。
- Error：LLM 返回不合 schema → 降级/抛明确错误，不返回半成品。

**Verification:** 测试全绿；返回符合 `SceneAnalysis` 且置信度合理。

---

### U3. 共享 cref/sref 注入 helper（接通两条出图路径）

**Goal:** 把锚点派生 + cref/sref 决策抽成共享函数，`generateForMobile` 与 `creationAgent.generateNextImage` 都用；空镜不注入 `--sref`。

**Requirements:** R4, R5

**Dependencies:** U1（v6/v7 结论）、U2（读 `needsCharacterAnchor` 决定是否 sref）

**Files:**
- Create: `server/services/imageInjection.ts`（`deriveInjection`）、`server/services/imageInjection.test.ts`
- Modify: `server/routers.ts`（`generateForMobile` 改用 `deriveInjection`）
- Modify: `server/services/creationAgent.ts`（`generateNextImage` 改用 `deriveInjection`，给 editImage/generateImage 传 cref/sref）

**Approach:**
- `deriveInjection(story, analysis?)`：`characterReferenceOf`→`toPublicImageUrl` 得 characterRef + characterWeight；人物镜头 `styleRef=characterRef`，`needsCharacterAnchor=false` 的空镜 `styleRef=undefined`。
- 两个调用点替换为该 helper；保持 `generateForMobile` 现有 characterRef 行为等价（回归）。
- 仅公网 URL 生效（imageGen 内部已守卫）。

**接口契约:** `deriveInjection(story, analysis?): { characterRef?, characterWeight?, styleRef? }`。

**禁止触碰:** imageGen 注入内部（除 U1 解禁项）；`characterReferenceOf`。

**Patterns to follow:** `routers.ts:1623-1632` 现有传参；`creationAgent.ts:384-395` 现有 editImage/generateImage 调用点。

**Test scenarios:**
- Happy：有锚点 + 人物镜头 → 返回 characterRef + styleRef（=同图）。
- Happy：有锚点 + 空镜（`needsCharacterAnchor=false`）→ 有 characterRef、**无 styleRef**。
- Edge：无锚点 → 都 undefined。
- Edge：本地 data URI 上传失败 → 安全降级 undefined。
- Integration：generateForMobile 与 agent generateNextImage 两路均经 helper，最终 prompt 带预期 `--cref`/`--sref`。

**Verification:** 测试全绿；两条路径出图都按规则注入；空镜无 `--sref`。

---

### U4. 分析内核接入 prompt 组装 + 默认空镜 + 失败回退

**Goal:** 出图 prompt 由 `SceneAnalysis` 驱动；空镜不放人；分析失败有明确回退。

**Requirements:** R1, R3

**Dependencies:** U2

**Files:**
- Modify: `server/routers.ts`（`generateForMobile` 入参 `sceneAnalysis?`）、`server/services/creationAgent.ts`（buildShotList/generateImage system prompt 加"非必要不画人"克制）
- Create: `server/services/composeScenePrompt.ts`、`server/services/composeScenePrompt.test.ts`

**Approach:**
- 入参新增 `sceneAnalysis?: SceneAnalysis`（zod 化），可选保持向后兼容。
- 传了 → `composePromptFromAnalysis`；未传 → 退回 `deriveMobileImagePrompt`（注意其 `ENV.forgeApiKey` 闸 + archive 位置）。
- **分析尝试但失败/为 null**（区别于"未传"）→ 明确回退到 `deriveMobileImagePrompt` 或报错，不静默出半成品。
- `isPerson=false`/`needsCharacterAnchor=false` → 空镜 prompt，不含人物。
- creationAgent 批量 `buildShotList`：默认不引入固定人物，除非分析判定需要。

**接口契约:** `generateForMobile` 增 `sceneAnalysis?: SceneAnalysis`；`composePromptFromAnalysis(analysis, { styleHint? }): string`。

**禁止触碰:** imageGen；U3 的 helper 内部。

**Test scenarios:**
- Happy：`needsCharacterAnchor=true` → prompt 含人物主体。
- Happy：`isPerson=false` → 空镜 prompt，无人物。
- Edge：未传 sceneAnalysis → 走旧 `deriveMobileImagePrompt`（回归）。
- Error：sceneAnalysis 请求但 analyzeScene 失败 → 走定义好的回退，不出半成品。
- Integration：批量 buildShotList 默认不造固定人物。

**Verification:** 测试全绿；无人物语境不再出现凭空人脸；旧调用行为不变。

---

### U5. 对话驱动确认流程（含"要不要画人" + 照片上传入口 + 按钮关系）

**Goal:** Agent 出图前在对话里复述分析并确认，**显式包含"画人/空镜"决策**；定义照片如何进入对话；定义既有按钮与确认轮关系。

**Requirements:** R2, R3, R6（上传入口）

**Dependencies:** U2, U4

**Files:**
- Modify: `server/services/creationAgent.ts`（新增 `proposeScene` 工具 + system prompt：先确认后出图）、`server/services/creationAgent.test.ts`
- Modify: 承载确认与上传的客户端面（见下"落点决策"）

**Approach:**
- `proposeScene`：携 `SceneAnalysis` 摘要，agent 复述"这一刻打算呈现 X（含**是否画人/空镜**），对吗？"；低 `confidence` 时强制确认；用户明确"直接画"可跳过。
- **落点决策（评审要求先定，不再泛推后）**：确认轮承载在**有对话线的面**（剪辑器 `CreationEditorContext` 对话区、mobileChat）。`DrawThisMomentPanel` 是按钮式非对话面——本次该面按钮行为定义为：**点击 = 触发分析 + proposeScene 确认**（在其关联对话/提示区显示），确认后才出图；不在该面新增按钮。
- **照片上传入口**：复用现有 img2img 上传机制（用户照片做垫图的既有入口，对应 `routers.ts:1515,1578` 的 `originalImageUrl`）——声明为既有入口复用，不算新按钮。若某面无既有上传入口，则该面 U8 照片流不适用，对话引导用户去有入口的面。
- **空镜信号**：空镜决策由 proposeScene 话术明示并经用户确认 → 出来的空镜图有对话溯源，不被误判为失败。

**接口契约:** `proposeScene` tool 形状（携 `SceneAnalysis`）；`generateImage` tool 增 `sceneAnalysis?` 透传。

**Test scenarios:**
- Happy：足够素材的新镜头 → 先 `proposeScene` 而非直接 `generateImage`。
- Happy：确认语 → 触发出图且带 sceneAnalysis。
- Happy：空镜场景 → proposeScene 明示"画空镜不放人"，确认后出空镜。
- Edge：低 confidence → 强制确认（即便用户没要求）。
- Edge：纠偏 → 重新分析再确认。
- Edge：模糊回复（又像确认又像纠偏）→ **按纠偏处理、再确认一次**（出错图比多问一次贵）。
- Edge：用户明确"直接画" → 跳过确认。

**Verification:** 测试覆盖；三个出图面出图前都有一次对话确认（DrawThisMoment 经按钮→确认轮）；无新按钮；照片走既有上传入口。

---

### U6. 服务端锚点持久化 mutation

**Goal:** 提供服务端写 `role:'character'` 锚点的途径（此前不存在）。

**Requirements:** R4

**Dependencies:** None（阶段二基础设施）

**Files:**
- Modify: `server/routers.ts`（新增锚点写入 mutation/函数）、相应 `*.test.ts`

**Approach:**
- 读 `story.body`→`normalizeStoryArtDirection`→**替换**已有 `role:'character'`（不堆叠）→写回。
- 处理与客户端整体 body upsert 的并发：以服务端读-改-写为准，或在 upsert 时合并 references，避免丢更新（实现时按现有持久化并发模型对齐，见 Open Questions）。
- 锚点须公网 URL（本地图经 `toPublicImageUrl`）。
- `protectedProcedure` + `getStoryById(storyId, ctx.user.id)`：只能写自己的 story。

**接口契约:** 锚点写入函数签名 `{ storyId, imageUrl }`（实现与现有持久化对齐）。

**禁止触碰:** `characterReferenceOf`、`normalizeStoryArtDirection` 内部（只调用）。

**Test scenarios:**
- Happy：写锚点 → references 出现一条 `role:'character'`。
- Edge：重复写 → 替换而非堆叠。
- Edge：本地图 → 经 `toPublicImageUrl` 转公网再存。
- Error：写他人 story → 拒绝（鉴权）。
- Integration：写后 `characterReferenceOf` 取到、两路出图注入 `--cref`。

**Verification:** 测试覆盖；写后 `.webdev` 数据出现 `role:"character"`（不再全空），且只在本人 story。

---

### U7. 对话驱动设人物锚点

**Goal:** 用户对话里指定某张满意图作锚点时，agent 经 U6 持久化。

**Requirements:** R4

**Dependencies:** U2（消费 `needsCharacterAnchor`/`recurringCharacter` 决定何时引导）、U6（持久化）

**Files:**
- Modify: `server/services/creationAgent.ts`（新增 `setCharacterAnchor` 工具）、`server/services/creationAgent.test.ts`

**Approach:**
- 分析 `needsCharacterAnchor=true` 且无锚点时，agent 对话引导"把哪张设成这个人物？或有照片吗？"（照片走 U8）。
- `setCharacterAnchor {imageId?|imageUrl?}` → 调 U6 写锚点。
- 单主角：再次设锚点替换前一个（多角色已划出范围）。

**接口契约:** `setCharacterAnchor` tool `{ imageId?: number; imageUrl?: string }`。

**Test scenarios:**
- Happy：setCharacterAnchor → 经 U6 落库一条 character。
- Integration：设锚点后两路出图注入 `--cref`(+人物镜头 `--sref`)。
- Edge：重复设 → 替换。

**Verification:** 测试覆盖；对话设锚点生效。

---

### U8. 用户照片 → 画风重绘 → 设为锚点（防静默文生图回落 + 数据护栏）

**Goal:** 用户给照片时重绘成风格化人物图设为锚点；确保重绘真用了照片；落最小数据护栏。

**Requirements:** R6

**Dependencies:** U6, U7

**Files:**
- Modify: `server/services/creationAgent.ts`（`createCharacterFromPhoto` 工具或扩展 setCharacterAnchor 支持照片源）、`server/routers.ts`（照片重绘逻辑）、相应 `*.test.ts`

**Approach:**
- 复用 `originalImageUrl`→`editImage` + `storyArtRecipe` 画风重绘。
- **防回落**：`editImage` MJ 图生图失败会静默回落纯文生图（`imageGen.ts:856-868`）——必须检测该回落并视为"重绘未用照片"，**不把该图设为锚点**，转而对话告知用户"没能基于照片重绘"。
- 设锚点的是风格化图，原照仅作输入。
- **数据护栏（最小）**：原始真人照不单独推公网 URL（只有风格化锚点图入公网桶）；锚点 URL 与原照字节不写入应用日志；记录"风格化锚点图 + 原照会经 302.ai/MJ 第三方"为已知接受的信任边界。完整合规评审单独进行。

**接口契约:** `createCharacterFromPhoto {photoUrl}` → 风格化图 → 经 U6/U7 落锚点。

**Test scenarios:**
- Happy：photoUrl → 风格化图 → 落 `role:'character'`（锚点 URL≠原照）。
- Error：img2img 回落到纯文生图 → 检测到 → **不设锚点**，对话告知。
- Error：重绘失败 → 明确报错，不误设原照为锚点。
- Integration：照片成锚点后两路出图注入该锚点 `--cref/--sref`。

**Verification:** 测试覆盖；手测上传照片→风格化人物图→后续镜头锁该人物；回落场景不会把无关图设成锚点。

---

## Phased Delivery

### Phase 0（门）：U1 spike
先行。结论（v6 够用 / 切 v7）为后续锚点逻辑输入。**未通过不进阶段二的锚点实现**。

### Phase 1（内容正确性）：U2 → U4 → U5
内容贴合语境、出图前对话确认（含画人/空镜）、空镜不造脸、不加按钮。

### Phase 2（跨镜头一致性）：U3 → U6 → U7 → U8
共享注入接通两路 → 服务端锚点持久化 → 对话设锚点 → 照片重绘成锚点。

---

## System-Wide Impact

- **Interaction graph:** 两条出图路径（generateForMobile / agent generateNextImage）经 U3 统一注入；`sceneAnalysis` 可选保持旧调用兼容。
- **Error propagation:** 分析失败、img2img 回落、上传失败、锚点写入并发——都安全降级或明确告知，绝不把半成品/原始真人照/无关文生图设成锚点。
- **State lifecycle risks:** `role:'character'` 替换非堆叠；服务端锚点写入与客户端整体 body upsert 的并发需防丢更新。
- **API surface parity:** `generateForMobile` 入参变更影响所有调用方（向后兼容）；agent 路径经 U3 获得同等注入。
- **Security/data:** 真人照片→风格化锚点→公网桶 + 302.ai 第三方；最小数据护栏在 U8，完整合规另行。
- **Unchanged invariants:** 不改 `characterReferenceOf`、imageGen 注入内部（除 U1 v7 解禁）；不传 sceneAnalysis 的旧路径不变。

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| v6 `--cref` 实测不锁人物 | U1 前置 spike；预先解禁切 v7 `--oref/--ow` |
| agent 路径漏接一致性 | U3 共享 helper 强制两路统一注入；集成测试覆盖两路 |
| 服务端锚点写入与客户端 upsert 并发丢更新 | U6 读-改-写/合并 references；按现有并发模型对齐 |
| `needsCharacterAnchor` 误分类致该画人却空镜 | U5 确认轮显式暴露"画人/空镜"；低置信强制确认 |
| 肖像锚点当 `--sref` 污染空镜构图 | 空镜不注入 `--sref`（画风靠文本） |
| 照片重绘静默回落文生图 → 无关图成锚点 | U8 检测回落、不设锚点、对话告知 |
| 真人照片公网/第三方暴露 | U8 最小数据护栏；完整合规另行 |
| 确认轮被用户习惯性绕过 | 低置信强制确认；"直接画"仅显式时生效 |
| Codex 超范围/接口对不上 | 每单元白名单+禁碰+接口契约；`git diff --stat`；阶段串行；v7 解禁仅 U1 |

---

## Open Questions

### Resolved During Planning / Review

- 两条出图路径统一：抽 `deriveInjection` 共享 helper（U3）。
- 服务端锚点持久化：新增 mutation（U6），替换非堆叠。
- 画风锁取图：沿用人物锚点，空镜不注入 `--sref`。
- v7 解禁：spike 需要时仅 U1 处解禁 imageGen `--cref→--oref`。
- 确认落点：对话面承载；DrawThisMoment 按钮 = 触发分析+确认轮。
- 照片上传：复用既有 img2img 上传入口。
- 空镜 vs 失败：由 proposeScene 话术明示并确认。

### Deferred to Implementation

- `analyzeScene` 的具体 LLM 调用形态（模型/prompt/结构化约束）——对齐 creationAgent 现有用法。
- U6 锚点写入与客户端整体 body upsert 的确切并发合并策略——按现有持久化模型实现时定。
- 确认默认每次 vs 仅低置信——默认低置信强制 + 每次轻确认，阈值真用后调。
- U8 重绘后"既像真人又像画风"的 likeness 漂移程度——实测后调画风强度。

---

## Sources & References

- **Origin:** `docs/brainstorms/shot-content-and-consistency-requirements.md`
- 上版一致性（v6/v7 遗留）：`docs/plans/2026-06-15-002-feat-story-visual-identity-plan.md`
- 关键代码：`server/routers.ts`、`server/services/creationAgent.ts`、`server/services/imageGen.ts`、`server/archive/storyReply.ts`、`shared/artDirection.ts`、`client/.../StoryAgentContext.tsx`
- 环境铁律：`AGENTS.md`（主仓库 3000 端口跑/验证）
