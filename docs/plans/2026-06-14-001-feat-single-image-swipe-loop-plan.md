---
title: "feat: 出图简化——一次一张、划走再来、图作为故事材料"
type: feat
status: completed
date: 2026-06-14
origin: docs/brainstorms/2026-06-14-shot-image-as-story-material-requirements.md
---

# feat: 出图简化——一次一张、划走再来、图作为故事材料

## Summary

在 creation 侧把"画出来"接成单图循环：点一次出**一张**图（复用 `creationAgent` 单图路径 + 继承 `storyArtRecipe`，不调 6 张候选），用户右划收下为该镜关键帧、左划淘汰则再出一张，直到满意；失败时保留旧图 + 提示。"画面材料"复用现有 `imageAssets` 投影（主图=关键帧 + prompt + recipe），不建新表。视频合成不做。

---

## Problem Frame

"画出来"当前底下并发出 4~6 张 Midjourney 候选（贵、慢），失败时 studio 先清空再失败导致"图没了"，且出来的图与故事材料关系不够稳固。用户要的是简单：一次一张、够漂亮、能复用、不满意就再来一张。同时，用户恢复镜头序列表的**真正动机是出视频时镜头要连贯**——必须能同时看到上一个/下一个镜头的关键帧与提示词来判断连贯性（落在 U3）。详见 origin（Sources & References）。

---

## Requirements

- R1. "把这一刻画出来"出**一张**图（不是候选集），基于当前对话/素材。
- R2. 单张质量靠**自动继承的美术配方**（锁定则继承 `storyArtRecipe`，未锁定用轻量默认），不必走 6 张候选 studio。
- R3. 出图按需、逐镜：只为当前焦点镜头出图，不一次为所有镜头预渲染。
- R4. 每镜有一条"画面材料"：关键帧图 + 提示词 + 美术配方（复用 `imageAssets` 投影，不新建结构）。
- R5. 满意的图确定归属到某镜头/卡片（按当前故事独立），刷新/切换不丢、不串故事。
- R6. 可在已收下的关键帧上整图微调（reviseImage）。
- R7. 出图失败/超时：提示"出图服务暂时不可用"，**保留之前的图、不清空**。
- R8. "画面材料"是视频就绪的数据形态（关键帧 + 提示词足以作后续视频输入）；本次不做视频合成。
- R9. **划走再来、直到满意**：右划收下、左划淘汰并再出下一张；每次只出一张、屏上只一张；被划走的进历史不直接消失。

**Origin actors:** A1（用户）、A2（小酌 creation Agent）、A3（轻量美术定调，自动继承）
**Origin flows:** F1（一次一张、划走再来、直到满意）、F2（在已收下的图上微调）、F3（失败处理）
**Origin acceptance examples:** AE1（covers R1/R2）、AE2（covers R5）、AE3（covers R7）、AE4（covers R3）、AE5（covers R9）

---

## Scope Boundaries

- 不做真视频合成/导出。
- 6 张候选探索 studio（`generateArtDirectionCandidates`）不作为主路径——保留为可选/进阶，不在本次删除或改造。
- 不动移动端已有的 swipe 流（`MobileChatContext`）。
- 不接/换出图模型、不修 302.AI 外部故障。

### Deferred to Follow-Up Work

- 移动端与 creation 侧 swipe 循环的统一/对齐：后续迭代。
- "画面材料"加显式视频参数字段：等真做视频合成时再加。
- 被淘汰图的独立"历史"面板（缩略图浏览、从历史提回为关键帧）：v1 只在数据层保留 swipe_left 不丢，UI 历史面板留后续。

---

## Context & Research

### Relevant Code and Patterns

