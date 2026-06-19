---
title: "refactor: Agent 脊柱第一刀 —— 立单一真相源 + 面板收窄 + 理由贯穿剧本→出图"
type: refactor
status: active
date: 2026-06-18
deepened: 2026-06-18
origin: docs/brainstorms/2026-06-18-002-agent-spine-bidirectional-requirements.md
---

# refactor: Agent 脊柱第一刀

## Summary

把 `StoryAgentContext`（2670 行 god-object）背后的"客户端创作理解"抽到一个 Zustand 单一 store（脊柱），让 storyAgent 系面板按窄 selector 订阅、消除"动一处全体抖"的重渲染风暴；明确脊柱与 react-query 的所有权边界（服务端 body 仍归 react-query）；在同一刀内收敛脆弱的自动保存 effect/ref 以免出现双真相窗口；删除跨面板冗余共享信息；并落地第一个行为证明——"意图 + 理由"作为 shot 上两个可选字段从剧本阶段无损贯穿到出图阶段并回显给用户。

> **本版为评审后修订（deepened 2026-06-18）**：四个 persona 评审（feasibility / coherence / scope-guardian / adversarial）对照真实代码发现若干阻断级问题，已据此重构单元、补全所有权边界、数据安全与跨上下文事实。详见各单元与 Risks。
>
> ⚠️ **2026-06-18 二次修订（canonical 故事）**：用户在界面上发现同一个故事 4 面板内容不统一，正确推出"Agent context 无法统一"。这推翻了原 D1'（"react-query 各管各的 body、脊柱只读"）——见 origin R14–R16、D7。新边界 **D1''**：脊柱拥有唯一 canonical 故事（4 面板是带血缘/过时标记的派生视图），服务端只是持久化、不是竞争真相。**给 Codex：U1 与本修订兼容，写完 U1 后暂停，等本计划的 U3/U5 按新边界更新到位再继续。** 凡文中残留旧 D1' 措辞，一律以 D1'' 为准。

---

## Problem Frame

本该一等公民的"故事的连续理解"在代码里不是独立的东西，被困在前端 god-object `client/src/features/storyAgent/StoryAgentContext.tsx`（2670 行 / 29 useState / 14 useEffect / 14 useRef / 43 useCallback），导致改动艰难。但评审澄清了两点关键事实，必须写进计划：

1. **痛点不只是重渲染，更是 effect/ref 耦合网**：两个自动保存 effect 各依赖约 18 个字段（`StoryAgentContext.tsx` L638、L873），`storyImagesRef`/`confirmedIntentRef`/`isReplyingRef` 等 ref 专门用于把当前值偷渡过 stale 闭包，自动保存定时器（L699–755）刻意用闭包读 `cards/scripts/storyShots`。仅搬状态而把这些 effect/ref 留在 Provider，会制造"状态在 store、effect 仍读 React 旧值"的双真相窗口。
2. **"5 面板共喝一缸水"只对 3 个面板成立**：聊天 / Story Cards / 剧本订阅 `useStoryAgent`；而**动态分镜(`AnimaticPanel`)/提示词表(`PromptTablePanel`) 走的是另一个 `CreationEditorProvider` + react-query**（`client/src/features/creationEditor/CreationEditorContext.tsx`），仅靠 `activeStoryId` 与 `storyUpsert→storyGet.invalidate` 往返同步。shots 因此已存在"前端内存 `storyShots` vs 服务端 `body.shots`"双所有权。

本计划只做"第一刀"（origin D6），不做向上反推、视频线、三管线合并。

---

## Requirements

- R1. 存在一份贯穿创作全程的共享理解（脊柱）作为**客户端创作理解**的单一真相源，承载意图、理由、在途编辑（见 origin R1/R2）。
- R3. storyAgent 系面板只通过窄 selector 读写脊柱，不再共享一缸数据；跨上下文边界（react-query 持有的服务端 body）明确化（见 origin R3/R11）。
- R5. 每个决定附可回看、可持久化的"为什么"，作为 shot 上的字段（见 origin R5）。
- R-D6a. 5 个面板各收窄到一个创作方向、走窄接口，仅故事聊天贯穿；删除电脑端冗余跨面板共享信息（见 origin D6/R11）。
- R-D6b. 行为证明：意图 + 理由从剧本阶段无损贯穿到出图阶段（见 origin D6）。

