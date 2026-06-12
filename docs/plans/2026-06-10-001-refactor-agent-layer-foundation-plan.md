---
title: "refactor: Agent 层打地基（出图收口 / 剧本抽离 / 库支撑判断 Agent）"
type: refactor
status: active
date: 2026-06-10
origin: docs/brainstorms/2026-06-10-agent-layer-foundation-requirements.md
---

# refactor: Agent 层打地基（出图收口 / 剧本抽离 / 库支撑判断 Agent）

## Summary

把 Agent / 出图层的地基分成 **7 个按依赖排序的单元**落地：抽共享库底座 → 搭文学库 → 收口出图网关 → 抽剧本职责 → 抽后端对话骨架 → 抽前端脚手架 → 刷新文档与注释。所有改动**行为保持不变**（判断 / 共鸣算法留为 identity 桩），碰到运行中的出图 / 剧本路径的单元采用 **characterization-first**（先固化现有行为再重构），22 个测试全程保持绿。

---

## Problem Frame

现状里"每加一个 Agent 就复制一遍骨架"的冗余已有具体苗头：出图入口散落在 4+ 处且绕过已有的合成缝、剧本逻辑埋在 2038 行的 `StoryAgentContext.tsx`、美术仓库 `styleLibrary` 给"后续排序器"留的字段无人消费。规划期进一步核实发现**出图后端其实是两套**（见 Key Technical Decisions），印证了收口的必要。完整问题背景见 origin（Sources & References）。

---

## Requirements

本计划满足 origin 的 R1–R15（逐条追溯）：

- R1. 收口 4+ 处 `generateImage` 到单一出图网关 → U3
- R2. 网关内留"判断→styleLibrary→shotPromptComposer"插入点，本轮透传 → U3
- R3. 美术 Agent 判断逻辑本轮占位不实现 → U3
- R4. 剧本 + 台词职责从 storyAgent 抽成独立单元（纯搬移） → U4
- R5. 剧本 Agent 读取文学库的插入点（本轮可选桩） → U4
- R6. 照 `docs/style-library/` 形状新建文学库 → U2
- R7. 抽 styleLibrary 与文学库的通用加载底座 → U1
- R8. 文学库本轮只放 1–2 个样例条目 → U2
- R9. 抽后端"对话 Agent 骨架" → U5
- R10. 抽前端"Agent Context + Chat 脚手架" → U6
- R11. 用 creationAgent 当采纳样板，不强拆 StoryAgentContext → U5, U6
- R12. 刷新 `architecture-map.md` 的 Agent 章节 → U7
- R13. 写《如何新增一个 Agent》模板 → U7
- R14. 给 Agent 层 + 共享底座文件加中文注释 → U7
- R15. 全程 22 测试通过、行为不变 → 每个单元的 Verification + 见 Key Technical Decisions

**Origin flows:** F1（出图收口 → U3）、F2（新增对话 Agent → U5, U6, U7）
**Origin acceptance examples:** AE1（covers R1,R2 → U3）、AE2（covers R7 → U1）、AE3（covers R9,R13 → U5,U7）、AE4（covers R4,R15 → U4）

---

## Scope Boundaries

- 不实现任何判断 / 共鸣算法（美术选流派、剧本专业化、文学家匹配）——只留 identity 桩。
- 不建完整文学家条目库，只放 1–2 个样例种子。
- 不强拆 2038 行的 `client/src/features/storyAgent/StoryAgentContext.tsx`。
- 不改 mobile 端现用的生成器选择（保持其现有行为）。
- 美术 Agent 的"出图后再评判 / 自动重试"不做——本轮只搭"出图前"网关。
- 不动其余 ~200 个非 Agent 文件、数据库 schema、认证 / 纳音 / 分析等无关模块、不加新依赖。
- 中文注释只覆盖 Agent 层 + 共享底座文件，不做全库注释。

### Deferred to Follow-Up Work

- **合并两套出图生成器**（`server/_core/imageGeneration.ts` 与 `server/services/imageGen.ts`）：本轮网关对两者都做透传收口，但不统一其签名 / 返回形 / 熔断行为。合并改变行为风险，留作后续 PR。

---

## Context & Research

### Relevant Code and Patterns

