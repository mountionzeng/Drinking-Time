---
title: "feat: 创造另一个世界意图入口"
type: feat
status: active
date: 2026-07-02
origin: docs/brainstorms/2026-07-02-fiction-world-intent-requirements.md
---

# feat: 创造另一个世界意图入口

## 总结

在现有 story agent 意图系统上扩展一条虚构故事专线：开场菜单新增「创造另一个世界」，复用共享 `confirmedIntent` 作为唯一意图事实，给聊天、故事卡抽取和拆镜注入虚构短片约束。实现重点是把虚构故事的逻辑放在意图和 prompt 层，而不是散落到故事版、镜头设计表或动态分镜里。

---

## 问题背景

现有能力菜单已经能把「求职」抬到开场，并通过 `confirmedIntent` 影响聊天、故事卡和拆镜；但虚构故事目前只是一个枚举标签，没有用户可见入口，也没有专属创作主轴。若直接沿用求职或私人回忆逻辑，虚构故事会被误写成个人优势、真实经历或情绪留念。

---

## 需求追踪

- R1. 开场能力菜单必须新增「创造另一个世界」，位置与「求职·给招聘者看」同级。
- R2. 选择该入口后，当前意图必须明确标记为虚构故事创作，不复用求职、作品集、私人留念的叙事目标。
- R3. 用户直接输入虚构灵感而未点菜单时，小酌可以识别为虚构故事意图，但需要以自然语言反映回来，避免误把真实经历改写成虚构故事。
- R4. 第一次产物必须是一套完整故事卡，而不是直接拆镜。故事卡至少包含故事核心、角色、冲突、视觉风格。
- R5. 故事卡必须为虚构故事服务：强调世界感、人物动机、叙事冲突和影像气质，不强调招聘说服力、个人优势或简历可信度。
- R6. 用户确认故事卡前，系统不应自动进入最终 shot 生成；用户可以让小酌继续改故事方向。
- R7. 用户确认后，系统默认生成 3-5 镜短片，而不是长篇世界观设定、连续剧章节或完整剧本。
- R8. 生成的 shots 必须继续进入现有故事版看板、镜头设计表、动态分镜、图片和视频管线。
- R9. 如果用户后续修改故事卡，后续镜头应围绕新的故事核心更新，而不是保留旧求职/旧故事的意图残留。

**来源角色：** A1 用户，A2 小酌  
**来源流程：** F1 一句话生成虚构故事卡，F2 确认故事卡后拆成短片镜头  
**来源验收例：** AE1 菜单入口，AE2 先出故事卡，AE3 确认后 3-5 镜，AE4 直说虚构灵感也按虚构回应

---

## 范围边界

- 不新建平行的「虚构故事工作台」；v1 继续复用 story cards、故事版看板、镜头设计表、动态分镜。
- 不做完整世界观数据库、角色关系网、长篇连续剧结构。
- 不做三套故事方向供用户选择；v1 只生成一套可编辑故事卡。
- 不把科幻、悬疑、童话、现实魔幻等类型库一次做透；类型词可进入 prompt，但不建立独立类型系统。
- 不改图片、视频、剪辑的素材事实层；本计划只改上游意图、故事卡目标和拆镜约束。
- 不把其他菜单入口一起做透；除兼容标签外，本计划只新增并打通「创造另一个世界」。

### 后续另做

- 多方向故事提案、世界观资料库、角色关系图：等 v1 跑通一句话短片后再评估。
- 虚构故事专属美术风格库：后续可接统一提示词谱系，但本计划只保证意图和故事卡能把视觉风格写清楚。
- 动态分镜里的派生镜头和选区小酌深度联动：沿用现有素材/选区线，当前不新增剪辑能力。

---

## 上下文与研究

### 相关代码与模式

