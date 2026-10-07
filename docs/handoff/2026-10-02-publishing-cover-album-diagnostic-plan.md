# 最小诊断与实现计划：发布工作台的封面入口与静态画册流程

> 状态：历史诊断记录。用户后续明确要求把画册能力搬到正文下方，已进入实现并完成首版；下文保留当时的调查背景，不再作为当前实施范围。
> **当前交付、验证与限制统一见：[文章图片制作首版](../qa/2026-10-02-publishing-image-pack.md)。继续工作直接从该文件开始，不需要再搜索聊天记录或寻找第 4 / 9 节。**
> 仓库：drinking-time-local。验收环境：main:3000，入口页面 http://localhost:3000/editing
> 当时原则：入口问题复现之前不新增按钮。该范围已由用户最新的图片制作需求取代；首版仍复用已有生成与导出能力。

## 1. 要解决的问题

- 用户反馈发布工作台改版后看不到“生成封面”入口。
- 当前源码里这个入口仍然存在，所以先把它当作复现任务处理，不当作缺失功能。
- 用户希望顺带把静态画册从建立到导出完整跑通，并且按钮尽量少、复用现有流程。

## 2. 当前代码事实

### 2.1 封面入口（源码中已存在）

`client/src/features/publishingDraft/PublishingDraftWorkspace.tsx` 和 `client/src/features/publishingAlbum/PublishingAlbumWorkspace.tsx` 里共有四处入口：

| 位置 | 入口 | 显示或禁用条件 |
|---|---|---|
| 正文操作区，约 2224 行 | “打开封面工作室”，已有轮次时为“继续选封面” | 在 `busy`、`coverBusy`、`videoBusy` 或 `dirty` 时禁用。`dirty` 表示文稿有未保存修改 |
| 正文页子导航，约 1781 行 | “正文 / 封面 / 画册” | 只在 `activeVersion.album` 存在时渲染 |
| 画册工作区页头，约 213 行 | “封面” | 画册工作区打开时始终可见 |
| 画册工作区底图区，约 273 行 | “返回封面工作室” | 当前版本还没有正式采用封面时显示 |

另外两条行为可能和“入口看不见”有关，需要在复现时确认：

- 当前版本带有画册时，会自动打开画册工作区。这时正文操作区里的封面按钮不在屏幕上，入口只剩画册页头的“封面”。
- 从画册进入封面工作室后，采用按钮的文案变为“采用并返回画册”或“使用当前封面返回画册”，采用后回到画册工作区。

### 2.2 画册流程（已实现）

- 节奏弹窗选中 `album9` 时标题为“先定一下这套画册”，确认按钮为“制作画册”。
- 点击“制作画册”后调用 `initializeAlbum`。成功后进入 `PublishingAlbumWorkspace`，提示“画册页面已建立；文字稿和视频故事板没有改变”。
- 画册工作区提供读取画册、编辑页面文字、保存排版、底图报价、确认付费后生成候选，以及显式采用候选的能力。
- 页面挂载时的恢复 effect 只用已保存的 `operationToken` 和 `taskId` 恢复同一个付费任务，不会发起新的购买，也不是自动生成。
- 导出逻辑在 `publishingAlbumExport.ts`。页面文字未保存时导出按钮禁用；某一页还没有采用底图或保存排版时，导出会报错并停止。

### 2.3 后端路由

后端路由文件是 `server/routers/publishingDraft.ts`：

| 过程 | 作用 |
|---|---|
| `readAlbum` | 读取版本画册、候选资产和封面字体标签 |
| `initializeAlbum` | 建立版本隔离的画册 |
| `updateAlbumPageText` | 更新单页文字 |
| `saveAlbumPageTypography` | 保存单页排版 |
| `quoteAlbumPageBackground` | 单页底图报价，不扣费 |
| `generateAlbumPageBackground` | 凭确认过的报价生成候选，或恢复同一任务 |
| `adoptAlbumPageBackground` | 用户显式采用某张候选 |

对应服务位于 `server/services/publishingAlbumPersistence.ts`、`server/services/publishingAlbumBackgroundPrompt.ts` 和 `server/services/publishingAlbumBackgroundGeneration.ts`。

## 3. 必须遵守的不变量

以下内容引自功能卡 `publishing-static-album`（`docs/features/feature-ledger.json`，状态为 `working`）。本次所有改动都不能违反：

