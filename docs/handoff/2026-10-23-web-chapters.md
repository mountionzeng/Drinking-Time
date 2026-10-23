# 交接：网页章节与排版按章存储（文档03）

> **接手时先读文末「第三轮：Codex 续做」**。前两轮记录保留用于追溯，其中旧 hook、待修错误与待确认镜像策略已被第三轮更新。禁止执行前文提到的放弃/还原命令。

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

---

# 追加：第二轮界面（未完成，中途停下）

停下原因：用户说算力不够，要求先写交接。**第二轮没有做完，也没有提交。工作树现在类型检查不通过。** 接手的人先读这一节。

## 提交状态

- 最后一次提交：`8244af5c`（第一轮，已验证）。分支 `codex/web-chapters-20261023`，之上有两个合并提交 `34c248a0`（文档05）和 `1557c476`（文档02 的测试修复）。未 push。
- 第二轮的改动全部**未提交**，`git status --short` 目前是：

```
RM client/src/features/publishingAlbum/useChapterLayoutSync.ts -> client/src/features/publishingAlbum/useChapters.ts
 M server/repositories/chapters.ts
 M server/routers.chapters.test.ts
 M server/routers/chapters.ts
 M server/services/chapterPackageService.ts
 M shared/chapterStore.test.ts
 M shared/chapterStore.ts
```

- 如果要放弃第二轮重来：`git checkout 8244af5c -- .` 之前先确认这 7 个文件里没有想留的东西。我没有执行任何还原。

## 当前验证结果（第二轮未提交状态）

- `pnpm check`：**失败，3 个错误**，都在客户端：
  - `PublishingImagePack.tsx(5)`：还在 import 旧文件名 `./useChapterLayoutSync`，该文件已改名为 `useChapters.ts`，导出也从 `useChapterLayoutSync` 改成了 `useChapters`，参数也变了。
  - `PublishingImagePack.tsx(510)`：上一条的连带错误，`document` 参数隐式 any。
  - `useChapters.ts(9)`：`Chapter` 类型的写法有误（`ReturnType<...>["data"]` 取出来是 `{}`），改成从 `RouterOutputs["chapters"]["list"][number]` 取类型即可。
- 章节路由、`chapterStore`、`stateCompatibility` 三个测试文件：35 个通过，**1 个失败**：`layout saving > layout autosaves do not fill the ten-version history`。原因是测试调用 `save` 时没传 `autosave: true`，而新逻辑只有 `autosave: true` 才不记历史。修法：测试里给那几次 `save` 加 `autosave: true`。
- `pnpm migration:verify` 和全量 `pnpm vitest run`：**第二轮之后没有重跑**。第一轮提交时的结果是 37 个迁移、最新 0036；全量 672 文件过、4 失败，5729 过、9 失败、67 跳过，9 项和基线逐项一致（`architecture-boundaries` 1、`mediaRouteAuth` 1、`sdk.session` 1、`routers.storyAgent` 6）。

## 第二轮已经写好的部分（未提交）

服务端：
- 自动保存不再占用 10 版历史。`save` 新增 `autosave` 参数，只有非自动保存的写入才把旧内容存成版本；按「保留最近 10 版」裁剪的逻辑也改成按数量而不是版本号差。
- 排版里带 `data:` 图片或超过 200 KB 时，服务端拒绝保存（`chapterLayoutProblem`，客户端同一函数提前提示）。
- 改正文时用 `realignBlockIds` 保持每行的 blockId 稳定：行内改字不换 id，中间新插入的行拿新 id，删除的行 id 作废。有 5 个测试。
- `save` 新增 `settings`（字体、纸张风格），存进章节，导出时才带得出排版外观。
- 导出 `exportPackage` 改为：排版里用编辑器自己地址（`/api/images/<文件名>`）引用的图片，由服务端从本地图库读取、必要时压成 WebP（2400 像素以内），再按包的上限（12 张、单张 2 MB、总 8 MB）筛选。读不到或超限的图片被丢掉，并在返回里给出 `droppedImages`；已存的图片读不到字节则给出 `missingImageBytes`。返回里 `images` 现在直接带 base64 字节，导入侧按 `{assetId, base64}` 接收。
- 读取和候选接口只为 `chapters/` 开头的存储键换取链接，编辑器自己的图片地址保持原样。

客户端（只改了一半）：
- `useChapters.ts`（原 `useChapterLayoutSync.ts`）已重写成管理整个故事的章节：章节列表、当前打开的章节、第 1 章跟随平台稿的正文和标题、按章节自动保存排版、冲突时暂停保存。

## 没有做的部分

