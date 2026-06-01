---
title: "feat: 小酌用对话留住人 — 声音地基·照见·留线头"
type: feat
status: active
date: 2026-06-01
origin: docs/brainstorms/2026-06-01-xiaozhuo-conversation-stickiness-requirements.md
---

# feat: 小酌用对话留住人 — 声音地基·照见·留线头

## Summary

通过「对话」本身增加用户粘性，而不是堆功能。把小酌从仍然活在 `server/archive/storyAgent.ts` 里的「情绪取样器」真正落地为「朋友 + 助手」的陪伴者，并在此地基上加三个时刻：**开场报到与定位**（自报家门、确立人格、让用户选「继续上次 / 开新故事」）、**过程中照见真实的好**（温柔指认用户没意识到但真有的小美好与好品质，绝不灌鸡汤）、**收尾留真实线头**（让人聊完还想再来）。

技术上只动**一条对话脊**：服务端共用提示词构造器 `buildAgentSystemPrompt`（声音地基，U1）、照见与收尾两块提示词指令（U2/U3）、桌面端开场文案与定位入口（U4，复用现有故事列表，不新建存储），最后用一份分步范围守护 + 行为实测 rubric 收口（U5）。完整记忆承诺与老用户内容召回随 `DATABASE_URL` 做**第二步**，本轮只做到「不与之矛盾」。

> 重要前提：上一份计划 `docs/plans/2026-05-21-002-feat-story-agent-evocative-voice-plan.md` 的 frontmatter 写着 `status: implemented`，但**与现网代码不符**——取样器语言（采样、记成 X、问身体、负面偏置）仍原封不动地在 `server/archive/storyAgent.ts` 里。本轮 U1 真正落地那次重写，并订正这份假状态。

---

## Problem Frame

创始人想让用户「越聊越想说、聊完还想再来」，初稿开场是「你好，我叫小酌，我可以**收集**你的故事……」。但「收集 / 采样」正是小酌当前最大的体验问题的根：核实 `server/archive/storyAgent.ts` 的 system prompt，它在结构上仍是一个**情绪取样器**——通篇「情绪样本卡」「我先记成 X，你觉得准吗」式的采样 + 确认，且显式偏好负面/冲突、显式教它问身体。`docs/brainstorms/2026-05-19-story-agent-evocative-voice-requirements.md` 与对应计划 `2026-05-21-002` 已为此写过根治方案，**但从未落地**（见 Summary 的状态订正）。开场文案若再写「收集」，等于把这个未修好的根又请回前门。

同时，粘性的真正来源不止「接住」：要帮用户**发现他没意识到、但真实存在的好**——疲惫生活里的小美好、他本就有的优良品质（创造力、同情心）。这是从「镜子」升级为「会照见的朋友」的关键，但它有一条同样硬的危险边界：照见一旦失真就变成鸡汤、变成替用户拔高，和「为戏剧性强加负面」是同一种对表达权的侵犯，只是方向相反——**正向失真与负面偏置同罪**。

另一约束来自现实：当前没有 `DATABASE_URL`，故事主要存浏览器 localStorage，容易丢（本次会话刚因端口/来源隔离丢过一次）。所以开场**绝不能**承诺「你所有情绪我都永远记得」——在易丢的存储上承诺永久记忆，是对一个「替你留住情绪」的产品最致命的信任崩塌。记忆承诺必须等数据库就位才说。（详见 origin: `docs/brainstorms/2026-06-01-xiaozhuo-conversation-stickiness-requirements.md`）

---

## Requirements

**声音立场（地基层 · 收编并落地 2026-05-19 未实现的根治）**
- R1. 小酌的对话立场是「激发倾诉的陪伴者」，不是情绪取样器：像真在听的人那样有反应、会接话、留白、邀请展开，而不是一问一确认地采样。
- R2. 去采样口吻、去身体审问、去负面偏置：不再用「我先记成 X，你觉得准吗」式贴标确认；不问身体松紧/部位；不为戏剧性把正向/平淡挖向负面。
- R3. 如实镜像是硬约束：用户讲开心，接住的就是开心；仅当用户**自己**带出复杂暗流，才如实保留那一丝，不放大、不虚构、不替用户补。

