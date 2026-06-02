# Codex 任务：接入 302 图像模型（GPT-image-2 + Midjourney）用于出图；视觉分析指向 302

> 这是一个**后端为主的补丁**。目标：在现有出图管线里**并存接入 302.ai 的两个出图模型**（GPT-image-2、Midjourney），作为**可选 provider**（fal 保留、可回退）；并把**图片分析**通道指向 302 的视觉模型，**保持分析输出结构不变**。做完岱岱（人）会审核并合并到 `main`。
>
> **背景**：302.ai 是 OpenAI 兼容的模型聚合网关，单 key 同时提供「OpenAI 兼容 LLM/视觉」「OpenAI images 出图」「Midjourney 中继」。本任务就是把它的出图 + 视觉接进来。

---

## 执行约定（先读）

- **你在终端跑，独立 worktree/分支干活。** 完成后**只本地提交，不要 `git push`、不要建远端分支、不要合并 main**——push / merge 由岱岱手动做。
- **全中文**：所有代码注释、UI 文案、文档都中文。
- **每阶段 `npm run check`（typecheck）+ 相关 `vitest` 必须绿**才算完成。
- **密钥岱岱填**：302 的 API key 是机密，**你不要硬编码、不要打印、不要写进任何提交**。只从 `ENV`（`server/_core/env.ts`）读，像现有 `falApiKey` 那样。`.env` 由岱岱手动填。
- **302 的确切 endpoint / 模型 ID / Midjourney 接口形状**：下面〈302 API 实参（已查证）〉已替你查好填进来了，✅ 标记的可直接用；**带 ⚠️ 的（尤其模型名 `gpt-image-1` vs `gpt-image-2`、MJ 鉴权 header）落地前用真实请求各打一发再核一眼**，且模型名一律做成 env 变量、别写死。
- 有疑问、或发现下面「已核实」与现实不符 → **停下说明**，不要自己拍板改架构。

---

## 目标（一句话）

让创作线出图除了 fal，还能选 **302 的 GPT-image / Midjourney**（默认走哪个由 env / 选择器定，没配 302 就还走 fal、不崩）；图片分析改用 **302 的视觉模型**，但**输出仍是原来的 `VisualCanvasAnalysis` 结构**。**复用现有接缝，不重造管线。**

## 已锁定决策（岱岱拍板，别推翻）

1. **出图 = fal + 302 并存可选**：保留 fal，把 302 的 GPT-image、Midjourney 加成**可选 provider**；默认 provider 由 env 定、可选 UI 选择器切换。
2. **图片分析 = 指向 302、结构不变**：分析通道指向 302 视觉模型，**`VisualCanvasAnalysis` 输出结构一字不变**（提示词池那条线依赖它）。
3. **inpaint / 分割暂留 fal**：`inpaintImage`（fal flux fill）+ `segmentation.ts`（fal SAM2）**本轮不动**。

## 本轮**不做**（明确排除）

- **不碰手机端出图**：`routers.ts` 的 `generateForMobile`（:1170）/ `mobileInpaint`（:1211）+ `server/_core/imageGeneration.ts`（Forge ImageService）是**手机线**，岱岱定的「手机端不碰」→ **一律不动**。
- **不改 `VisualCanvasAnalysis` 输出结构**（见〈已核实〉6）——这是和提示词池的唯一共享不变量。
- **不接** Midjourney `/describe` / GPT 视觉作为新分析来源（下一轮再说）；本轮分析只是**换模型**、不换输出契约。
- **不动** inpaint / 分割（留 fal）。
- 不换存储、不换熔断、不换 fetcher 注入模式——全部复用。

---

## 关键事实（已核实，省你时间，别再推翻）

