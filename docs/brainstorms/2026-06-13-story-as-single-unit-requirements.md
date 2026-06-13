---
date: 2026-06-13
topic: story-as-single-unit
---

# 故事为唯一单位：让各界面读同一个故事

## Summary

把"故事"确立为唯一工作单位，让 Story 页、creation 聊天、Shot Production Table 都跟随同一个"当前故事"、读同一份卡片/剧本/镜头；项目退化成纯文件夹。修掉"同一项目下多个故事，各界面各取各的"这一地基级错配。

---

## Problem Frame

一个项目（project）下可以挂多个故事（story）——真实数据里 6 个项目挂了 15 个故事，项目 1 一个就挂了 5 个。各界面解析"当前故事"的方式不一致：

- **Story 页**（故事聊天 + Story Cards + Script）认用户显式打开的 `activeStoryId`，卡片/剧本/镜头都读该 story 的 `stories.body`（body 自包含 `cards / script / shots / characters / messages`）。
- **Creation 页**（creation 聊天 + Shot Production Table）认 `getLatestStoryForProject`（项目里最近更新的故事），而 **Shot Production Table 只认 `projectId`、不绑 storyId**（独立的 `shots` 表）。

于是同一项目下有多个故事时三者必然错位：Story 页显示你打开的 A，creation 聊天读最新的 B，镜头表显示的是上次某个故事同步进项目级 shots 表的结果。用户看到的是"聊天、卡片、剧本、镜头表说的不是一个故事"。

这是地基：在错配的底座上做任何"目标驱动生成"都是空中楼阁，所以必须先修。

---

## Actors

- A1. 用户：项目所有者，在 Story 页构思故事、在 Creation 页做镜头与出图，期望两边是同一个故事。
- A2. creation 聊天 Agent（小酌）：当前读"最新故事"，需改为读"当前故事"。
- A3. Story 聊天 Agent：已基于 `activeStoryId` 工作，是"当前故事"概念的现有载体。

---

## Key Flows

- F1. 切换/打开一个故事，全界面对齐
  - **Trigger:** 用户在 Story 页打开（或新建）一个故事
  - **Actors:** A1, A2, A3
  - **Steps:** 用户选定故事 → 该故事成为全局"当前故事" → 切到 Creation 页 → Shot Production Table 显示的是这个故事的镜头、creation 聊天讨论的也是它
  - **Outcome:** 三个界面读同一个故事的卡片/剧本/镜头，不再错位
  - **Covered by:** R1, R2, R3, R5

- F2. 在 Creation 页基于当前故事改镜头
  - **Trigger:** 用户在当前故事下编辑/生成镜头
  - **Actors:** A1, A2
  - **Steps:** 改动落到"当前故事"的镜头上 → 回到 Story 页该故事的镜头与之一致
  - **Outcome:** 镜头归属唯一明确，不被同项目其他故事覆盖
  - **Covered by:** R2, R4

---

## Requirements

**当前故事（单一真相源）**
- R1. 存在一个全局唯一的"当前故事"概念，Story 页与 Creation 页共享同一个值；沿用 Story 页已有的 `activeStoryId` 机制扩展为跨页共享，不新造一套并行状态。
- R2. Creation 页（creation 聊天 + Shot Production Table）改为跟随"当前故事"，不再用"项目里最近更新的故事"（弃用 `getLatestStoryForProject` 作为 creation 侧的故事来源）。
- R5. 当没有明确"当前故事"时（如刚进入、尚未打开任何故事），各界面有一致、可预期的空状态，不得各自回退到不同故事。

**镜头归属到故事**
- R3. Shot Production Table 显示的镜头归属到"当前故事"，而不是仅按 `projectId`。`shots` 表增加 `storyId` 归属维度；现有镜头数据（10 条，分布在 3 个项目）迁移到其所属故事。
- R4. 在 Creation 页对镜头的增删改，落到"当前故事"名下；同项目的其他故事不受影响、不被覆盖。

**不破坏既有结构**
- R6. 不改动 `stories.body` 的自包含结构（卡片/剧本仍存于 body）；本次只把"项目级镜头表"对齐到故事维度。
- R7. 上一轮已合并的"创作目标注入"（goal）功能保留、不回退；本次不在其上叠加新功能。

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** 给定项目 1 下有 5 个故事，用户在 Story 页打开故事 X，切到 Creation 页：Shot Production Table 显示的是故事 X 的镜头，creation 聊天讨论的也是故事 X——而不是"最新故事"或别的故事。
- AE2. **Covers R4.** 用户在 Creation 页给当前故事 X 加了一个镜头，回到 Story 页打开同项目的故事 Y：故事 Y 的镜头不包含刚加的那条；再打开 X，那条还在。
- AE3. **Covers R5.** 用户刚进入、还没打开任何故事时，Creation 页不擅自加载某个故事的镜头，而是显示一致的空/未选状态。

---

## Success Criteria

- 用户在 Story 页打开某个故事后，切到 Creation 页，三个界面（卡片/剧本、镜头表、聊天）说的是同一个故事——这是验收的核心体感。
- 同项目多故事不再互相覆盖镜头。
- 现有 10 条镜头迁移后无丢失，且各归其所属故事。
- 交接给 ce-plan 时不需要再发明产品行为：当前故事的定义、镜头归属维度、空状态行为均已定义。

---

## Scope Boundaries

- 不做 buildShotList（聊天直接铺整张镜头表）——地基稳了再回来做（已暂停的功能）。
- 不做自动意图识别、不做真正的视频合成。
- 不深化社媒/记录两个目标。
- 不做 B 方案（一个项目=一个故事的数据合并/删故事）——A 方案不需要。
- 不改 `stories.body` 自包含结构，不迁移卡片/剧本的存储位置。
- 不回退上一轮的目标注入（goal）。

---

## Key Decisions

- 采用 A 方案（故事是单位，项目是文件夹）而非 B 方案（合并为一项目一故事）：A 不需要破坏性的数据合并，且匹配现状——`story.body` 本就自包含卡片/剧本/镜头，项目只是容器。
- "当前故事"复用 `activeStoryId` 扩展为跨页共享，而非新造并行状态：避免再增加一套"谁是当前"的真相源，那正是当前错配的成因。
- 镜头表从"按 projectId"改为"按 storyId 归属"：让镜头与故事一一对应，根治多故事覆盖。

---

## Dependencies / Assumptions

- 现状已对源码验证：`shots` 表仅按 `projectId`（drizzle/schema.ts）、creation 侧用 `getLatestStoryForProject`（server/db.ts）、Story 页用 `activeStoryId`（client/src/features/storyAgent/StoryAgentContext.tsx）、`story.body` 含 cards/shots（抽查真实数据确认）。
- 迁移数据量极小（10 条镜头、3 个项目），但需要一个把现有项目级镜头归属到正确故事的迁移规则——该规则的细节（如何判定某条镜头属于哪个故事）留给 ce-plan 在读代码后确定。
- 假设 `activeStoryId` 当前仅活在 Story 页的客户端状态；要跨页共享，其载体（提升到全局状态 / 持久化 / 服务端化）由 ce-plan 决定。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] `shots` 表加 `storyId` 的迁移策略，以及现有镜头如何判定归属故事（按 projectId+时间？按 body.shots 对照？）——需读代码后定。
- [Affects R1][Technical] "当前故事"跨页共享的承载方式：提升到全局 client store、URL/路由参数、还是服务端记一个 active story——由 ce-plan 权衡。
- [Affects R2][Technical] `getLatestStoryForProject` 的其他调用方是否还有别处依赖，弃用前需排查。
