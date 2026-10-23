# 交接：文档08 当前行上下文（网页续补）

更新：2026-10-23。工作树 `.claude/worktrees/frosty-gauss-191f36`，分支 `codex/line-modules-20261023`。接手基线 `c3a3b874`，本次为其本地续补，未合 main、未 push、未部署。

## 当前结论

本地上下文接线已补齐并做行为验证；**章节存储整合、真实浏览器/真机、真实模型和开关开启尚未完成**。`LINE_CONTEXT_CHAT_ENABLED` 仍默认关闭。以下是当前交接，替代旧文档中“网页模块和手机入口要重新问是否接”的待办；这些入口属于已授权08范围。

## 修改与复用

- `moduleCompanionContext.ts`：原模块讨论快照增加 `line`，内含轻量位置 `{chapterId, blockId, index, total, prevText, text, nextText}` 和有界文字摘录。图片和封面标题不冒充正文行；重复文字按模块身份识别；输入中的多行只有可靠光标时定位。
- `ImagePackModuleEditor.tsx` / `MobileModuleTools.tsx`：沿用模块点选及原生选区事件，把当前输入和光标接入已有 `ModuleCompanionContext`。取消、删除、换页、来源失效仍沿用原清理机制，无新按钮或模型请求。
- `MobileSyncedEditor.tsx` → `mobileMemoryFollowup.ts`：用户点现有“小忆”时保存实际 textarea 光标与选区，原聊天不再把当前行强制当作全文末尾。
- 电脑 `publishing-body` **没有另加正文状态或生产代码**。组件行为测试已验证现有 `getSnapshot()` 读取未保存全文、最新 selectionStart/End；既有聊天发送取这份快照，足够推导当前行。全文仍只有原编辑缓冲作为来源。
- `writingCompanion.ts`：补排版聊天独立分支的当前行说明，开关打开时先问方向或给两三条思路；开关关时保留既有提示。正文选区优先按 selection.start 定位。原计费、归属校验、显式候选/保存、选区外机械保留和冲突保护未改。
- 两端同源 `lineModules.ts`：修正 CRLF 原始光标偏移、拒绝越界/非整数位置、限制超长当前行，文本摘录复用 `trimLineContext`。共享样例覆盖重复行与CRLF；未修改 id 对账算法、章节包格式版本或任何存储。

## 03 的精确接入点

`ImagePackModuleEditor` 新增可选参数 `lineSource: ModuleLineSource`，类型在 `moduleCompanionContext.ts`：

```ts
{
  chapterId: string;
  blocks: readonly { id: string; text: string }[];
  moduleBlockIds: Readonly<Record<string, string>>;
  titles?: readonly string[];
}
```

在 03 所有的 `PublishingImagePack` 章节调用点传入：当前章节正文文本块按权威阅读顺序投影为 `{id: blockId, text}`；模块 id→正文 blockId 从 layout 的 `bind.blockId` 取；目录来自已有章节标题。同一块换页时仍按章节正文顺序定位。08 未修改 `PublishingImagePack` 或 `useChapters`，未到 03 工作树改文件。

没有 `lineSource` 的旧排版只按当前排版页/模块顺序给讨论快照，标记 `source: layout`；`scope` 与 `moduleId:line:N` 是临时身份，**不能当作持久 blockId**。有章节源但绑定缺失、输入中一块包含多行时保守省略行信息，等03拆行/保存后恢复；不由08推测或写第二份正文。稳定id对账、保存、改字后引用排版仍由03负责。

没有新增300ms轮询器：网页复用既有正文快照与选择事件；发送时取得最新快照。原需求中“行变化防抖300ms”的独立持久位置状态没有另做，也不把临时排版顺序称为整本书的权威位置。

## 验证证据

- 最终 `pnpm check` 通过；`pnpm feature:validate` 通过，67张卡。已更新 `writing-companion` 和 `publishing-module-chat-context` 的 history、权威代码/证据与缺口，既有 working 指既有能力，不表示开关关闭的新当前行功能已上线。
- 末次成组定向117项：共享规则、模块快照、真实组件事件接线、手机聊天、电脑正文快照、队列冻结、服务端提示与选区/确认保护。模拟模型每次发送只走一次既有调用，打开/定位不发调用。
- 本轮全量5719通过、9失败。原提交临时归档重跑同四文件，**9项全名及首段错误完全一致**：

| 文件 | 数量 | 原基线失败内容 |
| --- | --- | --- |
| `server/routers.storyAgent.test.ts` | 6 | setCharacterAnchor持久化、照片重绘设锚点、重绘失败回退、多图重组、mobileImageToImage和mobileInpaint的项目归属断言 |
| `client/src/architecture-boundaries.test.ts` | 1 | 未限定scope的query invalidate（原有2处） |
| `server/_core/mediaRouteAuth.test.ts` | 1 | guest session零长度签名key |
| `server/_core/sdk.session.test.ts` | 1 | guest session零长度签名key |

原交接仅比数量，本次已补逐项比对；没有扩展修改这些无关基线问题。最后formatter复用调整后只跑受影响的117项与类型检查，未声称第二次全量通过。

