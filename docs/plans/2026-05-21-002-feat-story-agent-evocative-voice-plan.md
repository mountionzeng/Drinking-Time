---
date: 2026-05-21
feature: story-agent-evocative-voice
requirements: docs/brainstorms/2026-05-19-story-agent-evocative-voice-requirements.md
status: superseded
superseded_by: docs/plans/2026-06-01-001-feat-xiaozhuo-conversation-stickiness-plan.md
---

# Plan: 小酌从「情绪取样器」改为「激发倾诉的陪伴者」

> **⚠️ 状态订正（2026-06-01）**：本计划此前被标记为 `implemented`，但这是**误标**——在 2026-06-01 比对线上代码时发现，`server/archive/storyAgent.ts` 仍是旧的「取样器」提示词，本计划描述的重写**从未真正落地**。
>
> 这套声音地基的重写（取样器 → 陪伴者、删除问身体 / 贴标确认 / 负面偏置、`asEmotionOptions` 去方向性默认词）已于 2026-06-01 由后续计划的 **U1（声音地基）** 真正实现并补了契约测试，并在其基础上扩展了「照见真实的好」「收尾留线头」等。本文档保留作为那次重写的设计依据，状态改为 `superseded`，后续以 `superseded_by` 指向的新计划为准。

## Goal

把 Story Agent（小酌）的对话立场从**情绪取样器**重做成**陪伴者**——让用户因为「想说」而继续，而不是被问题牵着；卡片忠于用户真实的情绪取向，不把开心改写成负面。

参见需求文档：`docs/brainstorms/2026-05-19-story-agent-evocative-voice-requirements.md`

---

## Scope（仅 `server/archive/storyAgent.ts`，下游管线不动）

- `buildAgentSystemPrompt`：小酌的主对话 system prompt
- `formatSimilarMemoryCards`：kNN 邻居卡片的使用指引
- `asEmotionOptions`：情绪选项候选词的构造逻辑

---

## Changes

### 1. `buildAgentSystemPrompt` — 全量重写

**旧立场（取样器）的根问题：**
- 通篇「情绪样本卡」「情绪采样优先召回」语气，对话变成采样+确认
- 显式偏好负面/冲突：「优先捕捉反方向、矛盾、烦躁、羞耻、空掉」「情绪太平就问一个反方向的问题」
- 显式要求问身体：「身体是松的还是紧的」「身体哪个部位最先有反应」
- 「我先把它记成 X，你觉得准吗」式的贴标确认打断倾诉

**新立场（陪伴者）的核心机制：**

| 模块 | 新写法 |
|------|--------|
| 角色定义 | "你在做的，是让对方自己想说下去" |
| 情绪取向 | "他说开心就是开心"；硬规矩禁止翻负 |
| 身体审问 | "不要去问他身体的反应——那会让人觉得自己被当成观察对象" |
| 标签确认 | "绝不在 reply 里问「我先把它记成 X，你觉得准吗？」这类话" |
| 追问方式 | 一次只问一件事；能用回应代替提问就别提问；给留白 |
| 叙事弧线（≥4卡） | "如果情绪很平、很温和，那就是它本来的样子——不要去翻出一个负面的反面来" |
| 内部状态识别 | 保留 7-trait read，但 numb/麻木 的应对改为「问场景和物，不要问身体」 |
| card.emotion 指令 | 明确列举开心一族候选词，禁止默认负面 |
| card.emotionOptions 指令 | "跟着主情绪同一族的 4-5 个近义候选；不要套用一组固定的负面词组" |
| 节奏（pacing）块 | 各阶段均包含「情绪取向跟着对方，不要替他翻成负面」的明确约束 |

### 2. `formatSimilarMemoryCards` — 移除反方向偏置指令

**旧：**
```
如果当前输入和邻居相似但有反方向情绪，优先问这个差异，因为差异更容易长出剧情起伏。
```

**新：**
```
如果邻居和当前输入有情绪差异，顺着对方此刻真实的情绪接话——他是什么情绪你就接什么情绪，不必把差异变成追问或往反方向带。
```

**理由：** kNN 邻居是旧记忆，当前输入才是用户此刻的真实情绪。旧指令会把历史负面情绪反注入当前对话，制造方向性干扰。

### 3. `asEmotionOptions` — 移除全负面的硬编码默认词组

**旧：**
```typescript
const defaults = ["委屈", "愤怒", "遗憾", "释然", "麻木"];
return Array.from(new Set([...defaults, ...options])).slice(0, 7);
```

问题：defaults 在 Set 中排在最前，导致模型即使返回正向选项，最终数组的前 5 个仍全是负面词。

**新：**
```typescript
// 无硬编码默认词组；情绪选项必须来自模型，方向跟着用户真实情绪
return options.slice(0, 7);
```

**理由：** 模型 prompt 已要求返回 4-5 个方向适配的候选词。如果模型返回空，空列表比注入错误方向词更好。

---

## Requirements Coverage

| 需求 | 覆盖情况 |
|------|---------|
| R1 激发倾诉，非采样 | ✅ 角色定义 + 三条规矩 + 叙事弧线块 |
| R2 去掉贴标确认 | ✅ 固定机制第1条明确禁止 |
| R3 故事来自邀请展开 | ✅ 叙事弧线块邀请话术 |
| R4 移除身体审问 | ✅ 角色信念 + 机制第5条 + numb 应对 |
| R5 情绪如实镜像 | ✅ 说话方式块硬规矩 + card.emotion 指令 + asEmotionOptions |
| R6 删除负面偏置指令 | ✅ 主 prompt + formatSimilarMemoryCards |
| R7 暗流如实保留，不放大 | ✅ 叙事弧线块 + 说话方式块 |
| R8 下游管线不动 | ✅ shot synthesis / 剧本生成未触碰 |

---

## Acceptance Examples Verified (via prompt reading)

- AE1（开心事 → 开心卡）：`card.emotion` 指令列开心一族示例；`asEmotionOptions` 不再注入负面默认 ✓
- AE2（无身体追问）：角色信念 + 机制第5条 + numb trait 指令 ✓
- AE3（先有反应不贴标）：机制第1条 ✓
- AE4（暗流如实不放大）：叙事弧线块「不要去翻出一个负面的反面来」+ 说话方式「仅当用户自己带出暗流时才如实保留」✓
- AE5（平淡不追挖矛盾）：叙事弧线块「如果情绪很平、很温和，那就是它本来的样子」✓
- AE6（用户想继续说而非被问题牵）：三条规矩「少问，多接」+ 「能用回应代替提问就别提问」✓
