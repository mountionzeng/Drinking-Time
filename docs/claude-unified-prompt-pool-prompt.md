# Claude 任务：统一提示词片段池（图像提示词 + 文字提示词放在一起）+ 卡/镜头提醒

> 这是一个**前端为主的补丁**，承接 brainstorm 文档 `docs/brainstorms/2026-06-02-unified-prompt-pool-requirements.md`（先读它）。目标：把**图像分析提取的提示词**做成**可复用的「片段」**，和文字提示词一起进一个**项目级片段池**；重写 Shot Production Table 为「池 + 每镜引用」；并在卡/镜头处做**两种提醒**（偏好驱动 + 缺口驱动）。做完岱岱（人）会审核并合并到 `main`。
>
> **更新（2026-06-02，岱岱本地 review 后追加）**：本轮**多一块**——把「故事页 Agent + 创作页 Agent」统一成**同一个小酌**，并把创作页对话框改成**横向悬浮 + 头像折叠**、能**对话式改提示词**。详见下方〈阶段 6〉。这块**排在池子（阶段 1-3）之后**做。

---

## 执行约定（先读）

- **你在终端跑，独立 worktree/分支干活。** 完成后**只本地提交，不要 `git push`、不要建远端分支、不要合并 main**——push / merge 由岱岱手动做。
- **全中文**：所有代码注释、UI 文案、文档都中文。
- **每阶段 `npm run check`（typecheck）+ 相关 `vitest` 必须绿**才算完成。
- 有疑问、或发现下面「已核实」与现实不符 → **停下说明**，不要自己拍板改架构。

---

## 目标（一句话）

图像分析的产出（已是结构化标签）→ 变成池里**可见、可复用、可编辑**的提示词**片段**，和文字提示词同表共处；镜头从池里**引用**片段经合成缝组装出图；并在卡/镜头处**主动提醒**用户「你常喜欢 X」（偏好驱动）和「这镜缺视觉锚，从池里挑？」（缺口驱动）。**复用现有引擎，不加新模型。**

## 本轮**不做**（明确排除）

- **不做 (b) 对话框「联想/自动蹦」**（边打字边从池里 autocomplete 弹片段）——下一轮。但池结构要让片段**可检索/可排序**，给它铺路。
  - ⚠️ **区分清楚**：「**用小酌 Agent 对话式改提示词**」（你跟它说「这镜暖一点」它就改）**本轮要做**，见〈阶段 6〉；它**不是**这里排除的「自动蹦」。
- 不加新图像模型、不换 fal。
- **不改对话粘性逻辑本身**（开场报到 / 回归问候 / `buildReturningGreeting` / `buildAgentSystemPrompt` 一个字不动）；**且**统一 Agent 后**粘性开场绝不能泄漏到创作页/悬浮对话框**（见〈阶段 6〉红线）。
- 不碰手机端 / mobile-redesign。
- 不做跨项目偏好持久化（v1 项目内）。

---

## 关键事实（已核实，省你时间，别再推翻）

1. **图像分析已经是结构化的，不用加模型、不用改分析调用。**
   - `server/services/artAgent.ts` 的 `ArtRiffResult.analysis`（约 20–35 行 / 227–238 行返回）已含：`visualStyle: string[]`、`mood: string[]`、`colorPalette: string[]`、`composition: string`、`lighting: string`、`objective`、`aesthetic`、`confidence`。
   - 前端镜像类型 `VisualCanvasAnalysis`（`client/src/features/storyAgent/types.ts:100–113`）字段一致。
   - **所以「图像 → 提示词片段」≈ 把这些数组/字段 map 成片段**：`visualStyle[i]`→标签`风格`、`mood[i]`→`情绪`、`colorPalette[i]`→`色彩`、`composition`→`构图`、`objective` 里的主体→`主体`。一个纯 transform，无新模型。

2. **每张图已经挂 `cardId`。** `VisualCanvasItem`（`types.ts:115–131`）有 `cardId?: string`（图文合一那轮加的）。所以片段的「出处卡」是现成的：`fragment.origin = item.cardId`。

