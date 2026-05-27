---
date: 2026-05-21
topic: creation-engine-v1
---

# Creation Engine v1：把「剧本→画面」拆出来独立成一页

## Summary

把 Drinking Time「双引擎」架构里一直缺的另一半建出来：新增独立的 Creation Engine 页面，承担"剧本到画面"的视觉准备工作，配自己的 Agent 和 Shot Production Table，配套 Script↔Shot 1:1 联动、对话内自动出图、点选物体级改图，一次性上完整版。

---

## Problem Frame

Drinking Time 从一开始的设计就是双引擎：Analysis（把灵感、卡片、剧本梳成结构化数据）+ Creation（基于这些数据生成图像、镜头、视频）。但目前只有 Analysis 一半成立，Creation 一直没有自己的家——Shot Production Table 这个本属于 Creation 的产物，被塞在 Analysis 的右侧栏勉强容身，挤占了 Story（故事）这一面板的呼吸空间，也让"我在分析"和"我在出片"两种心境无法分离。

更要紧的是：用户走完聊故事 → 卡片 → 剧本 → Shot Table 这条线之后，看到的是一堆**文字**描述的镜头——主体、动作、对白、景别、机位……都说了，但没有一张图。从"我有了剧本"到"我可以开始拍"中间还差一大步：看见这些镜头长什么样、能不能调整、能不能定稿。今天这一步整个缺失。

同时，PRODUCT_BRIEF 早已把这个场所命名为 Creation Engine 并定下要做的事，但工程从未启动。现在把它启动。

---

## Actors

- A1. **创作者（用户）**：跑完 Analysis（卡片 + 剧本 + 初版 Shot Table）后，进入 Creation Engine，把每一镜的画面定下来。会和 Creation Agent 来回聊画面、点改图、看效果。
- A2. **Story Agent（小酌）**：留在 Analysis Project 不动。继续做聊故事、采卡片、撑剧本的事；**不**参与图像生成。
- A3. **Creation Agent**：新角色，住在 Creation Engine。读得到用户的卡片、最新剧本、当前 Shot Table，看不见小酌的逐句对话。聊画面、自动出图、按用户的点选改图。
- A4. **Shot Production Table**：从 Analysis 的右栏挪出来，搬到 Creation Engine 里，成为这个页面的两件套之一。

---

## Key Flows

- F1. **从 Analysis 进入 Creation 第一次出图**
  - **Trigger:** 用户在 Analysis 已经聊出卡片、生成了剧本（Script 有 S0X 场景）、跳转到 Creation Engine。
  - **Actors:** A1, A3, A4
  - **Steps:**
    1. Shot Table 自动从 Analysis 的卡片/剧本数据初始化，SH0X 与 Script 的 S0X 1:1 对齐
    2. Creation Agent 主动开场，邀请用户从某一镜聊起
    3. 用户聊到某一镜（点击 Shot Table 那一行，或在对话里直接说"先看 SH02"），Creation Agent 锁定"当前焦点镜头"为 SH02
    4. 来回聊 SH02 的画面（光、景别、氛围、人物位置）到 Agent 觉得够了
    5. Agent 自动出第一张图，图直接出现在对话框里，并同时挂上 SH02 的标签
    6. Shot Table SH02 那一行、Script 的 S02 那一段，同步显示这张主图缩略
  - **Outcome:** SH02 有了第一张可视化主图；用户、Script、Shot Table 三处都看得见。
  - **Covered by:** R3, R5, R6, R8, R9, R10, R11, R12

- F2. **点选物体改图**
  - **Trigger:** 一张图已经生成，用户觉得画面里某个具体物体不对。
  - **Actors:** A1, A3
  - **Steps:**
    1. 用户点击图里那个物体（一把椅子、一扇窗、一个人）
    2. AI 识别出该物体的轮廓边界，在图上高亮显示这一片
    3. 用户在对话里描述要改成什么（"这把椅子换成更旧的木椅"）
    4. Agent 只重生这一块，图的其它部分保留
    5. 新版本图出现在对话里；该镜的主图更新为这个新版本；旧版本进入这一镜的图像历史
  - **Outcome:** 这一镜的画面在物体粒度上精准迭代了一次，前一版本不丢。
  - **Covered by:** R13, R14, R15

- F3. **跨页面切换不丢状态**
  - **Trigger:** 用户在 Creation 聊到一半，想回 Analysis 看眼某张卡片。
  - **Actors:** A1, A2, A3
  - **Steps:**
    1. 用户切回 Analysis Project（保留所有面板布局和小酌对话历史）
    2. 在 Analysis 操作一阵
    3. 切回 Creation Engine，Creation Agent 的对话历史、当前焦点镜头、Shot Table 状态、已生成的图都完好
  - **Outcome:** 两边对话各自独立持续；用户来回切不会被打断。
  - **Covered by:** R16, R17

---

## Requirements

