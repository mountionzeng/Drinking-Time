---
date: 2026-08-25
topic: story-refresh-latency
status: diagnosis-complete-ready-for-agent-handoff
branch_observed: main@1295f7b
scope: editing cold refresh, recent-story restore, tRPC query readiness, prompt-lineage reads
---

# 交接：让刷新后的故事先出现，增强数据随后补齐

## 一句话任务

修复 `/editing` 整页刷新后“故事更新超级慢”的体感：最近故事的主体和已有镜头一旦恢复就立即可见、可操作，素材、视频、发布稿、提示词谱系和供应商状态在后台继续加载；同时删除刷新路径里的重复 `storyList` / `storyGet`，并把本地提示词谱系读取从“复制整库”收窄为按 Story 读取。

本交接只完成了诊断，**没有修改产品代码，也没有触发任何生成或付费任务**。用户已经选择把实现交给另一位 Agent。

---

## 一、用户原话与完成标准

用户原话：

> “还有一个事，就是我每次刷新的时候，我感觉故事的更新超级慢。”

这不是 3000 端口响应慢，也不是图片／视频供应商排队。用户说的是：刷新 `http://localhost:3000/editing` 后，已经存在的最近故事和镜头迟迟不出现。

完成后应满足：

1. 页面刷新后，最近 Story 的标题、镜头列和基础剪辑操作先出现；非关键数据慢时不再整页只显示加载动画。
2. 首次恢复继续从服务端取最新 Story，不能为了快显示跨端旧快照。
3. 刷新路径不重复请求同一份 `storyList` 和 `storyGet`。
4. 切换故事、新建未保存草稿或请求迟到时，旧 Story 仍不得覆盖当前选择。
5. Story 隔离、素材归属、时间线赢家规则和 30fps 整数帧语义不变。
6. 不提交、重试、刷新或取消任何付费任务。

---

## 二、接手前先做

按顺序：

1. 读 `AGENTS.md`。
2. 跑 `pnpm env:status`。只有主仓库能跑端口 3000；worktree 禁止启动服务或写 `.webdev/`。
3. 读 `docs/handoff/SESSION-BOARD.md`，动代码前登记自己将触达的文件；发现重叠先停下协调。
4. 读 `docs/features/feature-ledger.json` 中这些功能卡：
   - `story-ownership`（working）
   - `recent-story-entry`（working）
   - `prompt-lineage`（working）
   - `extracted-frame-overlay-video`（working）
5. 当前观察到的工作树只有未跟踪素材目录：
   - `generated-images/`
   - `generated-videos/`
   不要提交、移动、删除或覆盖它们。

当前观察基线：主仓库 `main`，HEAD `1295f7b`；端口 3000 正常，且只有一个 dev server。

### 不可破坏约束

- Story 读取和写入必须同时校验 `storyId` 与 `userId`，不得退回 “latest Story” 猜测写入对象。
- 最近故事沿用服务端 `updatedAt` 倒序的第一项，不在客户端另造排序。
- 自动打开不得覆盖当前已打开的故事或未保存草稿。
- 刷新期间用户切换／新建故事后，迟到结果不得覆盖新作用域。
- `loadStory` 首次恢复必须取服务端最新值；另一端刚写入的消息、卡片或图片不能因缓存而丢失。
- Storyboard 可以在增强数据未完成时使用既有 Story shots 和时间线 fallback，但不得显示另一 Story 的素材。

如果实现会削弱以上任一能力，按功能账本规则停下并先向用户说明影响；普通性能修复只追加所属功能的 `history`，不要新建噪音功能卡。

---

## 三、已经确认的完整因果链

### 1. 刷新先等 Project，Story 恢复尚未开始

`client/src/pages/EditingStudioPage.tsx:550-552` 首渲染调用 `useProjectData()`。

`client/src/features/analysis/hooks/useProjectData.ts:47-48` 同时发：

- `project.getOrCreateDefault`
- `project.list`

`currentProjectId` 初始是 `null`。`StoryAgentContext.tsx:1203-1207` 的 hydrate effect 因此先退出，最近 Story 还不能恢复。