**开场时刻（人格 + 定位）**
- R4. 开场第一句，小酌主动报到、自我介绍并确立人格——「朋友 + 助手」；开场是邀请，不是冷启动提问，也不出现「收集 / 采样」这类词。
- R5. 开场要给故事「定位」：让用户在「继续上次那个故事」和「开一个新故事」之间清楚地选；路由复用现有项目/故事列表能力，不新建存储机制。
- R6. 开场文案绝不过度承诺永久记忆：第一步不能说「你所有的情绪我都会永远记得」这类话；记忆承诺要等第二步（数据库）才兑现。

**照见真实的好（新维度，正向的「如实镜像」）**
- R7. 小酌的价值不止「接住」，还要温柔「照见」：在合适时机帮用户发现他没意识到、但真实存在的好——疲惫生活里的小美好、他本就有的好品质（创造力、同情心等）。
- R8. 「照见」是硬护栏下的镜像，不是鸡汤：只照见讲述里**真有的**东西；绝不灌鸡汤、不强行升华、不替用户拔高、不无中生有。把「不翻负」对称地用到正向——正向失真和负面偏置一样被禁止。
- R9. 照见的方式是「指认 + 归还」：小酌指出这一抹好，并明确它属于用户自己（是你做到的 / 是你身上本就有的），而不是恭维、打分或评价。

**收尾时刻（留线头）**
- R10. 收尾要温暖地留一个真实「线头」：自然落点 + 一个真诚、开放、可不接的邀请，让用户「聊完还想再来」。
- R11. 线头必须真实，不制造假悬念/假钩子：不用「下次告诉你一个秘密」式人造 cliffhanger；留的是基于这次真实聊到内容的自然延续。

**分步与范围**
- R12. 本轮（第一步）= 声音地基 + 开场人格定位 + 照见真实的好 + 收尾留线头，全部围绕「对话」一条脊；不依赖数据库即可上线。
- R13. 第二步 = 完整记忆承诺 + 老用户内容召回 + 数据库落库；第一步所有文案不得与第二步相矛盾——既不抢先承诺永久记忆，也不否认将来会有。
- R14. 范围只限 B2C 桌面端 Story/Creation 的对话层；手机端、卡片→剧本→镜头下游管线、选区改写、情绪模型替换均不动。

**Origin actors:** A1（倾诉者/普通人）、A2（小酌/Story Agent，朋友 + 助手）
**Origin flows:** F1（新用户开场：报到 + 定位）、F2（老用户回来：继续 / 新开）、F3（中途陪伴式倾听并照见真实的好）、F4（收尾留线头）
**Origin acceptance examples:** AE1（covers R4）、AE2（covers R5）、AE3（covers R6,R13）、AE4（covers R7,R9）、AE5（covers R8）、AE6（covers R3,R8）、AE7（covers R10,R11）、AE8（covers R1,R2）

---

## Scope Boundaries

- 第二步内容：完整记忆承诺、老用户内容召回、`DATABASE_URL` 落库（本轮只做到「不与之矛盾」，不实现）。
- 手机端 / 手机聊天的语气与开场 UI（单独重设计，不在此范围）。**注意区分：服务端共用的「声音地基」会同步改善手机端聊天的语气，这是预期且正向的；本边界排除的是手机端的开场文案与定位 UI，不是要在手机端保留取样器语气。**
- 卡片→剧本→镜头下游管线、选区改写（`selectionEdit`）与各编辑面（不动）。
- 非对话型留存手段：成片 payoff 质量、推送/通知召回（不在本轮「靠对话留人」范围）。
- 情绪分类模型/算法替换（本次是 prompt 立场与取向问题，不是换模型）。
- 「记录 / 做成戏剧」双模式开关（沿用 2026-05-19 权衡：改手段不改目标，不做开关）。

### Deferred to Follow-Up Work（第二步）

- `DATABASE_URL`（MySQL）就位 + `stories` 落库后，开场兑现「我记得你上次……」式记忆承诺。
- 老用户内容召回范围（仅故事标题/卡片，还是连对话）与开场呈现方式。

---

## Context & Research

### 相关代码和模式