- `server/services/imageAssets.ts` — `getStoryImageAssets`/`projectImageAssets`：图片资产投影，已把 `swipe_right`→选中/`isPrimary`、`swipe_left`→`rejected`、`pending`/`曾收下`/`已淘汰` 状态算好。**"画面材料"直接复用它**，关键帧=isPrimary 的资产。
- `server/routers.ts` — `storyArtRecipe(story)`（从 `story.body` 取锁定的美术配方 DNA，已作 `artDirection` 喂进出图，154/1463/1567 行）；creation 聊天端点（已接 storyId + assets + goal）；`createImageSignal`（记 swipe 信号）；`recordSignal`（1601 行）。
- `server/services/creationAgent.ts` — `generateImage` 工具调用的**单张出图**路径（经 `renderViaGate`，已带 storyId/artDirection/referenceImages）；`reviseImage`（整图微调）。**单图"画出来"复用这条，不走候选。**
- `server/services/renderGate.ts` — `renderViaGate`：出图唯一必经点 + `artJudge` 注入风格 DNA（确定性、不调 LLM）。
- `client/src/features/creationAgent/CreationAgentContext.tsx` — creation 侧聊天 + 资产状态（`projectAssets`/`selectImage`/`refreshProjectAssets`，已 per-story）。
- `client/src/features/creationAgent/views/ImageSegmentOverlay.tsx`、`ShotImageWorkspace.tsx` — creation 侧图片工作区（合并自图片资产层）。
- `client/src/features/storyAgent/views/StoryArtDirectionStudio.tsx` — 现有 6 张候选 studio；其"生成中先清空、失败不回滚"是 R7 要修的行为参照（**反面教材**）。
- 入口：`StoryArtDirectionLauncher.tsx`（"生成画面"）、`StoryCardsBoard.tsx`、`MobileChatContext.tsx`（移动端"画出来"，本次不动）。

### Institutional Learnings

- `docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md` — 镜头/图片按 storyId 独立、写入带 userId 的纪律，本计划沿用。

### External References

- 未使用（图片资产/信号/配方/出图网关均有充分本地范例）。

---

## Key Technical Decisions

- **"画面材料"复用 `imageAssets` 投影，不新建表**：关键帧=`isPrimary` 资产、prompt/recipe 已在；新建结构是重复劳动且增加迁移负担（see origin: Key Decisions）。
- **单图出图复用 `creationAgent.generateImage` 单张路径**，不调 `generateArtDirectionCandidates`：候选集正是"贵又慢"的来源；单张 + 继承配方满足"一张够漂亮"。
- **swipe 循环复用现有信号模型**（swipe_right→收下主图、swipe_left→淘汰），本次只补 creation 侧"出一张→划走→再出下一张"的交互；数据层不重造。
- **失败不清空**：把"先切生成中清空、失败不回滚"改成"出图返回后再替换、失败保留旧图 + 提示"。
- **配方默认**：未锁定 `storyArtRecipe` 时给一个零点击轻量默认（styleLibrary/合理缺省），不强迫用户先跑 studio。**默认配方是净新代码**（`storyArtRecipe` 未锁定返回 `undefined`）——新增 `defaultArtRecipe()` 兄弟 helper，在出图端点处与 `storyArtRecipe` 组合（`storyArtRecipe` 保持"只管锁定"），不把默认逻辑塞进 `storyArtRecipe` 本身。
- **桌面侧"划走"= 按钮，不是触摸 swipe**：creation 是桌面表格/工作区，触摸 swipe 在桌面不可发现。复用的是 swipe **信号语义**（swipe_right/swipe_left 落库），交互呈现为两个显式按钮："收下"（右划语义）/"再来一张"（左划语义）。移动端真 swipe 流不动。
- **"出下一张"需确定性端点,不走 LLM tool call**：现有 `creationAgent.generateImage` 只在 LLM 主动发 tool call 时触发——左划无法可靠地再触发它。新增确定性单图出图入口（`creationAgent.generateNextImage` 直调 `renderViaGate` + `storyArtRecipe`/默认 + 焦点镜头 prompt），供循环反复调用。**这是 R9/AE5 的必需件，不是"必要时"可选。**

---

## Open Questions

### Resolved During Planning