1. **出图主接缝 = `server/services/imageGen.ts`（fal）。** 这是创作线真正用的出图函数：
   - `generateImage(prompt, options): Promise<ImageGenResult>`（:106）；`ImageGenResult = {status:'ok'|'error', imageUrl?, imageKey?, message?}`（:15）。
   - fal 端点：`GENERATE_URL = fal-ai/flux-pro/v1.1-ultra`（:39）、`INPAINT_URL = .../v1/fill`（:40）。
   - 已有：**熔断器**（:42–79，连续失败 3 次冷却 10 分钟）、**超时**（30s）、**落存储** `storagePut`（:166）、**可注入 fetcher** `options.fetcher`（:31–35，给测试用）、`buildHeaders()` 用 `ENV.falApiKey`（:83）。
   - **有测试**：`server/services/imageGen.test.ts`（照它的 fetcher 注入写法给 302 provider 写测试）。
   - **→ 302 的 provider 就加在这一层**，复用上面所有模式（熔断 / 超时 / 落存储 / fetcher 注入 / 统一 `ImageGenResult` 返回）。

2. **出图调用点只有两个，都只传 prompt**（所以加 `options.provider` 向后兼容、零改调用点）：
   - `server/services/artAgent.ts:194` → `generateImage(prompt)`（riff 出图）。
   - `server/services/creationAgent.ts:228` → `generateImage(generateCall.prompt)`（创作 Agent 出图）。

3. **另一条出图线 = `server/_core/imageGeneration.ts`（Forge ImageService）**，只被 `routers.ts` 的**手机端**端点用（`generateForMobile` / `mobileInpaint`）→ **本轮不碰**（见〈不做〉）。

4. **env 配置都在 `server/_core/env.ts`。** 现有：`falApiKey`（`FAL_KEY`，:45）、`forgeApiUrl`/`forgeApiKey`（`BUILT_IN_FORGE_API_URL/KEY`，OpenAI 兼容）、`llmModel`/`llmSupportsImage`/`llmSupportsResponseFormat`、`visionApiUrl`/`visionModel`（`VISION_API_URL`/`VISION_MODEL`）。**302 的新 env 加在这里**（建议 `IMAGE_302_*` / `VISION_302_*` 或统一 `API302_*`，名字你定，注释写清）。

5. **图片分析 = `server/archive/visionAgent.ts` 的 `analyzeVisionReference`（:292）**，双通道：
   - `invokeClaudeVision`（:192）：Claude messages 格式，鉴权 `"x-api-key": ENV.forgeApiKey`（:204），URL 走 `resolveClaudeUrl()`（认 `visionApiUrl||dropZoneApiUrl||forgeApiUrl`），model 认 `visionModel||dropZoneModel||llmModel`。
   - `invokeOpenAICompatibleVision`（:249）：走**全局** `invokeLLM(...)`，**⚠️ 会忽略 `visionApiUrl`/`visionModel`**，model 永远是 `llmModel`，要 `llmSupportsImage=true`。
   - `shouldUseClaudeChannel()`（:61）决定走哪条。
   - **⚠️ 坑（已核实）**：因为 OpenAI 兼容通道忽略 vision 专用配置，**「分析指向 302」不是纯改 env**。你要给分析通道补一个 **302 视觉专用 base/key/model** 并让它真正生效（要么增强 `invokeOpenAICompatibleVision` 接受 vision 专用 client，要么走 Claude 通道并补 vision 专用 key）。鉴权别再写死 `forgeApiKey`。

6. **🔒 分析输出契约 = `VisualCanvasAnalysis`，绝不能变。**
   - 前端镜像类型：`client/src/features/storyAgent/types.ts:100–113`（`objective`/`aesthetic`/`visualStyle[]`/`mood[]`/`colorPalette[]`/`composition`/`lighting`/`promptDraft`/`negativePrompt`/`confidence`）。
   - 服务端 `normalizeAnalysis`（`visionAgent.ts:126`）强约束结构。
   - **你只换模型 / 端点，不动 `buildSystemPrompt` 的输出字段约定、不动 `normalizeAnalysis` 的结构**。换模型后只要它仍吐可解析的同字段 JSON，结构就稳。
   - **原因**：提示词片段池（另一条线 / 终端 Claude）把这个结构 map 成片段，改了它那边就崩。