**Origin actors:** A1（创作者）、A2（阶段感知 Agent）、A3（渲染下游）
**Origin flows:** F2（选区+面板+对话修改）、F3（向下投影+按钮晋级）
**Origin acceptance examples:** AE3（选中镜头口述"再压抑一点"→ Agent 调整并给理由，理由写回脊柱可回看，covers R5/R12）

**Origin R4/R6/R7 处置**：R4（阶段感知）、R6（管住输入）、R7（选区+面板+对话）属脊柱之上的交互层，**本刀不实现其完整行为**，只保证脊柱结构不挡路。R2（带出处的编辑账本）的消费端属向上反推，**本刀不建账本**，仅在 shot 上落 intent/rationale 两字段。

---

## Scope Boundaries

- 不在本计划：向上反推（下游手改→反推剧本）、视频渲染线实现、"面板即上下文"完整实现、三管线合并——均见 origin 的 Deferred / Outside subsections。
- 不改"渲染脱钩 + 按钮晋级"的现有触发方式（origin R8/R9）。
- 不新增意图编辑用按钮（origin "Outside this product's identity"）。
- **不把服务端 body（cards/shots/images）的所有权搬进脊柱**——react-query 仍是服务端态的所有者（见 Key Technical Decisions D1'）。
- **不建"编辑事件账本"**（origin R2/D2 的数据结构）——那是向上反推的地基，砍出本刀。

### Deferred for later

- 向上反推（像素/提示词手改 → 反推剧本）及其编辑账本数据结构：北极星能力，AI 质量驱动，需单独验证与独立的数据模型设计（见 origin）。
- 视频线渲染实现：脱钩边界与"过时/晋级"机制留位，不实现渲染（见 origin）。
- "面板即上下文"完整实现：架构留位，不建（见 origin）。
- 三条平行管线正式合并：脊柱落地后的自然结果（见 origin）。

### Outside this product's identity

- 用按钮做意图/理解层面的编辑——意图编辑必须靠对话。
- 上游变化自动级联重渲染下游。
- 推倒重写。

### Deferred to Follow-Up Work

- 手机线（`client/src/features/mobileChat`）与创作线（`creationAgent`）接入同一脊柱：后续 PR，待桌面脊柱稳定后进行。
- **纯粹的"按域拆动作 hook"瘦身**（原 U3 的非必要部分）：作为机会性清理，可在 U1–U4 落定后按需进行，不作为本刀的 gated 单元。
- "理由"向后期/视频阶段的进一步贯穿。

---

## Context & Research

### Relevant Code and Patterns

- `client/src/features/storyAgent/StoryAgentContext.tsx` — 2670 行 god-object。切片蓝本：`StoryAgentContextValue`（L146–233）。**高危区**：自动保存 effect（L638、L873）、自动保存定时器闭包（L699–755）、ref 镜像（`storyImagesRef` L523、`confirmedIntentRef`/`pendingIntentDraftRef` L537、`isReplyingRef` L572）、hydration 门 `hydratedFor`（L580）、`serverRevisionRef`、`promptPool = useMemo(buildPromptPool(visualCanvasItems))`（L2484）、`prepareArtDirection`（L1991 读 cards+messages+visualCanvasItems+storyShots）。
- **两个 Provider 的真相**：storyAgent 系（聊天/卡片/剧本）= 内存 Context；动态分镜/提示词表 = `client/src/features/creationEditor/CreationEditorContext.tsx`（react-query，`storyGet`/`storyImages` 查询，`normalizeStoryShots` L219 从 body 再派生第三套 shot 形状）。二者仅经 `WorkspaceLayout.tsx` L234 的 `<CreationEditorProvider activeStoryId>` 与 L69 的 `activeStoryId` 桥接。
- 面板真身（`client/src/features/analysis/storyPanels.ts`）：`storyCards / script / animatic / promptTable` + 故事聊天 = 5。
- 持久化与保存路径：`server/db.ts`（body 跟 cwd，含写前备份/缩水检测/测试写保护 L144–384）；`server/services/storySync.ts`（`prepareStoryBody` L83 = **整体 body 覆盖写**；`mergeStaleStoryBody` L92 仅冲突路径；`mergeStableArray` L42 按 `shotNo` 去重）；`server/routers.ts` storySave（L1428–1462）。
- shot 类型三处：`drizzle/schema.ts` `StoryBody.shots`（L243–265）、`client/src/features/storyAgent/types.ts` `StoryShot`（L83）、`creationEditor` `normalizeStoryShots`。
- 剧本→出图：`server/services/composeScenePrompt.ts`（`composePromptFromAnalysis` 读 `SceneAnalysis`，无 shot 引用/无 rationale，输出 900 字截断 L34）；`SceneAnalysis` 定义在 `shared/sceneAnalysis.ts` L11；**两个调用点**：`server/routers.ts` L1648（`generateForMobile`）、`server/services/creationAgent.ts` L600（桌面）。
- 选区编辑既有种子：`activeSelection`/`sendSelectionEdit`（L224–228）、`storyAgent.selectionEdit`（routers L1192）。

