---
title: "feat: 故事视觉基调（Story Visual Identity）—— 跨镜头一致 + 忠于真实素材"
type: feat
status: active
date: 2026-06-15
---

# feat: 故事视觉基调（Story Visual Identity）

## Summary

让「把这一刻画出来」的每个镜头都继承一套**故事级视觉基调**（锁定的画风配方 + 主角参照 + 真实素材），实现跨镜头一致（同画风/色调/主角长相）且忠于用户上传的真实照片。核心做法是**打通并强化已有的 `artDirection` 机制**，而非新建系统——前面几轮在前端各镜头独立塞 prompt 的临时代码恰是不连贯的根源，本计划将其清理并重接到故事级基调上。

---

## Problem Frame

当前「把这一刻画出来」逐镜头**独立生成**：每个镜头各自现编 prompt、各自取照片或延续上一张。结果是跨镜头不连贯（人物长相、画风、场景每张都在变），且生成的是理想化 AI 糖水图、脱离用户上传的真实素材照片。

用户已确认核心诉求是**双重连贯**：① 跨镜头统一（同主角、同画风、同世界观）② 忠于真实素材；理想用法是**先锁一套整体基调，之后所有镜头继承**。用户进一步确认一致性要**一步到位连主角长相**。

关键调研发现（见 Context & Research）：故事系统**已有**一套美术基调机制 `story.body.artDirection`（可锁定的 `recipe` 画风配方 + 带 `purpose:'fact'` 语义的参考图），`generateForMobile` 也已在消费它——但「把这一刻画出来」的前端在前面几轮被改成绕过这套机制、各镜头自走一套，这正是不连贯的根因。

---

## Requirements

- R1. 同一故事的所有镜头共享统一画风（style/palette/light/composition/material/negative）。
- R2. 同一故事的所有镜头保持**同一主角长相一致**（用户已选"一步到位"）。
- R3. 生成图忠于用户上传的真实素材照片（保留具体物件与生活化质感，不变成理想化 AI 图）。
- R4. 用户能先锁定一套"故事视觉基调"（画风 + 主角参照 + 素材），之后所有镜头自动继承。
- R5. 「把这一刻画出来」消费故事级基调，不再每镜头在前端独立绕路。
- R6. 清理前面几轮引入的、与故事级基调脱节的临时机制（美术参考库多维匹配 / 维度表 / 艺术增强词 / 前端独立 styleHint）。

---

## Scope Boundaries

- **不改数据库 schema**：基调存 `story.body` JSON（沿用现有 `artDirection` 存储方式）。
- **不重做 artDirection 锁定流程的 UX**：复用现有 `StoryArtDirectionStudio`，只在其上补"主角参照"语义。
- **速度不是本次重点**：主角一致性走 MJ 慢轨（图生图/角色参考，~1分钟）是已知代价。
- **不做偏好/反馈学习库**：满意/不满意训练库是更早 brainstorm 的另一条线，本次不含。

### Deferred to Follow-Up Work

- 主角参照的"自动识别"（从素材里自动判断哪张是主角）：本次用户手动标记，自动识别后续迭代。
- 草稿快轨（flux-schnell）的基调继承优化：本次主角一致优先走 MJ 慢轨，草稿轨一致性后续再调。

---

## Context & Research

### Relevant Code and Patterns

- **`shared/artDirection.ts`** —— 故事级美术基调的数据模型已存在：
  - `StoryArtDirection`：`phase`（含 `'locked'`）、`references: ArtReferenceMaterial[]`、`recipe?: StoryArtRecipe`、`recipeVersions`。
  - `ArtRecipeDNA`：`{ style, palette, light, composition, material, negative }` —— 结构化画风配方。
  - `ArtReferenceMaterial`：`{ imageUrl, purpose: 'fact'|'aesthetic'|'both', visualStyle, colorPalette, lighting, composition, material, ... }` —— `purpose:'fact'` 即"忠于真实素材"的载体。
  - `normalizeStoryArtDirection` / `defaultArtRecipe` / `artRecipePrompt(recipe)` —— 归一化与 prompt 拼装。
