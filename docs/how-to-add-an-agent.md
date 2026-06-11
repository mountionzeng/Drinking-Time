# 如何新增一个 Agent

> 2026-06-10「Agent 层打地基」之后，新增 Agent 应当是**填空**，而不是复制粘贴。
> 这份文档给两种 Agent 形状的步骤清单，以及它们能复用的共享底座。

---

## 先认两种形状

| 形状 | 长什么样 | 例子 | 复用什么 |
|------|---------|------|---------|
| **对话型** | 用户聊天进 → LLM 回复 + 可能附带结构化动作(tool calls) | 小酌(creationAgent)、故事/剧本、工坊(dropZone) | 后端 `agentRuntime` 骨架 + 前端 `_agentKit` 脚手架 |
| **库支撑判断型** | 给输入 → 查一个「人类知识库」做判断 → 产出 | 美术(styleLibrary)、剧本接文学库(literatureLibrary) | `libraryLoader` 底座 + 出图网关 / 共鸣信号 |

很多 Agent 是两者的组合（对话进来，内部又查库判断）。

---

## 共享底座一览（先知道有什么可复用）

**后端**
- `server/services/agentRuntime.ts` —— `runJsonAgent()`：对话 Agent 骨架（拼消息 → invokeAgent → 宽松 JSON 解析 + 兜底）。
- `server/services/libraryLoader.ts` —— `createLibraryLoader()`：YAML 知识库的通用加载（校验 / 去重 / 缓存 / getActive）。
- `server/services/libraryFields.ts` —— 库条目 schema 的共享 zod 字段助手。
- `server/services/renderGate.ts` —— `renderViaGate()`：所有出图 / 重绘的唯一必经点（美术判断插入处）。
- `server/services/resonanceSignal.ts` —— `ResonanceSignal`：意图(dropZone) + 情绪画像(emotionAnalysis) 的共享信号。
- `server/_core/agentChannel.ts` / `llm.ts` / `llmJson.ts` —— LLM 调用 + 宽松 JSON 解析（更底层）。

**前端**
- `client/src/features/_agentKit/projectScopedStore.ts` —— 按 `projectId` 分区的 localStorage 持久化（load / save）。

---

## A. 新增一个「对话型」Agent

### 后端
1. 新建 `server/services/<name>Agent.ts`。
2. 写该 Agent 专属的两件事：
   - `buildSystemPrompt(...)`：系统提示。
   - 返回结构的解析 + tool call 处理。
3. 中间那套骨架**别自己写**，调 `runJsonAgent`：
   ```ts
   const { parsed, modelLabel } = await runJsonAgent<MyParsed>({
     systemPrompt: buildSystemPrompt(...),
     history,
     message: input.message,
     maxTokens: 800,
     fallback: text => ({ /* 解析失败时的安全默认 */ }),
   });
   ```
4. 「未配置 API」兜底留在自己的 Agent 里（各 Agent 返回形不同）。
5. 在 `server/routers.ts` 加一条 tRPC 路由调它。
6. 测试：mock `../_core/agentChannel` 的 `invokeAgent`，断言专属解析 / tool 处理（参考 `agentRuntime.test.ts`、`routers.storyAgent.test.ts`）。

### 前端
1. 新建 `client/src/features/<name>Agent/<Name>AgentContext.tsx`。
2. 持久化**别自己写** localStorage，调共享底座：
   ```ts
   const STORAGE_PREFIX = 'dt:<name>Agent';
   const init = loadProjectState(STORAGE_PREFIX, projectId, parse, emptyState);
   // 持久化 effect 里：
   saveProjectState(STORAGE_PREFIX, projectId, { messages, ... });
   ```
   （参考 `CreationAgentContext.tsx` 的采纳写法。）
3. 聊天 UI：暂无通用 `<AgentChat>` 组件（留作后续，需视觉 QA）——先参考 `CreationAgentChat.tsx`。

---

## B. 新增一个「库支撑判断型」Agent（含新建一个知识库）

以「新建一个 X 库 + 一个用它判断的 Agent」为例（美术库 / 文学库就是这么来的）。

### 建库
1. 照 `docs/style-library/` 或 `docs/literature-library/` 的形状，新建 `docs/<x>-library/`：
   - `_TEMPLATE.yaml`（条目模板）、`MANUAL.md`（守则）、`entries/*.yaml`（条目）。
2. 新建 `server/services/<x>Library.ts`：
   ```ts
   const XEntrySchema = z.object({ id: ..., status: statusField, /* DNA 字段用 libraryFields 的助手 */ });
   const loader = createLibraryLoader<XEntry>({ schema: XEntrySchema, resolveDir, label: "<x>Library" });
   export const getActiveX = (dir?) => loader.getActive(dir);
   export function xToFragments(entry): Fragment[] { /* 条目 → 可注入片段 */ }
   ```
   加载逻辑**别自己写**——`createLibraryLoader` 已经管好解析 / 校验 / 跳过坏条目 / 缓存。
3. 测试：参考 `literatureLibrary.test.ts`（建库种子 + tmp 目录两种）。

### 让 Agent 用库判断
- **出图侧**：判断逻辑放进 `renderGate.ts` 的 `artJudge`（目前是 identity 桩）——用库 + 情绪 + 意图 + 参考图改写 prompt 再交给生成器。所有出图都已经过这个网关，不用改调用方。
- **剧本侧**：参考 `scriptAgent.ts` 的 `gatherResonantVoices` / `buildScriptResonanceContext`——按 `ResonanceSignal` 排序取条目、组装可注入上下文。

---

## 跨 Agent 的共享信号（意图 / 情绪 / 文学）

- 用户的**意图**（dropZoneAgent 识别）+ **长期情绪画像**（emotionAnalysis）汇成一份 `ResonanceSignal`（`server/services/resonanceSignal.ts`）。
- 谁消费它：
  - 文学库 `rankVoicesBySignal(signal)` —— 排出「共鸣的声音」。
  - 剧本 `buildScriptResonanceContextForUser(userId, cardEmotions)` —— 注入剧本合成。
  - 出图网关 `RenderContext.intent / emotion` —— 美术侧对称（判断待填）。
- 新 Agent 想吃这份信号，读 `ResonanceSignal` 即可，不必自己再做一遍意图 / 情绪识别。

---

## 收尾清单

- [ ] 后端骨架用了 `runJsonAgent`（对话型）/ `createLibraryLoader`（库型），没自己抄样板。
- [ ] 出图一律走 `renderViaGate`，没有新增直连 `generateImage` 的出口。
- [ ] 前端持久化用了 `projectScopedStore`，没自己写 localStorage 分区。
- [ ] 每个新文件有中文头注释（作用）+ 关键函数注释（作用 + 接口）。
- [ ] 有测试；`npx tsc --noEmit` 干净；`npm test` 全绿。
- [ ] 行为改动（尤其碰在用的 Agent）是有意的、且默认路径行为不变。