- `client/src/features/storyAgent/views/StoryCapabilityMenu.tsx`：现有 5 个开场能力卡、`buildCapabilityIntent`、`chooseCapability` 和显示条件测试，是新增入口的直接落点。
- `client/src/features/storyAgent/intentTypes.ts`：已有 `fiction` 标签，但文案是「讲别人的故事（虚构）」，需要升级成可见产品入口；`StoryIntent` 是共享意图形状。
- `client/src/features/storyAgent/StoryAgentContext.tsx`：`confirmedIntent`、`pendingIntentDraft`、后台意图识别、聊天 payload、`generateScript()` 都在这里汇流。
- `client/src/features/storyAgent/views/StoryAgentChat.tsx`：负责渲染能力菜单、求职轻问、pending intent 软确认，可以沿用同一块聊天 UI 语法。
- `client/src/features/storyAgent/views/StoryJobIntakePrompt.tsx`：求职轻问把领域专属采集做成独立组件，是虚构故事确认提示可借鉴的边界。
- `server/archive/storyIntent.ts`：服务端意图识别已有 `fiction` purpose，但本地兜底只识别求职；需要补虚构灵感的低风险兜底。
- `server/archive/storyAgent.prompts.ts`：求职模式已经通过 `formatJobSearchIntentBlock`、`buildAgentSystemPrompt` 和 `buildCardExtractionPrompt` 改变聊天与卡片抽取；虚构模式应放在同一层。
- `server/archive/shotSynthesis.ts`：求职已有专属兜底/弧线判断；虚构短片需要在同一导演层约束 3-5 镜和叙事弧线。
- `server/routers.ts`：`storyAgent.chat` 和 `storyAgent.classify` 都接收 `confirmedIntent`；公共接口已存在，优先扩展，不另开路由。

### 项目内经验

- `docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md`：镜头、图片、视频都应以故事为单位，不应绕过故事归属。本计划不改素材归属，只让虚构意图进入已有故事链路。
- 项目工作透明协议要求任务过程中文说明、明确 worktree 和安全边界；本计划在独立 worktree 中执行，避免与 `main` 和 U7 线互相踩。

### 外部参考

- 未使用外部资料。现有 React + tRPC + story agent 模式已足够，外部研究不会改变实现路径。

---

## 关键技术决策

- **复用现有 `fiction` purpose，不新增 `world_creation` 枚举。** 现有服务端和共享类型已经认识 `fiction`，复用能减少迁移和兼容成本；用户可见文案改为「创造另一个世界」。
- **虚构故事逻辑放在意图和 prompt 层。** 菜单只负责确认意图，聊天和卡片抽取 prompt 决定「先出故事卡」，导演层决定「3-5 镜短片」；故事版、镜头设计表、动态分镜只消费结果。
- **v1 用现有 StoryCard 承载完整故事卡。** 不新增 story-card schema；把故事核心、角色、冲突、视觉风格写进现有字段与主题线索，避免为第一版引入新的持久化结构。
- **直说入口使用软确认。** 菜单点击是显性确认；直接说「月亮掉进菜市场」这类虚构灵感时，小酌先反映判断，再进入虚构模式，避免把真实经历误判成虚构。
- **拆镜继续走 `generateScript` / `classify`。** 确认后的 3-5 镜不另建生成按钮或路由；只增强 confirmed intent 的上下文和导演约束。
- **每个 prompt 改动都带架构约束尾巴。** prompt 只能要求模型改变聊天、卡片抽取或拆镜产物，不得让模型假装写入素材库、生成图片、生成视频或改剪辑状态。

---

## 待定问题

### 计划阶段已决

- 是否新增新的 purpose 名称：不新增，复用 `fiction`，把用户可见文案升级为「创造另一个世界」。
- 一套完整故事卡是否需要新 schema：v1 不需要，先用现有 StoryCard 字段承载，后续如果需要多卡/世界观结构再扩展。
- 是否新建独立后端路由：不新建，复用现有 `storyAgent.chat` 和 `storyAgent.classify`。

### 实施阶段再定

- 虚构故事卡确认按钮的最终 UI 文案：实现时按现有聊天气泡/按钮视觉打磨，但语义必须是「确认故事卡后再拆镜」。
- 虚构灵感本地兜底关键词边界：实现时从低风险词开始，避免把真实经历误判成虚构。
- 3-5 镜数量约束的兜底细节：实现时根据 `synthesizeShotList` 现有兜底路径决定是裁剪、重排还是在 prompt 中约束。

---

## 高层技术设计

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**三条线：模块边界、数据流向、公共接口**