**页面拆分与结构**
- R1. Analysis Project 的页面布局保持现状：左侧 故事列表、中部 STORY CARDS、右部 SCRIPT 三面板。Shot Production Table 从此页面移除。
- R2. 新建 Creation Engine 页面，结构 = Creation Agent 对话框 + Shot Production Table 两件套。
- R3. 同一个项目数据在 Analysis 和 Creation 两个页面之间共享（卡片、剧本、Shot Table、图像）。

**双 Agent**
- R4. Creation Agent 是独立的 Agent，与 Story Agent（小酌）拥有彼此独立的对话历史。
- R5. Creation Agent 的上下文中可读取：用户的卡片、当前最新剧本、Shot Table 当前状态、Creation Engine 自己的历史对话；不读取小酌的逐句聊天历史。
- R6. Story Agent 不参与图像生成；图像能力是 Creation Engine 独占。

**Script ↔ Shot Table 联动**
- R7. v1 版本中，Script 里每一个 S0X 场景与 Shot Production Table 里的 SH0X 镜头是严格 1:1 关系（S01↔SH01、S02↔SH02、…）。
- R8. 用户从 Script 某一段点过去，能跳到 Shot Table 对应的那一行（视觉聚焦/滚动到位即可）。反向亦然。

**图像系统：生成、归属、显示**
- R9. Creation Agent 在对话中达到一定语义条件后自动生成图像，图像直接显示在对话框里。
- R10. 每张生成的图都绑定到一个具体的镜头编号（SH0X）。绑定规则：默认绑当前焦点镜头。
- R11. "当前焦点镜头"由 Creation Agent 从对话推断；用户点击 Shot Table 某一行或在对话里显式提到 SH0X 也会更新焦点。
- R12. 同一镜头可以有多张图（迭代版本）。最新一张作为该镜的"主图"，显示在 Script 对应场景和 Shot Table 对应行的缩略位上。
- R13. 用户可以事后手动重绑：把图从某一镜拖到另一镜，或在某张图上显式指定它属于哪一镜。

**点选物体改图**
- R14. 用户在图上点击任意一个可视物体后，AI 自动识别该物体的边界并高亮显示。
- R15. 高亮边界确认后，用户在对话里描述改动意图，Agent 只重生这一块区域，图的其它部分保留。
- R16. 改图后生成新的图版本；新版本成为该镜的主图，旧版本进入该镜的图像历史，可以回看。

**跨页面状态**
- R17. 用户在 Analysis 与 Creation 之间来回切换时，两边各自的对话历史、面板状态、Shot Table 状态、图像状态都完整保留。
- R18. 进入 Creation Engine 时，如果 Analysis 已存在卡片和剧本，Shot Table 自动从这些数据初始化（与现行 Shot Table 生成逻辑一致）。

---

## Acceptance Examples

- AE1. **Covers R7, R8.** Given Script 显示 S01/S02/S03 三场景且 Shot Table 有 SH01/SH02/SH03 三行，when 用户在 Script 点击 S02 那一段，Shot Table 自动滚动并视觉聚焦到 SH02 那一行。反向同理。

- AE2. **Covers R9, R10, R12.** Given 当前焦点镜头是 SH02 且 Creation Agent 已与用户聊到 SH02 的画面细节，when Agent 判断条件成熟自动生成一张图，then 该图出现在对话框里且自动绑定到 SH02；Shot Table SH02 那一行的缩略位和 Script S02 那一段都立刻显示这张图的缩略。

- AE3. **Covers R11.** Given Creation Agent 当前焦点是 SH01，when 用户在对话里说"现在看看 SH03 的开场"，then 焦点镜头切换到 SH03，下一张生成的图自动绑给 SH03。

- AE4. **Covers R14, R15, R16.** Given SH02 已有一张主图且画面里有一把椅子，when 用户点击椅子且 AI 识别出椅子边界高亮，且用户描述"换成更旧的木椅"，then Agent 只重生椅子那一块得到新版本，新版本成为 SH02 主图，旧版本进入 SH02 图像历史，Script 和 Shot Table 的缩略同步更新。

- AE5. **Covers R17.** Given 用户在 Creation Engine 已与 Creation Agent 聊了 5 轮且为 SH01 生成过一张图，when 用户切回 Analysis 改了一张卡片再切回 Creation，then Creation Agent 的 5 轮对话、SH01 的图、当前焦点镜头都完好如初。

- AE6. **Covers R4, R5, R6.** Given 用户在 Analysis 与小酌聊到中段细节"想念那个椅子的木头味"，when 用户切到 Creation Engine 与 Creation Agent 聊画面，then Creation Agent 看得到该卡片的最终内容（包括 sourceQuote、emotion 等），但看不到小酌的逐句对话内容，且不会代替小酌出新卡片。

---

## Success Criteria