- **`server/routers.ts`** —— `storyArtRecipe(story)`（读 locked recipe）、`storyArtReferenceImages(story)`（收集 fact 参考图 + visualCanvasItems，去重取前4）；`generateForMobile`（行 ~1465）已把 `artDirection` + `referenceImages` 传给 `renderViaGate`。注意：**草稿轨 `generateDraftImage` 是纯文生图、不吃 referenceImages**，只有慢轨 `editMobileImage` 用垫图。
- **`server/archive/storyReply.ts`** —— `deriveMobileImagePrompt({ history, cardHint })` 现编英文 prompt；本计划已加的 `cardHint`/`styleHint` 入参（`server/routers.ts` generateForMobile schema）要重新定位为"基调消费"的一部分。
- **`server/services/imageGen.ts`** —— `editImage`（图生图，MJ `base64Array` 垫图 image prompt）、`midjourneyPromptFor`（拼 `--ar/--draft/--v/--quality/--turbo`，**无 `--cref/--sref/--oref`**）、`generate302MidjourneyImage`（`/mj/submit/imagine`，`base64Array` 传 base64 垫图）、`readImageInput`（已加"本地 `/api/images` 资产直读"分支 —— **保留**）。
- **`server/storage.ts`** —— `storagePut` 上传到 `BUILT_IN_FORGE_API_URL`（302.ai，本地 `.env` 已配）并返回托管 `url`；故用户照片大概率是 **302 托管 URL**（公网可达概率高），失败才回退 data URI base64。
- **`client/src/features/storyAgent/views/DrawThisMomentPanel.tsx`** —— 「把这一刻画出来」入口；前面几轮的前端临时逻辑（独立 styleHint / 随机艺术增强 / 前端图生图绕路）在此，需重写为消费故事级基调。
- **`client/src/features/storyAgent/views/StoryArtDirectionStudio.tsx`** —— 现有"锁定 artDirection"流程入口（`phase: empty→references→…→locked`），是"先锁基调"的天然落点。

### Institutional Learnings

- `AGENTS.md`：本地数据走 `process.cwd()` 下的 `.webdev/local-persist.json`，**只在主仓库跑 dev server**，不在 worktree 起服务，避免数据分裂。本计划改动需在主仓库 3000 端口验证。

### External References

- Midjourney 角色一致性参数随版本演进：v6 用 `--cref <url>`（character reference）+ `--cw` 权重；v7 改为 `--oref <url>`（omni reference）+ `--ow`；`--sref <url>` 为风格参考。**均要求图片是公网可访问 URL**（MJ 服务端去拉）。302.ai 网关是否透传这些参数、用何版本，需 U1 spike 实测确认。

---

## Key Technical Decisions

- **复用强化 `artDirection`，不新建"视觉基调系统"**：基调 = locked `recipe`（画风）+ 标记为"主角"的 `fact` 参考 + 其余 `fact` 素材。理由：骨架已存在、`generateForMobile` 已消费、存 `story.body` 不改 schema，复杂度与风险最低。
- **主角长相一致走 MJ 角色参考（`--cref`/`--oref`），带垫图降级**：首选角色参考（构图自由、只锁长相）；若 U1 spike 证明 302 不透传该参数、或照片非公网 URL，则**降级为统一主角照片做 `base64Array` 垫图**（能锁长相但会牵制构图），并在 plan 执行中记录降级。理由：用户要"一步到位连主角长相"，但可行性未验证，必须先 spike 再定路径。
- **基调存 `story.body.artDirection`，扩展而非替换**：在 `ArtReferenceMaterial` 增加"主角参照"标记（如 `role: 'character'` 或复用 `purpose` 扩展值），`normalizeStoryArtDirection` 向后兼容旧数据。
- **前端回归"消费"而非"自造"**：`DrawThisMomentPanel` 不再前端独立拼 styleHint/艺术增强；改为读取故事级基调，把镜头内容（`cardHint`）+ 基调一起交给后端统一拼 prompt。

---

## Open Questions

### Resolved During Planning

- **新建 vs 复用基调体系**：复用强化已有 `artDirection`（见 Key Technical Decisions）。
- **基调存哪**：`story.body.artDirection`，不改 schema。
- **一致性范围**：用户确认"一步到位连主角长相"。

### Deferred to Implementation

- **302 MJ 到底支持哪个角色参考参数（`--cref`/`--oref`/`--sref`）、用何 MJ 版本**：U1 spike 实测确定，决定 U4 走角色参考还是降级垫图。
- **`storagePut` 返回的 302 托管 URL 是否对 MJ 服务端公网可达**：U1 spike 验证（直接把该 URL 喂给 MJ 角色参考或在浏览器外访问）。
- **"主角参照"标记落在数据模型哪个字段**（新增 `role` vs 扩展 `purpose`）：U2 实现时按向后兼容最简方案定。
- **主角参照在 UI 的标记入口放 StoryArtDirectionStudio 还是镜头卡片**：U3 实现时按现有交互动线定。