```mermaid
flowchart LR
  A["UI 边界\nStoryCapabilityMenu / StoryAgentChat"] --> B["意图事实\nStoryIntent purpose=fiction"]
  B --> C["聊天与卡片抽取\nstoryAgent.prompts"]
  C --> D["故事卡\n现有 StoryCard"]
  D --> E["确认后拆镜\nstoryAgent.classify"]
  E --> F["现有下游\n故事版 / 镜头设计表 / 动态分镜"]
```

| 架构线 | v1 边界 | 不允许发生的事 |
| --- | --- | --- |
| 模块边界 | UI 只设置/确认意图；prompt 层负责创作语义；导演层负责拆镜 | 把虚构故事规则写进故事版、图片、视频或剪辑组件 |
| 数据流向 | `confirmedIntent` → chat payload → card extraction → classify | 各面板各自维护一套虚构状态 |
| 公共接口 | 复用 `storyAgent.chat`、`storyAgent.classify` 和现有 StoryCard | 新增未被下游消费的平行故事数据结构 |

---

## 实施单元

### U1. 菜单与意图标签接入

**目标：** 在开场能力菜单中新增「创造另一个世界」，点击后写入共享 `confirmedIntent`，并让标签文案从占位式「讲别人的故事」升级成明确产品入口。

**关联需求：** R1, R2, AE1

**依赖：** 无

**文件：**
- 修改： `client/src/features/storyAgent/views/StoryCapabilityMenu.tsx`
- 修改： `client/src/features/storyAgent/intentTypes.ts`
- 测试： `client/src/features/storyAgent/views/StoryCapabilityMenu.test.tsx`
- 测试： `client/src/features/storyAgent/StoryAgentContext.intent.test.tsx`

**方案：**
- 扩展现有 `StoryCapabilityId` 和 `CAPABILITY_OPTIONS`，让「创造另一个世界」与求职同级显示。
- `buildCapabilityIntent` 为该入口返回 `purpose: fiction`、公开观众或未知平台、虚构短片目标和影像调性。
- 保持菜单选择不写入 `messages` 的既有约束，避免污染对话历史。
- 更新 `PURPOSE_LABELS.fiction` 的用户可见文案，同时保留与旧 persisted intent 的兼容。

**执行提示：** 先补/改菜单纯函数测试，再改 UI。

**参考模式：**
- `StoryCapabilityMenu.test.tsx` 现有 5 能力卡断言。
- `buildCapabilityIntent('linkedin_job_search')` 的显性意图写入模式。

**测试场景：**
- 正向： 渲染开场菜单时能看到「创造另一个世界」，且仍能看到已有 5 个入口。
- 正向： 选择「创造另一个世界」会调用 `setConfirmedIntent`，intent purpose 为 `fiction`，desiredEffect 明确服务虚构短片。
- 边界： 选择 fiction 不进入求职轻问，`targetRole`、`channel`、`jobMaterialsPrompted` 不应被设置。
- 集成： 菜单选择仍不追加 chat message。

**验收方式：**
- 新入口在开场菜单可见；选择后菜单收起，`confirmedIntent` 成为虚构故事意图。

---

### U2. 直说虚构灵感的软确认

**目标：** 用户不点菜单、直接说虚构灵感时，后台识别可生成 pending fiction intent，并由聊天区用自然语言确认，避免误判真实经历。

**关联需求：** R3, R5, AE4

**依赖：** U1