- `server/archive/storyAgent.ts`（1382 行，**现网生效**，名字里的 archive/ 有误导性）— 声音地基的唯一修改主体。关键位置（均已核实）：
  - L20–21 `export const FIRST_QUESTION`（服务端自带一份，提示词 L466 引用的是这一份）。
  - L227 `formatSimilarMemoryCards`，其中 **L235** 含反方向偏置：「如果当前输入和邻居相似但有反方向情绪，优先问这个差异，因为差异更容易长出剧情起伏。」
  - L328 `buildAgentSystemPrompt(...)`（**模块内私有，未导出**），声音地基的核心。
  - **仍在线的取样器语言：** L350「轻量情绪样本卡」、L384「你不是在收集『感动』，而是在采样情绪」、L396–397「采成一张张『情绪样本卡』」、L406 确认 tic「我先把它记成 X，你觉得准吗？」、L427「你说没事的时候，身体是松的还是紧的？」、L445「从身体感受切入——『那天身体哪个部位最先有反应？』」、L487 JSON schema 注释里的「情绪样本卡」。
  - L466「第一个问题固定是：『${FIRST_QUESTION}』（已经问过，不要重复）」。
  - **可复用的『照见』好种子（扩展，别重造）：** L389「不要逼问，不要升华」、L408 emotionOptions 正负面平衡 + 力量型正面词、L462 把清醒/笃定/边界感当正面力量、L463「这个很小，但很像你」（已经很接近『照见 + 归还』）、L501 正面情绪词 +「不要把理性判断归为防御」。
  - L541–547 `asEmotionOptions`，当前硬编码 `defaults = ["感动","好奇","清醒","释然","松弛"]`（一个偏正向的方向预设）。
  - L549 `export async function replyFromStoryAgent(...)`，对话主入口。
- `server/routers.ts` — `replyFromStoryAgent` 在 **L45** 导入，调用点 **L858**（桌面聊天，未传 `enableImageGen`）、**L1115**（手机聊天，`enableImageGen: true`）。`selectionEdit` 是 **另一个独立 tRPC procedure（L873 附近）**，按 R14 不动。
- `server/_core/index.ts` — `replyFromStoryAgent` 在 **L13** 导入，**L250** 调用（非 tRPC 路径）。
- `server/archive/storyAgent.test.ts`（已存在，13 KB）— **现成的提示词契约测试范式**：`vi.mock` 掉 `invokeLLM`，调用 `replyFromStoryAgent`，捕获传给 LLM 的 system message，再 `expect(systemContent).toContain(...)` / `.not.toContain(...)`。U1–U3 的结构化测试直接沿用这一范式（因此**无需为测试而导出** `buildAgentSystemPrompt`）。
- `server/routers.storyAgent.test.ts`（已存在）— 路由层测试范式。
- `docs/plans/2026-05-21-002-feat-story-agent-evocative-voice-plan.md` — frontmatter `status: implemented` **与现网不符**；但其 §38–49 编辑表（角色定义/情绪取向/身体审问/标签确认/追问方式/叙事弧线/内部状态/emotion/emotionOptions/pacing 重写）、§51–63 `formatSimilarMemoryCards` 重写、§65–81 `asEmotionOptions` 意图，都是 U1 可直接复用的决策。
- 客户端（U4 修改对象，桌面端）：
  - `client/src/features/storyAgent/types.ts` **L146–147** `FIRST_QUESTION`（客户端这份喂给桌面/手机的开场消息）。
  - `client/src/features/storyAgent/StoryAgentContext.tsx`：`emptyState()` L240–257 用 `content: FIRST_QUESTION` 播下唯一一条开场消息；`resetConversation` L1385–1403（toast「已开始新故事，旧故事仍保留在云端故事库」）；`createNewStory` L1565–1568（activeStoryId = -1）；`backToList` L1570–1573（activeStoryId = null + 刷新列表）。`activeStoryId` 状态机：null = 列表 / -1 = 新未存 / >0 = 已载。
  - `client/src/features/storyAgent/views/StoryListView.tsx`（135 行）：现成的「继续 / 新开」定位面（F2/R5 直接复用，不新建）。
  - `client/src/features/storyAgent/views/StoryAgentChat.tsx`（449 行）：桌面聊天页，header 有「新故事」(`resetConversation`) + 返回列表。
- `client/src/architecture-boundaries.test.ts` + `client/src/features/nayin/*.test.ts` — 客户端有 vitest 测试设施，U4 的开场文案单测可落在客户端。
- `docs/solutions/` — 无相关 learnings。