- 两端共享源码 SHA256：`cceca4fcd8f0d9b029953b048d4d388d7e2ab9ef1c408d5c2996029d84653b50`。
- 同源样例 SHA256：`56bdca0e15b96118da95944c50c9b3f983f3a5219f354b04de1693b31471815c`，两份 `SHA256SUMS` 逐字一致。

- 15:42 最后边界检查：最长200字符旧模块id加行后缀后仍可通过讨论快照schema，blockId引用字段上限设256；相应模块上下文9项定向通过，未重复全量。

## 待整合/验收

1. 03传入上述章节适配参数，并负责行块持久化和新增多行的排版保存；按来源切换重置编辑器，不跨章节复用旧选择。
2. 合法主仓3000环境中验证电脑和手机网页实际点选、编辑、聊天、候选确认/冲突；当前没有运行服务，未以组件测试冒充浏览器验收。
3. 有效费用授权后验证真实模型“先问方向→用户回应→给候选”；开关变更要单独授权。本轮不请求重复部署或自动开启。
4. 03/04合入后由统一整合任务核对跨端内容与id，不互相合未提交内容。

## 验收与授权边界

- 本轮真实文字/图片/语音模型调用 **0**；云函数部署、数据库迁移、开关变更、push、合 main、出码、共享开发者工具操作均 **0**。父任务关闭的 AI 授权没有复用。
- 保留 `sourceFingerprint` 算法、`assertSpaceOwner` 调用、重置护栏和内容安全。03/04 的工作树、父任务整合分支、网页主仓未提交改动、资质目录均未修改。未发送其他对话消息。
- 用户原有正文与历史未用于测试、未写入业务数据；网页测试使用仓库自带临时持久化隔离。网页 env:status 显示没有 dev server；未在工作树启动服务。
- 本地模拟/组件测试证明的是接线与拒绝迟到数据等行为，不等于页面在真实浏览器或微信开发者工具运行通过，更不等于真实模型按当前行先问方向。共享开发者工具仍归父任务，最后验证需明确交接及有效 AI 授权。
- 按 layout 渲染阅读页和分享图：04 原需求第 4 项明确承担。04 旧交接转给 08 与原分工不一致，推荐由 04 完成，或由协调任务明确另行归属。08 本轮未扩展成排版渲染引擎。

## 本轮持续操作记录（北京时间）

| 时间/阶段 | 目的与动作 | 验证/成本 |
| --- | --- | --- |
| 15:16 开工核对 | 两棵 08 树分别在 c3a3b874 / c869adf，均干净；读适用规则、00/02/03/04/08、交接、账本及父任务行为记录 | 网页主仓有他人修改，只读。小程序 workspace:check exit 1 表示相对 9 月记录云快照的差异，不代表实时云端失败 |
| 15:19–15:31 接线与行为验证 | 修复手机光标、模块聊天分支和小程序异步选区；复用既有聊天与数据契约 | 只运行定向测试；一项旧测试由同步读取改为等待真实异步处理，原“待确认→接受”断言保留 |
| 15:33–15:35 一次全量检查 | 网页 5719 通过、9 失败；小程序 1400 通过 | 网页测试阶段 98.23 秒；小程序测试阶段 8.12 秒。类型检查耗时未单独计量 |
| 15:35 基线核对 | 从 c3a3b874 git archive 导出临时源码，仅重跑原失败的四个文件 | 81 通过、9 失败，2.83 秒；9 项名称和首段失败信息逐一与本轮相同。没有重跑第二遍网页全量 |
| 15:36–15:38 最后自查修补 | 原生 API 抛错降级、捕获之后又编辑则清掉旧行；文本摘录复用原 trimLineContext，避免第二套裁剪规则 | 最终两端类型检查通过；网页 9 文件117项通过（2.91秒），小程序4文件189项通过（0.76秒）。针对新增修补验证，没有重复整仓测试 |

首个可读计时点 15:16:13 至最后定向结果 15:38:43，为 22 分 30 秒（不包含此后的交接/提交整理）。未取得精确工具总调用数、模型 token 或货币账单，不估算；测试中的模拟调用不计真实模型费用。

## 本轮待暂存文件清单

只包含本工作树本轮修改：

- `client/src/features/mobileWorkspace/MobileMemoryFollowupChat.test.tsx`
- `client/src/features/mobileWorkspace/MobileSyncedEditor.tsx`
- `client/src/features/mobileWorkspace/mobileMemoryFollowup.ts`
- `client/src/features/publishingAlbum/ImagePackModuleEditor.tsx`
- `client/src/features/publishingAlbum/MobileModuleTools.tsx`
- `client/src/features/publishingAlbum/lineContextEntrypoints.test.tsx`
- `client/src/features/publishingAlbum/moduleCompanionContext.test.ts`
- `client/src/features/publishingAlbum/moduleCompanionContext.ts`
- `client/src/features/publishingDraft/PublishingDraftWorkspace.test.tsx`
- `client/src/features/storyAgent/desktopChatQueue.test.ts`
- `docs/features/feature-ledger.json`
- `docs/handoff/2026-10-23-line-modules.md`
- `server/services/lineContext.test.ts`
- `server/services/writingCompanion.ts`
- `shared/layoutModuleContext.ts`
- `shared/lineModules.ts`
- `tests/fixtures/line-modules/SHA256SUMS`
- `tests/fixtures/line-modules/cases.json`