- 用户走完 Analysis 之后进入 Creation Engine，能在 5 分钟内为某一镜出第一张图，并对那张图至少做一次点选物体级改图。
- 一段聊出来的故事，能从"一组文字镜头"演进到"一组带画面的镜头"，让用户具备"我可以开始拍了"的实感。
- Analysis Project 页面恢复成 3 面板布局（故事列表 / Cards / Script），不再有 Shot Table 抢空间。
- Creation Engine 是独立的视觉准备室，不污染 Analysis 的对话节奏；用户来回切，两边互不打扰。
- 给到 planning 的需求是闭合的：planning 不需要再回头问"图属于谁、几比几、能不能改、出现在哪儿"。

---

## Scope Boundaries

- **场景:镜头的 1:N 拆分**：v1 锁定 1:1，未来再升级
- **视频生成**：v1 只做静态图
- **导出/打包给摄制组**（PDF、CSV、压缩包等交付物）
- **给 Story Agent 也加图像能力**
- **多人协作、评论、实时同步**
- **图像版权、署名、商业使用合规审查**
- **图像生成 API 的具体技术选型**（DALL-E / Stable Diffusion / Flux 等）—— 留给 planning
- **Segmentation 模型的具体技术选型**（SAM / Replicate / fal.ai 等）—— 留给 planning
- **Analysis ↔ Creation 页面之间的导航形式**（顶栏 tab / 路由 / 双 stage 切换）—— UX 细节，留给 planning
- **图的存储格式、CDN、缓存策略** —— 工程细节，留给 planning
- **Creation Agent 的 system prompt 具体措辞和对话哲学**（参考小酌但独立写一套）—— 留给 planning

---

## Key Decisions

- **双 Agent，不共用对话历史。** Story Agent 听故事、Creation Agent 出画面。两人分工独立，但读同一套项目数据。理由：避免 Creation Agent 受小酌"陪伴者"语气污染，画面阶段需要的是分镜师/美指的判断节奏；同时不让小酌为了将来出图而记录无关的视觉细节。
- **Script ↔ Shot Table 1:1，YAGNI 锁定。** v1 不做 1:N，等到真有镜头分层需求再扩展。理由：当前用户的实际剧本规模就是每场一镜，1:1 已经覆盖；提前做层级会让 UI 与数据模型成本翻倍。
- **图绑当前焦点镜头，由 Agent 推断 + 用户可重绑。** 不要求用户每次手动选目标镜头，也不让图永远"自由漂浮"。理由：和"聊着聊着图自然蹦出来"的用户预期对齐；用户事后能拖动修正，提供逃生口。
- **点选物体改图，AI 自动识别边界。** 在矩形框、自由曲线、点选 + 自动识别、纯文字描述四种交互里选最高交互价值的一种。理由：用户明确想要"勾选具体的像素"且对体验有期望（MJ 级别）；矩形框/自由曲线交互门槛更高但价值更低；纯文字无法做局部精修。代价是要接 segmentation 模型，是 planning 时的关键依赖。
- **一次性上完整版（v1 = 拆 + 联动 + 出图 + 点选改图）。** 不分阶段。理由：用户已明确表达全栈意图；切碎反而需要承担两次"中间状态"的 UX 解释成本。

---

## Dependencies / Assumptions

- 假设 Shot Table 的现行生成逻辑（从卡片合成 ShotListPayload）足以为 Creation Engine 初始化数据，无需新一轮 Agent 调用。
- 假设当前的图像生成 API 与 segmentation 服务在国内/本地开发环境都可访问（具体选型 planning 时验证）。
- 假设 Creation Agent 看得到 Shot Table 当前状态意味着每次发请求时把 Shot Table 序列化进 prompt（与 Story Agent 当前传 shotDraft 同套机制可复用）。
- 上游依赖：`docs/PRODUCT_BRIEF.md` 已定义"双引擎"架构，本需求是 Creation 引擎的首次落地。
- 假设：图像版本、绑定关系、segmentation mask 都需要新的持久化数据（drizzle schema 需要扩展，但具体表结构留给 planning）。

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9, R14][Technical] 图像生成 API 与 segmentation 模型的具体选型与价格/延迟权衡。
- [Affects R10, R11][Technical] "当前焦点镜头"在前端如何持久化和传递给 Creation Agent（每次请求都重计算？还是状态机？）。
- [Affects R1, R2, R17][Technical] Analysis 与 Creation 两个页面之间的导航形式选择（顶栏 Tab、独立路由、左侧导航等）。
- [Affects R12, R16][Technical] 图像版本与历史的数据模型设计（每一镜的 image_versions 表？还是 events log？）。
- [Affects R4, R5][Technical] Creation Agent 的 system prompt 起草，包括与小酌区分的对话哲学、出图时机的判断信号、对 Shot Table 上下文的格式化。
- [Affects R13][User decision] 用户重绑图到另一镜时，是把原绑关系换掉，还是图可同时属于多镜？（默认假设换掉，但 planning 时再确认。）
- [Affects R15][Needs research] 改图时是否需要保留 segmentation mask 信息以支持后续多轮局部迭代（如果是 inpaint API 通常每次重传 mask 即可）。
- [Affects R18][Technical] 进入 Creation Engine 时如果 Analysis 还没生成剧本/Shot Table，给用户什么引导（空态文案与跳转）。
