---
title: "feat: 统一图片资产层与 Creation 画面连续性"
type: feat
status: active
date: 2026-06-13
origin: docs/brainstorms/2026-06-13-unified-image-asset-layer-requirements.md
---

# feat: 统一图片资产层与 Creation 画面连续性

## Summary

在现有 `generated_images` 与 `image_signals` 之上增加一层统一资产投影，不破坏旧数据即可识别数字镜号、标准镜号、无镜号图片、美术候选、历史版本、用户收下与淘汰信号。Creation 页面新增镜头图片工作区，继承手机端已经选择的画面，并把无法确定归属或文件丢失的记录放到明确位置。小酌继续作为唯一可见角色，在服务端读取当前镜头与图片版本后调度画面分析、整图修改、恢复和重绑能力。

---

## Problem Frame

当前 `generated_images` 名义上由手机和电脑共用，但查询和展示仍按两套身份工作：手机常写数字字符串镜号，Creation 使用 `SH01`；Creation 只查询 `isCurrent=true`，并用镜号精确匹配镜头。用户已经生成、右划收下或修改的图片因此可能存在于数据库，却在 `/creation` 完全不可见。另有美术候选借用 `shotNo=ART-*`，以及元数据仍在但本地文件已丢失的历史记录，需要与镜头主图区分。

需求和产品边界以源文档为准（see origin: `docs/brainstorms/2026-06-13-unified-image-asset-layer-requirements.md`）。本计划不把手机变成专业生产台，也不建立新的可见 Agent 人格。

---

## Requirements

继承源文档 R1-R18，重点约束如下：

- 手机与电脑读取同一套图片资产事实，生成、选择、淘汰、修改和恢复均可追溯。
- 用户右划、明确确认或恢复旧版才建立主图；生成成功本身只产生待确认版本。
- `/creation` 显示主图、待确认、历史、淘汰、待归属、美术依据和文件缺失记录。
- 数字镜号 `"2"` 与标准镜号 `SH02` 必须兼容；无法映射的图片不得静默消失。
- 手机上已选图片应成为电脑端对应镜头的优先主图。
- 小酌是唯一可见对话角色，后台画面分析和改图能力通过统一动作协议执行。
- 本轮不自动重绘物理丢失的图片，不做视频和 Photoshop 级图层系统。

**Origin actors:** A1-A6
**Origin flows:** F1-F4
**Origin acceptance examples:** AE1-AE7

---

## Context & Research

### Relevant Code and Patterns

- `drizzle/schema.ts`：`generated_images` 已保存项目、故事、镜号、父版本与 `isCurrent`；`image_signals` 已保存右划、左划和编辑事件。
- `server/db.ts`：`getStoryImages` 与 `getProjectCurrentImages` 都过滤 `isCurrent=true`；`createGeneratedImage` 在新图生成时立即降级旧图，因此 `isCurrent` 实际表示“版本链最新”，不能再等同用户选择。
- `server/routers.ts`：手机生成会同时写 `projectId` 与 `storyId`，但镜号写成数字字符串；`recordSignal` 已是用户审美反馈入口。
- `server/services/creationAgent.ts`：小酌目前支持出图、焦点和提示词建议，尚未读取当前图片资产，也不能执行画面分析、整图修改、恢复或重绑。
- `client/src/pages/CreationPage.tsx`：Creation 只从当前图片数组中按镜号匹配缩略图，没有历史版本和待归属区域。
- `client/src/features/creationAgent/CreationAgentContext.tsx`：对话按项目保存，适合作为 Creation 统一图片交互状态入口。
- `client/src/features/analysis/views/ShotTable.tsx`：现有镜头表已经很宽，不继续增加图片管理列；图片生产区应作为独立的全宽工作区与表格协同。
- `client/src/features/mobileChat/types.ts` 与 `server/routers.ts` 的 `mobileShotNo` 已能把 `SH02` 转回数字，允许新写入逐步规范成标准镜号而不改变手机 UI。

### Institutional Learnings