与此同时，`EditingStudioPage.tsx:352` 已无条件挂载 `CreationEditorProvider`。即使 `activeStoryId` 为空，`CreationEditorContext.tsx:1478-1480` 与 `:1638-1646` 仍会发：

- `storyAgent.storyList`
- `creationAgent.shotVideoProviderStatus`
- `creationAgent.imageProviderStatus`

所有 query 经 `client/src/main.tsx:36-47` 的 `httpBatchLink` 合批，整批响应要等最慢项。

### 2. 最近故事恢复是严格串行瀑布

Project 返回后，Story hydrate 才完成。对已保存 Story，hydrate 会刻意把 `activeStoryId` 保持为 `null`，避免直接相信旧本地作用域。

`StoryAgentContext.tsx:3027-3057` 随后严格执行：

1. `refreshRecentStoryListWithRetry()`
2. `refreshStoryList()` 内 `utils.storyAgent.storyList.fetch()`
3. `resolveRecentStoryEntry()` 选择服务端列表第一项
4. `loadStory()` 内 `utils.storyAgent.storyGet.fetch({ staleTime: 0 })`
5. 规范化 body、shots、cards、messages 等
6. `replaceStoryScopeIfCurrent()` 最后一次性写入 `activeStoryId` 与 Story 作用域

这个顺序保护了跨端最新值和迟到加载隔离，不能简单删除。但首屏已经由 `CreationEditorProvider` 请求过一次 `storyList`；默认 QueryClient 没有 `staleTime`（`client/src/main.tsx:9`），显式 `fetch()` 很可能再次走网络。

`loadStory()` 强制取回 `storyGet` 后才写入 `activeStoryId`。随后 `CreationEditorContext.tsx:1580-1587` 的同 key `storyGet.useQuery()` 挂载；默认 `staleTime: 0` 又会把刚取回的数据视为 stale，可能立即 background refetch 第二次。

### 3. Story 已恢复后，七个详情 query 同时启用

`activeStoryId` 写入后，`CreationEditorContext.tsx:1580-1632` 同时启用：

- `storyAgent.storyGet`
- `publishingDraft.read`
- `publishingDraft.storyboardCoverReferences`
- `storyAgent.storyImages`
- `storyAgent.storyVideoAssets`
- `storyAgent.storyMaterialState`
- `promptLineage.getStoryProjection`

另有两个 provider status 和 `storyList` 已挂载。query 继续走 `httpBatchLink`；一项慢，整批一起晚返回。

### 4. 最直接的用户体感：十项 query 共用一个整页 loading 门

`client/src/features/creationEditor/CreationEditorContext.tsx:3754-3764` 把十项 query 的 `isLoading` 用 OR 合成一个布尔值。

`client/src/features/creationEditor/views/EditingNleWorkspace.tsx:2795-2802` 看到这个布尔值为真就完全不渲染已有 shots，只显示：

> 正在加载剪辑工作台…

`AnimaticPanel` 和 `PromptTablePanel` 也有同类整块 gate。于是 StoryAgent 的第一份 `storyGet` 即使已经把 37 个镜头写进 spine，只要素材、发布封面、提示词谱系或供应商状态有一项还没结束，用户仍看不到故事。

### 5. 后端重复组装同一 Story

当前最近 Story 是 `1186`，有 37 个镜头。一次刷新详情阶段会重复执行：

- 图片图：至少 3 次
  - `storyGet → composeStoryWorkspace → getStoryImageAssets`
  - 独立 `storyImages`
  - `storyMaterialState → getStoryImageAssets`
- 视频图：至少 2 次
  - 独立 `storyVideoAssets`
  - `storyMaterialState → getStoryVideoAssets`
- 提示词投影：至少 2 次
  - 独立 `promptLineage.getStoryProjection`
  - `storyMaterialState → getStoryPromptProjection`
- 发布稿状态：`publishingDraft.read` 与 `storyboardCoverReferences` 各取一次。

`storyMaterialState` 实际只用 `promptProjection.compilationHeads` 建 lookup（`server/services/storyMaterials.ts:694-718`），却先加载完整投影。

### 6. 最重的确定性热点：读取一个 Story 时复制整份提示词仓库

