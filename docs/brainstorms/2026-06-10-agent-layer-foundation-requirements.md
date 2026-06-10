---
date: 2026-06-10
topic: agent-layer-foundation
---

# Agent 层打地基：出图收口、剧本抽离、库支撑的判断 Agent

## Summary

本轮在「Agent / 出图」层做一次**结构性打地基**：把散落的出图入口收口成单一网关、把剧本+台词职责从 storyAgent 抽成独立单元、照美术库的成熟形状搭一个文学库并把两库的通用加载逻辑抽成共享底座、抽出可复用的对话 Agent 脚手架。所有判断 / 共鸣算法本轮**留空为可插入的桩**，行为保持不变、22 个测试全绿。同时刷新中文架构地图、写《如何新增一个 Agent》模板、给 Agent 层文件加中文注释。

---

## Problem Frame

Drinking Time 已有三个 Agent（故事 / storyAgent、制作 / creationAgent、美术 / artAgent），每个都自带一套后端 service + 前端 Context + Chat。接下来要再加**剧本 Agent**和**美术 Agent（强化版）**，项目主用户担心"每加一个 Agent 就把骨架复制一遍"，越改越冗余。

现状里这种冗余已经有具体苗头：

- **出图入口散落在至少 4 处**——`server/services/creationAgent.ts`、`server/routers.ts` 的 `generateForMobile` / `mobileInpaint`、`server/services/artAgent.ts`——各自拼各自的 prompt，且都**绕过了**已经建好的"出图唯一合成缝"`server/services/shotPromptComposer.ts` 和美术仓库 `server/services/styleLibrary.ts`。
- **剧本 + 台词逻辑**埋在 2038 行的前端 `client/src/features/storyAgent/StoryAgentContext.tsx` 与归档的 `server/archive/storyAgent.ts` 里；若新建剧本 Agent 从零再写，就是复制。
- 美术仓库 `styleLibrary` 已在 schema 里给情绪 / 主题 / 亲和度字段留了"后续排序器"的位置（`server/services/styleLibrary.ts:59-63`），但目前**没有任何 Agent 消费它**——能力空置。

痛点不是"功能缺失"，而是"地基没收口"：在这个状态上直接堆两个新 Agent，会把已经分叉的出图与剧本逻辑进一步分叉。

---

## 结构示意（改造后）

```
库支撑的判断 Agent 范式（同一形状，两个实例）：

  美术 Agent ──查──▶ styleLibrary（美术仓库 · 已存在）─┐
  剧本 Agent ──查──▶ literatureLibrary（文学库 · 新建）─┘
                          │
                  共享库底座 loadLibrary（YAML 读取 + zod 校验 + 坏条目跳过 + 缓存）

出图收口（4+ 入口 → 单一网关）：

  creationAgent  ─┐
  routers.mobile  ─┤
  routers.inpaint ─┼──▶ 出图网关 ──▶ generateImage ──▶ 落库
  artAgent  ──────┘       ▲
                          └─ 本轮：透传桩（行为不变）
                             未来：美术 Agent(styleLibrary + 情绪 + 意图 + 参考图) → shotPromptComposer
```

---

## Key Flows

（技术 / 架构性 brainstorm，下面两个流说明"地基"如何改变现有路径，便于规划核对。）

- F1. **出图（收口后）**
  - **Trigger:** 任意 Agent / 路由要渲一张图
  - **Steps:** 调用方 → 单一出图网关 →（本轮桩：原样透传 prompt；未来：美术 Agent 用 styleLibrary + 情绪 + 意图 + 参考图判断 → `shotPromptComposer` 合成）→ `generateImage` → 落库
  - **Outcome:** 所有出图走同一条缝；本轮产出与现在逐字节一致（网关是透传）
  - **Covered by:** R1, R2, R3

- F2. **新增一个对话型 Agent（地基完成后）**
  - **Trigger:** 开发者要加第 N 个对话 Agent
  - **Steps:** 复制模板 → 只写该 Agent 专属的 system prompt 与解析规则 → 复用后端对话骨架 + 前端 Context/Chat 脚手架 →（可选）挂一个库
  - **Outcome:** 不再抄 ~60 行后端样板 + 几百行前端样板
  - **Covered by:** R9, R10, R12, R13

---

## Requirements

**出图收口（美术 Agent 的家）**
- R1. 把现有 4+ 处直接调用 `generateImage` 的出图入口收口到单一出图网关函数。
- R2. 网关内部留出"判断 → styleLibrary 选流派 → shotPromptComposer 合成 prompt"的插入点；本轮该插入点为**透传桩**（直接用调用方给的 prompt），不改变任何出图结果。
- R3. 美术 Agent 的判断逻辑（如何用情绪 / 意图 / 用户图 / styleLibrary 选流派与改写 prompt）本轮不实现，仅以接口形式占位。

**剧本职责抽离（剧本 Agent 的家）**
- R4. 把"剧本 + 台词"生成职责从 storyAgent（前端 `StoryAgentContext.tsx` 与 `server/archive/storyAgent.ts`）抽成一个独立、可单独调用的单元，**纯搬移、不改当前行为**。
- R5. 剧本 Agent 读取"文学库"作为共鸣参照的插入点；本轮该读取为**可选桩**（无条目时行为与现状一致）。

**库底座（删冗余的核心）**
- R6. 照 `docs/style-library/` 的现成形状新建文学库 `docs/literature-library/`（`_TEMPLATE.yaml` + `MANUAL.md` + `entries/*.yaml`），条目记录文学家的观点 / 声音 / 情绪指纹等。
- R7. 把 styleLibrary 与文学库的通用加载逻辑（YAML 读取 + zod 校验 + 坏条目跳过 + 目录缓存 + `getActive/getAll`）抽成共享底座，两库各自只保留自己的 schema 与"条目→片段"映射。
- R8. 文学库本轮只放 1-2 个样例条目作种子，不建完整名家库。