**文件：**
- 修改： `server/archive/storyIntent.ts`
- 修改： `server/archive/storyIntent.test.ts`
- 修改： `client/src/features/storyAgent/StoryAgentContext.tsx`
- 修改： `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- 测试： `client/src/features/storyAgent/StoryAgentContext.intentRecognition.test.tsx`

**方案：**
- 在服务端意图识别 prompt 中保留现有 fiction 说明，并补一个低风险本地兜底：明显「编一个故事 / 虚构 / 世界 / 主角 / 怪谈」等信号才归入 fiction。
- 将客户端 `recognitionToPendingJobIntent` 的概念泛化为「可软确认的 pending intent」：求职和虚构都能进入 pending，低置信或 exploration 继续静默。
- `StoryAgentChat` 的 pending intent 气泡根据 purpose 显示不同反映话术；fiction 话术强调「我按虚构短片来写一个世界，可以吗？」。
- 用户确认后写入 `confirmedIntent`；用户拒绝则清除 pending，继续普通聊天。

**执行提示：** 先用现有 intent recognition 测试刻画求职不回归，再加 fiction 分支。

**参考模式：**
- `StoryAgentContext.intentRecognition.test.tsx` 的 pending job intent 测试。
- `StoryAgentChat` 已有求职 reflect-back 气泡。

**测试场景：**
- 正向： 识别结果为高置信 fiction 时产生 pending intent。
- 正向： pending fiction intent 渲染虚构故事确认气泡，包含确认和继续聊两个动作。
- 边界： 低置信 fiction 或 exploration 不弹确认。
- 边界： 已有 `confirmedIntent` 或 pending intent 时不重复识别。
- 错误： recognizeIntent 抛错时只 warn，不打断聊天。
- 集成： 求职 soft confirm 现有文案和行为保持不变。

**验收方式：**
- 用户直接说虚构故事灵感时，小酌能自然确认方向；真实经历不会因为普通情绪描述被强行虚构化。

---

### U3. 虚构模式聊天与故事卡抽取

**目标：** 让小酌在 fiction intent 下先生成一套完整故事卡，故事卡服务世界、角色、冲突和视觉风格，而不是求职证据或私人回忆。

**关联需求：** R4, R5, R6, AE2

**依赖：** U1, U2

**文件：**
- 修改： `server/archive/storyAgent.prompts.ts`
- 修改： `server/archive/storyAgent.test.ts`
- 修改： `client/src/features/storyAgent/StoryAgentContext.tsx`
- 测试： `server/archive/storyAgent.test.ts`

**方案：**
- 在 `storyAgent.prompts.ts` 增加 fiction intent block，类似求职模式块，但目标改为「一句灵感 → 可确认故事卡」。
- 聊天 system prompt 中明确：第一步先回应并生成故事卡，不要直接拆镜，不要把用户当求职者，不要索要简历/JD。
- 卡片抽取 prompt 在 fiction 下把 card 标准改成：只要用户给了虚构灵感，就沉淀一张完整故事卡；字段映射为故事核心、角色、冲突、视觉风格、主题线索。
- 保持现有每轮最多新增一张 StoryCard 的数据结构；这张卡必须足够完整，后续确认后可拆 3-5 镜。
- 在 prompt 尾部加入架构约束：本轮只产出聊天回复和 card，不声称已生成 shots、图片、视频或时间轴。

**执行提示：** 优先加 prompt 内容断言，避免后续 AI 改 prompt 时把求职词带进 fiction 分支。

**参考模式：**
- `server/archive/storyAgent.test.ts` 中「求职模式 system prompt」和「求职模式后台抽取」测试。
- `buildCardExtractionPrompt` 现有求职分支的职责边界。

**测试场景：**
- 正向： fiction confirmedIntent 下，聊天 system prompt 包含虚构故事模式、故事核心/角色/冲突/视觉风格，并不包含求职影片顾问/JD/简历。
- 正向： fiction confirmedIntent 下，卡片抽取 prompt 要求虚构灵感生成完整故事卡。
- 边界： 非 fiction、非 job intent 仍走原普通情绪卡逻辑。
- 集成： 传入 storyCards 上下文时，fiction prompt 要求围绕已有故事核心修改，而不是重开新故事。

**验收方式：**
- 输入一句虚构灵感后，故事卡内容读起来是一个可拍短片的故事方向，而不是优势清单或情绪碎片。

---

### U4. 故事卡确认与拆镜闸门

**目标：** 在用户确认故事卡后再进入 3-5 镜拆镜；确认前保持故事卡可修改，不自动生成最终 shots。

**关联需求：** R6, R7, R8, AE2, AE3

**依赖：** U1, U3

**文件：**
- 修改： `client/src/features/storyAgent/intentTypes.ts`
- 修改： `client/src/features/storyAgent/StoryAgentContext.tsx`
- 修改： `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- 修改： `client/src/features/storyAgent/views/StoryCardsBoard.tsx`
- 测试： `client/src/features/storyAgent/StoryAgentContext.intent.test.tsx`
- 测试： `client/src/features/storyAgent/views/StoryCardsBoard.intent.test.ts`