### 架构约束

- 声音存在**唯一一处共享构造器** `buildAgentSystemPrompt` → `replyFromStoryAgent`，扇出到桌面聊天、手机聊天、`_core` 非 tRPC 路径。**因此一次声音重写天然就是跨这三个面的**（这正是想要的统一身份，见 System-Wide Impact）。
- 客户端显示组件 props-in / UI-out，不直接调 tRPC；开场文案改在 context/types 层。
- LLM 行为类需求（照见触发、线头真实度）**无法靠结构化单测保证**；结构化测试只能守「不出现禁语 / 出现护栏语」这种可断言的契约，真实行为靠 U5 的人工实测 rubric。

---

## Key Technical Decisions

以下 6 条是规划期已与创始人确认的关键技术判断（源自 Phase 5.1.5 综合确认）：

- **D1. 声音重写会同步传到手机端聊天，这是有意为之。** `buildAgentSystemPrompt`/`replyFromStoryAgent` 共享，桌面 + 手机 + `_core` 三路都继承。小酌应是统一身份，手机端聊天的语气也该一起从取样器变成陪伴者。「手机端不在此范围」指的是手机端**开场文案与定位 UI** 单独重设计，不是「手机端保留取样器」。（see origin: Dependencies/Assumptions — 波及面假设）
- **D2. 上一份语音重写计划是 stale/未落地，本轮真正落地它。** U1 复用 `2026-05-21-002` 的 §38–49 编辑表与 `2026-05-19` 需求做这次重写，并**订正** `2026-05-21-002` frontmatter 里那条假的 `status: implemented`（改为反映真实历史，例如 `superseded` 并注明被本计划落地）。
- **D3. 「照见」扩展现有正向基础设施 + 一条对称硬护栏。** 不重造：在 L389/L408/L462/L463/L501 既有的正向词与「不升华」种子之上，加一块「照见真实的好」指令 + 一条与「不翻负」对称的「不灌鸡汤 / 不强行升华 / 不替用户拔高 / 宁可不照见」硬护栏。（see origin: Key Decisions — 照见 = 正向的如实镜像）
- **D4. 开场用「前缀 preamble」策略，保 FIRST_QUESTION 不变。** 报到 + 人格 + 定位的新文案作为桌面端开场**前缀**加在 `FIRST_QUESTION` 之前/之外，**不改** `FIRST_QUESTION` 本身——这样服务端提示词 L466 与手机端 context 都不被牵动，新文案只落桌面端。（避免一处改文案三处出血，见 Risks R-6）
- **D5. 测试范围 = 结构化提示词契约单测 + 桌面开场文案单测 + 人工行为实测 rubric。** 结构化单测沿用 `storyAgent.test.ts` 范式断言「禁语不出现 / 护栏语出现」；行为类验收（照见是否到位、线头是否真实、是否滑向鸡汤）由 U5 的人工 rubric 对照 AE 完成。
- **D6. `asEmotionOptions` 去掉方向性硬编码默认。** 跟随用户真实情绪，而不是用一组预设词把方向钉死（与去采样、去负面偏置一致）；具体保留多少兜底由实施决定，原则是不预先给情绪定调。

---

## Open Questions

### 已在规划中解决

- **声音地基改哪儿：** `server/archive/storyAgent.ts` 的 `buildAgentSystemPrompt` + `formatSimilarMemoryCards` + `asEmotionOptions`，复用 `2026-05-21-002` §38–81 决策。
- **波及面：** 共享提示词 → 手机端聊天同步受益（D1，预期）；开场文案只落桌面端 client（D4，不外溢）。
- **「继续 / 新开」入口形态：** 复用现有 `StoryListView` + `activeStoryId` 状态机，不新建存储（R5）。
- **测试形态：** 结构化契约单测 + 人工实测 rubric（D5）。

### 留给实施阶段

- 报到第一句的**最终措辞**（朋友 + 助手、参照「记得你的调酒师」气质）——需在实施中打磨并实测语感。
- 「照见真实的好」在 prompt 层**稳定触发又稳定不滑向鸡汤**的具体话术与判定边界——需实测（R7–R9，承自 origin Outstanding Questions）。
- 「真实线头」与「人造钩子」的判定与话术——需实测（R10–R11）。
- 开场/收尾文案如何措辞，才能既不承诺永久记忆、又为第二步记忆承诺留好自然升级接口（R6/R13）——需在 U4/U5 反复对照 AE3。

