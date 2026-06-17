---
title: "feat: 求职意图触发链路重写（开场能力菜单 + 意图抬到 Context）"
type: feat
status: completed
date: 2026-06-16
origin: docs/brainstorms/2026-06-15-job-search-film-intent-requirements.md
---

# feat: 求职意图触发链路重写（开场能力菜单 + 意图抬到 Context）

## Summary

把"意图识别"从一个藏在卡片板底部、手动、可跳过、失败静默的按钮（`StoryIntentGate`），改成聊天**开场就主动出现的能力菜单**：用户点「求职」即显性确认，或直接说自己的事由后台 `recognizeStoryIntent` 判出，两条入口汇到同一条求职专列。核心重构是把 `confirmedIntent` 状态从 `StoryCardsBoard` 局部 state **抬到 `StoryAgentContext`**，让菜单（在聊天面板）与剧本生成（在 context）共用同一份意图。本计划只做**触发纵切**，不展开 R2–R7 的 HR 深访 / 优势清单 / 导演 / showreel。

---

## Problem Frame

`StoryIntentGate` 在代码上端到端是通的（识别 → 确认 UI → 注入剧本），但几乎从未真正被触发过：它只藏在 `StoryCardsBoard` 卡片板底部「生成剧本」按钮上方，用户要先聊天、生成一堆卡片、滚到底才看得到；不点也能直接出剧本（`generateScript(confirmedIntent ?? undefined)`）；失败时 `catch {}` 静默不报。问题在入口设计注定被跳过，不在识别代码本身。详见 origin 文档「背景与定位」与重写后的 R1。

---

## Requirements

- R1. 触发必须在对话**最便宜的时候、主动**发生，不再依赖靠后/手动/可跳过/静默的按钮（origin R1）
- R2. 开场主动亮能力菜单（求职/朋友圈/送人/作品集/留念），每段创作触发一次，非常驻横幅（origin R1.1）
- R3. 两条入口都通：点选「求职」显性确认；或直接说自己的事，后台识别判出求职走同一条专列，并留逃生口（origin R1.2）
- R4. 确认求职后轻问两件硬事实——目标岗位/行业、投放场景/精度——顺着聊一项一项要，不甩表（origin R1.3）
- R5. 旧 `StoryIntentGate` 在求职流程里下线/被取代，不存在双入口（origin R1.6）
- R6. 菜单里非求职用途可见但点了走通用旧流程（占位，不报错、不假装做透）（origin R1.6）
- R7. 选了求职要在剧本生成里**有重量**——意图（含目标岗位/投放场景）真正注入下游剧本上下文，而不只是一行被淹没（origin 背景：解决"选了等于没选"）

**Origin actors:** 用户（求职者）、小酌（意图识别 + 创作 Agent）
**Origin flows:** 开场能力菜单触发 → 求职确认 → 轻问硬事实 →（交棒 R2–R7 深访/导演）
**Origin acceptance examples:** 见下方 Acceptance Examples（origin 未编号 AE，本计划就触发链路新拟）

---

## Scope Boundaries

- 不做 origin R2–R7 的实体：HR 人设深访、可改「优势清单」、导演竞争力弧线、三段式 showreel、art 库视觉接入——这些是后续车道
- 不做朋友圈/送人/作品集/留念四种用途的"做透"：菜单里可见、占位、走通用旧流程
- 不改 mobileChat 等其他入口的开场（只做主创作对话 `StoryAgentChat` 一处）
- 不把 `server/archive/` 的核心文件搬回正式目录（除非实现时顺手且零风险）
- 不做"自动判定片子够不够有说服力"之类质量评分

### Deferred to Follow-Up Work