**共享 Agent 脚手架**
- R9. 抽出后端"对话 Agent 骨架"：未配置兜底 → 拼 system prompt → 组装消息 → `invokeAgent` → 宽松 JSON 解析 + 兜底 → 抽 toolCalls → 返回。
- R10. 抽出前端"Agent Context + Chat 脚手架"：按 `projectId` 分区的 localStorage 持久化、消息状态、基础聊天 UI。
- R11. 用较小的 creationAgent（后端 289 行 / 前端 312 行）作为采纳脚手架的样板；2038 行的 `StoryAgentContext` 本轮不强拆。

**文档与注释**
- R12. 刷新 `docs/brainstorms/architecture-map.md` 的 Agent 章节，使其与收口 / 抽离 / 双库后的结构一致（这就是用户要的"中文整体结构说明"）。
- R13. 写《如何新增一个 Agent》模板，覆盖对话型与库支撑型两种形状。
- R14. 给 Agent 层 + 共享底座的文件加中文注释：文件顶部说明作用，函数前说明作用 + 接口（入参 / 出参）。

**安全网**
- R15. 全程保持 22 个测试文件通过；本轮任何改动都是结构性的（搬移 / 收口 / 搭桩），不改变对外行为。

---

## Acceptance Examples

- AE1. **Covers R1, R2.** 给定今天经 creationAgent 渲一张图，当出图网关就位后，产出的图片与 prompt 与改造前一致，且 4+ 处入口都经由同一个网关函数。
- AE2. **Covers R7.** 给定 styleLibrary 与文学库都要加载条目，当修复一个 YAML 解析 / 校验缺陷时，只需改共享底座一处。
- AE3. **Covers R9, R13.** 给定开发者照模板新增一个对话型 Agent，当其完成时，只写了该 Agent 专属的 prompt 与解析，没有重写骨架样板。
- AE4. **Covers R4, R15.** 给定剧本职责被抽成独立单元，当跑 `npm test` 时，剧本 / 故事相关测试与其余测试全绿，行为无变化。

---

## Success Criteria

- 用户读完刷新后的架构地图 + 注释，能自己说清"加一个新 Agent 要动哪几处"。
- 加下一个对话 Agent 时，新增代码以"该 Agent 专属逻辑"为主，骨架 / 持久化 / 聊天 UI 基本复用。
- 美术 Agent 与剧本 Agent 各有一个明确的、已收口的"家"（出图网关 / 剧本单元）和一个可读的库（styleLibrary / 文学库），判断算法可在不动地基的情况下后续填入。
- ce-plan 拿到本文档即可排实现步骤，无需再发明产品行为或范围。
- 改造后 22 个测试全绿，应用行为与改造前一致。

---

## Scope Boundaries

- 不实现任何判断 / 共鸣算法（美术选流派、剧本专业化、文学家匹配）——只留可插入的桩。
- 不建完整文学家条目库，只放 1-2 个样例种子。
- 不强拆 2038 行的 `StoryAgentContext.tsx`（仅在抽脚手架时让较小的 creationAgent 做样板）。
- 美术 Agent 的"出图后再评判 / 自动重试"不做——本轮只搭"出图前"网关。
- 不动其余 ~200 个非 Agent 文件、不动数据库 schema、不动认证 / 纳音 / 分析等无关模块、不加新依赖。
- 中文注释只覆盖 Agent 层 + 共享底座文件，不做全库注释（全量注释会与代码漂移，是另一种冗余）。

---

## Key Decisions

- **美术 / 剧本 Agent 视为"库支撑的判断 Agent"同一范式的两个实例**（库 + 判断），而非两套各写各的——直接对应"删冗余"目标。
- **出图网关本轮是透传桩**：先收口调用点、保证行为不变、测试全绿，再在后续轮填入美术判断。把"收口"与"加智能"分两步，是降低风险的核心。
- **两库共享加载底座**的抽象建立在两个真实实例上（styleLibrary 已存在、文学库已确定要建），不是过早抽象。
- **文学库照 `docs/style-library/` 既有形状建**，复用其模板 / 手册 / 加载范式，避免另起一套约定。

---

## Dependencies / Assumptions

- styleLibrary 现有的"条目→片段→`shotPromptComposer`"缝是出图网关复用的基础（已在代码中验证存在）。
- 22 个测试是本轮重构的安全网；假设它们当前全绿（规划阶段先跑一次基线确认）。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical][Needs verification] `server/_core/imageGeneration.ts` 与 `server/services/imageGen.ts` 是否其实是两套出图实现、该不该顺带合并为一套（routers 用前者，creationAgent 用后者）。
- [Affects R4][Technical] 剧本 Agent 抽出后的接口形状：对话型（聊天精修剧本）、流水线型（情绪流 → 剧本合成）、还是先保留现有 synthesize 风格的调用、把对话精修留后？现有 storyAgent 两种都沾。
- [Affects R6][Technical] 文学库条目 schema 的具体字段（观点 / 声音 / 情绪指纹 / 代表句 / 与情绪的亲和度…）。
- [Affects R10][Technical] 前端共享脚手架的具体形态（Context 工厂 / 自定义 Hook / 通用组件）。
- [Affects R7][Technical] 共享库底座放在哪一层（`server/_core/` 还是 `server/services/`），与现有 styleLibrary 的迁移方式。