- `docs/solutions/2026-06-13-多worktree环境数据分裂收敛.md`：worktree 不运行服务、不写 `.webdev`；最终视觉验证回主仓库 3000 端口进行。
- 本地图片文件和元数据生命周期并不完全一致，资产投影必须把“记录存在”和“文件可展示”分开表达。

### External References

- 未使用。改动完全基于现有本地数据模型、React/tRPC 结构与已有图片生成能力。

---

## Key Technical Decisions

### 1. 兼容投影优先，不批量迁移旧数据

新增共享的图片资产投影服务，把已有行与选择事件投影成稳定的 `ImageAsset`：

- `canonicalShotNo`：`"2"`、`"02"`、`"SH2"` 统一为 `SH02`。
- `kind`：`ART-*` 识别为美术方向候选，其余为故事画面。
- `status`：依据每张图片最新的用户信号得到 `selected`、`rejected` 或 `pending`。
- `isPrimary`：同镜头中最近一次明确 `swipe_right` 的图片优先；没有任何选择信号的旧镜头才用 `isCurrent` 作为兼容主图。
- `availability`：本地文件能确认不存在时标记 `missing`，远程或无法确认的地址标记 `unknown`。

这样可以立即看见旧资产，不需要修改 `.webdev` 或执行不可逆回填。

### 2. 选择是事件，版本最新与主图分离

保留 `isCurrent` 作为版本链最新标记，主图由 `image_signals` 的选择事件投影得到。桌面端“设为主图/恢复此版本”复用 `swipe_right` 语义，由服务端为缺少 `storyId` 的旧桌面图片找到当前项目故事后写入事件。一个镜头只投影出一个 `isPrimary=true`，较早收下的版本仍保留为历史。

### 3. 稳定镜头键先用规范镜号，故事时刻保留现有故事关联

现阶段故事卡片和镜头之间没有可靠持久化外键。第一阶段以 `projectId + canonicalShotNo` 作为生产身份，以 `storyId` 保留故事时刻上下文；无镜号或无法匹配项目镜头的画面进入待归属区。不会根据文本相似度自动硬绑，避免错误继承。

### 4. 图片工作区独立于宽镜头表

Creation 顶部新增全宽 `ShotImageWorkspace`：

- 焦点镜头主画面与状态。
- 横向版本轨道，支持设为主图、恢复、重绑与查看缺失上下文。
- 待归属画面区和美术依据区。
- 选择镜头与 `ShotTable` 焦点双向同步。

现有表格只接收投影后的主图缩略图，不继续加列。

### 5. 小酌服务端读取资产，不信任客户端拼装图片上下文

`creationAgent.chat` 在服务端查询项目资产，并把焦点镜头的主图、待确认版本和历史摘要传给小酌。动作协议扩展为：

- `analyzeImage`：调用现有视觉分析能力。
- `reviseImage`：以当前主图或指定版本为参考生成新版本，新图默认待确认。
- `selectImage`：恢复或确认某版本为主图。
- `reassignImage`：把指定图片重绑到镜头。

客户端只传用户消息、镜头和故事文字，不负责决定哪张图片是真正主图。

---

## Implementation Units

### U1. 统一图片资产投影与兼容查询

**Goal:** 把现有图片行与选择事件投影成 Creation 和小酌可共用的稳定资产模型，确保旧数字镜号、历史、美术候选和缺失文件都有明确状态。

**Requirements:** R1-R6, R10-R12, R18（AE1-AE3、AE6）

**Dependencies:** None

**Files:**

- Create: `shared/imageAsset.ts`
- Create: `server/services/imageAssets.ts`
- Create: `server/services/imageAssets.test.ts`
- Modify: `server/db.ts`
- Modify: `server/routers.ts`
- Modify: `client/src/features/creationAgent/types.ts`

**Approach:**