- "画面材料"是否新建结构：否，复用 `imageAssets` 投影。
- 单图走哪条出图路径：新增确定性 `generateNextImage`（复用 `generateImage` 底层 + `renderViaGate`），**不经 LLM tool call**——左划要能反复触发，现有 `generateImage` 只在 LLM 发 tool call 时出图，不够（doc-review 核实）。
- 与 buildShotList 并存：buildShotList 铺镜头/提示词骨架；"画出来"逐镜按需出图，两者互不冲突。
- 桌面"划走"= 按钮（"收下"/"再来一张"），非触摸 swipe；落库仍是同一套 swipe 信号。
- R7"失败不清空"目标 = creation 侧 `CreationAgentContext`，**不**改候选 studio（studio 在范围外）。
- 交互态（生成中骨架 / 中途失败 inline+重试 / 切镜头静默丢弃 pending / 收下后原位转已定态 / 空态内嵌"画出来"）已在 U2/U3 定死。
- 左划淘汰图的历史：v1 只在数据层记 swipe_left（不丢），ShotImageWorkspace 暂不做独立历史面板——见 Deferred to Follow-Up Work。

### Deferred to Implementation

- 未锁定配方时 `defaultArtRecipe()` 的具体取值（styleLibrary 某默认流派 / 从对话现编）——读 `styleLibrary`/`artDirection` 后定；架构位置已定（端点处组合的兄弟 helper）。
- 左划"淘汰"信号是否影响下一张的生成方向（避免重复同类）——v1 只记信号、不影响生成；进阶再用。
- `selectImage` 是否对齐到 story 域校验（现 project 域 + asset.storyId，功能正确）——一致性优化，非必须。

---

## High-Level Technical Design

> *以下说明意图与方向，供评审验证，不是实现规范。实现者当作上下文，而非照抄的代码。*

单图循环的状态流（复用现有资产/信号，新增的只是 creation 侧这层循环交互）：

```
[点"画出来"按钮（桌面）]
   │ 取焦点镜头 + storyArtRecipe(锁定)或 defaultArtRecipe()
   ▼
generateNextImage（确定性单图，不经 LLM tool call，经 renderViaGate 注入配方）
   │
   ├─ 失败（首张/有可保留图）→ inline"出图服务暂时不可用"，保留已有图（R7）
   ├─ 失败（左划后，无可回退图）→ inline 错误 + 重试，不回显被拒图
   │
   ▼ 成功 → 骨架→展示这一张（pending），屏上只此一张
   │
   ├─ "收下"(swipe_right 语义) → selectImage → isPrimary 关键帧 → 结束，原位转 U3 已定态
   └─ "再来一张"(swipe_left 语义) → reject 信号（淘汰、进历史）→ generateNextImage 下一张 → 回展示
   （切焦点镜头时若有未处置 pending：静默丢弃，不记信号）
```

关键：关键帧、淘汰、历史**都已是 `imageAssets` 投影的现成状态**，本计划接的是"出一张→等用户划→再出一张"这层循环，不重造数据。

---

## Implementation Units

### U1. 确定性单图出图端点 + 默认配方 + 失败不清空

**Goal:** 提供一个**不依赖 LLM tool call** 的确定性单图出图入口（供 U2 的循环反复调用），继承锁定配方或新增的轻量默认配方；出图失败时保留旧图 + 明确提示，不再"先清空后失败"。

**Requirements:** R1, R2, R7（F3、AE3）

**Dependencies:** None