- R1.5「想凸显的能力/特质聊几轮后总结反映回来确认」的**完整形态**（= origin R3 深访 → 可改优势清单）：单独计划。本计划只埋下 hook（见 U4 的 reflect-back 软确认），不建优势清单 UI
- 求职专属剧本取向 / 节奏 / 精致度的**深度定制**（origin R4–R7、S1–S6）：本计划只做"意图注入更重的一行 + 轻问字段进上下文"（U6），让"有重量"可感知，深度留后

---

## Context & Research

### Relevant Code and Patterns

- `client/src/features/storyAgent/StoryAgentContext.tsx` — 共享 store：`messages`、`cards`、`isReplying`、`sendMessage`（L860）、`generateScript`（L1255，已接收 `ScriptIntentArg`）、`returningGreeting`（内存态问候，L476/1578）。`ScriptIntentArg` 类型定义在 L85 附近
- `client/src/features/storyAgent/views/StoryAgentChat.tsx` — 聊天面板：渲染 `messages`、`returningGreeting` 块（L272，**内存态、不进 messages、不落库**，是能力菜单要照抄的模式）、底部输入区（L344 起）
- `client/src/features/storyAgent/views/StoryCardsBoard.tsx` — 当前持有 `confirmedIntent` 局部 state（L425）、`intentHistory`（L426）、渲染 `StoryIntentGate`（L516）、调 `generateScript(confirmedIntent ?? undefined)`（L524）
- `client/src/features/storyAgent/views/StoryIntentGate.tsx` — 待下线的旧确认关 UI；其中 `StoryIntent` 接口（L16）、`PURPOSE_LABELS`/`AUDIENCE_LABELS`（L29/L42）可复用迁出
- `server/routers.ts` — `storyAgent.recognizeIntent`（L1247，包装 `recognizeStoryIntent`）；`storyAgent.classify`（L1149）里 `confirmedIntent` 拼成一行注入 `scriptContext`（L1160）→ `synthesizeShotList`
- `server/archive/storyIntent.ts` — `recognizeStoryIntent`：LLM 判 purpose/audience/platform/tone + 本地兜底（命中"领英/找工作/求职/面试"→ linkedin_job_search，L92）
- `server/archive/storyAgent.types.ts` — `StoryIntentPayload` 等意图类型；新增 `targetRole`/`channel` 字段落在此处

### Institutional Learnings

- `AGENTS.md` 环境铁律：**只有主仓库跑 dev server（端口 3000）**；worktree 只改代码、不跑服务、不写 `.webdev/`。本功能验证一律回主 checkout 的 3000
- origin 文档「接口与车道划分」：本功能从 main 拉独立 worktree `feat/job-search-film-intent`，与 art 库车道物理隔离、各自小步快合

### External References

- 无需外部研究：意图识别/聊天/剧本注入在本仓已有完整本地模式（`recognizeStoryIntent`、`returningGreeting`、`classify` 注入），照本地模式即可

---

## Key Technical Decisions

- **意图状态抬到 `StoryAgentContext`**：`confirmedIntent` 当前是 `StoryCardsBoard` 局部 state，但菜单在 `StoryAgentChat`、消费在 `generateScript`（context）。抬到 context 是让"开场设意图 → 生成剧本读意图"贯通的前提，也消除未来多入口各持一份意图的风险
- **能力菜单照 `returningGreeting` 模式做成内存态 UI 块**，不写进 `messages`、不落库：它是"此刻的引导"，不是对话历史；避免污染召回/摘要
- **轻问字段（目标岗位/行业、投放场景）扩进意图记录**而非塞进卡片：它们是意图的属性，应随 `confirmedIntent` 一起流到服务端 `classify`
- **后台识别复用 `recognizeStoryIntent`**：直说入口不另造识别逻辑；触发时机选在首条用户消息后，置信度够才软确认（reflect-back），不够则静默不打扰
- **旧 `StoryIntentGate` 直接下线、不保留双入口**（用户已拍板）：删除其在 `StoryCardsBoard` 的渲染与局部 state；可复用的 label 映射迁到共享 types
- **服务端注入增强但不动情感片老路径**：`classify` 的 `confirmedIntentLine` 增补目标岗位/投放场景，仅是更丰富的一行，不改 `synthesizeShotList` 的情感老逻辑

