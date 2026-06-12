# Drinking Time 架构地图

> 最后更新：2026-06-10
> 本文档用中文详细解释整个项目的模块组成、数据流向、以及每个部分存在的原因。
>
> **Agent 层在 2026-06-10「打地基」后有重构——最新结构见文末「九、Agent 层地基」。新增 Agent 请看 `docs/how-to-add-an-agent.md`。**

---

## 一、项目全貌

Drinking Time 是一个 **AI 辅助影视预制作工坊**。核心流程：

```
用户上传素材 → AI 分析 → 故事构思（对话+卡片） → 剧本生成 → 镜头表 → AI 生图 → 局部编辑
```

技术栈一句话：**React + tRPC + Drizzle ORM**，前后端同仓（monorepo），用 Vite 开发和打包。

---

## 二、目录结构总览

```
drinking-time-local/
├── client/src/           ← React 前端
│   ├── _core/            ← 基础设施（认证、工具函数）
│   ├── app/              ← 应用壳层（路由、全局 Provider、TopBar）
│   ├── features/         ← 功能模块（每个模块自包含）
│   │   ├── storyAgent/   ← 故事 Agent（对话、卡片、剧本）
│   │   ├── creationAgent/← 制作 Agent（出图、编辑）
│   │   ├── nayin/        ← 纳音五行主题系统
│   │   └── analysis/     ← 分析模块（镜头表、素材、Production Table）
│   ├── components/ui/    ← shadcn/ui 组件库
│   ├── pages/            ← 页面级路由组件
│   ├── hooks/            ← 通用 Hook
│   └── lib/              ← 工具库（tRPC 客户端、农历计算）
├── server/               ← Express + tRPC 后端
│   ├── _core/            ← 基础设施（env、trpc、llm、oauth）
│   ├── services/         ← 业务服务层
│   ├── archive/          ← 历史保留的 Agent 代码
│   ├── routers.ts        ← 所有 tRPC 路由定义
│   ├── db.ts             ← 数据库访问层（双模式）
│   └── storage.ts        ← 文件存储代理
├── drizzle/
│   └── schema.ts         ← 数据库表结构定义（唯一 source of truth）
└── shared/               ← 前后端共享常量
```

---

## 三、后端架构

### 3.1 数据库双模式（最重要的架构决策）

`server/db.ts` 实现了一个 **双模式数据层**：

| 模式 | 触发条件 | 存储位置 | 适用场景 |
|------|---------|---------|---------|
| **MySQL 模式** | `DATABASE_URL` 环境变量存在 | MySQL 数据库 | 生产部署 |
| **内存模式** | `DATABASE_URL` 不存在 | `.webdev/local-persist.json` | 本地开发 |

**工作方式：** 每个数据库函数（如 `createProject`、`getProjectShots`）都走同一个模式：
```
const db = await getDb();
if (!db) {
  // 内存操作 + 写 JSON 文件
} else {
  // Drizzle ORM 操作 MySQL
}
```

**为什么这么设计：** 本地开发不需要装 MySQL，开箱即用。JSON 文件在每次写操作后原子持久化（先写 `.tmp` 再 `rename`，防止写到一半崩溃导致数据损坏）。

### 3.2 tRPC 路由体系

所有 API 定义在 `server/routers.ts`，通过 `appRouter` 导出。主要路由：

| 命名空间 | 功能 | 认证等级 |
|---------|------|---------|
| `auth.me` / `auth.logout` | 用户认证 | 公开 |
| `almanac.today` | 老黄历/农历 | 公开 |
| `nayin.today` | 纳音五行计算 | 公开 |
| `project.*` | 项目 CRUD + 重命名 | 需登录 |
| `reference.*` | 素材上传/管理 | 需登录 |
| `shot.*` | 镜头 CRUD + 批量更新 | 需登录 |
| `analysis.*` | AI 分析（环境模板） | 需登录 |
| `story.*` | 故事 CRUD（整 blob 读写） | 需登录 |
| `storyAgent.chat` | 故事 Agent 对话 | 需登录 |
| `storyAgent.synthesizeShots` | 镜头表合成 | 需登录 |
| `creationAgent.chat` | 制作 Agent 对话 + 出图 | 需登录 |
| `creationAgent.segment` | SAM 2 分割（点选物体） | 需登录 |
| `creationAgent.inpaint` | 局部重绘 | 需登录 |
| `editContext.*` | 编辑快照 + 语义标注 | 需登录 |