- 在 shared 层定义可序列化的 `ImageAsset`、规范镜号函数、资产分类与选择状态类型。
- DB 层新增“项目全部相关图片”和“图片选择事件”查询，不再过滤 `isCurrent`；项目查询同时覆盖 `projectId` 直接关联以及该项目故事下的图片。
- 服务层按最新信号、创建时间和版本关系计算状态与唯一主图。
- 本地 `/api/images/*`、`/local-images/*` 地址通过配置的图片目录检查文件；不对远程 URL 发网络探测。
- `creationAgent.getProjectAssets` 返回完整投影；保留旧 `getProjectImages` 一段时间供其他页面兼容，但改为返回投影主图或在调用点迁移。

**Patterns to follow:**

- `server/services/storySync.ts` 的“表为唯一权威来源”原则。
- `shared/artDirection.ts` 的共享可序列化类型组织方式。
- `server/services/artDirection.test.ts` 的纯函数测试风格。

**Test scenarios:**

- Happy path: `"2"`、`"02"`、`"SH2"` 都规范成 `SH02`。
- Happy path: 同镜头三张图中最近一次右划的图片为唯一主图，生成时间更晚但未选择的图片保持 `pending`。
- Happy path: 左划图片为 `rejected`，不自动成为主图。
- Legacy compatibility: 某镜头没有任何信号时，唯一 `isCurrent=true` 的旧图片成为 `legacy` 兜底主图。
- Edge case: `ART-R1-1` 被分类为美术依据，不进入镜头主图竞争。
- Edge case: 无镜号或规范镜号不在项目镜头集合中的图片进入 `unassigned`。
- Error path: 本地文件不存在时返回 `availability=missing`，记录和 prompt 仍保留。
- Integration: 项目查询能同时返回桌面图片和同项目故事产生的手机图片。

**Verification:**

- 对当前本地数据的只读样本运行投影时，项目 1 的数字镜号图片映射到 `SH02`，美术候选独立分类，不再被当前图过滤掉。

---

### U2. 选择、恢复、重绑与新写入规范化

**Goal:** 让手机与电脑的选择语义落到同一事件流；新图片使用规范镜号并保留故事归属，生成不越权覆盖已选主图。

**Requirements:** R3-R6, R9, R11-R13（AE1、AE2、AE5）

**Dependencies:** U1

**Files:**

- Modify: `server/db.ts`
- Modify: `server/routers.ts`
- Modify: `server/services/creationAgent.ts`
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`
- Modify: `client/src/features/mobileChat/MobileChatContext.tsx`
- Modify: `server/routers.storyAgent.test.ts`

**Approach:**

- 新增桌面端 `selectImage` mutation：校验图片属于当前用户项目，找到或补用项目当前故事，写入 `swipe_right` 信号。
- 重绑时只调整归属和版本最新关系；最终主图仍由选择事件投影决定。
- 手机右划后使 Creation 资产查询失效；现有手机 UI 保持数字镜号表现。
- 手机和 Creation 的新图片写入前统一镜号为 `SHxx`；Creation 新图片补写当前故事 `storyId` 和用户 `userId`。
- 生成新版本后返回待确认资产；已有明确选择主图不被新生成版本替代。

**Patterns to follow:**

- `storyAgent.recordSignal` 的事件写入与用户权限上下文。
- `creationAgent.reassignImage` 的 tRPC mutation 与 Context 刷新模式。

**Test scenarios:**

- Happy path: 手机对数字第二镜图片右划后，项目资产查询把它投影为 `SH02` 主图。
- Happy path: Creation 新生成的变体为 `pending`，原已选主图保持主图。
- Happy path: 桌面恢复旧版本写入新选择事件，旧版本成为唯一主图，原主图仍在历史中。
- Edge case: 旧桌面图片没有 `storyId` 时，选择接口使用该项目当前故事记录事件。
- Error path: 图片不属于当前用户项目时拒绝选择或重绑。
- Integration: 新写入 `SH02` 仍能在手机故事工作区被解析成数字 `2`。

**Verification:**

- `server/routers.storyAgent.test.ts` 覆盖“手机生成/选择 → Creation 项目资产”的真实 router 链路。

---

### U3. Creation 镜头图片工作区

**Goal:** 在电脑端提供镜头级主图、版本、待确认、淘汰、待归属、美术依据和缺失状态管理，并把主图继续传给现有镜头表。

**Requirements:** R10-R13, R18（F2、F4；AE2、AE3、AE5、AE6）

**Dependencies:** U1, U2

**Files:**

- Create: `client/src/features/creationAgent/imageAssetViewModel.ts`
- Create: `client/src/features/creationAgent/imageAssetViewModel.test.ts`
- Create: `client/src/features/creationAgent/views/ShotImageWorkspace.tsx`
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`
- Modify: `client/src/pages/CreationPage.tsx`
- Modify: `client/src/features/storyAgent/views/ScriptViewer.tsx`