---

## Open Questions

### Resolved During Planning

- 能力菜单落点：只做主创作对话 `StoryAgentChat` 一处（mobileChat 等留后）—— 见 Scope Boundaries
- 旧关去留：直接下线，无双入口 —— 用户拍板
- 意图状态放哪：抬到 `StoryAgentContext` —— 见 Key Technical Decisions

### Deferred to Implementation

- 菜单的显示条件精确边界（`messages.length === 0` 且无 `confirmedIntent` 且无 `returningGreeting`？回访用户同时命中 returningGreeting 时谁优先）—— 实现时按真实渲染调，建议 returningGreeting 与能力菜单二选一、菜单优先级在新对话更高
- 后台识别的触发时机与置信度阈值（首条消息后？前 N 条？confidence ≥ 0.6 才软确认？）—— 实现时据 `recognizeStoryIntent` 真实输出标定
- 轻问采用"气泡按钮快选 + 可自由输入"还是纯自由对话 —— 实现时按手感定，倾向快选 chips + 逃生口

---

## Implementation Units

### U1. 意图状态抬到 StoryAgentContext

**Goal:** 把 `confirmedIntent`（及新增的求职轻问字段）从 `StoryCardsBoard` 局部 state 提升为 `StoryAgentContext` 的共享状态与 setter，供开场菜单写入、`generateScript` 读取。

**Requirements:** R1, R7

**Dependencies:** None

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`
- Modify: `client/src/features/storyAgent/views/StoryCardsBoard.tsx`
- Create: `client/src/features/storyAgent/intentTypes.ts`（把 `StoryIntent` 接口、`PURPOSE_LABELS`、`AUDIENCE_LABELS` 从 `StoryIntentGate.tsx` 迁出为共享类型；新增 `targetRole?: string`、`channel?: string` 轻问字段）
- Test: `client/src/features/storyAgent/StoryAgentContext.intent.test.tsx`

**Approach:**
- 在 context 新增 `confirmedIntent: StoryIntent | null`、`setConfirmedIntent`、`clearIntent`，纳入 provider value
- `generateScript` 改为优先读 context 里的 `confirmedIntent`（保留可选入参以兼容，缺省回退 context）；`ScriptIntentArg` 扩入 `targetRole`/`channel`
- `StoryCardsBoard` 删除本地 `confirmedIntent` state，改用 context 的；其 `generateScript()` 调用不再手动传 intent
- 切换 active story / 新建草稿 / `resetConversation` 时清空意图（与 `returningGreeting` 一并 reset 的位置一致，L867/1415/1479/2260 附近）

**Patterns to follow:**
- context 现有 state + provider value 的声明方式（L437 起 useState 群、L2430 起 value 装配）

**Test scenarios:**
- Happy path：`setConfirmedIntent({purpose:'linkedin_job_search', targetRole:'产品经理', channel:'linkedin'})` 后，context 暴露的 `confirmedIntent` 含全部字段
- Edge case：切换 active story → `confirmedIntent` 被清空为 null
- Integration：`generateScript()` 不传参时，读取的是 context 当前 `confirmedIntent`（而非 undefined）
- Edge case：`clearIntent()` 后 `confirmedIntent` 为 null，菜单可重新出现

**Verification:**
- `StoryCardsBoard` 内不再有 `confirmedIntent` 局部 state；类型检查通过；生成剧本仍可工作

---

### U2. 开场能力菜单组件

**Goal:** 新建开场能力菜单 UI，在新对话的空状态渲染，列出 5 种用途，点「求职」写入 context 意图并进入求职专列；其余用途写入对应 purpose 后走通用旧流程。

**Requirements:** R2, R6

**Dependencies:** U1

**Files:**
- Create: `client/src/features/storyAgent/views/StoryCapabilityMenu.tsx`
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx`（在 `returningGreeting` 块附近、消息区空状态时渲染菜单）
- Test: `client/src/features/storyAgent/views/StoryCapabilityMenu.test.tsx`