**Files:**
- Create/Modify: `server/services/creationAgent.ts`（新增 `generateNextImage`：直调 `renderViaGate` + 焦点镜头 prompt，**不经 LLM tool call**；失败返回结构清晰；与现有 `generateImage` 共用底层）
- Modify: `server/routers.ts`（暴露 `creationAgent.generateNextImage` mutation，带 storyId/userId/焦点镜头；组合 `storyArtRecipe(story)` 锁定值或 `defaultArtRecipe()`）
- Create: `server/services/artDirection.ts` 或同处新增 `defaultArtRecipe()`（未锁定配方时的零点击默认；`storyArtRecipe` 保持只管锁定）
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`（出图失败的状态处理：**不清空** `projectAssets`，inline 提示"出图服务暂时不可用，稍后再试"）
- Test: `server/services/creationAgent.test.ts`（新增；`generateNextImage` 成功/失败结构）+ `server/routers.shot.test.ts`

**Approach:**
- **不改 `StoryArtDirectionStudio.tsx`**：6 张候选 studio 在范围外（见 Scope Boundaries）；"图没了"的 R7 真正目标是 **creation 侧**单图路径，不是候选 studio。studio 里"生成中先清空候选"的行为（`StoryAgentContext.tsx`）本次不动。
- `generateNextImage` 直调 `renderViaGate`（`imageGen.generateImage`），传入焦点镜头 prompt + 配方，返回单张；左划可反复调用它出下一张。配方 = `storyArtRecipe(story)` 锁定值，未锁定则 `defaultArtRecipe()`。
- 失败处理：出图 **resolve 之后**才更新展示；失败分支不动 `projectAssets`，inline 错误（非 toast，见 U2 交互态）。

**Patterns to follow:**
- `creationAgent.generateImage`（`creationAgent.ts:399-422`）现有单张路径 + `renderViaGate`——`generateNextImage` 复用其底层，去掉 LLM tool-call 触发。
- `storyArtRecipe` 注入（已在 creation 端点 routers.ts:1860 喂锁定配方）。

**Test scenarios:**
- Covers AE3. Error path: 出图服务返回 error/timeout → `generateNextImage` 返回结构标失败，前端保留旧图/已有资产、给提示，不清空。
- Happy path: 锁定配方时 `generateNextImage` 出一张，`artDirection` 带该配方 DNA。
- Edge case: 未锁定配方 → 用 `defaultArtRecipe()`，不报错、不强制进 studio。
- Edge case: 出图 resolve 才替换展示；失败时 `projectAssets` 不变。
- Integration: `generateNextImage` 连调两次产出两张不同 pending（证明可被循环反复触发，不依赖 LLM）。

**Verification:**
- 存在一个可被前端直接、反复调用的单图出图端点（带配方、绑焦点镜头）；服务挂时旧图/已有资产还在 + 有提示，不再"图没了"。

---

### U2. creation 侧单图 swipe 循环（出一张→划走→再出一张→直到满意）

**Goal:** 在 creation 侧接上单图循环交互：桌面"画出来"触发 → 出一张 pending 图 → 用户"收下"为关键帧（结束）/ "再来一张"淘汰并出下一张 → 直到满意。

**Requirements:** R3, R5, R9（F1、AE1、AE2、AE4、AE5）

**Dependencies:** U1

**Files:**
- Modify: `client/src/features/creationAgent/views/ShotImageWorkspace.tsx`（单图展示 + **两个按钮**"收下"/"再来一张"；屏上只当前一张；生成中骨架态；空态/失败态/历史区）
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`（循环状态：当前 pending 图、"收下"→ selectImage、"再来一张"→ reject 信号 + `generateNextImage`；切焦点镜头/失败的收尾）
- Modify: `server/routers.ts`（creation 侧 **reject/左划 mutation**——`recordSignal` 现在在 storyAgent router，creation 侧需自己的 swipe_left 入口；或让"再来一张"一步内含 reject+generateNextImage）
- Test: `server/routers.shot.test.ts`（swipe 信号 → 资产状态流转）

**Approach:**
- **桌面交互 = 按钮，不是触摸 swipe**（见 Key Technical Decisions）：creation 是桌面工作区。"收下"= swipe_right 语义，"再来一张"= swipe_left 语义。落库仍是同一套 swipe 信号。
- **入口**：U1 的 `generateNextImage` 是循环的发动机；ShotImageWorkspace 上为焦点镜头提供"画出来"按钮启动循环（首张），之后由"再来一张"反复驱动。
- "收下"：经现有 `creationAgent.selectImage`（→ swipe_right，project 域校验但 signal 带 `asset.storyId`，per-story 正确）→ `isPrimary` 关键帧 → 结束。注意 `selectImage` 可因 availability==='missing' 返回 `success:false`（刚出的图文件未落地）——循环要处理失败、不假设必成。
- "再来一张"：记 swipe_left（creation 侧入口）→ 该图 `rejected` 进历史 → 调 `generateNextImage` 出下一张。
- **交互态**（design-lens 已点，本计划定死，免实现者瞎猜）：
  - **生成中**：图框内同尺寸骨架 + "正在画下一张…"；被拒的上一张**不**保留可见。
  - **循环中途失败**（左划后出下一张失败，没有可回退的"上一张"）：图框内 inline 错误 + "重试"按钮（重调 `generateNextImage`），**不**回显被拒的旧图。R7 的"保留旧图"只适用于有已收下/未处置图可保留时。
  - **切焦点镜头**（有未处置 pending 时切走）：**静默丢弃** pending、不记信号、不弹确认——符合 R3"只为焦点镜头"，避免假 swipe_left。
  - **收下后**：swipe 按钮消失，原位渲染为 U3 的"已定关键帧"态（image+prompt+配方），无需额外成功 toast；焦点不程序化移动。