7. **302 是 OpenAI 兼容 + Midjourney 中继**（确切实参见下〈302 API 实参（已查证）〉）：
   - **GPT-image**：OpenAI images 风格的**单次 REST**（`POST https://api.302.ai/v1/images/generations`），返回图片（b64 优先 / 或 url）。映射成 `ImageGenResult` 即可，和 fal 形状接近、最快。
   - **Midjourney**：**异步任务**——`POST /mj/submit/imagine` 提交拿 taskId → 轮询 `GET /mj/task/{taskId}/fetch` 直到 `SUCCESS` 拿 `imageUrl`。**最费时（30~90s）**，要处理轮询间隔 / 总超时 / 失败，复用熔断器（但别套用 30s 超时，见下）。

---

## 302 API 实参（已查证，2026-06-02；✅ 可直接用，⚠️ 落地前在 302 控制台/文档再核一眼）

**统一约定**
- ✅ Base URL：`https://api.302.ai`
- ✅ 鉴权：`Authorization: Bearer <302_API_KEY>`（整个 302 网关统一 Bearer，**和现有 fal 的 `Authorization: Key xxx` 不同**——别套用 `imageGen.ts:buildHeaders()` 的 fal 写法，给 302 单独写 header）。
- ✅ 模型名 / endpoint 全部从 env 读，别写死。

**A. GPT-image（OpenAI images 格式，单次 REST）**
- ✅ 端点：`POST https://api.302.ai/v1/images/generations`
- ⚠️ 模型名：已确认存在 `gpt-image-1`（也有写法 `openai/gpt-image-1`）；岱岱说的 **"gpt-image-2" 可能是 302 上线的新版别名**——**实现时打一发 `GET https://api.302.ai/v1/models` 或看文档「Models（列出模型）」页，用列表里真实的 id**，做成 env 变量（如 `IMAGE_302_GPT_MODEL`）。
- 请求体（OpenAI 风格）：`{ "model": "gpt-image-1", "prompt": "...", "size": "1024x1024", "n": 1, "quality": "high" }`
  - `size`：`1024x1024` / `1536x1024` / `1024x1536` / `auto`
  - `quality`：`low` / `medium` / `high` / `auto`
  - ⚠️ `response_format`：OpenAI 原生 gpt-image-1 **忽略此参数、永远返回 b64**；302 中继可能也支持 `"url"`。**两种都兼容**：优先读 `data[0].b64_json`（base64 解码 → `storagePut`，照 `server/_core/imageGeneration.ts` 处理 b64 的写法），没有再读 `data[0].url`。
- 返回体：`{ "created": <ts>, "data": [ { "b64_json": "..." }  /* 或 */ { "url": "https://..." } ], "usage": {...} }`

**B. Midjourney（midjourney-proxy 中继格式，异步任务）**
- ✅ 提交绘画：`POST https://api.302.ai/mj/submit/imagine`
  - 请求体：`{ "prompt": "<提示词，可含 --ar 16:9 等>", "base64Array": ["data:image/png;base64,..."] }`（`base64Array` 仅图生图时传，文生图省略）
  - 返回：`{ "code": 1, "result": "<taskId>", "description": "..." }`（`code` 1=提交成功 / 22=已排队，都拿 `result` 当 taskId）
- ✅ 轮询取结果：`GET https://api.302.ai/mj/task/{taskId}/fetch`
  - 返回：`{ "id", "status": "SUBMITTED"|"IN_PROGRESS"|"SUCCESS"|"FAILURE", "progress": "100%", "imageUrl": "https://...", "failReason": "..." }`
  - 流程：提交拿 taskId → 每 3~5s 轮询 fetch → `status==="SUCCESS"` 取 `imageUrl` → **再 `storagePut` 落到自家存储**（别直接存 302 的临时 url）→ `FAILURE` 当 error 进熔断。
- ⚠️ MJ 鉴权 header：302 统一网关用 `Authorization: Bearer`；若中继层报鉴权错，备选是 midjourney-proxy 原生的 `mj-api-secret: <key>`——**先用 Bearer，不行再切**，在 302「Midjourney」文档页确认。
- ⚠️ **超时预算**：MJ 出图常 30~90s，**不能套用 `imageGen.ts` 现有的 `TIMEOUT_MS=30_000`**。给 MJ provider 单独总轮询预算（建议 120~180s）+ 单次 fetch 短超时；熔断器可复用，但「一次失败」要等总预算耗尽或拿到 `FAILURE` 才判定，**别把还在 `IN_PROGRESS` 误判成失败**。

