# Codex 任务：情绪流动 → 出图提示词 + 美术 Agent 视觉锚画布

> 这是一件大事，**分两阶段、各自一个可审 PR，阶段 A 先**。先读两份 spec，再按下面落地。做完我（另一个 agent）会逐条验收。

## 两份需求文档（真相源，逐条 R 要满足）
- `docs/brainstorms/2026-05-29-emotion-flow-to-shot-prompts-requirements.md`（情绪 → 流动 → 关系型提取成每镜 prompt；Shot Table 真·DB 映射）
- `docs/brainstorms/2026-05-29-art-agent-visual-canvas-requirements.md`（美术 Agent + Story Cards 自由视觉画布；画布 = 视觉锚喂养下游出图）

## 这件事的核心 = 一个「prompt 合成缝」
每一镜最终的出图 prompt = **视觉内容**（主体/动作/场景）+ **情绪电荷**（情绪 + 流动）+ **视觉锚**（画布的审美/参考）。
**先建好这个合成缝（一个把三者拼成一条 prompt 的单一函数/层），阶段 A 先把「情绪电荷」接上，阶段 B 再把「视觉锚」接上。** 两份需求都在此交汇，别让它们各搞一套。

## 现状（我已核实，省你时间）
- 情绪模型已有：`StoryCard` 有 `emotion`/`emotionOptions`/`emotionBlend`；`ShotDraft` 有 `beat`（开场/起势/转折/收束）、`mood`、`emotion`；`server/archive/storyAgent.ts` 的 `synthesizeShotList` 已给每镜 `beat`。**缺的是「与上一镜的情绪转变（流动 delta）」和把情绪系统地写进 `promptDraft`。**
- 出图：`server/services/imageGen.ts` 有 `generateImage`（文生图）、`inpaintImage`（带 `image_url`）。**"图经提示词工程重新出图"走「图→分析→prompt→`generateImage`」即可，复用文生图，不必上真·img2img。**
- Shot Table：后端 `shots` 表（`drizzle/schema.ts`，已有 `mood`/`promptDraft` 列）+ `createShots`/`getProjectShots`/`updateShot`/`batchUpdateShots`（`server/db.ts`）都在。**但 `client/src/pages/CreationPage.tsx` 现在是从 `storyShots` 前端合成假 id（`id: -1*(index+1)`），不是读真 `shots` 表。**
- 视觉分析：`server/archive/visionAgent.ts` 已有，**在其上加「美术/情绪解读层」，别重造**。
- Story Cards：`client/src/features/storyAgent/views/StoryCardsBoard.tsx` 是文字卡的可重排列表。

---

## 阶段 A · 地基：情绪 → 提示词 + Shot Table 真映射（先做，独立 PR）

**A1 关系型情绪提取**
- 在 `synthesizeShotList`（或一个紧随其后的步骤）里，给每镜算出「情绪电荷」=「自身 `emotion` + 它的 `beat` 在弧线上的位置 + **与上一镜的情绪转变 delta**」。转折镜要表达「转变」本身，不是静态情绪。
- **守则（硬性）**：流动从用户**真实**弧线读，**不为戏剧性放大、不制造转折、不翻负**——沿用 `storyAgent.ts` 既有的「如实镜像、正负面平衡」原则。

**A2 prompt 合成缝**
- 建一个单一的「prompt 组装」函数/层：输入 = 视觉字段 + 情绪电荷（+ 以后的视觉锚），输出 = 写进 `promptDraft` 的最终 prompt。阶段 A 先接「视觉 + 情绪电荷」，给视觉锚留好入参位。

**A3 Shot Table 真·DB 映射**
- `CreationPage.tsx` 改为从 `getProjectShots`（真 `shots` 表）读，不再从 `storyShots` 合成假 id；编辑落 `updateShot`/`createShots`。
- 若现有 `shots` 表字段不足以承载「情绪电荷 / 转变」，按需小幅加列（`drizzle/schema.ts` + `server/db.ts` 双模式都要更新，按仓库既有模式）。

## 阶段 B · 美术 Agent + 自由视觉画布（A 落地后，独立 PR）

**B1 美术 Agent 双重分析**：扩展 `visionAgent.ts`——对上传图给「理性分析（客观内容）」+「美术/情绪分析（接住情绪、读审美）」，并产出一段可用于出图的 prompt。
**B2 图经提示词出新图**：用 B1 的 prompt 走 `generateImage` 出新图（复用文生图）。
**B3 对话精炼 / 项目内学习**：Agent 问"你想要什么"→ 用户改 → 在**本项目内**累积审美偏好，bias 后续 riff（跨项目持久化不做）。
**B4 Story Cards 图文合一卡**：把图并进 `StoryCardsBoard` 的卡里——每张卡 = 记忆文字 + 它的图（上传图 / AI riff）；卡片可重排（顺序决定剧本），**不另开独立画布栏**。卡与卡之间加**「会说话的轻连接」**：仅在情绪真的转变处显示一个小标（如「暖 → 怅然」，来自 A1 的流动 delta），**不画装饰性「下一张」箭头**；平淡处不显、不硬造。
**B5 视觉锚接入合成缝**：把卡里图的审美/参考作为「视觉锚」喂进 A2 那个 prompt 合成缝，让下游每镜出图带上卡里定下的风格。

---

## 硬约束
- **所有新文档用中文。**
- 只做 **B2C 桌面端**的 Story/Creation 流程；**手机端不在此范围**（单独重设中）。
- **复用**现有 `visionAgent` / `imageGen`(fal) / 情绪管线，不重造。
- 不破坏现有 Story Agent（小酌）行为、现有 Story→剧本→镜头→出图 流程、选区编辑、不覆写契约。
- 守则：**流动 ≠ 戏剧化**，如实镜像，不翻负。

## 验收（我会逐条验）
- 阶段 A：`npm run check` 通过；一段"暖→失落"的故事，转折镜 `promptDraft` 带「转变」而非静态悲伤；平淡故事不被强行造转折；Creation 的 Shot Table 读真 `shots` 表，前端改一镜能落库、刷新一致、Analysis/Creation 看同一份。
- 阶段 B：上传图能出「理性 + 情绪」两段分析并 riff 出新图；画布可自由拖/改；画布定的风格反映在下游出图；项目内第二次 riff 带上了之前偏好。

## 完成后给我
1. 改动清单（每个文件改了什么）；2. 自检结果（哪些测了、哪些没法测）；3. 阶段 A / B 分别是哪个 commit / PR。