3. **合成缝在哪、要演进哪一层。** `server/services/shotPromptComposer.ts`：
   - `visualAnchorSummary`（:87）把视觉锚**压成一行** `V1「…」（审美：…；风格：…）；V2…`，再由 `composeShotPrompt`（:107）当作 `visualAnchorText` **一行**塞进 `promptDraft`（:146）。
   - **要演进的就是这一层**：让镜头「引用的图像片段」作为**离散、带标签**的部分进入 prompt，而不是压扁一行。
   - **保持不动**：文字层 `visualContent`（:123）/`cameraAndLook`（:131）、情绪层 `emotionCharge`（:115）/`emotionDelta`、守则 `negativePrompt`（:157）。本轮**只片段化图像侧**（岱岱已确认）。

4. **持久化走哪、零迁移。**
   - `visualCanvasItems` 通过 `normalizeVisualCanvasItem`（`client/src/features/storyAgent/StoryAgentContext.tsx:282`）读出；`loadState`（:163）和服务器回灌都走它；保存到服务器在 :750。
   - 新增的「片段引用 / 用户对池的增删」字段挂在 **story body JSON** 即可：`storyUpsert` 的 `body` 校验是 `z.record(z.string(), z.unknown()).optional()`（`server/routers.ts` 约 1013 行），**原样透传未知字段、零迁移**，后端不用改。
   - **必须**让新字段在 `normalize*` 里被**读出**，否则 localStorage / 服务器回灌时被丢。

5. **偏好驱动提醒的燃料是现成的。** `artAgent.ts` 的 `preferenceUpdate`（:208）已累积「偏好风格 / 情绪 / 色彩」；前端 `visualPreference` 持有它。偏好驱动提醒从这里读。

6. **别破坏下游 B5。** `generateScript` 把 `visualCanvasItems` 映射成 `visualAnchors` 喂 `classify`（视觉锚喂下游）。片段化是**前端表现 + 合成缝**的事，这条全量传保持原样。

7. **Shot Production Table** = `client/src/features/analysis/views/ShotTable.tsx`（live 版；`client/src/archive/ShotTable.tsx` 是旧的，别动）。

8. **当前是「两个独立 Agent」，不是一个**（〈阶段 6〉的前提）。
   - **故事对话框** = `StoryAgentChat`（`client/src/features/storyAgent/views/StoryAgentChat.tsx` + `StoryAgentContext`）——挂在 **Analysis 页**（`client/src/features/analysis/views/WorkspaceLayout.tsx:143`，左侧 Tab，与 DropZone 切换）。**粘性（开场报到 / 回归问候）就绑在这个 context**。
   - **创作对话框** = `CreationAgentChat`（`client/src/features/creationAgent/views/CreationAgentChat.tsx` + `CreationAgentContext`）——挂在 **Creation 页**（`client/src/pages/CreationPage.tsx`，左侧**固定**面板 `ResizablePanel defaultSize={40}`，右侧才是 ShotTable）。聊镜头 + 图像分割编辑，**不含粘性**。
   - 两者各有独立 context / 对话线 / 后端调用——所以「统一成同一个小酌」是真要做合并，不是改个文案。

9. **现在「改 prompt」不走对话。** Creation 页改提示词是直接点表格触发的：`ShotTable → onEditShotPrompt → shot.update`（`CreationPage.tsx:81–94`）。所以「用 Agent 对话式改提示词」是**新能力**（≈ (b) 的写侧），且**依赖池子的数据落点**——必须排在池子（阶段 1–3）之后，且**复用** `shot.update` / 池引用持久化，别另起一套写路径。

---

## 数据模型（建议，实现时可微调，但保持语义）

```ts
// 提示词片段（统一文字/图像两源）
interface PromptFragment {
  id: string;
  text: string;                       // 片段文本，如「暖橙色调」「近景」
  source: 'image' | 'text';           // 本轮只新造 image 源；text 源见下
  tag: '风格' | '色彩' | '构图' | '情绪' | '主体' | '光线';
  originCardId?: string;              // 出处卡（图像片段 = item.cardId）
  originItemId?: string;              // 出处图（VisualCanvasItem.id）
  confidence?: number;               // 取自 analysis.confidence，可用来排序/门控
}
```

- **图像片段**：从 `visualCanvasItems[].analysis` **派生**（推荐先派生、零迁移；若要支持用户手动增删/编辑片段，再把「用户对池的编辑」作为覆盖层持久化进 body）。
- **文字源**：本轮**不新造**文字片段（文字层保持原样）。`source:'text'` 字段先留着、给下一轮统一用；表里文字层照现状渲染即可。
- **每镜引用**：`shot` 记录它引用了哪些 `fragment.id`（持久化进 body / shot 映射）。镜头默认可继承其所属卡的图像片段，用户可增删。