- `server/services/styleLibrary.ts` —— 库加载范式样板（YAML + zod 校验 + 坏条目跳过 + 目录缓存 + `getActive/getAll` + `styleToFragments`）。U1 从这里抽底座。
- `docs/style-library/`（`_TEMPLATE.yaml` / `MANUAL.md` / `entries/*.yaml`）—— 文学库照此形状建（U2）。
- `server/services/shotPromptComposer.ts` —— "每镜出图 prompt 唯一合成缝"，未来美术判断在网关内调它（U3 留接口）。
- `server/services/creationAgent.ts`（289 行）—— 对话 Agent 骨架的抽取源 + 采纳样板（U3 出图点、U5 骨架）。
- `server/_core/agentChannel.ts`（`invokeAgent`）、`server/_core/llmJson.ts`（`parseJsonLoose`）—— 已抽好的共享底座，骨架复用它们。
- `client/src/features/creationAgent/`（Context 312 行 + Chat 202 行）—— 前端脚手架抽取源 + 采纳样板（U6）。
- 出图调用点：`server/services/creationAgent.ts`（generateImage）、`server/services/artAgent.ts`、`server/routers.ts`（`generateForMobile` / `mobileInpaint`）、以及 `inpaintImage` 局部重绘路径。

### Institutional Learnings

- 无 `docs/solutions/` 目录，无既往沉淀可引。

### External References

- 不需要外部研究：库加载 / Agent 骨架 / 出图收口都有强本地范式（styleLibrary、agentChannel、creationAgent）可循。

---

## Key Technical Decisions

- **出图后端确为两套，本轮收口不合并**：`server/_core/imageGeneration.ts`（92 行，`{url}`，仅 mobile 端用）与 `server/services/imageGen.ts`（519 行，带熔断，`{status,imageUrl,imageKey}`，creation/art 用，另含 `inpaintImage`）。网关把全部出图 / 重绘出口透传收口（各入口保留自己的后端当 delegate），**生成器合并列为 Follow-Up**。理由：合并签名 / 返回形 / 熔断有真实行为风险，与"行为不变"冲突。
- **网关本轮是 identity 透传**：先收口调用点、保证逐字节行为不变、测试全绿；美术判断后续填进同一个缝。"收口"与"加智能"分两步是降风险核心。
- **剧本抽离 = 纯搬移**：保留现有 `synthesizeShotList` 等的对外契约，不改行为；对话式精修留后。
- **文学库底座抽象建立在两个真实实例上**（styleLibrary 已存在 + 文学库确定要建），非过早抽象；两库各自只留 schema 与"条目→片段"映射。
- **前端脚手架形态** = Context 工厂 + `useAgentChat` hook + 通用 `AgentChat` 组件；creationAgent 当样板，StoryAgentContext 不动。
- **共享库底座落位** `server/services/libraryLoader.ts`（与 styleLibrary 同层，迁移面最小）。

---

## Open Questions

### Resolved During Planning

- 两套出图实现如何处理？→ 网关透传收口两者，不合并生成器（合并入 Follow-Up）。
- 剧本 Agent 接口形状？→ 纯搬移现有 synthesize 契约，对话精修留后。
- 文学库 schema？→ 起步字段照 styleLibrary 形状（见 U2），实现期可微调。
- 前端脚手架形态？→ Context 工厂 + hook + 通用组件。
- 共享底座放哪层？→ `server/services/libraryLoader.ts`。

### Deferred to Implementation

- 网关的 `Renderer` delegate 抽象是否需要归一化两套返回形，还是各调用点各自适配——接线时按真实代码定。
- `literatureToFragments` 落到 `shotPromptComposer` 的哪些槽位 / 还是剧本侧另立消费点——取决于剧本 Agent 后续怎么吃它。
- 后端骨架抽取后，`creationAgent` 的 focus 推断 / toolCall 处理留在骨架里还是留在 creationAgent 专属层——按搬移时的耦合度定。

---

## High-Level Technical Design

> *以下为评审用的方向性示意，不是实现规范。实现 Agent 应当作上下文参考，而非照抄的代码。*

**出图网关（唯一 prompt(+上下文) → image 出口；本轮 judge 为 identity 桩）**

```
type RenderRequest = {
  prompt: string
  // 未来美术 Agent 判断要用的上下文（本轮收集但不消费）
  emotion?, intent?, referenceImages?, shotNo?, projectId?
}
type Renderer = (req: RenderRequest) => Promise<RenderResult>  // 各调用点现有生成器，原样注入

async function renderViaGate(req, render: Renderer) {
  const judged = await artJudge(req)   // 本轮：return req（identity 桩）
                                       // 未来：styleLibrary + 情绪 + 意图 + 参考图 → shotPromptComposer 改写 prompt
  return render(judged)                // 行为零变化：judged.prompt === req.prompt
}
```