1. **`PublishingImagePack.tsx` 还没改**去用新的 `useChapters`。需要：传入 `documentChapterId`（当前排版属于哪一章），章节切换时让排版跟着章节走。这里要小心：`PublishingImagePack` 的 `body` 来自平台稿，多章时第 2 章起的正文不是平台稿，不能用它生成排版的 `options.body`。
2. **所有章节界面都没有写**：章节栏（列表、新建、改名、排序、删除前确认）、每章菜单的「打包这一章」下载、导入章节包（留下成新故事 / 加入当前故事末尾，需要把图片字节一起传）、发回候选条（并排对照新旧文字和排版、采用或忽略、旧版本找回）。服务端路由都已存在并有测试，只缺界面。
3. **草稿镜像标记没有做**：设想是在章节上记一个 `draftMirror`（平台稿正文的 sha256），只有带这个标记的第 1 章才跟随平台稿，避免平台稿改动覆盖用户在章节里的单独编辑。`StoredChapterBlocks` 已加了 `draftMirror?: string` 字段，但路由还没用它。**目前 `useChapters` 里「第 1 章永远跟随平台稿」会在用户单独编辑第 1 章后被覆盖，这是个已知隐患，没处理前不要打开开关。**
4. 客户端的界面和 hook 都没有行为测试（仓库没有 testing-library）。
5. 没有做浏览器验证。工作树里不能启动服务，要等合回主 checkout 后在 3000 端口验证，验证前先问用户。

## 下一步（给接手的人）

按顺序：

1. 修 `useChapters.ts` 的类型，让 `PublishingImagePack.tsx` 改用它，`pnpm check` 通过。
2. 给自动保存的测试加 `autosave: true`，跑三个测试文件。
3. 补 `draftMirror`：`create` 时记录，`save` 改正文时更新，`useChapters` 只让带标记的第 1 章跟随平台稿。
4. 做章节栏、导出下载、导入、发回候选条，全部放在 `useChapters().enabled` 后面。
5. 重跑 `pnpm check`、`pnpm migration:verify`、全量 `pnpm vitest run`，失败项和基线 9 项逐项对上。
6. 只 stage 自己的文件，提交，不 push。

## 合并到 main 的顺序

先文档02（章节包格式），再文档05（网页登录，迁移 0035），最后本分支（迁移 0036）。迁移编号只能用 0036，不要改。本分支已经合并了 02 和 05 的提交，所以合并时不应有迁移冲突。

## 需要用户决定

- 是否给网页导入补内容检查（第一轮已列）。
- 正式库迁移 0036 何时执行（没有在任何库上执行过）。
- 平台稿生成或更新版本时「问用户目的」的交互设计。
- 第 1 章与平台稿的同步策略：我倾向「只有带镜像标记的第 1 章跟随平台稿」，用户单独编辑后即断开，需要确认。


---

# 第三轮：Codex 续做（2026-10-23）

## 交付状态与授权

- 在原工作树 `.claude/worktrees/interesting-tesla-5f271b`、原分支 `codex/web-chapters-20261023` 继续，基点 `8244af5c`。保留并承接全部第二轮改动及暂存的 hook 重命名。没有 reset、stash、clean，没有新建工作树。
- **用户在本对话明确选择「采用镜像规则（推荐）」**。镜像绑定创建时的平台稿 scope 与标题/正文指纹；仅匹配的源稿可以更新，独立改文字或标题立即断开。排序不重新指定“第一章”，切平台/版本不会把不同稿件强行写入同一章。新平台版本如何转为章节仍受下方「问目的」决定约束。
- 本轮代码和本交接同一提交，最终 SHA 见本对话交付消息及 `git log -1`。提交后工作树应为干净状态；没有 push、合 main、执行迁移、启动 dev/preview、部署、改开关或操作微信环境。
- `CHAPTER_PACKAGE_ENABLED` 保持关闭。功能卡 `story-chapters` 标记 **partial**，不是 working。

## 本轮实现与数据影响