**认证三级：**
- `publicProcedure`：任何人可调用
- `protectedProcedure`：需要登录（JWT cookie）
- `adminProcedure`：需要 admin 角色

### 3.3 服务层

| 文件 | 职责 |
|------|------|
| `services/creationAgent.ts` | 制作 Agent 逻辑：接收对话 + 镜头上下文，调用 LLM，解析 tool call（generateImage / updateFocus） |
| `services/imageGen.ts` | fal.ai 图片生成（Flux Pro Ultra）和 inpainting（Flux Pro Fill），含 circuit breaker |
| `services/segmentation.ts` | fal.ai SAM 2 分割服务，同样有 circuit breaker |
| `services/editContext.ts` | 编辑快照保存、diff 计算、语义标注触发 |
| `services/semanticAnnotation.ts` | LLM 分析编辑 diff，推断用户偏好 |
| `services/almanac.ts` | 老黄历 API 对接（天行数据 / 极速数据） |
| `archive/storyAgent.ts` | 故事 Agent 核心：对话回复、镜头表合成、历史摘要 |

**Circuit Breaker 模式（`imageGen.ts` 和 `segmentation.ts`）：**
- 30 秒超时
- 连续 3 次失败 → 触发熔断
- 熔断冷却期 10 分钟
- 冷却结束自动恢复

### 3.4 LLM 调用链

```
server/_core/llm.ts          ← invokeLLM()：统一的 LLM 调用封装
  ↓
server/_core/agentChannel.ts  ← invokeAgent()：流式 Agent 调用（SSE）
  ↓
server/_core/llmJson.ts       ← parseJsonLoose()：宽松 JSON 解析（处理 LLM 输出的不规范 JSON）
```

LLM 配置通过环境变量：
- `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY`：主 LLM（OpenAI 兼容格式）
- `LLM_MODEL`：默认 `gemini-2.5-flash`
- `DROP_ZONE_*`：聊天 Agent 专用模型（可选）
- `VISION_*`：视觉分析专用模型（可选）

### 3.5 文件存储

`server/storage.ts` 使用 Forge 存储代理：
- `storagePut(relKey, data, contentType)` → 上传文件，返回 `{ key, url }`
- `storageGet(relKey)` → 获取下载 URL
- 用于：上传素材、保存生成的图片、保存分割 mask

---

## 四、前端架构

### 4.1 页面与路由

```
/login       → LoginPage（未认证）
/welcome     → WelcomePreviewPage（预览/demo）
/            → AnalysisPage（默认主页，需认证）
/analysis    → AnalysisPage
/creation    → CreationPage（需认证）
```

路由用 **wouter**（轻量级路由库），认证守卫在 `AppRouter` 层。

### 4.2 四大功能模块

#### 模块一：故事 Agent（`features/storyAgent/`）

**做什么：** 用户通过对话和 AI 协作，从零构思故事。

**数据流：**
```
用户聊天 → AI 提取情感卡片 → 卡片板展示 → 用户选择/排列卡片 → AI 生成剧本 → 镜头表
```

**核心状态（`StoryAgentContext`）：**
- `messages`：对话历史
- `cards`：情感卡片（从对话中 AI 提取）
- `generatedScript`：生成的剧本
- `storyShots`：镜头列表（从剧本合成）
- `characters`：角色列表
- 元数据：`title`、`logline`、`theme`、`arc`

**存储方式：** `localStorage` 按 `projectId` 分区（key: `dt:storyAgent:${projectId}`）

**重要子组件：**
- `StoryAgentChat`：聊天界面
- `StoryCardsBoard`：卡片看板
- `ScriptViewer`：剧本查看器（含跳转到制作页的按钮）
- `StoryListView`：历史故事列表

#### 模块二：制作 Agent（`features/creationAgent/`）

**做什么：** 接收镜头表，为每个镜头生成 AI 图片，支持局部编辑。

**数据流：**
```
镜头表 → 选中镜头 → AI 对话出图 → 查看/切换图片 → 点击物体 → SAM 2 分割 → 输入修改指令 → inpaint
```