---

## 阶段任务

### 阶段 1：图像分析 → 片段（派生层 + 池）
- 写一个纯函数把 `VisualCanvasItem.analysis` map 成 `PromptFragment[]`（标签化、去空、可带 confidence）。放在前端合适的工具模块（如 `client/src/features/storyAgent/promptPool.ts`）。
- 池 = 当前项目所有 `visualCanvasItems` 派生出的图像片段集合（可按 tag 分组、可排序、可去重）。**去重**：同 tag 同文本合并。
- `npm run check` + 给这个纯函数写 vitest（含空分析、缺字段、去重用例）。

### 阶段 2：重写 Shot Production Table = 池 + 每镜引用
- 重写 `client/src/features/analysis/views/ShotTable.tsx`：每镜行展示 ① 现有文字层（原样）② 该镜**引用的图像片段**（来自池，可单独增删、可勾选是否进最终 prompt）。
- 提供「从池里挑片段加到这镜」的入口（池按 tag 分组、可搜索——也为 (b) 铺路）。
- 引用关系持久化进 body，经 `normalize*` round-trip。

### 阶段 3：合成缝演进（只动视觉层）
- 改 `server/services/shotPromptComposer.ts`：新增「镜头引用的图像片段」入参；把它们作为**离散、带标签**的部分组进 `promptDraft`（替代/补充原来压扁的一行 `visualAnchorText`）。
- **保持** `visualContent` / `cameraAndLook` / `emotionCharge` / `emotionDelta` / `negativePrompt` 不变；守则文案不变。
- 更新 `shotPromptComposer.test.ts`：断言引用片段进了 prompt、且文字层/情绪层/守则未变。

### 阶段 4：两种提醒
- **偏好驱动**：从 `visualPreference` 读累积偏好，在 Story Cards（`StoryCardsBoard`）/卡上提醒「你常喜欢 X，要用上吗」。**门控**：偏好为空 / 没真实累积 → **不显**（不硬造）。
- **缺口驱动**：某镜/某卡**没有任何引用的图像片段**时，提示「这镜还没视觉提示词，从池里挑？」并给候选（候选排序：先按标签/情绪与该镜匹配，再按 confidence）。
- 提醒是**建议**，不自动改用户内容；用户可一键采纳或忽略。

### 阶段 5：持久化 + 守护
- 新字段（片段引用 / 池编辑覆盖层）在 `normalizeVisualCanvasItem` 同级的 `normalize*` 路径里读出；localStorage `loadState` 和服务器回灌都覆盖。
- 自检：刷新页面（localStorage）+ 切换/重载故事（服务器）后，每镜的片段引用都还在。
- 确认无 `DATABASE_URL` 的 local-persist 降级仍正常（开发默认就是这个模式）。

### 阶段 6：统一悬浮小酌对话框（岱岱 2026-06-02 追加 · **排在阶段 1–3 之后**）

> **来源**：岱岱本地 review 时提的新需求。**目标**：把「故事页一个 Agent、创作页另一个 Agent」收成**同一个小酌**，并把创作页那个**固定左面板**改成**横向悬浮 + 头像折叠**的对话框，让小酌能**对话式改提示词**。

**两条已锁定的决策（岱岱拍板，别推翻）：**
1. **合并程度 = 同一个小酌 · 各自对话线**：故事页 / 创作页都是同一个小酌——**人格 + 能力一致**（都能聊镜头、改提示词），但**各自保留对话线**。**不要**做「跨页共享同一条 thread」。
2. **形态 = 横向悬浮 + 头像折叠**：创作页对话框从固定左面板改成**悬浮**态；平时收起来**只是一个头像**，**点头像展开**对话（展开后是**横向**条 / 面板，不是占满左侧的竖栏）。
   - 「搜索的时候就是一个头像」= 用户在看 / 操作镜头表时，对话框不挡路、缩成头像。悬浮位置 / 展开尺寸 / 动效细节你可定，**拿不准就回岱岱确认，别硬猜**。