1. 画册 aggregate 按发布版本隔离，不能创建或修改 Story shots、timeline、`activeVideoStoryboardVersionId` 或 `videoStoryboard`。
2. `album9` 只能进入画册 API。视频 router 只接受 `video10`、`video30` 和 `video50`。
3. 底图只继承当前版本正式采用封面的美术风格。没有正式封面时，必须在付费提交前阻止。
4. 底图像素里不能有文字。中文由产品以可编辑字体层排版，保存完整 Unicode，不截字。
5. 已受理的付费任务必须保存不可变的 `taskId`。pending、unknown 或带 `taskId` 的失败只能恢复同一任务，不能自动重复购买。
6. 生成结果先进入页面候选轮次，像素质检只标记风险。只有用户明确采用 exact `assetId` 才会改变该页底图。
7. 用户明确选择的字体始终优先，文字或底图变化不能自动覆盖已保存的 `fontId`。
8. 预览和 PNG 导出使用同一个布局计划。导出是只读操作，不改变页面 revision、采用状态或视频数据。

## 4. 诊断任务：封面入口

目标是在 main:3000 上用真实故事和发布版本确认入口到底是哪种情况，并记录触发条件。

1. 打开 `/editing`，选择一个已有发布版本、还没有画册的故事，记录正文操作区封面按钮是否可见、是否可点。
2. 在同一个故事里修改文稿但不保存，确认按钮是否因为 `dirty` 变为禁用，以及禁用时有没有可见原因。
3. 再触发一次报价、视频准备等进行中的状态，记录 `busy`、`coverBusy` 和 `videoBusy` 下的按钮状态。
4. 选择一个已建立画册的版本，确认页面是否自动跳进画册工作区，以及用户是否只看到画册页头的“封面”。
5. 从画册工作区点“返回画册”，确认正文子导航“正文 / 封面 / 画册”是否出现。
6. 切换故事和发布版本，确认入口状态是否跟随切换，没有残留上一个版本的状态。

每一步记录故事 ID、发布版本 ID、入口状态（不可见、可见但禁用，或位置变了）、触发条件和截图。

- 可见但禁用：只补充禁用原因的文案或提示，不新增按钮。
- 位置变化：优先调整现有入口的可发现性，不新增按钮。
- 确实不可见且能稳定复现：先写一个能复现的失败测试，再讨论修复。
- 复现不到：记录验证过的条件，然后关闭这个诊断项，不改代码。

## 5. 画册目标流程

每一个付费或采用动作都由用户明确触发：

1. **建立画册**：在节奏弹窗选择“静态画册·最多 9 张”，点击“制作画册”。
2. **生成并采用正式封面**：进入封面工作室，生成封面候选，再由用户明确采用。没有正式封面时，底图生成按钮保持禁用。
3. **逐页处理底图**：先报价；用户点击“确认付费生成”；生成候选；用户在候选中明确点击“采用这张”。不自动生成，也不自动采用任何候选。
4. **保存排版**：逐页编辑文字层和字体，并保存。
5. **导出**：导出本页或整册 PNG，文件名格式为 `{前缀}-{两位页码}.png`。

## 6. 本次最小改动范围

- 第 4 节的诊断有结论之前，不新增按钮，也不改界面结构。
- 不改数据模型，不改 `server/routers/publishingDraft.ts` 的接口。
- 画册流程本身已经实现。本次只验证它能按第 5 节的顺序跑通，补齐缺失的测试。
- 确实需要修复时，只修复复现到的那个条件。

## 7. 待产品决定事项

以下两项从本次最小改动中移出。产品决定之前，不设计数据模型，也不复用画册 API 实现：

1. **封面作为画册第一页并进入导出包**：待定是否需要这样做、放在第几页、导出时如何命名。当前封面不属于画册页面，画册导出不包含封面。
2. **插图生成**：待定“插图”指正文配图，还是画册页底图以外的其他图；待定是否需要独立入口、计费方式和采用规则。当前仓库没有专门的插图生成流程。

其余待定事项：

- “直接发布”的目标平台和方式。
- 导出后是否需要“复制到剪贴板”，还是只需要下载。

## 8. 测试

现有相关测试包括：