本地模式下：

1. `server/services/promptLineageStore.ts:786-792` 的 `loadStoryPromptAggregate()` 创建 persistent local store。
2. `createPersistentLocalPromptLineageStore()` 调 `getLocalPromptLineageState()`。
3. `server/db.ts:906-910` 对整个 `memoryState.promptLineage` 做 `structuredClone()`。
4. 创建 store 后才按 `storyId` 过滤。

当前提示词 sidecar 约 9.74MB。读取 Story 1186 的投影时，每次先复制整库；刷新路径至少执行两次。独立 `promptLineage` 响应本身约 2.09MB。

---

## 四、实测基线（2026-08-25）

全部是只读本地请求，没有调用模型、没有提交任务。

| 项目 | TTFB / 总耗时 | 响应大小 |
| --- | ---: | ---: |
| `/editing` HTML | 2.9ms / 10.9ms | 368,066B |
| 初始合批：project×2 + storyList + provider status×2 | 41ms / 41ms | 17,058B |
| `storyList`（并发探针） | 173–242ms | 12,531B |
| `storyGet(1186)` | 61–82ms TTFB / 83–104ms | 616,713B |
| `storyImages(1186)` | 76–221ms | 7,871B |
| `storyVideoAssets(1186)` | 84–225ms | 257,138B |
| `storyMaterialState(1186)` | 230–302ms TTFB / 250–321ms | 509,003B |
| `promptLineage.getStoryProjection(1186)` | 206–297ms TTFB / 221–334ms | 2,086,178B |
| 七项详情真实合批 | 223ms | 3,487,658B |

并发 curl 会竞争同一个 Node 进程，不能把单项墙钟直接相加；它们的用途是比较响应体与热点。更接近服务层的只读计时结果：

- `getStoryMaterialState`：热调用约 45–48ms；
- `getStoryPromptProjection`：热调用约 38–41ms；
- 当前 Story：79 张图片、112 个视频、37 个 range；
- 图片 availability 在现有重复路径中约检查 237 次。

### 已排除的错误方向

不是每次刷新重新解析 `.webdev/local-persist.json`：

- `server/db.ts:627-642` 用 `memoryLoaded` / `memoryLoadPromise` 保证主数据只在服务进程生命周期首次访问时加载；
- 当前主文件约 10.24MB，冷读约 21ms、JSON.parse 约 14ms；普通浏览器刷新不重启 server，不再付这笔成本；
- `.webdev/edit-snapshots-local.json` 约 34.86MB，但本刷新路径不加载它。

不要通过删除数据、清空快照、重启服务或改本地持久化格式“优化”这个问题。

---

## 五、建议实施顺序（一次只验证一个假设）

### Phase A：先让已有故事立即可见（最高优先级）

目标：StoryAgent 已恢复正确 Story 作用域后，非关键 query 不再让整个剪辑台保持 spinner。

建议：

1. 在 `CreationEditorContext` 中明确区分：
   - `initialStoryLoading`：尚无可信当前 Story 作用域／核心 Story 数据；
   - enhancement loading：素材、视频、发布封面、提示词、供应商状态仍在后台加载。
2. `isLoading`（或替代字段）只在“当前 Story 核心尚不可用”时阻止 `EditingNleWorkspace`。
3. Story 作用域是否可信，不能用 `shots.length > 0` 判断；零镜头 Story 也是已加载。应使用 `activeId` 与 spine 的 `activeStoryId` / `remoteStoryId` 是否匹配，或抽成一个可测试的纯函数。
4. timeline/material 尚未回来时，继续使用 Context 已有的 Story shots fallback 生成基础 timeline；增强数据到达后无跳错 Story、无位置回弹。
5. 素材仓库、提示词表等真正依赖增强数据的局部区域可以各自显示局部 loading，不再占用整页 loading 门。

先写失败测试证明：`promptLineage` 或 provider status 永久 pending 时，只要可信 Story scope 已恢复，`EditingNleWorkspace` 仍会渲染镜头而不是全屏 spinner。

### Phase B：删除首屏重复 `storyList` / `storyGet`