**要做：**
- **统一 Agent**：让创作页用「小酌」（与故事页**同人格 + 同能力**）。实现方式你定（`CreationAgent` 复用 `StoryAgent` 的人格 / 系统提示并补镜头 + 改提示词能力，或反过来 `StoryAgent` 扩出创作页能力均可），**但产出必须是「同一个小酌」的体验**。
- **悬浮 + 头像折叠**：重写 Creation 页左侧（`CreationPage.tsx` 的 `ResizablePanel`）为悬浮头像 + 可展开横向对话框；ShotTable 占满主区。
- **对话式改提示词**：小酌能在对话里改某镜的提示词——**改的是阶段 1–3 的池 / 引用数据**（增删该镜引用的片段、或调片段文本），经合成缝出图。**复用** `shot.update` / 池引用持久化，**别另起一套写路径**。改动走**建议 → 用户确认 / 可撤销**，不擅自改用户内容（与提醒同规矩）。

**🚫 粘性红线（硬约束，违反即不合格）：**
- 统一后，**创作页 / 悬浮对话框绝不能触发粘性开场**——不能冒出「你好，我是小酌……把今天的小事做成短片」「我还记得上次聊到……」这类**报到 / 回归问候**。那套只属于故事页开场。
- `OPENING_PREAMBLE` / `OPENING_MESSAGE` / `buildReturningGreeting` / `buildAgentSystemPrompt` 的**逻辑一个字不动**；你只是**不在创作页调用**它们的开场分支。
- 守着这些的测试（`openingCopy.test.ts` / `returningGreeting.test.ts`）必须**仍然绿**。

**自检：** `npm run check` 绿；进创作页 → 看到悬浮头像，点开能和小酌对话；让它「把这镜改暖一点」→ 该镜引用的片段 / prompt 真的变了且出图用上；创作页**全程没有**粘性开场；故事页粘性开场 / 回归问候**照旧**。

---

## 守则（硬约束）

- **如实，不编造**：图像片段只来自真实 `analysis`；提醒只反映**真实**累积偏好 / **真实**缺口。**平淡 / 空 → 不显、不硬造、不正向失真**（正向失真与负面偏置同罪）。
- **不重造**：美术 Agent 双重分析 / fal / 情绪管线 / `cardId` / `visualPreference` 全部复用。
- **不破坏现有流程**：Story 出卡、`generateScript` 出镜头、`visualAnchors` 喂下游（B5）、合成缝的**文字层 + 情绪层**、选区编辑、自动存档都不能坏。
- **只动桌面端 Story/Creation 这侧**；手机端不碰。**对话粘性逻辑不碰**——且统一 Agent 后**粘性开场不得泄漏到创作页 / 悬浮对话框**（〈阶段 6〉红线）；`openingCopy.test.ts` / `returningGreeting.test.ts` 必须仍绿。

---

## 验收清单（你先跑 + 自检，并在交付里逐条回）

1. `npm run check` 通过（typecheck 干净）；阶段 1/3 的 vitest 绿。
2. 喂一张参考图 → 池里出现该图的标签片段（风格/色彩/构图/情绪），来源=图像、出处=该卡（对应 AE1）。
3. 某镜引用 2 个图像片段 → 表里可见、可单独增删；该镜出图 prompt 由这些片段组装，**不再是压扁的一行视觉锚**（AE2）。
4. 多次 riff 偏暖/近景 → 卡/对话提醒「你常喜欢暖色调/近景」（AE3）；**无累积时不显**。
5. 某镜无视觉片段 → 提示「这镜缺视觉锚，从池里挑？」并给候选（AE4）。
6. 平淡故事 / 空偏好 → 不硬造提醒、不无中生有标签（AE5，守则）。
7. 刷新（localStorage）+ 切换/重载故事（服务器）后，片段引用都还在。
8. `generateScript` 仍正常，`visualAnchors` 仍照常喂 `classify`（B5 未受影响）。
9. 进创作页 → 看到**悬浮头像**，点开是**横向**对话框；收起回到头像（阶段 6 形态）。
10. 创作页的小酌与故事页**同人格 + 同能力**（都能聊、能改提示词），但**各自对话线**；让它「把这镜改暖一点」→ 该镜引用片段 / prompt 真变了且出图用上（阶段 6 能力）。
11. **粘性红线**：创作页 / 悬浮对话框**全程无**报到 / 回归问候；故事页开场 / 回归问候照旧；`openingCopy.test.ts` / `returningGreeting.test.ts` 绿（阶段 6 红线）。

## 完成后给岱岱

1. 改动清单（每个文件改了什么、为什么）。
2. 自检结果（清单哪几条跑了、结果如何；哪些只能手测、你怎么验的）。
3. 这次产出在哪个本地 commit（**不要 push**）。
4. 任何你觉得偏离 brainstorm 决策、或建议留给下一轮 (b) 的点。