### Institutional Learnings

- `docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md` — 故事为唯一单位、镜头按 storyId 绑定，脊柱须沿用。
- AGENTS.md 数据铁律：本地持久化跟 `process.cwd()` 走，已有两次数据分裂事故（2026-06-01、2026-06-12）。触及 `body` 的字段变更必须**写向也安全**（不仅读向兼容）；验证回主仓 3000 端口，**worktree 不跑 dev server**。

### External References

- 未做外部调研；React Context→Zustand 抽取、selector 等值（`zustand/shallow` / `useStoreWithEqualityFn`）为成熟模式，本地 react-query 已确立"服务端态独立所有者"心智，足以支撑。

---

## Key Technical Decisions

- **脊柱机制 = Zustand 单一 store**（用户拍板）：作为"客户端创作理解"的单一真相源，自带 selector 精准重渲染。客户端当前无状态库（仅 react-query 管服务端态），新增一个小依赖，**仅限本 store，不作为其他客户端态的先例**。
- **D1'' canonical 故事边界（2026-06-18 二次修订，取代 D1'）**：**脊柱拥有唯一 canonical 故事**——cards / scripts / shots / prompts 都是它**带血缘（派生自上游哪个版本）+ 过时标记**的派生投影；intent/rationale 挂在 shots 上。4 个面板从脊柱投影，**动态分镜/提示词表不再从服务端 body 另起一份 `normalizeStoryShots` 派生**（那正是"第 4 份真相"）。服务端 body 是脊柱的**持久化下游**（保存/加载传输），不是竞争真相。
  - *为何推翻 D1'*：D1'（保留两层、脊柱只读）治得了重渲染，治不了"4 份真相打架→Agent context 无法统一"（origin R14）。
  - *同源但脱钩*：canonical 故事始终唯一自洽；下游阶段产物可滞后，但滞后是**显式"过时"状态**、由用户按钮重生（origin R15/R16），不是静默不一致。
- **D1'（已废弃）**：原"react-query 各管各 body、脊柱只读"。保留此条仅为追溯，**执行以 D1'' 为准**。
- **同刀收敛 effect/ref（评审后强化）**：U1 不止搬状态——必须在同一单元内把两个自动保存 effect + hydration 门 + ref 镜像收敛为"由 store 驱动的单一持久化路径"，定时器改读 `store.getState()`，删除 ref 镜像，`hydratedFor`/`serverRevision` 变为 store 字段。否则留双真相窗口。
- **intent / rationale = shot 上两个可选字段，per-shot**：`intent?: string | null`（该镜演进中的意图）、`rationale?: string | null`（Agent 为何这么设）。**本刀不建编辑事件账本**。旧故事缺字段读为 null。
- **写向数据安全（评审后新增）**：`prepareStoryBody` 改为**字段保留式合并**——当传入 body 缺 `intent`/`rationale` 时，从既有 body 保留，绝不整体覆盖抹除（防被 defer 的手机/创作线一存抹光）。
- **派生切片等值**：`promptPool`、art `references` 等派生值要么物化为 store 字段（由所属 action 更新、引用稳定），要么用 `zustand/shallow`/自定义比较，避免拖拽锚点时引用变化引发重渲染或 Zustand 循环。
- **特征化先行**：脊柱抽取/effect 收敛/持久化改动在弱测试区，先用 vitest 钉住"故事加载/保存/卡片编辑/自动保存快照/出图"现状再动。