---

## High-Level Technical Design

> *以下为方向性示意，供评审验证思路，非实现规范。实现者应按代码实际情况调整。*

```
锁定阶段（一次）
  StoryArtDirectionStudio → story.body.artDirection = {
     phase: 'locked',
     recipe: ArtRecipeDNA,                 // 画风：style/palette/light/composition/material/negative
     references: [
        { role:'character', purpose:'fact', imageUrl: <主角参照URL> },  // 主角（跨镜头锁长相）
        { purpose:'fact',   imageUrl: <素材URL> }, ...                  // 真实素材
     ]
  }

每镜头生成（继承基调）
  DrawThisMomentPanel → generateForMobile({ storyId, shotNo, cardHint=镜头内容 })
     │
     ├─ 后端读 story.body.artDirection（locked）
     ├─ prompt = deriveMobileImagePrompt(cardHint) + artRecipePrompt(recipe)
     ├─ 主角一致：
     │     U1可用 → midjourneyPromptFor 追加 --cref/--oref <主角URL>
     │     降级    → base64Array 垫主角照片
     └─ 素材忠实：fact references 作为 referenceImages
                ↓
        302 MJ → 跨镜头一致 + 忠于素材的画面
```

---

## Implementation Units

### U1. Spike：验证 MJ 角色参考可行性 + 照片公网可达性

**Goal:** 实测确定主角一致性的技术路径——302 MJ 是否透传 `--cref`/`--oref`/`--sref`、用何版本，以及 `storagePut` 返回的照片 URL 是否对 MJ 服务端公网可达。产出明确结论：走"角色参考"还是"降级垫图"。

**Requirements:** R2

**Dependencies:** None

**Files:**
- 调研对象（只读 + 临时探针，不留production代码）：`server/services/imageGen.ts`（`generate302MidjourneyImage` / `midjourneyPromptFor`）、`server/storage.ts`（`storagePut` 返回 URL 实例）
- 产出：在本计划下方追加"U1 Spike 结论"注记（或 `docs/solutions/` 速记），供 U4 引用

**Approach:**
- 取一张已上传素材，打出 `storagePut` 返回的实际 URL，确认是 302 托管公网 URL 还是 data URI。
- 用一条带 `--cref <url>`（v6）或 `--oref <url>`（v7）的 prompt 走 `/mj/submit/imagine` 试出图，观察 302 是否接受该参数、返回是否体现角色锁定。
- 若角色参考不被透传或 URL 不可达 → 确认降级路径（统一主角照片 `base64Array` 垫图）可用。

**Execution note:** 这是 spike——目标是拿到事实结论，不是留下生产代码。结论写回计划/solutions，探针代码删除。

**Test scenarios:**
- Test expectation: none —— spike 验证单元，产出是结论文档而非可测行为。

**Verification:**
- 计划中记录明确结论：主角一致走 `--cref`/`--oref`/`--sref` 中的哪个，或走垫图降级；照片 URL 公网可达性已确认。

---

### U2. 数据模型：在 artDirection 增加"主角参照"语义

**Goal:** 让 `story.body.artDirection` 能表达"这张参考是主角，需跨镜头锁长相"，并保持对旧数据向后兼容。

**Requirements:** R1, R2, R4

**Dependencies:** None（可与 U1 并行）

**Files:**
- Modify: `shared/artDirection.ts`（`ArtReferenceMaterial` 加主角标记；`normalizeStoryArtDirection` 兼容）
- Test: `shared/artDirection.test.ts`（若不存在则新建）

**Approach:**
- 在 `ArtReferenceMaterial` 增加主角标记（优先 `role?: 'character'` 这种加法式扩展，避免破坏现有 `purpose` 语义）。
- `normalizeStoryArtDirection` 解析时：缺字段按非主角处理；保证旧 `story.body` 不报错。
- 提供取主角参照的纯函数（如 `characterReferenceOf(direction)` 返回首个 `role==='character' && imageUrl` 的项）。

**Patterns to follow:** `shared/artDirection.ts` 现有 `normalizeRefMaterial`/`normalizeStoryArtDirection` 的容错解析风格。

**Test scenarios:**
- Happy path: 含 `role:'character'` 的 reference → `characterReferenceOf` 返回该项 imageUrl。
- Edge case: 旧数据无 `role` 字段 → 归一化不报错、视为非主角、`characterReferenceOf` 返回空。
- Edge case: 多张标 `role:'character'` → 取第一张（确定性）。
- Edge case: 标了 character 但无 imageUrl → 跳过，返回空。