1. **编辑入口**：保留原“平台图稿”完整路径，功能打开后另有“章节排版”。章节栏可新增、编辑标题与正文、上移下移、确认删除；第二章起明确用本章的 body，编辑会话与本机缓存按账号/故事/章/版本隔离。旧镜像章没有服务端排版时，尝试读取原 scope 的本机稿，不改 `sourceFingerprint` 算法。
2. **保存与正文唯一来源**：`useChapters` 负责读取，`ChapterSaveQueue` 串行提交防抖写入；保存中到来的编辑使用上次返回的版本号，不发送并行过期版本。切章/导出/采用前先请求编辑器完成输入再 flush；冲突与保存错误明确显示，不静默覆盖。排版持久化为 `StoredChapterLayout`，文字模块只存 blockId 绑定；读时从唯一正文恢复文字。移动模块不换 blockId，改字同步正文，删掉已绑定文字模块会删相应正文块，未编排的正文保留。多行模块按行存 blockId，导出拆为单行绑定。字体/纸张、封面/纹理/插图引用跟章保存。
3. **文件往返**：下载 `{ package, images: [{assetId, base64}] }` 文件，包本身仍遵守02契约且没有嵌入图片。导入可留下为新故事或加入当前故事末尾，多章包逐章保留。导入图片核对字节数和 SHA256。服务端读取图库图片时只接受属于当前故事的图片，必要时压缩到2400像素以内，再遵守12张/单张2MB/总8MB限制；未知或缺字节图片明确计数提示。生成图库的 AI 标记不会变成 false；已导入图片的原标记保留。
4. **发回与版本**：导入保留 root/parent lineage 与源 chapterId，另一账号再导出后仍能回到原作者的章；发回包必须对上原章。候选可并排看正文和实际绘制的排版，采用需携带**对照时**的版本号，之后有改动会拒绝；忽略与采用的状态变更有并发保护。采用与旧版本快照同事务，恢复也作为新版本。自动保存不挤占最近十版历史。
5. **导入原子性**：包内容（含多个章节）和 requestId 回执一起提交；MySQL 按账号行锁串行导入，本地用既有 aggregate lock 和回滚快照。相同请求并发重试不会新建两份故事；相同 requestId 不同有效载荷拒绝。替换了原先分开的 import receipt / candidate 写入辅助函数，未新增表或迁移编号。
6. **账本与边界**：仅工作树的账本新增一张 `story-chapters` 卡，未碰主仓未提交内容。`drizzle/schema.ts` 仅调整 JSON 列的 TypeScript 类型，SQL仍为0036。没有修改文档04、小程序、旧分享系统、`assertSpaceOwner`、重置护栏或正式平台稿生成逻辑。

## 验证证据

- 最后定向回归：**9文件 / 88项全部通过**，包含章节路由24项、章节图像字节2项、存储/绑定12项、状态兼容8项、客户端文件/队列/入口与原发布工作区回归。
- `pnpm check`：最后一次通过。
- `pnpm migration:verify`：37 migrations，最新0036_story_chapters；**这是迁移文件校验，不是数据库执行证据**。
- `pnpm feature:validate`：68张卡，通过。
- `pnpm build`：最后一次通过；保留原大 chunk 警告，未顺带改打包策略。
- `git diff --check`：通过。
- 本轮仅跑一次全量 `pnpm vitest run`：**676文件通过 / 4文件失败 / 20文件跳过；5756项通过 / 9项失败 / 67项跳过，98.60秒**。失败分布与交接中的9项已知基线一致，未重新跑干净基线。最后保存空队列/缓存格式/候选状态护栏调整及新增并发测试后，仅重跑上述9文件88项、类型与构建；未把该全量数字冒称为新增并发测试后的总数。
- 全量9项失败逐项列出：
  - `routers.storyAgent`：setCharacterAnchor toolCall 经U6持久化人物锚点；照片重绘成风格化人物图后设锚点；照片重绘失败不采用原照或无关图；多图重组按图号编辑且待归类；mobileEdit 带projectId落库；mobileInpaint 带projectId落库。
  - `mediaRouteAuth`：browser guest session（Zero-length key）。
  - `sdk.session`：local app id为空的签名会话（Zero-length key）。
  - `architecture-boundaries`：AdminUserOverview / AdminVisitsPage 的 adminUsers.overview 查询失效未带scope。
- **未做浏览器端到端、真实双账号跨端操作、一次性MySQL事务验收或正式库验证**。工作树禁止起服务，主仓3000服务的代码不是本分支，不能拿它冒充截图验收。构建并不等于浏览器通过。

## 尚未完成与开启前条件