**Approach:**

- 用纯 view-model 函数按项目镜头分组资产，返回每镜主图、预览版本、历史、淘汰、待归属和美术依据。
- 工作区以焦点镜头为中心：主画面占稳定比例，版本轨道横向滚动；使用图标按钮与 tooltip 执行设为主图、重绑和刷新。
- 缺失文件使用明确占位与原 prompt/时间，不渲染破图。
- 待归属区提供镜头选择器，用户确认后重绑；美术候选只作为风格依据展示。
- `ShotTable` 的 thumbnail 使用 `isPrimary`；没有明确主图但有待确认图时，工作区可展示预览，表格不把它冒充正式主图。
- 保持 `/creation` 桌面生产密度；窄屏只做可用的纵向折叠，不把完整版本管理复制到 `/m`。

**Patterns to follow:**

- `client/src/features/analysis/views/ShotTable.tsx` 的镜头焦点交互。
- `client/src/features/creationAgent/views/FloatingAgentChat.tsx` 的 Creation 视觉语言与图标库。
- `client/src/components/ui/tooltip.tsx`、`select.tsx`、`scroll-area.tsx` 的现有控件。

**Test scenarios:**

- Happy path: `SH02` 的选中图、待确认变体和淘汰图被分到同一镜头且状态正确。
- Happy path: 点击某镜头版本轨道同步更新焦点，镜头表高亮同一镜头。
- Edge case: 数字镜号资产出现在标准镜头分组。
- Edge case: 无镜号或不存在镜头的资产进入待归属区。
- Edge case: 美术候选进入风格依据区，不出现在镜头版本中。
- Error path: `availability=missing` 使用缺失占位，不触发无限图片加载错误。
- Responsive: 1440px 桌面可同时看到主画面、版本轨和镜头表入口；390px 窄屏不出现文字或控件重叠。

**Verification:**

- 合并到主目录后，在 `http://localhost:3000/creation` 用真实项目确认已有图片可见，主图与版本状态清楚，待归属和缺失记录有明确去处。

---

### U4. 小酌统一图片动作协议

**Goal:** 让用户在 Creation 的同一个小酌聊天框中分析和修改当前画面，后台专业能力不暴露为额外人格。

**Requirements:** R14-R17（F3；AE4）

**Dependencies:** U1, U2

**Files:**

- Modify: `server/services/creationAgent.ts`
- Modify: `server/routers.ts`
- Modify: `client/src/features/creationAgent/CreationAgentContext.tsx`
- Modify: `client/src/features/creationAgent/views/FloatingAgentChat.tsx`
- Modify: `client/src/pages/CreationPage.tsx`
- Create: `server/services/creationAgent.test.ts`

**Approach:**

- Router 在调用小酌前加载项目资产，服务端根据焦点镜头确定当前主图与最近版本。
- 系统提示加入可用图片摘要和动作约束；新增 `analyzeImage`、`reviseImage`、`selectImage`、`reassignImage` 工具调用。
- `analyzeImage` 复用现有 `analyzeVisionReference`；`reviseImage` 复用 `renderViaGate + editImage`，并以当前图片和故事美术参考为输入。
- 新修改图写入父版本、项目、故事、用户和规范镜号，作为待确认版本返回。
- 小酌回复统一解释分析或执行结果，前端只展示小酌消息和产生的图片，不显示内部 Agent 名称。
- Creation 页面把故事卡片和当前剧本传入现有 `sendMessage`，避免小酌只看到镜头表。