> **来源**：302 官方文档站（`doc.302.ai` 的「图片生成（OpenAI格式）」「GPT-Image系列」「Midjourney / Imagine（绘画）」节点，base url 见英文文档站 `doc-en.302.ai`）+ OpenAI images 官方契约交叉核对。`doc.302.ai` 当前 **TLS 证书链不完整**（浏览器/抓取工具会报证书错，属站点配置问题、非接口问题），接口形状已交叉验证；**Codex 落地前务必用带 key 的真实请求各打一发确认**，尤其 ⚠️ 三处。

---

## 接口建议（实现可微调，保持语义）

```ts
// 出图 provider（services/imageGen.ts 内）
export type ImageProvider = 'fal' | 'gpt-image' | 'midjourney';

// 现有签名加一个可选 provider；不传则取 env 默认（IMAGE_PROVIDER_DEFAULT），再回退 'fal'
export async function generateImage(
  prompt: string,
  options: ImageGenOptions & { provider?: ImageProvider } = {},
): Promise<ImageGenResult> // 返回类型不变
```

- **路由层**：`generateImage` 里按 `provider` 分发到 `fal`（现有逻辑原样）/ `gpt-image` / `midjourney`。302 两个 provider 的实现可放新模块（如 `server/services/imageGen302.ts`），但**统一返回 `ImageGenResult`**、**复用** `storagePut` / 熔断 / 超时 / fetcher 注入。
- **降级**：`provider` 指向 302 但 **302 key 没配** → 返回 `error` 或回退 `fal`（你定一种，写清；**绝不崩、绝不打印 key**）。
- **默认 provider**：env 配（没配=`fal`），保证**不配 302 时行为零回归**。

---

## 阶段任务

### 阶段 1：env + provider 骨架（零行为变化）
- 在 `env.ts` 加 302 出图 + 视觉的 env（key / base / 模型名 / 默认 provider），带中文注释；缺省值保证「没配 302 → 全走 fal、视觉走原通道」。
- 在 `imageGen.ts` 给 `generateImage` 加 `options.provider` 分发骨架：`provider==='fal'`（含未配置）→ **现有逻辑一字不动**；其它 provider 先占位。
- `npm run check` + 跑 `imageGen.test.ts` 确认 fal 路径**零回归**。

### 阶段 2：GPT-image provider（出图）
- 去 302 文档核实 GPT-image 的确切 endpoint / 模型名 / 入参出参。
- 实现 `gpt-image` provider：调 302 → 拿图（url 或 b64）→ `storagePut` 落存储 → 映射 `ImageGenResult`。复用熔断 / 超时 / fetcher 注入。
- 写 vitest（注入 fetcher mock 302 响应：成功 / HTTP 错 / 空结果 / 超时）。

### 阶段 3：Midjourney provider（出图，异步）
- 去 302 文档核实 MJ 中继的提交 / 轮询 / 取图接口。
- 实现 `midjourney` provider：提交 → 轮询（合理间隔 + 总超时）→ 取图 → 落存储 → `ImageGenResult`。轮询失败 / 超时要进熔断、返回 `error`。
- 写 vitest（注入 fetcher mock：提交成功→轮询 pending→完成；以及 失败 / 超时）。

### 阶段 4：分析指向 302（结构不变）
- 按〈已核实〉5 的坑，给分析通道接 302 视觉专用 base/key/model 并**真正生效**（别再写死 `forgeApiKey`、别被 `invokeOpenAICompatibleVision` 忽略 vision 配置坑到）。
- **保持** `buildSystemPrompt` 输出字段约定 + `normalizeAnalysis` 结构 → 输出仍是 `VisualCanvasAnalysis`。
- 自检：喂一张图 → 分析仍返回完整 `VisualCanvasAnalysis`（风格/情绪/色彩/构图/光线/confidence 都在）；没配 302 视觉 → 回退原通道、不崩。