- **网页导入审核待决定**：目前没有可复用的网页正文审核调用，本轮没有增加或绕过检查。建议开启入口前确定与小程序一致的服务端审查标准，决定处理失败/超时是保留待审还是拒绝；不要把现在“能导入”当作已完成安全审核。
- **正式0036何时执行仍待用户批准**。先在一次性MySQL库验证事务、并发导入和版本恢复，再安排正式迁移。02→05→03顺序不变，本分支已有02/05，不合主干。
- **平台稿生成/更新前问目的仍待交互决定**，本轮未改生成逻辑。可审阅建议：生成/更新确认框明确目标“继续当前平台稿 / 放入章节 / 选章节生成平台稿”；放入章节再选择新增或目标章，选章节则列可勾选章节并按章序拼稿。提交前同时显示来源与目标，避免把选章误解释为覆盖全文。现有 `composeBodyFromChapters` 可复用，无需再存一份拼接正文作为权威源。
- **内部结构仍未完全收敛到包的 blocks[]/assetId**：现在正文仍为一份按行的 body + blockIds，排版已去掉重复文字；照片保留插图锚点、blockId和caption，存储引用仍为key。没有引入旧JSON形态兼容读取器。若继续把内部形态统一成直接blocks[]，宜在0036未执行、开关未启用前做完，避免再堆一层线上兼容。本轮没有宣称完成07精简。
- 未覆盖排版的正文完整保留并导出，但自动补排，以及多行模块导出拆行后的几何一致性仍需两端联调。正文增行后若已有排版，新增未绑定行可能需用户排版；不能宣称新正文已自动显示在纸面上。
- 本机 data URL 图片阻止该章云端保存，仍保留原本机稿；没有自动上传本机图库。断网/强退、本机草稿恢复与React真实挂载切章尚无浏览器行为证据；队列单元测试不替代这些验收。
- 导入图片存储发生在数据库事务之前；DB回滚不删除已经按内容哈希写入的对象，可能留下可复用但未引用的文件。没有执行存储清理。
- 功能卡依赖已有发布模块和故事分享，02转换器为代码依赖；本工作树没有独立的 `chapter-package` 功能卡，未擅自替02补一张。

## 行为与消耗记录

|阶段|目的与影响|验证/重复工作说明|
|---|---|---|
|接手读取|读原交接、账本、00/02/03/07和现有章节代码；确认未提交内容|未新建分支/树，未重跑已知全量；早期一次文件清单搜索范围偏宽、输出有截断，随后改为定点读取。|
|已知问题与接入|修正hook类型、旧引用、autosave测试参数；接入按章渲染|首次定向发现旧采用测试没带对照版本；补参数同时新增并发冲突语义测试，没有为了通过删约束。|
|正确性补全|唯一文字引用、镜像协议、lineage、事务导入、图像字节|复用02校验/转换器与原绘制器；保留原模块编辑器，无新编辑引擎或数据表。|
|客户端工作|章节栏、导入选项、对比、恢复；串行保存队列|新增队列与文件解析纯测试、静态组件测试；未安装DOM测试库，未伪造浏览器结果。|
|核验与收尾|一次全量、定向复验、类型/构建/账本/迁移文件校验|类型检查多轮修正新增泛型与未使用声明，精确轮数未单独计量；构建2轮（第二轮因最后护栏代码变化）；不重复无关全量。|

- 新增复杂度：一个章节工作区组件、一个复用原绘制器的对比组件、一个串行保存队列、一个下载信封解析器，以及存储边界的文字绑定读写。没有新增兼容版本链、服务器进程、付费AI流水线或临时报告目录。事务写入取代分散辅助函数；原 hook 重命名接续而非并存。
- 前两轮的模型消耗未知，本轮会话模型调用次数、Token/算力用量也未知（工具未提供真实计量），不估算。子agent调用 **0**；主动真实付费AI/图像/语音生成 **0**。
- 可核实的操作时间区间：北京时间 2026-10-23 15:05:56 至 15:42:33，36分37秒；这是首次明确时间记录以后的区间，**整轮实际耗时未知**，不含之前接手读取及随后提交。全量测试98.60秒、最后定向测试1.68秒；最后前端构建4.16秒、服务端打包47ms，均以工具输出为准。

## 本轮提交文件清单

- `client/src/features/publishingAlbum/PublishingImagePack.tsx`
- `client/src/features/publishingAlbum/PublishingImagePack.test.tsx`
- `client/src/features/publishingAlbum/useChapterLayoutSync.ts（删除，承接原暂存重命名）`
- `client/src/features/publishingAlbum/useChapters.ts`
- `client/src/features/publishingAlbum/ChapterWorkspace.tsx`
- `client/src/features/publishingAlbum/ChapterWorkspace.test.tsx`
- `client/src/features/publishingAlbum/ChapterComparison.tsx`
- `client/src/features/publishingAlbum/chapterSaveQueue.ts`
- `client/src/features/publishingAlbum/chapterSaveQueue.test.ts`
- `client/src/features/publishingAlbum/chapterFile.ts`
- `client/src/features/publishingAlbum/chapterFile.test.ts`
- `server/repositories/chapters.ts`
- `server/routers/chapters.ts`
- `server/routers.chapters.test.ts`
- `server/services/chapterPackageService.ts`
- `server/services/chapterPackageService.test.ts`
- `shared/chapterStore.ts`
- `shared/chapterStore.test.ts`
- `drizzle/schema.ts`
- `docs/features/feature-ledger.json`
- `docs/handoff/2026-10-23-web-chapters.md`