**方案：**
- 给 fiction intent 增加一个轻量生命周期标记，表达「故事卡已确认，可以拆镜」。字段名在实现时确定，但必须属于 `StoryIntent`，不能另起局部状态。
- 在聊天区或故事卡区域提供确认动作；用户确认后更新 `confirmedIntent`，再允许现有 `generateScript()` 按 fiction 约束拆镜。
- 如果用户继续修改故事卡，确认状态应能被清除或重新确认，避免 R9 的旧故事意图残留。
- 不新增下游素材状态；确认只影响拆镜入口和 confirmed intent。

**执行提示：** 先补纯函数/状态测试，再接 UI；不要把确认状态放进某个面板局部 state。

**参考模式：**
- `StoryJobIntakePrompt.tsx` 通过 `StoryIntent` 字段推进求职轻问状态。
- `StoryCardsBoard.tsx` 现有 `generateScript()` 入口和禁用条件。

**测试场景：**
- 正向： fiction intent + 有故事卡 + 未确认时，UI 提示先确认故事卡再拆镜。
- 正向： 点击确认后，`generateScript()` 使用 context 中的 fiction intent。
- 边界： 非 fiction intent 不显示虚构确认闸门。
- 边界： 修改/删除故事卡后，确认状态不应继续假装有效。
- 集成： 确认动作不新建 story、不改图片/视频素材状态，只更新 story agent state。

**验收方式：**
- 用户能先看故事卡、改故事卡，确认后再生成 shots；不会一输入灵感就自动拆镜。

---

### U5. 虚构短片拆镜约束

**目标：** 确认后的 fiction story cards 默认拆成 3-5 镜虚构短片，镜头服务开端、推进、转折、收束，并继续进入现有下游管线。

**关联需求：** R7, R8, R9, AE3

**依赖：** U3, U4

**文件：**
- 修改： `server/routers.ts`
- 修改： `server/archive/shotSynthesis.ts`
- 修改： `server/archive/storyAgent.test.ts`
- 测试： `server/archive/storyAgent.test.ts`
- 测试： `client/src/features/creationEditor/creationEditor.routing.test.tsx`

**方案：**
- 扩展 `buildConfirmedIntentLine` 或等价上下文构造，让 fiction intent 明确进入 `classify` 的 scriptContext。
- 在 `shotSynthesis` 中增加 fiction 判定与导演约束：3-5 镜、短片弧线、每镜服务虚构故事，不使用求职竞争力语言。
- 兜底路径也要尊重 fiction：如果模型返回坏 JSON，fallback shots 仍应是虚构短片镜头，而不是优势镜头或普通情绪镜头。
- 保持 `replaceDirectorShotsForStory` 和 storyId 归属验证不变。

**执行提示：** 先加服务端测试钉住 prompt/兜底，再改导演逻辑。

**参考模式：**
- `shotSynthesis.ts` 现有 `isJobSearchIntent` 和 `buildJobSearchFallbackShotList` 的分支方式。
- `server/routers.ts` 现有 confirmed intent line 注入方式。
- `creationEditor.routing.test.tsx` 对 generated shots 流入 CreationEditor 的断言。

**测试场景：**
- 正向： fiction intent 传入 classify 时，scriptContext 包含虚构短片目标，不包含求职目标。
- 正向： fiction fallback 生成 3-5 个 shots，beat 覆盖开场、推进/起势、转折、收束中的合理弧线。
- 边界： 只有一张 story card 时也能生成 3-5 镜，而不是 1:1 只出一镜。
- 边界： job intent 分支仍保持求职竞争力语言和既有测试通过。
- 集成： 生成的 storyShots 仍按 storyId 写入，并能被 CreationEditor 读取。

**验收方式：**
- 确认故事卡后，故事版看板、镜头设计表和动态分镜能看到同一组虚构短片 shots。

---

### U6. 架构一瞥与回归护栏

**目标：** 在实施结束前做一次轻量架构审计，确认虚构逻辑没有散落到错误模块，也没有引入跨模块耦合。

**关联需求：** R8, R9；支持全部 AE

**依赖：** U1, U2, U3, U4, U5

**文件：**
- 修改： `docs/plans/2026-07-02-001-feat-fiction-world-intent-plan.md`，如果实施发现计划发生实质偏移
- 测试预期：无 -- 这是实施后的架构核对单元，验证由测试套件和文件范围审计完成。