**Verification:** 新旧 `story.body.artDirection` 都能正确归一化；主角参照可被稳定取出。

---

### U3. 主角参照确立入口（前端）

**Goal:** 用户能把某张已上传素材标记为"主角参照"，作为整故事跨镜头锁长相的依据。

**Requirements:** R3, R4

**Dependencies:** U2

**Files:**
- Modify: `client/src/features/storyAgent/views/StoryArtDirectionStudio.tsx`（或 `StoryCardsBoard.tsx` 的参考图项）—— 加"设为主角"标记交互
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（写入 `role:'character'` 到对应 reference）

**Approach:**
- 在已有的参考图/素材展示处加"设为主角参照"操作（单选——一个故事一个主角参照，符合 U2 取第一张语义）。
- 写回 `story.body.artDirection.references` 对应项的 `role`，复用现有 persist 路径。
- 视觉上标出当前主角参照（如角标/高亮）。

**Patterns to follow:** `StoryCardsBoard.tsx` 现有 reference 项的展示与 `addVisualReference`/persist 动线。

**Test scenarios:**
- Test expectation: 以手动 UI 验证为主（项目前端单测稀疏）；逻辑层（写入 role）若抽成纯函数则补单测。

**Verification:** 标记主角后刷新不丢；`story.body` 中对应 reference 带 `role:'character'`。

---

### U4. 生成链路消费基调（后端核心）

**Goal:** 每镜头生成时统一注入：锁定画风 `recipe` + 主角参照（角色参考或降级垫图）+ fact 素材，实现跨镜头一致 + 忠于素材。

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1（定技术路径）、U2（取主角参照）

**Files:**
- Modify: `server/routers.ts`（`generateForMobile`：组装基调 → prompt + referenceImages）
- Modify: `server/archive/storyReply.ts`（`deriveMobileImagePrompt`：把 `cardHint` 与基调 prompt 合理拼接）
- Modify: `server/services/imageGen.ts`（`midjourneyPromptFor`：按 U1 结论支持追加 `--cref`/`--oref`/`--sref`；`editImage`/`generate302MidjourneyImage`：主角参照纳入）
- Test: `server/routers.storyAgent.test.ts`、`server/services/imageGen.test.ts`

**Approach:**
- `generateForMobile`：读 `storyArtRecipe(story)` + 主角参照（U2）+ `storyArtReferenceImages`；prompt = `deriveMobileImagePrompt(cardHint)` + `artRecipePrompt(recipe)`。
- 主角一致：U1 可用 → `midjourneyPromptFor` 追加角色参考参数（URL=主角参照）；降级 → 主角照片进 `base64Array` 垫图。
- 素材忠实：fact references 作为 referenceImages（沿用现有通道）。
- 让首张就走带基调的轨（主角一致优先 MJ 慢轨）；草稿轨基调继承列入 Deferred。

**Execution note:** 先为"基调注入 prompt 组装"写失败测试（给定 locked recipe + 主角参照 → 期望 prompt 含画风词且追加角色参考参数），再实现。

**Test scenarios:**
- Happy path: story 有 locked recipe + 主角参照 → 出图 prompt 含 recipe 画风词，且（U1可用）含角色参考参数 / （降级）base64Array 含主角图。
- Happy path: 多个镜头依次生成 → 都注入同一 recipe 与同一主角参照（跨镜头一致的可断言代理指标）。
- Edge case: story 未 locked（无 recipe）→ 回落现有行为，不报错（不强行注入空基调）。
- Edge case: 有 recipe 但无主角参照 → 只注入画风 + 素材，不追加角色参考。
- Error path: 角色参考 URL 不可用/出图失败 → 按 `editImage` 既有"图生图失败回落文生图"兜底，不中断。
- Integration: `generateForMobile` 端到端（caller 注入 locked story）→ 返回的 prompt/referenceImages 体现基调三要素。

**Verification:** 同一故事连续生成多镜头，prompt 中画风词与主角参照稳定一致；未锁基调时行为不回归。

---

### U5. 清理前端临时机制 + DrawThisMomentPanel 重接基调

**Goal:** 移除前面几轮与故事级基调脱节的临时代码，`DrawThisMomentPanel` 改为"消费基调"，只负责传镜头内容，不再前端自造画风/增强。

**Requirements:** R5, R6

**Dependencies:** U4