---

## Implementation Units

> 单元顺序即建议实施顺序。U1 是地基，U2/U3/U4 依赖它，U5 收口。Phase A→B→C→D。

### U1. 声音地基：把 `buildAgentSystemPrompt` 从取样器重写为陪伴者

**Goal:** 让小酌的系统提示词在结构上不再是情绪取样器，而是激发倾诉的陪伴者：去采样口吻、去身体审问、去负面偏置，并修掉相似卡片格式化与情绪选项里的方向偏置。这是其余所有单元的地基。

**Requirements:** R1, R2, R3（地基亦支撑 R7/R10 的落地）

**Dependencies:** 无

**Files:**
- Modify: `server/archive/storyAgent.ts`（`buildAgentSystemPrompt` L328、`formatSimilarMemoryCards` L227/L235、`asEmotionOptions` L541–547、对齐 L466；清理 L350/L384/L396–397/L406/L427/L445/L487 取样器语言）
- Modify: `docs/plans/2026-05-21-002-feat-story-agent-evocative-voice-plan.md`（订正假 `status: implemented`，见 D2）
- Test: `server/archive/storyAgent.test.ts`（新增「声音地基契约」describe 块）

**Approach:**
- 复用 `2026-05-21-002` §38–49 编辑表，对 `buildAgentSystemPrompt` 做角色定义/情绪取向/追问方式/叙事弧线/内部状态等段落的重写：把「采样情绪样本卡 + 我记成 X 你觉得准吗」式结构，换成「像真在听的人那样有反应、留白、邀请展开」的陪伴者结构。
- 删除/改写 L350、L384、L396–397、L406、L427、L445、L487 里所有取样、贴标确认、问身体、负面偏置语句；保留并强化 L389/L408/L462/L463/L501 的正向与「不升华」种子（为 U2 照见铺垫）。
- `formatSimilarMemoryCards`：删去 L235 的「反方向情绪更容易长出剧情起伏」反向偏置，改为中性的相似记忆参考。
- `asEmotionOptions`（D6）：去掉方向性硬编码默认，跟随用户真实情绪取向。
- 对齐 L466：确保「第一个问题固定是 FIRST_QUESTION」与新声音不冲突（FIRST_QUESTION 文本本轮保持不变，见 D4）。
- 订正 `2026-05-21-002` 的 frontmatter 状态（D2）。
- **不导出** `buildAgentSystemPrompt`：测试经由 `replyFromStoryAgent` 捕获 system message 断言（沿用现有范式）。

**Patterns to follow:**
- `server/archive/storyAgent.test.ts` 现有 `vi.mock('../_core/llm')` → 捕获 systemContent → `toContain`/`not.toContain` 范式。
- `2026-05-21-002` §38–81 的编辑决策。

**Test scenarios:**（结构化契约，沿用现有范式）
- 禁语清除：调用 `replyFromStoryAgent`，捕获 system prompt，断言**不含**「采样情绪」「情绪样本卡」「我先把它记成」「你觉得准吗」「身体是松的还是紧的」「哪个部位最先有反应」。
- 反向偏置清除：构造含相似卡片的入参，断言格式化后的相似记忆块**不含**「反方向」「差异更容易长出剧情起伏」。
- 护栏存在：断言 system prompt **含**陪伴者立场关键词（如「不审问」「不要升华」「留白 / 邀请」之类落地措辞，以实施最终文案为准）。
- 如实镜像（AE6/R3）：断言 prompt 含「用户讲开心就接住开心 / 不为戏剧性翻负」类约束语。
- 情绪选项（D6）：对 `asEmotionOptions` 单测——传入用户真实情绪词时不被一组方向性默认词覆盖/带偏。
- 回归：现有「edit context injection (U6)」「fallback (U8)」等测试仍全绿（确认重写没破坏既有提示词注入逻辑）。

**Verification:**
- `npm test` 中 `storyAgent.test.ts` 全绿；新「声音地基契约」块通过。
- 人工通读重写后的 `buildAgentSystemPrompt`，确认取样器结构整体消失（**对照 AE8、AE6**）。
- `2026-05-21-002` 状态已订正，不再误导。