**库支撑判断 Agent 范式（共享底座，两个实例）**

```
function makeLibrary<TEntry>(opts: { dir, schema, toFragments }) {
  // 从 styleLibrary 抽出：YAML 读取 + zod 校验（坏条目告警跳过）+ 目录缓存 + getActive/getAll
}
styleLibrary       = makeLibrary({ dir: "docs/style-library/entries",      schema: StyleEntry,      toFragments: styleToFragments })
literatureLibrary  = makeLibrary({ dir: "docs/literature-library/entries", schema: LiteratureEntry, toFragments: literatureToFragments })
```

---

## Implementation Units

### U1. 抽取共享库加载底座

**Goal:** 把 styleLibrary 里的通用加载逻辑抽成可复用底座，styleLibrary 改用它且行为不变。

**Requirements:** R7（AE2）

**Dependencies:** 无

**Files:**
- Create: `server/services/libraryLoader.ts`
- Modify: `server/services/styleLibrary.ts`
- Test: `server/services/libraryLoader.test.ts`（新增）；`server/services/styleLibrary.test.ts`（保持绿）

**Approach:**
- 底座暴露一个工厂（接收 `entries` 目录、zod schema、可选 `toFragments`），内部做 YAML 读取、逐条 `safeParse`（坏条目告警跳过）、id 去重、按解析目录缓存、`getAll/getActive/clearCache`。
- `styleLibrary` 改为：定义 `StyleEntrySchema` + `styleToFragments` + `styleNegatives`，加载部分委托底座。对外导出签名保持不变。

**Patterns to follow:** `server/services/styleLibrary.ts` 现有结构（直接来源）。

**Test scenarios:**
- Happy path：合法条目目录 → 全部加载；`getActive` 只返回 `status: active`。
- Edge：缺 `id`/`name` 的条目被跳过且不影响其余；重复 id 只留第一条；空 / 不存在目录 → 返回 `[]` 不抛。
- Edge：`force` 重载绕过缓存；`clearCache` 后重新读盘。
- Covers AE2：styleLibrary 与（U2 的）文学库共用底座，一处修复同时生效——以"两库加载走同一函数"的断言体现。

**Verification:** `server/services/styleLibrary.test.ts` 原断言全绿；底座新测试覆盖上述场景。

---

### U2. 新建文学库（结构 + 加载器 + 样例条目）

**Goal:** 照 style-library 形状搭起文学库，并用 U1 底座加载。

**Requirements:** R6, R8

**Dependencies:** U1

**Files:**
- Create: `docs/literature-library/_TEMPLATE.yaml`、`docs/literature-library/MANUAL.md`、`docs/literature-library/entries/lu-xun.yaml`、`docs/literature-library/entries/zhang-ailing.yaml`（1–2 个样例种子）
- Create: `server/services/literatureLibrary.ts`
- Test: `server/services/literatureLibrary.test.ts`

**Approach:**
- 起步 `LiteratureEntry` schema 照 styleLibrary 形状（方向性，实现期可微调）：`id / name / one_liner / status` + 文学 DNA `viewpoint`（观点）、`voice`（语言声音）、`themes`（母题）、`signature_lines`（代表句）、`devices`（手法）、`era_culture`、`negative`（最不该被写成什么）+ 落点 `emotion_fit / theme_fit / affinity` + `references / notes`。
- `literatureLibrary.ts` = schema + `literatureToFragments` + 委托 U1 底座加载。
- `MANUAL.md` 说明"一条目 = 一位文学家的声音"，守则：与用户共鸣、不替用户拔高、不伪造其原话。

**Patterns to follow:** `docs/style-library/_TEMPLATE.yaml`、`docs/style-library/MANUAL.md`、`server/services/styleLibrary.ts`。

**Test scenarios:**
- Happy path：两个样例条目加载成功；字段被正确解析。
- Edge：草稿条目不进 `getActive`；坏条目被底座跳过（复用 U1 行为）。
- Happy path：`literatureToFragments` 把一条目映射成带标签的片段。