**Files:**
- Modify: `client/src/features/storyAgent/views/DrawThisMomentPanel.tsx`（移除独立 `styleHint` 选择器/随机艺术增强/前端图生图绕路；保留传 `cardHint`=镜头内容、绑镜头、反馈维度→改为后端基调语义）
- Modify: `server/routers.ts`（移除 `artReference` 路由注册）、`server/_core/index.ts`（移除 art cache 启动加载）
- Delete: `server/services/artReferenceAgent.ts`、`server/services/artRepository.ts`、`server/services/artPromptTemplate.ts`、`server/services/artisticEnhancement.ts`、`server/routers/artReference.ts`、`scripts/initArtReferenceCache.ts`、`art-repository/features-cache.json`、`art-repository/PROMPT_DIMENSIONS.md`
- Keep（明确不动）: `server/services/imageGen.ts` 的 `readImageInput` 本地资产分支（有用）；`art-repository/references/`（用户素材）

**Approach:**
- 前端把"画风"来源从前端 `STYLE_OPTIONS` 切换到故事级 `recipe`；若需要让用户调画风，应作用于 artDirection recipe（经 U3/Studio），而非镜头级独立选项。
- "不满意指定"维度反馈保留，但语义改为"对当前镜头基于基调微调"，传给后端处理。
- 删除 art 参考库一整套噪音代码与其注册/加载点，确保 `npm run check`/`tsc` 干净、`server/routers.ts` 与启动不再引用。

**Test scenarios:**
- Edge case: 删除后 `tsc --noEmit` 零错误（无悬空 import/引用）。
- Integration: dev server 启动不再加载 art cache、`artReference` 路由移除后无运行期引用错误。
- Happy path: `DrawThisMomentPanel` 生成请求只带镜头内容，画风来自故事基调（手动验证生成图画风跟随 locked recipe）。

**Verification:** 删除项全部移除且编译/启动干净；「把这一刻画出来」走基调链路；保留项未受影响。

---

## System-Wide Impact

- **Interaction graph:** `DrawThisMomentPanel` → `generateForMobile` → `deriveMobileImagePrompt` / `renderViaGate` → `editImage`/`generate302MidjourneyImage`；`StoryArtDirectionStudio`/`StoryAgentContext` 写 `story.body.artDirection`。
- **Error propagation:** 角色参考/图生图失败沿用 `editImage` 既有"图生图→文生图"兜底；未锁基调回落现有文生图行为。
- **State lifecycle risks:** `story.body.artDirection` 旧数据兼容（U2 归一化）；删除 art 参考库代码需确保无悬空引用（U5 编译校验）。
- **API surface parity:** 手机端 `MobileChatPage` 也走 `generateForMobile`——基调注入在后端，故手机端自动受益；需确认手机端不依赖被删的 `artReference` 路由（grep 校验）。
- **Unchanged invariants:** 不改 DB schema、不改 `artDirection` 锁定流程主干、不动 `art-repository/references/` 用户素材、保留 `readImageInput` 本地资产分支。

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 302 MJ 不透传 `--cref`/`--oref`/`--sref`，主角长相一致做不到角色参考级 | U1 spike 先验证；降级为统一主角照片垫图（锁长相但牵制构图），并向用户说明取舍 |
| 用户照片是 data URI 而非公网 URL，角色参考拉不到 | U1 验证 URL 形态；走 `base64Array` 垫图路径（已支持 base64）作为降级 |
| 用户尚未走"锁定 artDirection"流程 → 无 recipe 可继承 | U4 未锁基调时回落现有行为不报错；后续可加"先去锁基调"引导（Deferred） |
| 删除 art 参考库代码引入悬空引用/编译错误 | U5 以 `tsc --noEmit` + 启动校验把关；先 grep 所有引用点 |
| 手机端 `MobileChatPage` 隐式依赖被删路由 | System-Wide Impact 已列；U5 执行前 grep `artReference` 全量引用 |

---

## Sources & References

- 现有基调数据模型：`shared/artDirection.ts`（`StoryArtDirection` / `ArtRecipeDNA` / `ArtReferenceMaterial`）
- 生成消费点：`server/routers.ts`（`storyArtRecipe` / `storyArtReferenceImages` / `generateForMobile`）
- 出图与角色参考落点：`server/services/imageGen.ts`（`midjourneyPromptFor` / `generate302MidjourneyImage` / `editImage` / `readImageInput`）
- 入口：`client/src/features/storyAgent/views/DrawThisMomentPanel.tsx`、`StoryArtDirectionStudio.tsx`
- 照片存储：`server/storage.ts`（`storagePut`）、`server/services/artAgent.ts`（`storeOriginalImage`）
- 约束：`AGENTS.md`（本地数据/dev server 铁律）