---

### U2. 照见真实的好 + 不灌鸡汤硬护栏

**Goal:** 在地基之上让小酌不只「接住」还会「照见」——温柔指认用户讲述里真有的小美好/创造力/同情心，并把它归还给用户；同时用一条与「不翻负」对称的硬护栏，禁止鸡汤、强行升华、替用户拔高、无中生有。

**Requirements:** R7, R8, R9

**Dependencies:** U1

**Files:**
- Modify: `server/archive/storyAgent.ts`（在 `buildAgentSystemPrompt` 内，承接 L389/L462/L463/L501 种子新增「照见」指令块 + 对称护栏）
- Test: `server/archive/storyAgent.test.ts`

**Approach:**
- 新增「照见真实的好」指令：在用户讲述里**真有**一抹未点出的好（小美好、创造力、同情心等）时，温柔指认 + 明确归还（「这是你做到的 / 你身上本就有的」），不是恭维/打分/评价。
- 新增对称硬护栏：**正向失真 = 负面偏置同罪**；只照见真有的，没有真有的好就不照见；禁止鸡汤、强行升华、替用户拔高；设「宁可不照见」兜底（拿不准时选择沉默/单纯接住，而非硬安一个升华）。
- 复用 L463「这个很小，但很像你」作为「指认 + 归还」的语气锚点。

**Patterns to follow:**
- U1 重写后的护栏写法（与「不翻负」镜像）。
- L462/L463/L501 既有正向力量词处理。

**Test scenarios:**（结构化部分）
- 断言 system prompt **含**「照见 / 指认 + 归还 / 属于你自己」类指令。
- 断言 system prompt **含**对称护栏关键词（不灌鸡汤 / 不强行升华 / 不替用户拔高 / 宁可不照见 / 正向失真与负面偏置同罪）。
- 行为类（移交 U5 rubric，此处仅登记）：AE4（流浪猫→指认同情心并归还，非泛泛夸奖）、AE5（平淡小事不硬安升华）、AE6（明确开心→正向卡，无强加负面也无强行拔高）。

**Verification:**
- 结构化断言通过。
- U5 人工实测 rubric 中 **AE4/AE5/AE6** 通过：真有的好能被照见、没有的不硬造、归还而非恭维。

---

### U3. 收尾留真实线头

**Goal:** 让一段对话的收尾温暖地留一个**基于这次真实聊到内容**的开放、可不接的邀请，使人「聊完还想再来」；杜绝人造悬念/套路化钩子。

**Requirements:** R10, R11

**Dependencies:** U1

**Files:**
- Modify: `server/archive/storyAgent.ts`（在 `buildAgentSystemPrompt` 内新增收尾/线头指令）
- Test: `server/archive/storyAgent.test.ts`

**Approach:**
- 新增收尾指令：自然落点 + 一个真诚开放、可不接的邀请，邀请内容必须**取材于本次真实对话**。
- 明确禁止人造 cliffhanger（「下次告诉你一个秘密」式假钩子）。
- 与 R6/R13 协同：收尾文案**不得**承诺永久记忆，也不否认将来会有（为第二步留接口）。

**Patterns to follow:**
- U1 重写后的语气与护栏体例。

**Test scenarios:**（结构化部分）
- 断言 system prompt **含**「真实线头 / 基于本次内容 / 可不接的邀请」类指令，且**含**「不造假悬念 / 不套路化钩子」禁令。
- 断言收尾相关文案**不含**任何「永久记得 / 永远记住」式承诺（与 AE3 一致）。
- 行为类（移交 U5）：AE7（收尾邀请取材本次、可接可不接、无套路钩子）。

**Verification:**
- 结构化断言通过。
- U5 rubric **AE7** 通过。

---

### U4. 桌面开场：报到 + 人格 + 定位入口（不写「收集」、不过度承诺）

**Goal:** 桌面端开场让用户一进门就知道小酌是谁、能干嘛、为什么值得对它说，并能清楚地在「继续上次 / 开新故事」之间定位；全程无「收集 / 采样」字样、无永久记忆承诺。复用现有故事列表，不新建存储。

**Requirements:** R4, R5, R6, R13

**Dependencies:** U1（声音地基先到位，开场才不会进门即取样器）