**Approach:**
- 照 `returningGreeting` 块的内存态 UI 模式：不写进 `messages`、不落库
- 文案：「我可以帮你把一段经历做成 → 给自己留念 / 发社交平台 / 求职·给招聘者看 / 送给某个人 / 作品集」，并明示"或直接说你的事"
- 显示条件：无 `confirmedIntent` 且对话尚未实质展开（见 Deferred：与 returningGreeting 的优先级实现时定）
- 点「求职」→ `setConfirmedIntent({ purpose:'linkedin_job_search', audience:'recruiters', platform:'linkedin' })` 并标记进入轻问（U3）；点其他 → 设对应 purpose、不进求职专列
- 复用 U1 迁出的 `PURPOSE_LABELS`

**Patterns to follow:**
- `StoryAgentChat.tsx` L272 的 `returningGreeting` motion 块（染色背景、小酌头像、whitespace-pre-wrap）
- `StoryIntentGate.tsx` 的视觉 token（`--nayin-accent`、`--panel-border` 等）

**Test scenarios:**
- Happy path：空对话渲染菜单，5 个用途可见 + "直接说你的事"提示
- Happy path：点「求职」→ context `confirmedIntent.purpose === 'linkedin_job_search'`，且进入轻问态
- Edge case：点「朋友圈」→ 设 purpose 但不进求职专列、不触发轻问
- Edge case：已有 `confirmedIntent` 时菜单不渲染
- Integration：菜单选择不向 `messages` 追加条目（不污染历史）

**Verification:**
- 进入新创作对话即见菜单；点求职后菜单收起、进入轻问；点其他用途行为与接入前一致

---

### U3. 求职轻问（目标岗位/行业 + 投放场景）

**Goal:** 求职确认后，顺着聊轻问两件硬事实并写入 context 意图：目标岗位/行业、投放场景/精度。

**Requirements:** R4

**Dependencies:** U1, U2

**Files:**
- Modify: `client/src/features/storyAgent/views/StoryCapabilityMenu.tsx`（或拆出 `StoryJobIntakePrompt.tsx`）
- Modify: `client/src/features/storyAgent/intentTypes.ts`（确认 `targetRole`/`channel` 字段；`channel` 取值如 linkedin/视频号/简历附件/内推）
- Test: `client/src/features/storyAgent/views/StoryJobIntake.test.tsx`

**Approach:**
- 一项一项问，不一次性甩表；倾向"快选 chips + 可自由输入"（投放场景给固定候选，岗位/行业自由填）
- 写入 `setConfirmedIntent({ ...prev, targetRole, channel })`
- 两件都可跳过（软引导，与 origin S1「给了才走」一致）；跳过则意图仍可用，字段留空

**Patterns to follow:**
- `StoryIntentGate.tsx` L120 起的 select/label 轻表单视觉；逃生口参考菜单"直接说你的事"

**Test scenarios:**
- Happy path：填目标岗位"产品经理"+投放场景"linkedin" → context 意图含两字段
- Edge case：跳过轻问 → 意图 purpose 仍为求职、targetRole/channel 为空，流程不阻断
- Edge case：只填其一 → 另一字段留空、不报错

**Verification:**
- 求职确认后能顺畅补两件事实并落进意图；可跳过

---

### U4. 直说入口的后台意图识别 + 软确认（reflect-back）

**Goal:** 用户不点菜单、直接说自己的事时，后台跑 `recognizeStoryIntent`；判出求职且置信度够，则由小酌软确认（"听起来你是想做求职片？对吗？✓/改"），确认后进求职专列。

**Requirements:** R3