### 阶段 5：选 provider 的入口
- env 默认 provider（必做）。
- 创作 / 画布出图处加**简单 provider 选择器**（fal / GPT-image / Midjourney），把选择经 `options.provider` 传进 `generateImage`。UI 细节你定，**拿不准回岱岱确认，别硬猜**。
- **只动桌面创作侧，手机端不碰。**

### 阶段 6：守护 / 回归
- `provider=fal`（默认）行为**零回归**；`imageGen.test.ts` 绿。
- 提示词池依赖的 `VisualCanvasAnalysis` 结构**没变**。
- 手机端 / Forge 线（`generateForMobile` / `mobileInpaint` / `_core/imageGeneration.ts`）**没碰**。
- 无 `DATABASE_URL` 的 local-persist 降级仍正常；无 302 key 时优雅降级到 fal / 原视觉通道。

---

## 守则（硬约束）

- **不改分析输出契约**：`VisualCanvasAnalysis` / `normalizeAnalysis` 结构一字不变（提示词池依赖）。
- **不碰手机端 / Forge 出图线**（`generateForMobile` / `mobileInpaint` / `_core/imageGeneration.ts`）；inpaint / 分割留 fal。
- **不重造**：出图复用 `services/imageGen.ts` 的 `ImageGenResult` / `storagePut` / 熔断 / 超时 / fetcher 注入；分析复用 `analyzeVisionReference` 框架。
- **机密安全**：302 key 只从 `ENV` 读，**不硬编码 / 不打印 / 不进提交**；`.env` 岱岱填。
- **零回归 + 优雅降级**：默认（fal）路径行为不变；没配 302 不崩、自动走 fall back。
- **只动桌面端这侧**；手机端不碰；对话粘性不碰。

---

## 与「提示词片段池」那条线的协调（重要）

提示词池任务（终端另一个 Claude / 见 `docs/claude-unified-prompt-pool-prompt.md`）也碰图像管线，但**两条线的唯一共享不变量 = `VisualCanvasAnalysis` 输出结构**。分工：

- **302 这条线（你）**：主要动 `imageGen.ts`（加 provider）+ env + 视觉通道的「换模型」。
- **提示词池那条线**：动前端片段化 / `ShotTable` / `shotPromptComposer` 视觉层 / 提醒。
- **交界点 = `artAgent.ts`**：它既调 `generateImage`（出图）又调 `analyzeVisionReference`（分析）。你若要在这里透传 provider，**改动要小**，且**绝不动它产出的 `analysis` 结构**。两边都守住第 6 条，就不会撞。

---

## 验收清单（你先跑 + 自检，并在交付里逐条回）

1. `npm run check` 通过；`imageGen.test.ts` + 新增 302 provider 测试绿。
2. `provider=fal`（默认 / 未配 302）→ 出图行为与改动前**完全一致**（零回归）。
3. 配好 302 后，`provider=gpt-image` → 能出图、落存储、返回 `ImageGenResult`（对应阶段 2）。
4. `provider=midjourney` → 异步提交+轮询能出图；pending / 超时 / 失败有正确 `error`（阶段 3）。
5. 分析指向 302 → 喂图仍返回完整 `VisualCanvasAnalysis`（结构未变，阶段 4 / 守则）。
6. 创作侧能切 provider（env 默认 + 选择器），选择真的传进 `generateImage`（阶段 5）。
7. 没配 302 key → 不崩、优雅降级到 fal / 原视觉通道。
8. 手机端 / Forge 线、inpaint、分割**均未改动**；提示词池依赖的分析结构**未变**。

## 完成后给岱岱

1. 改动清单（每个文件改了什么、为什么）。
2. 自检结果（清单哪几条跑了、结果如何；哪些只能手测、你怎么验的；302 文档里确认到的确切 endpoint / 模型 ID / MJ 接口）。
3. `.env` 需要岱岱填哪些新变量（**只列变量名 + 说明，不要填值、不要示例 key**）。
4. 这次产出在哪个本地 commit（**不要 push**）。
5. 任何你觉得偏离决策、或建议留给下一轮的点（如 MJ describe 分析源、inpaint 接 302）。