**方案：**
- 按用户给的架构护栏做 30 秒到数分钟的一瞥：文件范围、跨模块 import、文件大小、prompt 所在层、状态唯一事实。
- 检查是否有虚构逻辑被写进图片、视频、剪辑或 CreationEditor 面板；如果有，拆回 story agent / prompt / shot synthesis 层。
- 检查 prompt 是否包含架构约束尾巴，避免 AI 声称已执行图片、视频或时间轴写入。
- 检查新增状态是否只通过 `StoryIntent` / spine 流动，而不是面板局部另存。

**参考模式：**
- 本计划的 High-Level Technical Design 三条线。
- 现有 worktree 隔离规则：功能线只在 `codex/feat-fiction-world-intent` 上完成。

**测试场景：**
- 测试预期：无 -- 本单元不新增功能测试，但要求前面所有单元的测试和 TypeScript 检查通过。

**验收方式：**
- 最终 diff 中，虚构入口相关代码主要集中在 story agent intent、chat prompt、card extraction、shot synthesis；下游面板只消费数据，不承载虚构业务规则。

---

## 全局影响

- **交互图：** 开场菜单、后台意图识别、聊天回复、卡片抽取、拆镜共用 `confirmedIntent`。虚构意图必须沿这条链路传递，不能在某个面板复制状态。
- **错误传播：** 意图识别失败继续保持非阻断 warn；聊天和拆镜失败沿现有 toast/error 路径走，不新增阻断弹窗。
- **状态生命周期风险：** 切换故事、重置对话、修改/删除故事卡时，fiction confirmation 状态必须同步清理，避免旧故事确认状态泄漏。
- **公共接口一致性：** `storyAgent.chat` 与 `storyAgent.classify` 已接收 confirmed intent；本计划只扩展语义，不引入新公开接口。
- **集成覆盖：** 需要至少覆盖「菜单选择 → 生成故事卡 → 确认 → 拆镜 → CreationEditor 读取」的关键断点。
- **不变约束：** storyId 归属验证、图片/视频素材统一事实、动态分镜剪辑状态都不改变。

---

## 风险与依赖

| 风险 | 缓解 |
|------|------------|
| 虚构逻辑散落到 UI 面板，后续难维护 | U6 架构一瞥；UI 只做入口/确认，业务语义放在 intent + prompt + director |
| 直接说入口误判真实经历为虚构 | U2 低风险兜底 + 软确认；不自动 confirmed |
| 故事卡太像普通情绪卡，不足以拆镜 | U3 明确卡片必须包含故事核心、角色、冲突、视觉风格 |
| 拆镜仍沿用求职说服力语言 | U5 服务端测试断言 fiction 上下文不含求职词；job 分支回归测试 |
| 新状态与旧 story persistence 不兼容 | U4 状态放入可 normalize 的 `StoryIntent`，并补持久化/恢复测试 |

---

## 文档与执行备注

- 实施时每次改 prompt 都要在 prompt 尾部加入架构约束：只生成当前层负责的产物，不声称完成下游素材写入。
- 每个实现单元结束做一次「架构一瞥」：文件范围、跨模块 import、文件大小、是否出现顺手优化。
- 若 AI 提议「顺手优化」其他意图或下游素材，必须拆到后续回合，不纳入本计划。

---

## 来源与参考

- **来源文档：** [docs/brainstorms/2026-07-02-fiction-world-intent-requirements.md](../brainstorms/2026-07-02-fiction-world-intent-requirements.md)
- 相关计划： [docs/plans/2026-06-16-002-feat-job-search-intent-trigger-plan.md](2026-06-16-002-feat-job-search-intent-trigger-plan.md)
- 相关代码： `client/src/features/storyAgent/views/StoryCapabilityMenu.tsx`
- 相关代码： `client/src/features/storyAgent/StoryAgentContext.tsx`
- 相关代码： `client/src/features/storyAgent/intentTypes.ts`
- 相关代码： `server/archive/storyIntent.ts`
- 相关代码： `server/archive/storyAgent.prompts.ts`
- 相关代码： `server/archive/shotSynthesis.ts`
- 相关代码： `server/routers.ts`