**Verification:** 文学库测试绿；`getActive/getAll` 行为与 styleLibrary 对称。

---

### U3. 出图网关：收口出图 / 重绘出口 + 美术判断占位

**Goal:** 把全部出图 / 重绘出口收口到单一网关，网关内留美术判断插入点（本轮 identity 透传），行为逐字节不变。

**Requirements:** R1, R2, R3（AE1）；F1

**Dependencies:** 无（逻辑上未来消费 styleLibrary / shotPromptComposer，二者已存在）

**Files:**
- Create: `server/services/renderGate.ts`
- Modify: `server/services/creationAgent.ts`、`server/services/artAgent.ts`、`server/routers.ts`（`generateForMobile` / `mobileInpaint` 及 `inpaintImage` 调用点）
- Test: `server/services/renderGate.test.ts`

**Approach:**
- `renderGate.ts` 暴露 `renderViaGate(req, render)`：先过 `artJudge(req)`（本轮 identity 桩，原样返回），再调注入的 `render` delegate。
- 各调用点把现有生成器调用包进 delegate 传入；**各自后端不变**（creation/art 仍走 `services/imageGen`，mobile 仍走 `_core/imageGeneration`，inpaint 仍走 `inpaintImage`）。
- `artJudge` 的签名收齐未来要用的上下文（prompt + 情绪 + 意图 + 参考图 + shotNo + projectId），但本轮不消费——这就是美术 Agent 的"家"。

**Execution note:** characterization-first —— 先对每个调用点固化"给定输入 → 现有 prompt / 出图调用"的现状，再插入网关，确保透传后逐字节一致。

**Technical design:** 见上方 High-Level Technical Design 的 `renderViaGate` 草图（方向性）。

**Patterns to follow:** `server/services/creationAgent.ts:178-266`（现有出图调用与落库流程）。

**Test scenarios:**
- Covers AE1 / Happy path：经 creationAgent 渲一张图，网关透传后产出的 prompt 与生成器入参与改造前一致。
- Integration：4+ 调用点都经由 `renderViaGate`（以"delegate 被调用且 prompt 未被改写"的断言体现）。
- Edge：`artJudge` 桩对任意 `req` 返回 `prompt` 不变（identity 契约）。
- Error path：delegate 抛错时网关原样冒泡，不吞错、不改变现有错误处理。

**Verification:** 现有出图相关测试（如 `server/services/imageGen.test.ts` 间接路径）全绿；新增网关测试覆盖透传与 identity 契约；手动核对一次 creation 出图产物未变。

---

### U4. 剧本职责抽离 + 文学库读取占位

**Goal:** 把剧本 + 台词生成职责从 storyAgent 抽成独立、可单独调用的单元（纯搬移），并留文学库读取的可选桩。

**Requirements:** R4, R5（AE4）

**Dependencies:** U2（文学库读取桩引用 `literatureLibrary`）

**Files:**
- Create: `server/services/scriptAgent.ts`
- Modify: `server/archive/storyAgent.ts`（把剧本 / 台词相关导出迁出或改为转调新单元）、`server/routers.ts`（剧本相关路由改指向新单元）
- Test: `server/services/scriptAgent.test.ts`；`server/routers.storyAgent.test.ts`（保持绿）

**Approach:**
- 把 `synthesizeShotList` 等剧本 / 台词逻辑迁入 `scriptAgent.ts`，保留对外契约（入参 / 出参不变）。
- 在剧本合成入口加 `literatureLibrary` 读取桩：本轮无条目或不消费时，行为与现状完全一致。
- 多版本叙事壳（克制 / 戏剧 / 诗意）、原话追溯、不伪造重大事实等现有约束随逻辑一起搬，不改语义。

**Execution note:** characterization-first —— 先用现有 `server/routers.storyAgent.test.ts` 锁住剧本合成的当前输出，再搬移。

**Patterns to follow:** `server/archive/storyAgent.ts`（`synthesizeShotList`、剧本整理段 :1038-1054）。

**Test scenarios:**
- Covers AE4 / Happy path：搬移后剧本合成对相同输入产出与改造前一致。
- Edge：文学库为空 / 读取桩关闭时，输出与现状逐字一致。
- Integration：剧本相关 tRPC 路由改指向新单元后端到端不变。

**Verification:** `server/routers.storyAgent.test.ts` 全绿；新单元测试覆盖契约不变。

---