目标：每次冷刷新对最近 Story 最多一次列表网络读取、一次 Story 主体网络读取，同时保留跨端最新语义。

建议：

1. 最近故事自动打开可以复用本次页面刚取回的 `storyList`；手动刷新故事库仍允许强制 refetch。
2. `loadStory()` 继续用 `staleTime: 0` 主动获取最新 Story，这是跨端同步边界。
3. `CreationEditorContext` 的同 key `storyGet.useQuery()` 应复用刚完成的 `loadStory` 缓存，避免挂载即二次 refetch；可用窄 `staleTime` 或 `refetchOnMount: false`，但必须证明后续 invalidate／明确刷新仍能拿到更新。
4. 不要把全局 QueryClient 改成长期 stale；那会影响全应用语义。只对这两个明确的初始化 key 收窄。

测试必须断言 request/fetch 次数，而不只是最终界面内容。

### Phase C：提示词按 Story 读取，material 只取 heads

目标：单 Story 读取不再复制 9.74MB 整库；`storyMaterialState` 不再加载完整 2MB prompt projection。

建议优先设计窄读接口：

1. 本地模式新增 Story-scoped 只读选择器：先按 `storyId + userId` 从内存状态筛出 Story 相关切片，再 `structuredClone` 该切片；禁止把可变的全局内存对象直接泄露给调用方。
2. SQL/MySQL 分支继续按 `storyId + userId` 查询，行为与本地分支一致。
3. 为 `storyMaterials` 新增 `getStoryPromptCompilationHeads()`（或等价窄函数）；只返回 `stableShotId + modality + currentCompilationId` 所需字段。
4. 独立 prompt UI 若确实需要完整 Story aggregate，仍可取完整**单 Story** aggregate；不能再复制其它 Story。

测试建议：构造目标 Story + 大量无关 Story 谱系，spy `structuredClone` 的入参或测试纯选择器，断言 clone 前已排除无关 Story；另断言 `getStoryMaterialState` 只依赖 compilation heads，不调用完整 projection。

### Phase D：指标仍不达标时，才考虑 `editingBootstrap`

可选方案：新增单个 `editingBootstrap(storyId)`，一次共享读取并返回 story workspace、images、videos、material、prompt heads、publishing/cover。

这会改 API 边界和客户端查询编排，范围明显更大。**不要把它作为第一刀。** Phase A–C 后重新测：如果故事首显已达标，只保留分开的增强 query 更容易缓存、失效和局部重试。

### Phase E：最后才考虑 availability 缓存

若 profiler 仍证明图片文件状态检查是热点，再为 `resolveAssetAvailability` 加基于 URL/path + mtime/存在状态的进程缓存和失效测试。不要在没有 Phase A–C 后测量证据时先引入缓存。

---

## 六、推荐测试文件与断言

前端：

- 新建窄纯函数测试，例如 `client/src/features/creationEditor/creationEditorReadiness.test.ts`：
  - Story scope 已匹配、shots 为 0 或非 0、enhancement pending → `initialStoryLoading=false`；
  - activeId 与 spine Story 不匹配 → 仍 loading；
  - 切换期间旧 Story 数据不能算 ready。
- `client/src/features/storyAgent/StoryAgentContext.recentStoryRetry.test.tsx`：保留失败重试与 cancellation。
- `client/src/features/storyAgent/recentStoryEntry.test.ts`：保持最近 Story 选择和 zero-shot 路由语义。
- 增加冷刷新 query orchestration 测试：
  - 首批 `storyList` 已成功时自动打开不再第二次请求；
  - `loadStory` 刚成功后 `CreationEditorProvider` 不二次请求同 ID；
  - 非关键 query 延迟时镜头先可见。

服务端：

- `server/services/promptLineageStore.test.ts`：单 Story 读取在 clone 前排除无关 Story，所有权不匹配仍抛错。
- `server/services/storyMaterials.test.ts`：material 只消费 heads，时间线 `promptCompilationId` 投影结果保持不变。
- `server/routers.promptLineage.test.ts`：完整单 Story projection 的 DTO 与原语义一致，不串 Story。

基础门禁：

