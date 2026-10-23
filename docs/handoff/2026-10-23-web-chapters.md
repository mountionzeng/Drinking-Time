# 交接：网页章节与排版按章存储（文档03）

日期：2026-10-23。分支：`codex/web-chapters-20261023`，基于文档02 的网页提交 6634063d，之后合并了文档05（6503a5ae）和文档02 的测试修复（55c07c5a）。未 push，未合并 main，未部署。

## 做成了什么

- **存储。** 新增 5 张表，章节内容不放进 `stories.body`：
  - `story_chapters`：标题、正文块、排版、版本号。
  - `story_chapter_versions`：旧版本，每章保留最近 10 版。
  - `chapter_exports`：本人发出过的包，用来识别发回。
  - `chapter_imports`：导入回执，`(userId, requestId)` 唯一。
  - `chapter_return_candidates`：发回的候选。
- **迁移。** `drizzle/0036_story_chapters.sql`，快照 `0036_snapshot.json` 由 drizzle-kit 基于文档05 的 0035 快照生成。**只生成了文件，没有在任何库上执行。** 正式库迁移需要用户批准。
- **路由 `chapters`**（`server/routers/chapters.ts`）：`enabled`、`list`、`get`、`create`、`save`、`reorder`、`remove`、`versions`、`restoreVersion`、`exportPackage`、`importPackage`、`candidates`、`resolveCandidate`。
  - `save` 带 `expectedVersion`，不一致返回冲突，不静默覆盖。
  - 导入有 `keep`（新故事）和 `append`（加到某故事末尾）两种方式，`requestId` 防重复，每账号每小时 20 次（`consumePersistentRateLimit`）。
  - 发回判断：包的 `lineage.rootPackageId` 命中本人 `chapter_exports` 时，不新建故事，挂为该章节的候选。采用候选会写新版本，旧版本可用 `restoreVersion` 找回；忽略只改状态。
- **图片。** 导入时校验字节数和 sha256，再用 `storagePut` 存到 `chapters/<userId>/<sha256>.<ext>`。表里只存存储键，读取时才换成链接，不存带签名的临时地址，不存 data URL。导入时没有传字节的图片会被丢弃，并在结果的 `missingImages` 里返回数量。
- **拼稿。** `shared/chapterStore.ts` 的 `composeBodyFromChapters(chapters, pickedIds)`：按章节顺序、一行一块，把选定章节拼成正文。纯函数，有测试。
- **编辑器接入。** `useChapterLayoutSync.ts` 加 `PublishingImagePack.tsx` 的 8 行。开关打开后：
  - 老故事首次打开时，用当前正文建第 1 章；
  - 本机没有排版时，读取服务器上的排版；
  - 排版变化后防抖 1.5 秒保存，带版本号；
  - 版本冲突时停止保存并提示刷新。
  - `localStorage` 仍是离线缓存。
- **开关。** `CHAPTER_PACKAGE_ENABLED`，按仓库惯例在使用处读 `process.env.CHAPTER_PACKAGE_ENABLED === "true"`。路由层：关闭时除 `enabled` 外全部拒绝。界面层：关闭时 hook 不做任何事。默认关闭。

## 章节与平台稿的关系

用户的回答：没想好固定的上下级，由每次生成的目的决定。两个方向都要：

1. 平台稿 → 章节：在已有平台稿基础上增加章节。老故事首次打开章节时用当前平台稿生成第 1 章，之后可继续加章。
2. 章节 → 平台稿：选定几章生成一篇平台稿。数据层已有 `composeBodyFromChapters`。

**「问用户目的」这一步在两个方向上都还没做**，平台稿生成逻辑也没改。后续在生成或更新版本时要先问目的，再决定走哪个方向。

## 改动文件

新增：`drizzle/0036_story_chapters.sql`、`drizzle/meta/0036_snapshot.json`、`server/repositories/chapters.ts`、`server/routers/chapters.ts`、`server/services/chapterPackageService.ts`、`shared/chapterStore.ts`、`shared/chapterStore.test.ts`、`server/routers.chapters.test.ts`、`client/src/features/publishingAlbum/useChapterLayoutSync.ts`。

修改：`drizzle/schema.ts`、`drizzle/meta/_journal.json`、`server/repositories/runtime.ts`（本地状态加 5 个集合和 3 个计数器）、`server/routers/index.ts`（注册一行）、`server/repositories/stateCompatibility.test.ts`（补新集合清单）、`PublishingImagePack.tsx`、`PublishingImagePack.test.tsx` 与 `PublishingDraftWorkspace.test.tsx`（trpc 模拟补 `chapters`）。

## 验证

- `pnpm check`：通过。
- `pnpm migration:verify`：37 个迁移，最新 0036_story_chapters。
- 章节路由 15 个、拼稿 3 个、`stateCompatibility` 8 个测试全部通过。
- 全量 `pnpm vitest run`：672 个文件通过、4 个失败；5729 个测试通过、9 个失败、67 个跳过。这 9 个失败在干净基线上同样存在，与本次改动无关：`architecture-boundaries` 1 个（`AdminUserOverview`、`AdminVisitsPage` 的查询失效范围）、`mediaRouteAuth` 1 个、`sdk.session` 1 个、`routers.storyAgent` 6 个。
- 没有在工作树里启动任何服务。网页界面的实际效果未做浏览器验证，要在合并回主 checkout 后到 3000 端口验证，验证前先问用户。

## 风险与限制

- **网页导入的文字没有经过内容检查。** 网页服务端目前没有针对用户文字的内容安全检查（没找到 `msgSecCheck` 或同类调用，`storyContextShare` 也没有）。从小程序导入网页的内容不会被检查。是否补，由用户决定。小程序一侧的检查由文档04 负责。
- **`useChapterLayoutSync` 没有行为测试。** 仓库没有 testing-library，客户端测试只做静态渲染，防抖保存和冲突提示没有被自动测试覆盖。服务端的版本冲突有路由测试。
- **目前只同步故事的第 1 章。** 章节栏、多章切换、导出导入入口、发回候选界面属于下一轮，见下。
- 导入时前端必须把图片字节一起传上来，否则包里的图片会被丢弃。
- 与文档08 的重叠文件：`PublishingImagePack.tsx`。`ImagePackModuleEditor.tsx` 本轮未改。

## 需要建功能卡

`docs/features/feature-ledger.json` 根目录有别人的未提交改动，本轮没动。请合并后建一张卡：

- 名称：章节与排版按章存储（`story-chapters`）。
- 状态：不要标 `working`。界面入口和 hook 的行为测试都还没有。
- 权威代码：`server/routers/chapters.ts`、`server/repositories/chapters.ts`、`shared/chapterStore.ts`、`client/src/features/publishingAlbum/useChapterLayoutSync.ts`。
- 测试证据：`server/routers.chapters.test.ts`、`shared/chapterStore.test.ts`。
- 依赖：`chapter-package`（文档02）、`publishing-image-modules`、`story-context-sharing`。
- 约束：不删 `storyContextShare` 和 `artworkShare`（那是文档07 的事）；章节内容不得写入 `stories.body`。
- 缺口：内容检查、多章界面、hook 测试、平台稿「问用户目的」。
- 建卡后运行 `pnpm feature:validate`。

## 需要用户决定

- 是否给网页导入补内容检查。
- 正式库迁移 0036 何时执行（本轮没有执行，也没有在任何库上验证过）。
- 平台稿生成或更新版本时「问用户目的」的交互怎么设计。