- 焦点镜头来自现有 focusShotNo；只为它出图（R3 按需逐镜）。

**Patterns to follow:**
- `imageAssets` 的 swipe_right→选中 / swipe_left→rejected 投影。
- `creationAgent.selectImage`（routers.ts:1944-1964，project 域 + asset.storyId）。

**Test scenarios:**
- Covers AE5. Integration: 画出来出第1张→"再来一张"→出第2张（记了第1张 swipe_left）→"再来一张"→第3张→"收下"：第3张 isPrimary 关键帧、循环结束；任一时刻只一张 pending。
- Covers AE2. Integration: 收下后刷新/切故事再切回：该关键帧仍在该镜下、不丢、不串故事（沿用 per-story）。
- Covers AE4. Edge case: 焦点镜头出图只影响该镜，不为其他镜头预渲染。
- Edge case: 循环中途 `generateNextImage` 失败 → inline 错误+重试，不回显被拒图、不中断成"空"。
- Edge case: 有 pending 时切焦点镜头 → 静默丢弃、无 swipe_left 信号、无确认弹窗。
- Edge case: "收下"时 `selectImage` 返回 `success:false`（availability missing）→ 循环保持当前态 + 提示重试，不误判为已收下。
- Edge case: 左划淘汰的图进历史（数据层 swipe_left 已记），不直接消失。

**Verification:**
- 用户能"画出来→不满意再来一张→再出一张"直到满意；满意那张成为该镜关键帧、归属稳固；中途失败/切镜头有明确、不丢数据的收尾。

---

### U3. 镜头序列表（连贯性主视图）+ 单镜画面材料

**Goal:** 把"镜头序列表"做成判断**视频连贯性**的主视图：用户出视频时镜头要连贯，必须能同时看到上一个/下一个镜头。序列表（每行 = 关键帧缩略图 + 提示词）常驻可见，与单镜 `ShotImageWorkspace` 同屏并存（剪辑器式"时间线 + 预览"）；点某行切焦点、驱动现有单图循环。单镜区仍把该镜"画面材料"（关键帧 + 提示词 + 配方）呈现为一体并可微调（R6）。

**Requirements:** R4, R6（F2）, R8

**Dependencies:** U2

**Files:**
- Modify: `client/src/features/analysis/views/ShotTable.tsx`（**U3 必做**：镜头行 = `isPrimary` 关键帧缩略 + 提示词；按镜头顺序排列；常驻、不折叠；点行 → 切焦点镜头）
- Modify: `client/src/features/creationAgent/views/ShotImageWorkspace.tsx`（焦点镜的关键帧 + prompt + 配方一体展示；"改这张"= reviseImage 入口；无关键帧时的空态；与序列表同屏并存）
- Test: `server/routers.shot.test.ts` / 前端组件测试（行↔焦点联动）