```bash
pnpm check
pnpm feature:validate
pnpm exec vitest run \
  client/src/features/storyAgent/recentStoryEntry.test.ts \
  client/src/features/storyAgent/StoryAgentContext.recentStoryRetry.test.tsx \
  client/src/features/creationEditor/spine-bridge.test.ts \
  server/services/promptLineageStore.test.ts \
  server/services/storyMaterials.test.ts \
  server/routers.promptLineage.test.ts
git diff --check
```

若改了 Context／页面加载门，再补跑受影响的 creation editor 与 editing workspace 测试；不要只跑新增测试。

---

## 七、真实页面与性能验收

只能在主仓库 3000 验收。建议以 Story 1186 为现有大 Story 样本，不做任何写入或生成。

至少连续完整刷新 3 次，记录中位数：

1. 从 reload 到最近 Story 标题出现；
2. 从 reload 到第一条镜头列可见；
3. 从 reload 到基础拖动／选择可交互；
4. 全部增强数据完成时间；
5. `storyList` 和 `storyGet(1186)` 的请求次数；
6. 首显前传输字节数与首显后后台字节数；
7. console error。

建议本地 warm-server 验收目标：

- 最近 Story 与第一批镜头中位数在 1 秒内可见；
- 非关键 query 人为延迟 2 秒时，镜头仍在 1 秒内出现；
- 每次刷新 `storyList` ≤ 1 次、`storyGet(1186)` ≤ 1 次；
- active details 后台加载可以继续，但不再控制全页 spinner；
- Story 1186 以外的 Story 不出现任何镜头／素材；
- 刷新中途切换 Story，迟到的 1186 响应不得切回；
- 页面 console 无新增 error。

浏览器自动化注意：本次诊断时左侧 in-app tab 显示“无法访问此站点”，且浏览器安全策略拒绝程序化 claim 本地 tab；没有绕过该限制。接手 Agent 若仍遇到同样情况，应使用获准的本地浏览器表面或请用户在可见标签操作，不能用 raw CDP／替代浏览器绕过安全策略。只读 curl 计时仍可用于服务端基线。

---

## 八、功能账本与收工

这是已有能力的性能修复，不新建功能卡：

- 最近 Story 恢复、重复请求和首显证据追加到 `recent-story-entry.history`；
- 如果修改 prompt lineage 读取，追加到 `prompt-lineage.history`；
- 如果改变 Storyboard fallback/readiness，追加到 `extracted-frame-overlay-video.history`，并明确视觉与时间线不变量未变。

完成后：

1. 更新 `docs/features/feature-ledger.json` 的证据与 history；
2. 跑 `pnpm feature:validate`；
3. 在 `docs/handoff/SESSION-BOARD.md` 销号并记录落地提交；
4. 按 `AGENTS.md` 合并回主干后立即删除功能分支和 worktree；
5. 保留 `generated-images/`、`generated-videos/` 未跟踪目录，不纳入提交。

---

## 九、不要做

- 不要用旧本地 Story 快照提前显示、然后静默覆盖成服务端版本；这会制造闪烁和跨端旧数据。
- 不要把全局 React Query `staleTime` 一刀改大。
- 不要移除 `storyId + userId` 所有权校验。
- 不要让零镜头 Story 永远处于 loading。
- 不要为了首显把 Story 1186 的素材、提示词或 timeline 写回／裁剪／清空。
- 不要把 `local-persist.json` 解析当作刷新主因。
- 不要第一步就造大型 `editingBootstrap` 或换状态管理框架。
- 不要触发图片、视频、提示词分析或任何付费生成。

---

## 十、交接结论

根因已经闭环：

> 刷新先经历 `project → storyList → storyGet` 串行恢复；Story 主体已经回到 spine 后，Creation Editor 又同时启用多个重复且体积很大的详情 query，全部经 query batch 等最慢项，并被一个十项 OR 的全页 loading 门统一挡住。后端最重的重复读还会为单 Story 两次复制整份 9.74MB 提示词仓库。

建议接手 Agent 严格按 Phase A → B → C 顺序，每一阶段单独测量。先让正确 Story 立即可见，再削掉重复工作；不要用一次大重构把“变快”与“为什么变快”混在一起。