---

## Open Questions

> **执行准则（给 Codex）**：以下"实现期决定"不是让执行代理自行拍板，而是**到点必须产出选择、停下来标为 checkpoint 等确认**，尤其是 worktree 内无法用 dev server 验证的 runtime 行为。

### Resolved During Planning

- 脊柱机制 → Zustand（用户确认）。
- 所有权边界 → D1'：服务端 body 归 react-query，脊柱只持客户端理解。
- intent vs rationale → shot 上两个可选字段，per-shot，无账本。
- 5 面板真身 → 聊天 + storyCards + script + animatic + promptTable，其中后两者跨 creationEditor。

### Deferred to Implementation（均为 surface-and-stop checkpoint）

- U4 冗余共享删除清单：先产出**书面候选清单**并复核再删；runtime-only 依赖标 manual-gated（worktree 不能跑 dev 验证）。
- U3 creationEditor 面板接脊柱方式：默认 D1'（保持 react-query 持有，脊柱经 selector 读）；若实现中发现需接管，停下来确认。
- U2 派生切片的具体等值策略（物化字段 vs shallow）：按面板实际派生形状定，产出选择即停。

---

## High-Level Technical Design

> *以下用于说明意图方向、供评审验证，并非实现规范。实现代理应作为上下文而非照抄的代码对待。*

```
            ┌──────────────────────────────┐         ┌────────────────────────┐
            │  storySpine (Zustand)         │  读取    │  react-query (服务端态) │
            │  客户端理解：intent/rationale  │ ──────▶ │  持久化 body            │
            │  /在途编辑/选区/UI工作态/存盘态 │  selector│  cards/shots/images     │
            │  + 单一持久化路径(收编旧effect) │         └────────────────────────┘
            └──────────────────────────────┘                 ▲ 字段保留式合并写
               ▲ 窄/等值 selector 订阅                         │ (缺字段不抹除)
   ┌───────────┼───────────┐                ┌─────────────────┴─────────────┐
 故事聊天   StoryCards    剧本   ← storyAgent 内存系   动态分镜   提示词表 ← creationEditor/react-query
 (贯穿)                                      (D1': 经 selector 读 body，不搬所有权)

行为证明（向下投影）：
 剧本写 shot.intent+rationale → 持久化(保留式) → SceneAnalysis 加可选字段 → 两个 compose 调用点都带 →
 rationale 作为生成图记录"同级字段"（不进900字prompt）→ 出图回显"当前为什么"(不做历史UI)
```

---

## Implementation Units

### U1. 建脊柱 store + 迁移 canonical 状态 + 同刀收敛持久化 effect/ref（消除双真相窗口）