**Approach:**
- **序列表是主视图,不是补充**：常驻可见、与单镜工作区同屏（时间线+预览），**不是**折叠/切换后才出现——否则"看上下镜头"无从谈起。行按镜头顺序排，缩略图取该镜 `isPrimary` 关键帧，未出图的镜头留占位（占位即"画出来"发现点，复用 U2/U3 空态）。
- **行→焦点联动**：点某行 → 焦点切到该镜（现有 focusShotNo）→ 驱动 U2 的单图循环；切焦点时若有未处置 pending，按 U2 规则静默丢弃。
- 单镜画面材料：关键帧 = `isPrimary` 资产；prompt = 资产 prompt；配方 = `storyArtRecipe`。三者已在数据里，做"一处可见"的聚合（R8"视频就绪"= 确认三样齐备可作后续视频输入，不加新字段）。
- **空态**（镜头尚无关键帧）：序列表该行 + 单镜区都显示占位 + 内嵌"画出来"，使其成为功能发现点；不空白、不隐藏。
- "改这张" = 对关键帧调 `reviseImage`（整图微调），新版进 pending、满意替换（R6）。
- 其余不变：单图循环、`imageAssets` 复用、失败不清空、配方继承（`storyArtRecipe`/`defaultArtRecipe`）。

**Patterns to follow:**
- `ShotTable.tsx` 现有镜头行渲染；`ShotImageWorkspace` 现有资产展示；`reviseImage` 现有路径；`getStoryImageAssets`（per-story，取各镜 isPrimary）。

**Test scenarios:**
- Happy path: 多镜故事 → 序列表按顺序列出各行；有关键帧的行显示缩略+提示词，无图的行显示占位；序列表与单镜区同屏。
- Integration: 点序列表第 N 行 → 焦点切到该镜 → 单镜区展示该镜画面材料 / 空态；可对该镜启动单图循环。
- Edge case: 焦点镜有未处置 pending 时点别行 → 按 U2 静默丢弃，不记 swipe_left。
- Covers R6. Integration: 对焦点镜关键帧"改暖一点"→ reviseImage 出新版 pending → 收下替换关键帧、序列表该行缩略同步更新。
- Test expectation: R8 为数据形态确认，无新字段——以"关键帧+prompt+配方三者可取到"为验收。

**Verification:**
- 序列表常驻、与单镜区同屏；用户能一眼看到上下镜头的关键帧+提示词判断连贯性；点行切焦点驱动循环；焦点镜画面材料可见可改。

---

## System-Wide Impact

- **Interaction graph:** 触及出图唯一必经点 `renderViaGate` 的调用方（单张路径）；swipe 信号经 `createImageSignal` 影响 `imageAssets` 投影；creation 侧资产查询已 per-story。
- **State lifecycle risks:** 单图循环的"当前 pending 图"是新交互态，循环中途失败/切焦点镜头/切故事时要正确收尾（不残留半截 pending、不串故事）。
- **Unchanged invariants:** 6 张候选 studio、移动端 swipe 流、出图模型、按 storyId 独立、goal 注入均不变；不新建数据表。
- **Integration coverage:** "划走→再出一张→收下为关键帧"这条要真信号+真资产投影的集成测试，mock 证明不了状态流转。

---

## Risks & Dependencies

| 风险 | 缓解 |
|------|------|
| 302.AI/Midjourney 持续不可用，单图也出不来 | 外部故障不在本次范围；本次只保证失败时体验（保留旧图+提示），不修上游 |
| 单图质量不如多候选挑选 | 靠继承锁定配方 + reviseProvide 迭代保证；用户不满意可无限"划走再来" |
| 左划淘汰大量图导致历史膨胀 | 资产投影已有 rejected 状态；历史只读展示，不影响主流程；清理留后续 |
| 循环态与现有 ShotImageWorkspace 耦合 | 复用现有组件、最小新增；失败/切镜头时显式收尾 pending 态 |

---

## Documentation / Operational Notes

- 落地后可在 `docs/agent-architecture-map.md` 的数据流处补一句"画出来=单图循环"，避免未来 AI 退回多候选思路。

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-14-shot-image-as-story-material-requirements.md](../brainstorms/2026-06-14-shot-image-as-story-material-requirements.md)
- 相关代码：`server/services/imageAssets.ts`、`server/services/creationAgent.ts`、`server/services/renderGate.ts`、`server/routers.ts`（storyArtRecipe / createImageSignal）、`client/src/features/creationAgent/views/ShotImageWorkspace.tsx`、`StoryArtDirectionStudio.tsx`
- 相关学习：`docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md`