**核心状态（`CreationAgentContext`）：**
- `messages`：制作相关对话
- `focusShotNo`：当前聚焦的镜头号（如 "SH03"）
- `projectImages`：项目所有已生成图片列表

**跨页面握手：**
- ScriptViewer 点击 📷 按钮 → `sessionStorage` 写入 `dt:creation:focusShotNo` → 导航到 `/creation` → CreationPage 读取并设置焦点

#### 模块三：纳音五行（`features/nayin/`）

**做什么：** 根据农历日期计算当日五行属性，映射到饮品主题，为整个 UI 提供氛围色彩。

**五行 → 饮品映射：**

| 五行 | 饮品 | 色调 |
|------|------|------|
| 金 Metal | 啤酒 Beer | 琥珀金 |
| 木 Wood | 龙井 Longjing | 翡翠绿 |
| 水 Water | 椰汁 Coconut | 柔和青 |
| 火 Fire | 咖啡 Coffee | 深红棕 |
| 土 Earth | 葡萄酒 Wine | 赤陶色 |

**组件：**
- `BeverageAmbience`：背景氛围色（CSS 变量注入）
- `WuxingParticles`：粒子效果
- `BeverageTransition`：切换主题时的全屏"倒饮"动画
- `WuxingDrinkIcon`：饮品图标

**刷新机制：** CST（东八区）午夜自动刷新 + 窗口聚焦时检查

#### 模块四：分析模块（`features/analysis/`）

**做什么：** 管理素材上传、镜头表展示与编辑、生产状态追踪。

**核心 Hook：**
- `useProjectData()`：项目列表、素材、镜头的 CRUD 操作
- `useAnalysisOrchestration()`：AI 分析触发与结果管理
- `usePanelState()`：面板 UI 状态

**镜头状态流水线：**
```
idea_pool → requirement_pool → structured → production_ready → queued → rendered
```

**关键视图：**
- `ShotTable`：镜头表（可编辑字段 + 缩略图 + 拖拽重分配）
- `DropZone`：素材上传区
- `WorkspaceStageRouter`：根据数据状态切换引导页/工作区

### 4.3 Provider 嵌套关系

```
<App>
  <tRPC Provider + QueryClient>
    <AppProviders>                    ← ErrorBoundary + NayinProvider + Toast
      <AppRouter>
        <AnalysisPage>
          <StoryAgentProvider>        ← 按 projectId 隔离
            <AnalysisWorkspace />
          </StoryAgentProvider>
        </AnalysisPage>

        <CreationPage>
          <StoryAgentProvider>        ← 按 projectId 隔离
            <CreationAgentProvider>   ← 嵌套在 Story 内部
              <CreationWorkspaceInner />
            </CreationAgentProvider>
          </StoryAgentProvider>
        </CreationPage>
      </AppRouter>
    </AppProviders>
  </tRPC Provider>
</App>
```

**重要：** `CreationAgentProvider` 必须嵌套在 `StoryAgentProvider` 内部，因为制作页需要读取 `storyShots`。

### 4.4 前后端通信

```
前端 Hook (useQuery/useMutation)
  ↓
tRPC Client (httpBatchLink + superjson)
  ↓
HTTP 请求（cookie 带 JWT）
  ↓
tRPC Server (middleware 解析 user)
  ↓
protectedProcedure → db.ts → MySQL 或 内存
```

所有 tRPC 调用自动带 `credentials: 'include'`，认证信息在 HTTP-only cookie 中。

---

## 五、数据流全景

### 5.1 故事创作流程

```
1. 用户在 AnalysisPage 的 StoryAgentChat 聊天
2. 消息发到 storyAgent.chat → LLM 分析 → 返回回复 + 情感卡片
3. 前端 StoryAgentContext 存储卡片到 localStorage
4. 用户排列卡片，点击"生成剧本"
5. 前端调用 storyAgent.synthesizeShots → LLM 合成镜头表
6. 镜头表存入 StoryAgentContext.storyShots
7. 自动保存故事到服务器（story.save）
8. 自动用故事标题重命名项目（project.rename）
```

### 5.2 图片生成流程