### U5. 抽后端"对话 Agent 骨架" + creationAgent 采纳

**Goal:** 把对话 Agent 的重复骨架抽成可复用运行时，creationAgent 改用它且行为不变。

**Requirements:** R9, R11（AE3）；F2

**Dependencies:** 无（建议在 U3 之后，因二者都改 `creationAgent.ts`）

**Files:**
- Create: `server/services/agentRuntime.ts`
- Modify: `server/services/creationAgent.ts`
- Test: `server/services/agentRuntime.test.ts`；creationAgent 相关现有测试保持绿

**Approach:**
- 骨架封装：未配置兜底 → 组装消息（system + 截断历史 + user）→ `invokeAgent` → `parseJsonLoose` + 解析失败兜底 → 返回结构化结果。Agent 专属的 system prompt 与 toolCall 解析以回调 / 参数注入。
- creationAgent 改为：提供自己的 prompt 构造 + toolCall 解析，骨架部分委托运行时。focus 推断等专属逻辑去留按搬移耦合度定（见 Deferred to Implementation）。

**Patterns to follow:** `server/services/creationAgent.ts:178-235`（拼消息 → invoke → 解析兜底）、`server/_core/agentChannel.ts`、`server/_core/llmJson.ts`。

**Test scenarios:**
- Covers AE3 / Happy path：用骨架重建 creationAgent 后，对相同对话输入产出 reply / toolCalls 与改造前一致。
- Edge：未配置 API key → 骨架返回现有的"未配置"兜底文案。
- Error path：LLM 返回非法 JSON → 骨架走 `parseJsonLoose` 失败兜底，得到纯文本 reply。

**Verification:** creationAgent 现有行为测试全绿；骨架测试覆盖兜底与解析路径。

---

### U6. 抽前端"Agent Context + Chat 脚手架" + creationAgent 采纳

**Goal:** 把每个前端 Agent 重复的 Context + Chat 抽成脚手架，creationAgent 前端改用它且行为不变。

**Requirements:** R10, R11；F2

**Dependencies:** 无（建议在 U3/U5 之后）

