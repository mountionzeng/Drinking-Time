# Agent 架构地图

> 给项目所有者本人的"现有 agent 怎么工作、怎么联动"的地图。
> 随时会变；变化的逻辑见末尾"怎么让它别过期"。
> 生成日期：2026-06-13（故事为唯一单位 + buildShotList 落地后）

---

## 一句话总览

用户在 `/creation` 跟**小酌**聊天，小酌（对话编排者）按需调用三类专门 agent——**剧本**（写台词）、**美术**（出图）、**意图/情绪信号**（认诉求）——把素材变成**当前故事**名下的**镜头表 + 图**。镜头按 `storyId` 归属（故事是唯一单位）。

---

## 一、活跃 agent（都在 `server/services/`）

| 你的叫法 | 代码 | 形状 | 实际干什么 |
|---|---|---|---|
| **小酌**（主对话） | `creationAgent.ts` | 对话型 | `/creation` 悬浮聊天框的后端。聊天 + 推断焦点镜头 + 判断何时出图 + **何时铺整张镜头表（buildShotList）**。是调度中枢。 |
| **创作目标** | `creationGoal.ts` + `shared/creationGoal.ts` | 注入层 | 把"我在做：求职/社媒/记录"翻译成注入提示词的指引（求职=HR 视角）。注入到小酌的 system prompt 和镜头合成。 |
| **剧本** | `scriptAgent.ts` | 库支撑型 | 把"共鸣信号 + 文学库"接进剧本生成，让台词呼应用户意图/情绪与文学声音。重型镜头表合成委托 `shotSynthesis`。 |
| **美术** | `artAgent.ts` + `renderGate.ts` | 流水线型 | 参考图 → 视觉分析(`visionAgent`) → 拼 riff prompt → 经出图网关出图。每次出图过"美术判断"。 |
| **意图/情绪信号** | `resonanceSignal.ts` | 信号层 | 把"用户意图 + 长期情绪画像"收成一份结构化信号，供剧本/文学库/出图共用。 |
| **编辑上下文 / 语义标注** | `editContext.ts`、`semanticAnnotation.ts` | 服务 | 快照存储、diff、从编辑里推断用户偏好。 |
| **分割 / 局部重绘** | `segmentation.ts`（fal.ai SAM2）+ inpaint 路由 | 服务 | 点选分割 + 蒙版重绘（重绘美术风格跟随当前故事）。 |

### 共享底座（agent 复用的地基）

- `agentRuntime.ts` — `runJsonAgent()`：对话 agent 骨架（拼消息→invokeAgent→宽松 JSON 解析+兜底）。
- `renderGate.ts` — `renderViaGate()`：**所有出图/重绘的唯一必经点**（美术判断插入处）。
- `libraryLoader.ts` / `libraryFields.ts` — YAML 知识库通用加载；`literatureLibrary.ts`(文学库)、`styleLibrary.ts`(流派库) 基于它。
- `_core/agentChannel.ts`(`invokeAgent`) / `_core/llm.ts` / `_core/llmJson.ts` — LLM 调用 + 宽松 JSON 解析（更底层）。
- `imageGen.ts` / `artDirection.ts` / `shotPromptComposer.ts` — 出图与提示词组装。

---

## 二、数据流（用户说一句话之后发生什么）

```
用户在 /creation 输入
   │
   ▼
creationAgent.replyFromCreationAgent（小酌）   ← 注入 creationGoal 的目标指引
   │   读 当前故事(storyId，已验归属) 的卡片/剧本/镜头
   ├─ 回复文字
   ├─ toolCalls：
   │    generateImage  → renderViaGate → imageGen        （出图，按 projectId+shotNo 存）
   │    updateShotPrompt → 改某镜提示词
   │    buildShotList(storyDigest) → synthesizeShotList（注入目标）
   │                               → replaceDirectorShotsForStory(storyId)  （整张镜头表写当前故事）
   ▼
前端刷新 Shot Table（按 storyId 取）
```

**当前故事**这条线（故事为唯一单位）：Story 页选定故事 → `StoryAgentContext` 经 `onActiveStoryChange` 向上 emit 到 `useProjectData`（唯一真相源）→ Creation 页的 shot.list / 小酌聊天 / 镜头写入都按这个 `storyId`。详见 `docs/solutions/2026-06-13-故事为唯一单位-镜头按storyId.md`。

---

## 三、`archive/` 的真相（重要——名字骗人）

`server/archive/` 不是"已死代码"。一大块还**活着**，通过三条路被够到：

**A. 经 `storyAgent.ts` 这个 re-export 枢纽，被活的 routers/scriptAgent 用（必须保留）：**
- `shotSynthesis.ts`（`synthesizeShotList`）—— 剧本合成 + buildShotList 都在用
- `summary.ts`（`summarizeHistory`）—— summarize 端点用
- `selectionEdit.ts`（`handleSelectionEdit`）—— 划词编辑用
- `storyAgent.types/parsing/prompts.ts` —— 类型与解析助手

**B. 被活的 `artAgent` 用（必须保留）：**
- `visionAgent.ts`（`analyzeVisionReference`）—— 美术的视觉分析

**C. 只被 `/api/archive/*` 这 8 个遗留路由用（路由没有任何客户端在调 = 死路由，可清）：**
- `storyReply.ts`、`dropZoneAgent.ts`、`analysisShell.ts`
- `storyIntent.ts`（意图分类器——**含 linkedin_job_search 规则，计划复活做"自动识别意图"，先别删**）

> 所以"死代码清查"的安全做法是：删那 8 个无人调用的 `/api/archive/*` 路由 + 它们独占的 `storyReply / dropZoneAgent / analysisShell`；`visionAgent`、`shotSynthesis`、`summary`、`selectionEdit`、`storyAgent.*` 是载重代码不能删；`storyIntent` 留作复活。
>
> ⚠️ 安全：`/api/archive/analysis-shell` 硬编码 userId=1、`dropZoneAgent` 用无 userId 过滤的 `getProjectShots`——删掉这些死路由顺带消除这个预存越权隐患。

**客户端 `client/src/archive/`**（AIChatBox/Beverage*/Dashboard* 等）已被 tsconfig 排除编译，是另一摊旧 UI，单独评估。

---

## 四、怎么让这张图别过期（变化的逻辑）

这张图是快照，代码随时变。别维护一份会过期的手抄本——**用命令现查**：

- 活/死边界（哪些 archive 还被活代码引用）：
  ```
  grep -rl "archive/<模块名>" server client --include="*.ts" --include="*.tsx" | grep -v archive/
  ```
- 谁调某个 agent 函数：`grep -rn "<函数名>" server client | grep -v .test.`
- 新增 agent 的填空式步骤：见 `docs/how-to-add-an-agent.md`

新增/重构 agent 后，回来更新本文件的"一、活跃 agent"表与"二、数据流"——只改变化的那几行，别重写。