```
1. 用户在 CreationPage 选中镜头（或从 ScriptViewer 跳转）
2. 在 CreationAgentChat 发送指令（如"生成这个镜头的图片"）
3. 消息发到 creationAgent.chat → LLM 决定 tool call
4. 若 tool=generateImage → imageGen.ts → fal.ai Flux Pro → 生成图片
5. 图片上传到 storage → 记录到 generated_images 表
6. 前端刷新 projectImages → ShotTable 显示缩略图
```

### 5.3 局部编辑流程

```
1. 用户点击已生成的图片 → 打开 ImageSegmentOverlay
2. 用户点击图片中的物体
3. 前端调用 creationAgent.segment → SAM 2 → 返回 mask
4. 前端显示半透明 mask 覆盖
5. 用户输入修改指令（如"把这个人换成猫"）
6. 前端调用 creationAgent.inpaint → Flux Pro Fill → 新图片
7. 新图片保存，parentImageId 指向原图
```

---

## 六、环境配置

所有配置通过 `.env` 文件管理（`server/_core/env.ts` 统一读取）：

| 变量 | 用途 |
|------|------|
| `VITE_APP_ID` | 应用 ID |
| `JWT_SECRET` | JWT 签名密钥 |
| `DATABASE_URL` | MySQL 连接（不设则用内存模式） |
| `OAUTH_SERVER_URL` | OAuth 认证服务器 |
| `OWNER_OPEN_ID` | 管理员用户的 OpenID |
| `BUILT_IN_FORGE_API_URL` | LLM API 地址 |
| `BUILT_IN_FORGE_API_KEY` | LLM API 密钥 |
| `LLM_MODEL` | 默认模型（`gemini-2.5-flash`） |
| `FAL_KEY` | fal.ai API 密钥（图片生成+分割） |
| `HUANGLI_API_KEY` | 老黄历 API 密钥 |

---

## 七、关键设计模式速查

| 模式 | 在哪里用 | 一句话解释 |
|------|---------|-----------|
| 双模式数据库 | `db.ts` | MySQL 或 JSON 文件，开发零配置 |
| Context + localStorage | StoryAgent / CreationAgent | 前端状态按 projectId 隔离，刷新不丢 |
| Circuit Breaker | imageGen / segmentation | 外部 API 连续失败后自动熔断，10分钟冷却 |
| 整 blob 读写 | story.body (JSON 列) | 故事的卡片/角色/镜头存为一个 JSON，不拆表 |
| 跨页面 sessionStorage | ScriptViewer → CreationPage | 用 `dt:creation:focusShotNo` 传递焦点镜头 |
| CustomEvent 通信 | ShotTable → CreationAgent | `dt:reassign-image` 事件实现拖拽重分配 |
| Agent Tool Call | creationAgent.ts | LLM 返回 JSON 决定调用 generateImage 还是 updateFocus |
| 宽松 JSON 解析 | `llmJson.ts` | 处理 LLM 输出的不标准 JSON（trailing comma, 注释等） |

---

## 八、文件索引（按职责查找）

**"我想改 XX，应该看哪个文件？"**

| 我想改... | 看这些文件 |
|----------|-----------|
| 数据库表结构 | `drizzle/schema.ts` |
| 数据库读写逻辑 | `server/db.ts` |
| API 路由定义 | `server/routers.ts` |
| 认证流程 | `server/_core/oauth.ts`, `server/_core/cookies.ts`, `server/_core/context.ts` |
| LLM 调用方式 | `server/_core/llm.ts`, `server/_core/agentChannel.ts` |
| 图片生成逻辑 | `server/services/imageGen.ts` |
| 图片分割逻辑 | `server/services/segmentation.ts` |
| 故事 Agent 行为 | `server/archive/storyAgent.ts` |
| 制作 Agent 行为 | `server/services/creationAgent.ts` |
| 故事前端状态 | `client/src/features/storyAgent/StoryAgentContext.tsx` |
| 制作前端状态 | `client/src/features/creationAgent/CreationAgentContext.tsx` |
| 纳音主题系统 | `client/src/features/nayin/` |
| 镜头表 UI | `client/src/features/analysis/views/ShotTable.tsx` |
| 项目/素材管理 | `client/src/features/analysis/hooks/useProjectData.ts` |
| 页面路由 | `client/src/app/router/AppRouter.tsx` |
| 顶部导航栏 | `client/src/app/shell/TopBar.tsx` |
| 环境变量配置 | `server/_core/env.ts` |
| 文件上传/存储 | `server/storage.ts` |
| **库加载底座（美术/文学共用）** | `server/services/libraryLoader.ts` + `libraryFields.ts` |
| **文学库（剧本共鸣用）** | `docs/literature-library/` + `server/services/literatureLibrary.ts` |
| **出图网关（美术判断插入点）** | `server/services/renderGate.ts` |
| **共鸣信号（意图+情绪画像共享）** | `server/services/resonanceSignal.ts` |
| **剧本 Agent（接文学库/共鸣）** | `server/services/scriptAgent.ts` |
| **对话 Agent 骨架** | `server/services/agentRuntime.ts` |
| **前端 Agent 持久化脚手架** | `client/src/features/_agentKit/projectScopedStore.ts` |
| **如何新增一个 Agent** | `docs/how-to-add-an-agent.md` |