**Dependencies:** U1, U2

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（在 `sendMessage` 回复后、合适时机调用 `trpc.storyAgent.recognizeIntent`）
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx`（渲染软确认气泡，复用菜单的确认动作）
- Test: `client/src/features/storyAgent/StoryAgentContext.intentRecognition.test.tsx`

**Approach:**
- 触发时机：首条用户消息后（或前 N 条），仅当尚无 `confirmedIntent`；阈值见 Deferred
- 判出求职且 confidence 达阈 → 设一个"待确认意图草稿"（非直接 confirmedIntent），UI 出软确认；用户确认 → 提交为 `confirmedIntent` 并接 U3 轻问；置信度不足 → 静默，不打扰
- **失败不再静默吞**：与旧 `StoryIntentGate` 的 `catch {}` 相反，识别失败记一条 console.warn（不打断对话）；本地兜底已在 `recognizeStoryIntent` 内
- reflect-back 是 R1.5 完整形态（深访/优势清单）的最小 hook —— 只确认 purpose，不做能力总结

**Patterns to follow:**
- `recognizeStoryIntent` 调用与返回结构（`server/archive/storyIntent.ts` 的 `StoryIntentResult`）
- `recognizeIntent` 路由入参（`server/routers.ts` L1247，传 `history`）

**Test scenarios:**
- Happy path：用户首条说"我想做个找工作的片子" → 后台判 linkedin_job_search → 出软确认气泡
- Happy path：软确认点「对」→ `confirmedIntent` 落定为求职 → 进轻问
- Edge case：置信度低/判为 exploration → 不弹软确认、不打扰对话
- Error path：`recognizeIntent` 抛错 → console.warn 一条、对话继续、不弹错误（对比旧版静默 catch）
- Integration：已通过菜单确认意图后，不再重复后台识别/弹软确认

**Verification:**
- 直说也能进求职专列；低置信不打扰；识别失败可观测但不打断

---

### U5. 下线旧 StoryIntentGate

**Goal:** 移除 `StoryCardsBoard` 里的 `StoryIntentGate` 渲染与残留意图局部 state，消除双入口；保留/迁移其可复用的 label 映射。

**Requirements:** R5

**Dependencies:** U1, U2

**Files:**
- Modify: `client/src/features/storyAgent/views/StoryCardsBoard.tsx`（删除 `StoryIntentGate` import 与 L516 渲染、`intentHistory` 若无其他用途一并清理）
- Delete: `client/src/features/storyAgent/views/StoryIntentGate.tsx`（label 映射已在 U1 迁到 `intentTypes.ts`）
- Modify: `server/routers.ts`（`storyAgent.recognizeIntent` 路由**保留**——U4 仍在用；仅确认无其他僵尸引用）
- Test: 复用 `client/src/features/storyAgent/views/StoryCardsBoard` 既有测试，更新断言

**Approach:**
- 「生成剧本」按钮保留，但意图来源改为 context（U1 已处理）
- 确认全仓无对 `StoryIntentGate` 的其他 import（grep 校验）
- `recognizeIntent` 路由与 `recognizeStoryIntent` 函数**不删**（U4 复用）

**Patterns to follow:**
- 删除组件后用类型检查 + grep 验证无悬挂引用

**Test scenarios:**
- Happy path：`StoryCardsBoard` 不再渲染 `StoryIntentGate`，生成剧本仍读 context 意图正常出片
- Edge case：全仓 grep `StoryIntentGate` 无残留引用
- Test expectation：无新增行为，主要靠类型检查 + 既有测试回归

**Verification:**
- 卡片板底部不再有旧"识别意图"按钮；无编译/引用错误；生成剧本链路完整

---

### U6. 服务端意图注入增强（让"选了求职"有重量）

**Goal:** `classify` 注入的 `confirmedIntentLine` 增补目标岗位/投放场景，使求职意图在剧本上下文里更有分量，肉眼可感"选了求职 ≠ 没选"。

**Requirements:** R7

**Dependencies:** U1, U3

**Files:**
- Modify: `server/routers.ts`（`storyAgent.classify` 的 `confirmedIntent` zod schema 增 `targetRole`/`channel`；`confirmedIntentLine` 拼入这两项，L1138/L1160 附近）
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（`generateScript` 打包 `confirmedIntent` 时带上 `targetRole`/`channel`，L1300 附近）
- Test: `server/routers.classify.intent.test.ts`

**Approach:**
- schema 向后兼容：新字段 `nullish()`
- 注入行示例（不改情感老路径）：在现有「用户已确认意图」行后追加"目标岗位=…；投放=…；剧本优先服务这个岗位的竞争力与该平台的时长/正式度"
- 仅增强字符串上下文，不动 `synthesizeShotList` 内部逻辑

**Patterns to follow:**
- `server/routers.ts` L1160 现有 `confirmedIntentLine` 拼接与 `scriptContext` 日志可观测（L1167）

**Test scenarios:**
- Happy path：带 `targetRole`/`channel` 的 confirmedIntent → 注入行包含岗位与投放
- Edge case：不带新字段（旧客户端）→ 行为与现状一致，不报错
- Edge case：purpose 非求职 → 不追加求职专属语句
- Integration：`classify` 日志（L1167）打印的 `scriptContext` 含新字段，便于人工验证"意图已生效"

**Verification:**
- 服务端日志可见目标岗位/投放进入剧本上下文；缺省字段时与接入前完全一致

---

## System-Wide Impact

- **Interaction graph:** 意图状态抬到 context 后，`StoryAgentChat`（菜单/软确认写入）、`StoryCardsBoard`（生成剧本读取）、`StoryAgentContext.generateScript`（打包给服务端）三处共用同一份 `confirmedIntent`，需保证 reset 时机一致
- **Error propagation:** U4 把旧版静默 `catch {}` 改为可观测 warn；识别失败不得打断对话，本地兜底兜住
- **State lifecycle risks:** 切换 active story / 新建 / reset 时必须清空 `confirmedIntent`，否则上一个故事的求职意图会泄漏到下一个；与 `returningGreeting` 的清空点对齐
- **API surface parity:** `classify` 与 `recognizeIntent` 两个路由的 `confirmedIntent` 形状需一致（都新增 targetRole/channel）
- **Unchanged invariants:** `synthesizeShotList` 情感老路径不变；非求职用途的生成流程与接入前一致；`recognizeStoryIntent` 本地兜底逻辑保留

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 意图状态抬到 context 触碰面广，回归风险 | U1 先行独立成单元 + 测试；其余单元依赖 U1，分步落地 |
| 能力菜单与 returningGreeting 同时命中、抢占空状态 | 实现时明确二者优先级（Deferred 已记），建议新对话菜单优先、回访问候其次 |
| 后台识别过度打扰（频繁弹软确认） | 置信度阈值 + 仅在无意图时触发 + 低置信静默（U4） |
| 在 worktree 误启 dev server 导致数据分裂 | 遵守 AGENTS.md：worktree 只改码，验证回主 checkout 3000 |
| 改动与 art 库车道冲突 | 物理隔离：本功能从 main 拉独立 worktree，不碰 art 库文件（origin 车道划分） |

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-15-job-search-film-intent-requirements.md（2026-06-16 重写 R1 触发后的版本）
- 关键代码：`client/src/features/storyAgent/StoryAgentContext.tsx`、`client/src/features/storyAgent/views/StoryAgentChat.tsx`、`client/src/features/storyAgent/views/StoryCardsBoard.tsx`、`client/src/features/storyAgent/views/StoryIntentGate.tsx`、`server/routers.ts`、`server/archive/storyIntent.ts`
- 环境铁律：`AGENTS.md`、`docs/environment-guide.md`