**Patterns to follow:**

- `server/services/artAgent.ts` 调用视觉分析的方式。
- `server/services/creationAgent.ts` 当前 `generateImage`、`updateFocus`、`updateShotPrompt` 工具协议。
- `server/services/renderGate.ts` 的美术 DNA 与参考图汇合方式。

**Test scenarios:**

- Happy path: 焦点镜头有主图时，“人物不要看镜头，窗外再亮一点”触发 `reviseImage`，新图父版本指向当前图且为待确认。
- Happy path: “分析一下这张图为什么不够安静”调用视觉分析，并由小酌返回中文摘要。
- Happy path: “恢复上一版”选择指定历史图并刷新主图。
- Edge case: 焦点镜头没有可用图片时，分析/修改动作返回清楚引导，不调用图片服务。
- Error path: 图片文件缺失或视觉/出图服务失败时，保留旧主图并返回可理解错误。
- Integration: router 从服务端资产查询获得当前主图，客户端不传图片 URL 也能完成修改。

**Verification:**

- 在 Creation 选中有图镜头，通过小酌完成一次分析与一次修改；新版本进入版本轨，用户确认前原主图不变。

---

## System-Wide Impact

- **Data lifecycle:** 不新增表、不批量改写旧记录；新增查询读取完整历史，新增选择事件沿用已有 `image_signals`。
- **Compatibility:** `getStoryImages` 的手机恢复行为保持；Creation 改用资产投影。新 `SHxx` 写入通过现有 `mobileShotNo` 转回数字。
- **Agent chain:** 小酌是唯一对话状态；视觉分析和出图服务是无会话工具，不创建第二份聊天历史。
- **Failure behavior:** 生成、分析或文件检查失败都不能删除或替换现有主图。
- **Performance:** 项目图片与信号一次查询后在服务层投影；不为每张远程图片发 HEAD 请求。
- **Security:** 选择、重绑和聊天动作都必须以当前用户校验项目与故事归属。

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 旧 `isCurrent` 与用户选择语义混杂 | 明确信号优先，只有完全没有选择信号时才使用 legacy 兜底 |
| 同一镜头多张图片都曾右划 | 以最近一次右划时间选唯一主图，其余保留“曾收下”历史 |
| 无稳定 card-to-shot 外键导致错误自动映射 | 第一阶段只按规范镜号映射；有歧义进入待归属区 |
| 美术候选误当镜头图 | `ART-*` 独立分类为 style reference |
| 历史文件丢失导致破图 | 服务端本地检查 + 前端 `onError` 降级，保留元数据 |
| Creation 工作区挤压现有宽表 | 独立全宽工作区，不增加 ShotTable 列 |
| 修改图生成后错误覆盖用户主图 | 新版本为 pending；只有 select/restore 事件改变投影主图 |

---

## Verification Strategy

1. 单元测试：镜号规范化、状态投影、主图决策、分组 view model、小酌动作解析。
2. Router 集成测试：手机生成与右划信号经过真实 DB memory adapter 后，在 Creation 查询成为对应镜头主图。
3. 静态检查：`pnpm check`。
4. 构建检查：`pnpm build`。
5. 视觉验证：代码合并到主目录后，只使用现有 3000 服务，在 `/creation` 检查桌面和窄屏截图；不在 worktree 启动服务。
6. 数据安全检查：视觉验证前后确认主目录 `.webdev/local-persist.json` 未被测试或 worktree 写入覆盖。

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-06-13-unified-image-asset-layer-requirements.md`
- `drizzle/schema.ts`
- `server/db.ts`
- `server/routers.ts`
- `server/services/creationAgent.ts`
- `client/src/pages/CreationPage.tsx`
- `client/src/features/creationAgent/CreationAgentContext.tsx`
- `docs/solutions/2026-06-13-多worktree环境数据分裂收敛.md`