- `client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx`
- `client/src/features/publishingAlbum/PublishingAlbumWorkspace.test.tsx`
- `server/routers.publishingDraft.test.ts`
- `server/services/publishingAlbumBackgroundGeneration.test.ts`
- `server/services/publishingAlbumPersistence.test.ts`
- `shared/publishingAlbum.test.ts`
- `client/src/features/publishingAlbum/publishingAlbumExport.test.ts`

诊断复现到问题时，在 `PublishingDraftWorkspace.test.tsx` 或 `PublishingAlbumWorkspace.test.tsx` 里按实际触发条件补测试，例如 `dirty` 时封面入口禁用并显示原因，或画册版本自动打开画册工作区后页头“封面”仍然可达。

运行命令：

```sh
pnpm vitest run client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx client/src/features/publishingAlbum server/routers.publishingDraft.test.ts server/services/publishingAlbumPersistence.test.ts server/services/publishingAlbumBackgroundGeneration.test.ts shared/publishingAlbum.test.ts
pnpm check
pnpm build
```

## 9. main:3000 非付费验收步骤

全程不点击“确认付费生成”，也不在封面工作室发起新的付费轮次。浏览器网络面板里不能出现新的 `generateAlbumPageBackground` 提交，也不能出现封面生成提交。

1. 打开 `/editing`，选择一个已有正式封面的真实故事，并选择它的发布版本。
2. 按第 4 节逐项记录封面入口的状态。
3. 在节奏弹窗选择“静态画册”，点击“制作画册”，确认进入画册工作区。
4. 确认页面提示视频故事板和剪辑台没有改变。
5. 选择一个没有正式封面的版本，确认生成底图按钮禁用，并显示“返回封面工作室”。
6. 点击画册页头的“封面”进入封面工作室。用“使用当前封面返回画册”或采用已有候选的方式回到画册，不发起新的生成。
7. 对一页点击报价，确认报价卡显示候选数量和预计金额，以及“候选不会自动采用”。然后取消，不确认付费。
8. 已有候选时，点击“采用这张”，确认只有这一页的底图变化，并显示“已采用”。
9. 编辑文字，进入排版，保存，然后刷新页面，确认文字和字体都被恢复。
10. 导出本页和整册，确认 PNG 按页码命名。导出前后页面 revision 和采用状态不变。
11. 检查浏览器控制台，确认没有报错。

## 10. 最小文件改动清单

诊断前不改任何代码文件。诊断复现到问题后，只按结论改以下文件：

| 文件 | 条件 | 改动 |
|---|---|---|
| `client/src/features/publishingDraft/PublishingDraftWorkspace.tsx` | 入口可见但禁用，或者被自动打开的画册工作区挡住 | 补充禁用原因，或调整现有入口的可发现性，不新增按钮 |
| `client/src/features/publishingAlbum/PublishingAlbumWorkspace.tsx` | 画册页头入口存在可达性问题 | 调整现有“封面”入口，不新增按钮 |
| 对应的 `*.test.tsx` | 任何代码改动 | 先补能复现问题的失败测试，再修复 |
| `docs/features/feature-ledger.json` | 有代码改动并完成验收 | 在 `publishing-static-album` 的 history 中追加修复和验收记录 |

不改动的文件：

- `server/routers/publishingDraft.ts`
- `shared/publishingAlbum.ts`
- 画册相关的后端服务

## 11. 2026-10-02 非付费诊断记录

在 main:3000 完成以下观察，未点击任何生成、付费确认或采用操作：

- 当前发布版本带有静态画册时，页面默认显示画册工作区；画册子导航中的“封面”入口可见。
- 当前版本没有正式采用封面时，页面显示“采用封面后才能生成继承其风格的底图”，且“生成底图”按钮禁用，同时提供“返回封面工作室”入口。
- 点击画册子导航的“封面”可打开封面工作室。工作室展示既有候选轮次、每轮四张候选、生成费用，以及“只有点击采用这张后才会成为正式封面”的说明。
- 关闭封面工作室后回到正文工作区；“继续选封面”按钮仍然可见且可用。

结论：本次未复现“封面入口消失”。当前最小范围内没有需要修复的代码。若用户后续提供稳定的不可见或禁用场景，先以该场景补充失败测试，再做针对性修复。

环境备注：`pnpm env:status` 报告主仓同时存在 3000 和 4321 两个服务进程；本次浏览器验收实际使用 3000。未停止任何已有服务。