---

## 九、Agent 层地基（2026-06-10 重构）

这一节是 Agent 层的**最新**结构（覆盖第三节里 storyAgent / creationAgent 的旧描述）。核心思想：**新增 Agent 应当是填空，不是复制**。新增步骤见 `docs/how-to-add-an-agent.md`。

### 9.1 三条共享底座

| 底座 | 文件 | 解决的重复 |
|------|------|-----------|
| 库加载 | `server/services/libraryLoader.ts`（+ `libraryFields.ts`） | 每个「YAML 知识库」都要的解析 / 校验 / 缓存，只写一处 |
| 对话骨架 | `server/services/agentRuntime.ts` | 每个对话 Agent 的「拼消息→invoke→解析兜底」，只写一处 |
| 前端持久化 | `client/src/features/_agentKit/projectScopedStore.ts` | 每个前端 Agent 的 projectId 分区 localStorage，只写一处 |

### 9.2 库支撑的判断 Agent（同一范式，两个实例）

```
美术 Agent ──查──▶ styleLibrary（docs/style-library/）─┐
剧本 Agent ──查──▶ literatureLibrary（docs/literature-library/）─┘
                        └── 两库共用 libraryLoader 底座
```

- **美术库** `styleLibrary`：美术流派条目，注入出图 prompt。
- **文学库** `literatureLibrary`：文学家「声音」条目（鲁迅 / 张爱玲…），供剧本共鸣。
- 两库都有 `emotion_fit / theme_fit / affinity` 落点字段，供按信号排序。

### 9.3 出图网关（所有出图的唯一必经点）

```
creationAgent / artAgent / routers(generateForMobile, mobileInpaint, inpaint)
        └──────────────▶ renderViaGate（renderGate.ts）──▶ 各自生成器
                              ▲ artJudge：本轮 identity 桩
                                未来：styleLibrary + 情绪 + 意图 + 参考图 → shotPromptComposer 改写 prompt
```

收口前这些出口各拼各的 prompt、各自直连生成器；现在统一过网关，美术判断只需填 `artJudge` 一处。
（注：底层有两套生成器 `_core/imageGeneration` 与 `services/imageGen`，本轮只透传收口、未合并。）

### 9.4 共鸣信号：意图 + 情绪画像的共享

```
dropZoneAgent（意图识别）──┐
emotionAnalysis（情绪画像）─┴──▶ ResonanceSignal（resonanceSignal.ts）
                                   ├──▶ literatureLibrary.rankVoicesBySignal（排共鸣声音）
                                   ├──▶ scriptAgent → classify 路由（注入剧本合成）
                                   └──▶ renderGate.RenderContext（美术侧对称，待填）
```

- `dropZoneAgent` 读用户情绪画像折进上下文（意图识别带着情绪底盘理解）。
- 剧本路由 `classify` 取「用户画像 + 卡片情绪」→ 信号 → 文学库排序 → 注入剧本。

### 9.5 本轮留空的「判断」

打地基只搭缝、不填智能。以下 LLM 判断后续填入，不改地基：
- `renderGate.artJudge`：美术怎么用库 + 情绪选流派、改写 prompt。
- 文学共鸣的「智能版」排序（现在是确定性规则 `rankVoicesBySignal`）。
- 剧本「怎么写专业」的合成判断。