**Files:**
- Create: `client/src/features/_agentKit/createAgentContext.tsx`、`client/src/features/_agentKit/useAgentChat.ts`、`client/src/features/_agentKit/AgentChat.tsx`（命名方向性）
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`、`client/src/features/creationAgent/views/CreationAgentChat.tsx`
- Test: `client/src/features/_agentKit/useAgentChat.test.ts`

**Approach:**
- 脚手架提供：按 `projectId` 分区的 localStorage 持久化、消息状态、基础聊天 UI（发送 / 渲染 / 加载态）。
- creationAgent 前端改为用工厂 + hook + 通用组件，保留其专属状态（focusShotNo、projectImages 等）。
- **StoryAgentContext（2038 行）本轮不动**——只把较小的 creationAgent 跑通做样板，验证脚手架够用。

**Patterns to follow:** `client/src/features/creationAgent/CreationAgentContext.tsx`、`client/src/features/storyAgent/StoryAgentContext.tsx` 里 localStorage 分区持久化的现有写法。

**Test scenarios:**
- Happy path：脚手架持久化按 `projectId` 隔离，刷新后消息恢复。
- Edge：换 projectId → 读到对应分区、不串号。
- Integration：creationAgent 聊天发送 → 状态更新 → 持久化的链路与改造前一致。

**Verification:** creationAgent 前端交互手测无回归；脚手架持久化测试绿。

---

### U7. 文档与中文注释

**Goal:** 刷新中文架构地图、写《如何新增一个 Agent》模板、给 Agent 层 + 共享底座文件加中文注释。

**Requirements:** R12, R13, R14；F2

**Dependencies:** U1–U6（文档要反映收口 / 抽离 / 双库后的真实结构）

**Files:**
- Modify: `docs/brainstorms/architecture-map.md`（刷新 Agent 章节）
- Create: `docs/how-to-add-an-agent.md`
- Modify（加中文注释，文件顶部说作用、函数前说作用 + 接口）: `server/services/renderGate.ts`、`server/services/libraryLoader.ts`、`server/services/literatureLibrary.ts`、`server/services/scriptAgent.ts`、`server/services/agentRuntime.ts`、`server/services/creationAgent.ts`、`server/services/artAgent.ts`、`server/services/styleLibrary.ts`、`server/_core/agentChannel.ts`、`client/src/features/_agentKit/*`

**Approach:**
- 架构地图：更新 Agent 章节，画出"库支撑判断 Agent"范式 + 出图网关收口 + 剧本单元；标注两套生成器现状与 Follow-Up。
- 《如何新增一个 Agent》：覆盖"对话型"（用后端骨架 + 前端脚手架）与"库支撑型"（建库 + 在网关 / 剧本侧消费）两条路径，给填空式清单。
- 注释：只覆盖 Agent 层 + 共享底座；保持简洁、说清作用与接口（入参 / 出参），不逐行解释。

**Test scenarios:** Test expectation: none —— 纯文档与注释，无行为变更。

**Verification:** 用户读完地图 + 模板能自述"加一个 Agent 要动哪几处"；注释覆盖目标文件清单。

---

## System-Wide Impact

- **Interaction graph:** 出图网关成为 creation / art / mobile / inpaint 的共同必经点；剧本路由改指向 `scriptAgent`；前端 creationAgent 改挂脚手架。其余 Agent（storyAgent）本轮不接入，保持原状。
- **Error propagation:** 网关对 delegate 错误原样冒泡；骨架保留 `parseJsonLoose` 失败兜底——现有错误语义不变。
- **State lifecycle risks:** 前端脚手架的 localStorage 分区键须与现有键一致（或做兼容），避免刷新丢历史。
- **API surface parity:** tRPC 对外路由签名不变（剧本路由仅换内部实现指向）。
- **Unchanged invariants:** 出图产物、剧本合成产物、mobile 出图后端、StoryAgentContext、数据库 schema、认证 / 纳音 —— 本轮均不变。

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 网关插入改变了出图产物（prompt 被动过） | Med | High | identity 桩 + characterization-first 锁现状 + 逐字节核对 |
| 剧本搬移漏带某条现有约束（多版本 / 原话追溯） | Med | Med | 先用 `routers.storyAgent.test.ts` 锁输出再搬；纯移动不改语义 |
| 前端脚手架 localStorage 键不兼容导致刷新丢历史 | Low | Med | 复用现有分区键；脚手架测试覆盖按 projectId 隔离 |
| 后端骨架抽取过度，把 creationAgent 专属逻辑也吞进去 | Med | Med | 专属逻辑（focus 推断 / toolCall）留在 creationAgent 层，骨架只收公共骨架 |
| 误碰两套生成器试图合并 | Low | High | 明确列入 Deferred to Follow-Up；本轮网关只透传 |

---

## Documentation / Operational Notes

- 无迁移、无新依赖、无 rollout 风险——纯结构重构 + 文档。
- U7 产出的架构地图与《如何新增 Agent》模板即本轮对外的"中文结构说明"，供用户与后续 Agent 搭建参考。

---

## Alternative Approaches Considered

- **出图网关一步合并两套生成器**：更彻底地删冗余，但要统一签名 / 返回形 / 熔断，行为风险高，违背"打地基行为不变"。→ 拒绝，改为透传收口 + 合并入 Follow-Up。
- **本轮直接拆 2038 行 StoryAgentContext 做脚手架样板**：样板更有说服力，但高风险大改、正撞用户"怕越改越乱"。→ 拒绝，用较小的 creationAgent 当样板，StoryAgentContext 留后。
- **文学库直接复制 styleLibrary 代码**：最快，但正是要避免的复制冗余。→ 拒绝，抽共享底座（U1）。

---

## Phased Delivery

- **第一阶段（库与缝）：** U1 → U2 → U3。先把"库底座 + 文学库 + 出图网关"立起来，互相独立可验证。
- **第二阶段（抽取与采纳）：** U4 → U5 → U6。剧本抽离与前后端脚手架，均以现有单元当样板、行为不变。
- **第三阶段（固化认知）：** U7。文档与注释，反映前两阶段的真实结构。

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-10-agent-layer-foundation-requirements.md
- 关键代码：`server/services/styleLibrary.ts`、`server/services/shotPromptComposer.ts`、`server/services/creationAgent.ts`、`server/services/artAgent.ts`、`server/_core/agentChannel.ts`、`server/routers.ts`、`client/src/features/creationAgent/`
- 两套出图实现：`server/_core/imageGeneration.ts`、`server/services/imageGen.ts`
- 现有中文架构文档：`docs/brainstorms/architecture-map.md`