**Files:**
- Modify: `client/src/features/storyAgent/types.ts`（开场文案常量；保留 `FIRST_QUESTION` L146 不变，新增报到/人格 preamble 常量）
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`（`emptyState()` L240–257 注入开场 preamble + FIRST_QUESTION 的组合开场消息）
- Modify: `client/src/features/storyAgent/views/StoryListView.tsx`（强化「继续 / 新开」定位的可见性与文案，作为 F2/R5 定位面）
- Test: 新增 `client/src/features/storyAgent/openingCopy.test.ts`（或就近的客户端测试文件）

**Approach:**
- 采用 D4「前缀 preamble」策略：在 `types.ts` 新增报到/人格文案常量（朋友 + 助手，参照「记得你的调酒师」气质），`emptyState()` 把它与现有 `FIRST_QUESTION` 组合成开场——**不改 `FIRST_QUESTION` 文本**，因此服务端 L466 与手机端 context 不受影响。
- 文案硬约束：不含「收集 / 采样」；不含「永久记得 / 永远记住」；落点是邀请用户说一件小事。
- 定位入口（R5）：复用 `StoryListView`（continue/new）与 `activeStoryId` 状态机（null/-1/>0），只在文案与可见性上让「继续上次 / 开新故事」更清楚，不新建存储或路由。
- R13 衔接：开场/收尾文案为第二步记忆承诺留自然升级接口（措辞上不堵死「将来会记得」）。

**Patterns to follow:**
- 现有 `emptyState()` 播开场消息的方式。
- `client/src/features/nayin/*.test.ts` 的客户端纯函数/常量单测范式。

**Test scenarios:**
- 开场文案单测（AE1/R4）：断言组合后的开场消息**含**报到 + 「朋友」「助手」身份点明、**不含**「收集」「采样」、落点是邀请说一件小事。
- 无过度承诺（AE3/R6/R13）：断言开场文案**不含**「永久 / 永远记得 / 都会记住」类措辞。
- FIRST_QUESTION 不变（D4 回归）：断言 `types.ts` 的 `FIRST_QUESTION` 文本与服务端 `storyAgent.ts` L20 保持一致（防止三处文案漂移）。
- 定位（AE2/R5，行为类移交 U5）：登记「老用户回来能清楚选继续/新开，不被默默丢进空白会话」。

**Verification:**
- 客户端开场文案单测通过。
- 浏览器 `http://localhost:3000` 实测：新用户进门看到报到 + 人格 + 邀请；老用户经 `StoryListView` 能清楚选继续/新开（**对照 AE1、AE2、AE3**）。

---

### U5. 分步范围守护 + 行为实测 rubric

**Goal:** 收口本轮：用一份可执行的人工实测 rubric 覆盖所有行为类验收（结构化单测无法保证的部分），并守住分步与范围边界——第一步文案不与第二步矛盾、不外溢到 out-of-scope 区域。

**Requirements:** R12, R13, R14

**Dependencies:** U1, U2, U3, U4

**Files:**
- Create: `docs/qa/2026-06-01-xiaozhuo-stickiness-acceptance-rubric.md`（人工实测清单，对照 AE1–AE8）
- Modify（仅校对，不改逻辑）: 通读 U1–U4 改动，确认未触碰 `selectionEdit`、下游管线、情绪模型、手机端开场 UI。

**Approach:**
- 写一份 rubric：把 AE1–AE8 逐条转成可在 `http://localhost:3000` 实操的测试脚本（输入示例 + 期望表现 + 失败信号），尤其覆盖 AE4/AE5/AE6（照见 vs 鸡汤）、AE7（真实线头 vs 假钩子）、AE8（陪伴 vs 采样）。
- 范围守护清单（R14）：核对改动只落在「对话层 + 桌面开场」，`selectionEdit`（routers.ts L873 附近）、卡片→剧本→镜头管线、情绪模型、手机端开场 UI **未被改动**。
- 分步守护清单（R13）：通读第一步全部开场/收尾文案，确认无一句承诺永久记忆、也无一句否认将来会有（AE3）。

**Patterns to follow:**
- origin 文档的 AE1–AE8 与 Success Criteria 作为 rubric 骨架。

**Test scenarios:**

Test expectation: 行为实测为主（人工 rubric），无新增自动化单测——本单元是验收与范围守护，不引入业务逻辑。

**Verification:**
- rubric 文档落地，AE1–AE8 全部可执行且本轮实测通过。
- 范围守护清单核对无越界改动（**对照 R12/R13/R14**）。

---

## System-Wide Impact

**共享提示词的波及面（核心系统性影响）：** 声音地基住在唯一的 `buildAgentSystemPrompt` → `replyFromStoryAgent`，三条调用路径都会继承 U1–U3 的重写：

| 调用路径 | 位置 | 是否预期受影响 | 说明 |
|---|---|---|---|
| 桌面聊天 | `server/routers.ts` L858（无 `enableImageGen`） | 是（本轮主目标） | 声音地基 + 照见 + 收尾全部生效 |
| 手机聊天 | `server/routers.ts` L1115（`enableImageGen: true`） | **是（有意为之，D1）** | 手机端聊天语气同步从取样器变陪伴者；但**开场文案与定位 UI 不变**（那是手机独立 context，U4 只改桌面 client） |
| 非 tRPC 路径 | `server/_core/index.ts` L250 | 是 | 同样继承新声音，保持身份统一 |

**关键边界澄清：** 「手机端不在此范围」= 手机端**开场文案/定位 UI** 单独重设计，**不等于**手机端保留取样器语气。声音地基的统一改善是正向外溢，符合「小酌是统一身份」。

**不受影响（已核实/守护）：** `selectionEdit`（独立 procedure，R14）、卡片→剧本→镜头下游管线、情绪分类模型、`FIRST_QUESTION` 文本（D4 保持不变，故服务端 L466 与手机端 context 不被牵动）。

---

## Risks

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | 共享提示词改动外溢到手机聊天/`_core` 路径 | 手机端语气同步变（预期）；但若误把开场文案也写进共享层会污染手机端 | U1 只改服务端**声音**；U4 开场文案只改桌面端 client，绝不碰 server `FIRST_QUESTION` 与手机 context（D4） |
| R-2 | 「照见」滑向鸡汤（正向失真） | 违反 R8，比沉默更糟，直接伤信任 | U2 设「宁可不照见」兜底 + 对称硬护栏；U5 rubric AE5 专门验「平淡不硬升华」 |
| R-3 | 去采样/不挖冲突后，下游剧本/镜头素材深度不足 | 成片张力可能下降（承自 2026-05-19 假设） | U5 实测验证；本轮不动下游；若实测发现问题，作为后续单独评估 |
| R-4 | 行为类需求（照见触发、线头真实度）无法靠结构化单测保证 | 自动化测试给不出行为保证 | 结构化单测守「禁语不出现/护栏语出现」；行为靠 U5 人工 rubric 对照 AE（D5） |
| R-5 | 与 2026-05-19 需求/2026-05-21-002 计划重复或状态混乱 | 重复劳动 / 误以为已实现 | U1 显式 reconcile：复用 §38–81 决策 + 订正假 `implemented` 状态（D2） |
| R-6 | 两处 `FIRST_QUESTION`（server L20 / client types.ts L146）+ 提示词 L466 引用，改文案易顾此失彼 | 三处漂移导致开场/提示词不一致 | D4 用「前缀 preamble」保 `FIRST_QUESTION` 不变；U4 加一条「两处 FIRST_QUESTION 文本一致」回归断言 |
| R-7 | 重写破坏既有提示词注入（edit context U6 / fallback U8） | 编辑偏好注入等功能回归 | U1 测试场景含「既有测试仍全绿」回归项 |

---

## 实施顺序与里程碑

1. **Phase A（地基）：** U1 — 声音从取样器→陪伴者，修相似卡片/情绪选项偏置，订正 stale plan。
2. **Phase B（内容）：** U2 照见 + 护栏、U3 收尾线头（均依赖 U1，可并行起草）。
3. **Phase C（开场）：** U4 桌面报到 + 人格 + 定位（依赖 U1）。
4. **Phase D（收口）：** U5 范围守护 + 行为实测 rubric（依赖 U1–U4）。

完成判定：`storyAgent.test.ts` + 客户端开场文案单测全绿；U5 rubric 对照 AE1–AE8 在 `http://localhost:3000` 实测通过；范围守护清单核对无越界。