**Goal:** 引入 Zustand `storySpine` 作为客户端理解的单一真相源，迁移 canonical 客户端态，并在**同一单元内**把两个自动保存 effect、hydration 门、ref 镜像收敛为 store 驱动的单一持久化路径——`useStoryAgent()` 对外签名不变，但内部无任何"React 态↔store"镜像 effect 残留。

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Create: `client/src/features/storyAgent/spine/storySpine.ts`
- Create: `client/src/features/storyAgent/spine/storySpine.test.ts`
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`
- Modify: `package.json`（加 zustand）

**Approach:**
- **store 即 canonical 故事（D1''）**：store 模型把 cards/scripts/shots/prompts 建为唯一故事的派生投影，**每个阶段产物从一开始就带 `derivedFrom`（上游版本指纹）+ `stale` 标记字段**——哪怕首版还不点亮过时 UI，字段先留位，避免日后重构（详见 U5 的血缘/过时落地）。intent/rationale 挂 shots。
- 先做"effect 清单"：枚举 14 个 effect，分类为 (a) 纯派生→selector、(b) 持久化副作用→收敛为对 store 的单一订阅、(c) ref 镜像 hack→store 同步读后删除。
- 自动保存定时器改读 `store.getState()`，不再用 stale 闭包；`hydratedFor`/`serverRevision`/`lastSnapshotHash` 移入 store 字段。
- 删除 `storyImagesRef`/`confirmedIntentRef`/`pendingIntentDraftRef`/`isReplyingRef` 等镜像，统一从 store 读。
- 验收标准改为"两个保存 effect + hydration 门收敛为单一 store 驱动路径，无镜像 effect 残留"，而非仅"状态搬走"。

**Execution note:** 特征化先行——迁移前补"加载→编辑→自动保存tick→快照"的现状测试，作基线。

**Patterns to follow:** react-query"外部态+订阅"心智；origin storyId 绑定约束。

**Test scenarios:**
- Happy path：加载故事 → store 持有客户端态，`useStoryAgent()` 读值与迁移前一致。
- Edge case：空/新建故事 store 初始态正确，无 undefined 抛错。
- Integration（关键）：加一张故事图后立即触发自动保存 tick → 快照含该图、**不丢字段**（防 stale 闭包/ref 滞后）。
- Integration：单次逻辑改动只触发一条持久化写，**不双写**（防两个保存 effect 竞发）。
- Edge case：hydration 未完成时不让空 store 覆盖已加载故事（`hydratedFor` 门生效）。

**Verification:** 基线特征化测试全绿；`StoryAgentContext.tsx` 内无残留镜像 effect；主仓 3000 端口手测加载/编辑/自动保存与迁移前一致、无数据丢失。

---

### U2. storyAgent 系面板走窄/等值 selector 订阅（消除重渲染风暴，含派生切片）

**Goal:** 把聊天 / StoryCards / 剧本三个 storyAgent 系面板从整块 `useStoryAgent()` 改为按 selector 只订阅各自切片；**派生切片**（如 promptPool、art references）用物化字段或 `zustand/shallow` 保证引用稳定，确保跨域派生用例也不再连锁重渲染。

**Requirements:** R3, R-D6a

**Dependencies:** U1

**Files:**
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- Modify: `client/src/features/storyAgent/views/StoryCardsBoard.tsx`
- Modify: `client/src/features/storyAgent/views/ScriptViewer.tsx`
- Create: `client/src/features/storyAgent/spine/selectors.ts`
- Test: `client/src/features/storyAgent/spine/selectors.test.ts`

**Approach:**
- 每面板定义最小 selector；派生值物化进 store（由所属 action 更新）或 shallow 比较，避免新引用。
- 不改面板视觉与交互，只换数据来源与订阅粒度。
- 动态分镜/提示词表**不在本单元**（见 U3，跨 creationEditor）。

**Test scenarios:**
- Happy path：改 cards 只触发 StoryCards 重渲染，剧本/聊天不重渲染（render 计数断言）。
- Edge case（关键，adversarial 指定）：拖动视觉锚点 10px（`updateVisualCanvasItem`）→ 断言提示词表/派生面板 render 计数**不变**（防 promptPool 新引用风暴）。
- Integration：聊天发消息更新 messages → 仅聊天面板重渲染。

**Verification:** render 计数测试含拖拽派生用例全绿；主仓 3000 端口手测操作跟手、不卡。

---

### U3. 把动态分镜/提示词表统一到 canonical 脊柱（消除"第 4 份真相"）

**Goal:** 实现 D1''：动态分镜/提示词表不再从服务端 body 另起 `normalizeStoryShots` 派生一份 shots，而是**读 canonical 脊柱的 shots 投影**——4 面板真正同源。`CreationEditorProvider` 的服务端往返降级为持久化/加载传输，不再充当竞争真相源。

> ⚠️ 本单元承载 D1'' 的核心改动。**Codex 写完 U1 后在此暂停，等用户确认本单元最终形态再动手**——这是会让"是否搬迁服务端所有权"卡住执行的载入性决定，已由用户拍板（同源、脱钩、带过时标记）。

**Requirements:** R3, R-D6a, R14, R16

**Dependencies:** U1

**Files:**
- Modify: `client/src/features/creationEditor/CreationEditorContext.tsx`（shots 来源从 `normalizeStoryShots(server body)` 切到 canonical 脊柱投影；react-query 仅保留加载/保存传输）
- Modify: `client/src/features/creationEditor/views/AnimaticPanel.tsx`
- Modify: `client/src/features/creationEditor/views/PromptTablePanel.tsx`
- Modify: `client/src/features/analysis/views/WorkspaceLayout.tsx`（桥接收敛）
- Test: `client/src/features/creationEditor/spine-projection.test.ts`

**Approach:**
- 动态分镜/提示词表的 shots 改为脊柱投影；删除"内存 storyShots vs 服务端 body.shots"双所有权——4 面板都从 canonical 故事读。
- 保留脱钩：下游投影可带 `stale` 标记（U5 落地数据，UI 可后续点亮），但**源唯一**。
- 持久化：脊柱→服务端为单向同步（保存），加载时 hydrate 脊柱；react-query 不再是并行真相。

**Test scenarios:**
- Happy path：动态分镜/提示词表与 Story Cards/Script 对同一故事**内容一致**（同源断言）。
- Integration：改 cards 后，分镜面板读到的 shots 来自同一 canonical 故事，不再出现"内存改了、面板没跟/打架"。
- Edge case：`activeStoryId` 切换后单源 hydrate 正确，无残留旧故事数据。

**Verification:** 4 面板对同一故事同源一致；无 `normalizeStoryShots(server body)` 的并行派生残留；主仓 3000 端口手测切故事数据一致。

---

### U4. 删除跨面板冗余共享信息（先清单后删，runtime 依赖 manual-gated）

**Goal:** 定位并删除面板间点对点共享/重复状态，统一经脊柱（或 D1' 边界）读取——但以"先产出书面冗余清单并复核"为前置，避免开放式横扫。

**Requirements:** R3, R-D6a

**Dependencies:** U2, U3

**Files:**
- Create: `docs/plans/u4-redundancy-inventory.md`（候选清单交付物，复核后再删）
- Modify: `client/src/features/analysis/views/WorkspaceLayout.tsx`
- Modify: `client/src/features/analysis/views/AnalysisWorkspace.tsx`
- Modify: 受影响面板组件（按清单复核后定）
- Test: `client/src/features/storyAgent/spine/redundancy-isolation.test.ts`

**Approach:**
- 先枚举 WorkspaceLayout/AnalysisWorkspace 透传 props 与各面板自存重复态，列入 inventory，逐项标"走脊柱 / 真冗余可删 / runtime-only（manual-gated）"。
- **runtime-only 依赖一律标 manual-gated**——worktree 内无法跑 dev 验证，须回主仓 3000 端口人工确认后再删。
- 复核通过的项才删，删后用 selector 直读。

**Test scenarios:**
- Edge case：删除某冗余共享态后，依赖它的面板仍从脊柱/边界取到等价值。
- Integration：A 面板改动不再经共享 prop 牵连 B 面板（断言 B 不受影响）。

**Verification:** inventory 文档存在且已复核；面板 props 表面变窄；主仓手测"改一个面板不串到别的"。

---

### U5. 给阶段产物加 intent/rationale + 血缘/过时 字段 + 写向安全（三处类型同改）

**Goal:** 在 shot 模型新增 `intent?`/`rationale?`（per-shot，无账本），并为各阶段产物落地 **`derivedFrom`（派生自上游哪个版本指纹）+ `stale`（过时标记）** 数据模型（R15）——上游变化时下游标过时、不自动重算（R16，UI 点亮可后续）。三处类型同步，持久化改字段保留式合并，确保缺字段的客户端不抹除已有数据。

**Requirements:** R5, R-D6b, R15, R16

**Dependencies:** U1

**Files:**
- Modify: `client/src/features/storyAgent/spine/storySpine.ts`
- Modify: `client/src/features/storyAgent/types.ts`（`StoryShot`）
- Modify: `drizzle/schema.ts`（`StoryBody.shots[]` 加可选字段）
- Modify: `client/src/features/creationEditor/CreationEditorContext.tsx`（`normalizeStoryShots` 透传新字段）
- Modify: `server/services/storySync.ts`（`prepareStoryBody` 字段保留式合并）
- Test: `server/services/storySync.preserve-rationale.test.ts`

**Approach:**
- 字段一律可选（`intent?/rationale?: string | null`；`derivedFrom?: string | null`；`stale?: boolean`），旧故事读为 null/false、不报错。
- 血缘最小实现：阶段产物记录上游版本指纹；上游变化时由所属 action 把下游 `stale=true`。**本刀只落数据 + 标记逻辑，不建过时 UI、不建按钮重生**（origin R16 的 UI 属后续）。
- `prepareStoryBody`：传入 body 缺这些字段时从既有 body 保留，绝不整体覆盖抹除。
- 三处类型（drizzle / types / normalizeStoryShots）同改，保证 `body → normalize → body` 往返不丢字段。

**Execution note:** 触及持久化——先加 body 形状快照测试钉住现状，再增量加字段（AGENTS.md 数据铁律）。

**Patterns to follow:** 既有 `intentSummary`（types.ts L75）、`storyImages`/`body.mobileImages` 持久化；`mergeStableArray`（storySync L42）。

**Test scenarios:**
- Happy path：写带 rationale 的 shot → 保存 → 重载，rationale 原样保留。
- Edge case：加载缺字段旧故事 → 读为 null、不破坏其余字段。
- Integration（关键，adversarial 指定）：**缺 rationale 字段的"手机形状" body 覆盖存到已有 rationale 的桌面 body → rationale 存活**（验字段保留式合并）。
- Integration：`body → normalizeStoryShots → body` 往返新字段不丢（三处类型一致）。

**Verification:** 保留式合并测试 + 往返测试绿；旧故事正常加载；主仓 3000 端口验证存取无数据异常。

---

### U6. 行为证明：理由从剧本无损贯穿到出图并回显（仅当前理由）

**Goal:** 让剧本阶段把 intent+rationale 写到对应 shot，经 `SceneAnalysis` 可选字段在**两个 compose 调用点**都带上，理由作为生成图记录的**同级字段**（不进 900 字 prompt），最终在指定面板回显"当前为什么这么画"（不做历史 UI）。

**Requirements:** R-D6b, R5

**Dependencies:** U5

**Files:**
- Modify: `shared/sceneAnalysis.ts`（`SceneAnalysis` 加 `rationale?`/`intent?` 可选字段）
- Modify: `server/services/scriptAgent.ts`（剧本产物挂 intent/rationale 到 shot）
- Modify: `server/services/composeScenePrompt.ts`（读取并保留 rationale，作同级字段、不拼进 prompt）
- Modify: `server/routers.ts`（`generateForMobile` L1648 调用点透传）
- Modify: `server/services/creationAgent.ts`（**第二个 compose 调用点** L600 透传）
- Modify: 指定回显面板（明确为 StoryCards 一侧的图卡片现有文字槽，spine 可读）
- Test: `server/services/composeScenePrompt.rationale.test.ts`

**Approach:**
- 剧本→shot→SceneAnalysis→出图 每一跳显式带 rationale；compose 现仅读 subject/action/emotion，扩展为同时保留 rationale 为同级字段。
- 回显**仅显示当前 rationale**（不做历史/账本列表 UI），走现有图卡片文字槽，不新增按钮（origin 交互边界）。
- 明确回显落点为 spine 可读的 storyAgent 系面板，避免依赖 U3 未决的 creationEditor 所有权。

**Test scenarios:**
- Happy path：剧本生成带 rationale → 两个 compose 调用点输出都保留 rationale → 生成图携带可回看的"为什么"。
- Covers AE3：选中镜头口述"再压抑一点" → Agent 调整并产理由 → 写回脊柱、出图回显、可回看。
- Error path：剧本未产 rationale 时出图降级为无理由、不报错。
- Integration：剧本写入的 rationale 到**两个**出图调用点端到端不丢（防只接一个调用点的半成品）。

**Verification:** compose 链路测试证明两调用点 rationale 无损；主仓 3000 端口手测：改剧本→出图→图上看到对应"为什么"。

---

## System-Wide Impact

- **交互图：** 脊柱挂载点（WorkspaceLayout / AnalysisWorkspace / WorkspaceStageRouter / CreationPage）订阅方式改变；两个 compose 调用点（generateForMobile + creationAgent）需带 rationale。
- **错误传播：** rationale 缺失须全链路降级为 null、不抛错。
- **状态生命周期风险：** 持久化改保留式合并以防缺字段客户端抹除；U1 期间不得留"React 态↔store"镜像 effect；故事 body 所有权仍归 react-query（D1'）。
- **API 表面对齐：** 手机线/创作线暂不接脊柱，但 rationale 在共享类型上为可选、且保留式合并保证它们的写不抹除桌面侧字段。
- **集成覆盖：** 跨面板隔离（U4）、缺字段覆盖存活（U5）、两调用点 rationale 贯穿（U6）须有集成断言。
- **不变量：** 故事为唯一单位、镜头按 storyId 绑定不变；渲染脱钩+按钮晋级不变；意图编辑不加按钮不变；服务端 body 所有权不变（仍 react-query）。

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U1 留"状态在 store、effect 读 React 旧值"双真相窗口 → 自动保存丢字段/双写/hydration 竞态 | effect 清单先行；定时器读 `store.getState()`；删除 ref 镜像、`hydratedFor`/`serverRevision` 入 store；验收=单一持久化路径、无镜像 effect；加"编辑+保存tick不丢字段"特征化测试 |
| 缺 rationale 字段的客户端整体覆盖存 → 抹除 rationale（AGENTS.md 两次案底） | `prepareStoryBody` 字段保留式合并；U5 集成测试"手机形状 body 覆盖存→rationale 存活" |
| 派生切片 selector 引用不稳 → 拖拽锚点重渲染风暴/Zustand 循环 | 派生值物化为 store 字段或 shallow 比较；U2 加拖拽 render 计数测试 |
| "5 面板一缸水"前提对 2 面板不成立 → U2/U4/U6 误当原子提交 | 拆出 U3 划清 react-query 边界（D1'）；U6 回显落点选 spine 可读面板，不依赖 U3 未决项 |
| shot 类型三处不同步 → 往返丢字段 | U5 同改 drizzle/types/normalizeStoryShots + 往返测试 |
| U6 只接一个 compose 调用点 → 桌面/手机半成品 | U6 Files 显列两调用点 + "两调用点端到端不丢"集成测试 |
| U4 开放式横扫滑向重写（用户核心恐惧） | 先出书面 inventory 复核后删；runtime-only 标 manual-gated（worktree 不能跑 dev） |
| Codex 在"实现期决定"处擅自发明设计 | Open Questions 全标 surface-and-stop checkpoint；worktree 内 runtime 行为不可验证项一律 manual |

---

## Success Metrics

- **开发摩擦的可证伪量度（adversarial 建议）**：以"新增一个 shot 字段需触碰的文件数"为前后对比基线。若 U1–U4 后该数未明显下降，则"god-object 结构是瓶颈"的前提被证伪，应把 effect/动作去耦进一步前移。界面跟手（selector 收益）是必要非充分条件。
- origin 三条结构性成功标准（改 Agent 行为只动一处、面板不串、界面不卡）在 Phase 1 后即可独立验证。

---

## Documentation / Operational Notes

- 验证一律回主仓 3000 端口（`pnpm dev`）；worktree 只改代码、不跑服务（AGENTS.md）。
- 诊断环境先 `pnpm env:status`；疑似数据问题先看 `.webdev/backups/`。
- 脊柱落地后建议在 `docs/solutions/` 补"god-context→Zustand 脊柱 + react-query 边界"的迁移学习。

---

## Phased Delivery

### Phase 1 — 结构第一刀（止痛，可独立交付/验证）
- U1（脊柱+收敛 effect）→ U2（窄/等值 selector）→ U3（划清 react-query 边界）→ U4（清单后删冗余）。落地后："改一个面板不再串"、界面不卡、持久化更安全。U5/U6 仅依赖 U1，排期紧时可与 U3/U4 并行起步。

### Phase 2 — 第一个行为证明（验证模式）
- U5（两字段+写向安全）→ U6（理由两调用点贯穿+回显）。验证"脊柱携带理解贯穿阶段"成立，再往两头延伸。

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-18-002-agent-spine-bidirectional-requirements.md
- 评审：feasibility / coherence / scope-guardian / adversarial（2026-06-18，对照真实代码）
- 关键代码：`client/src/features/storyAgent/StoryAgentContext.tsx`、`client/src/features/creationEditor/CreationEditorContext.tsx`、`server/services/storySync.ts`、`server/services/composeScenePrompt.ts`、`server/services/creationAgent.ts`、`shared/sceneAnalysis.ts`、`drizzle/schema.ts`、`server/db.ts`
- 相关学习：`docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md`
- 环境规则：`AGENTS.md`、`docs/environment-guide.md`
