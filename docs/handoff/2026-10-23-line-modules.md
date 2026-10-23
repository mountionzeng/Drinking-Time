# 交接：一行一个模块与当前行对话上下文（网页侧）

日期：2026-10-23。分支 `codex/line-modules-20261023`，基于文档 02 的 `6634063d`，已合入 `55c07c5a`。未 push，未部署。

## 做了什么

- `shared/lineModules.ts`：纯函数，不碰存储和网络。
  - `splitLines`：按单个换行拆，空行不算模块。
  - `reconcileLines`：编辑后对账 id。行内改字 id 不变，新行拿新 id，删掉的行 id 作废，粘贴多行拆成多个模块。
  - `locateLine`：光标落在第几个非空行，空行归上一行。
  - `linePosition`：生成当前位置对象 `{chapterId, blockId, index, total, prevText, text, nextText}`。
  - `trimLineContext`：按「当前行、邻近各 2 行、本章、全书目录」的顺序按字数裁剪。
- `server/services/writingCompanion.ts`：新增 `lineContextMessage`。开关打开时，在原有伴写上下文后追加「用户当前停在第几行」的引用材料，并要求先问方向或给两三条思路，用户回应后才给改写。选区改写场景也会多一段引用，选区之外必须逐字保留的规则没改。
- `server/_core/env.ts`：新增 `LINE_CONTEXT_CHAT_ENABLED`。
- 没有新按钮，没有新路由，没有新模型通道。当前行只在用户发起聊天时随请求带上，行的变化本身不产生任何请求。计费沿用现有伴写路径。
- 共用样例：`tests/fixtures/line-modules/cases.json` 与 `SHA256SUMS`，小程序仓库放同一份。

## 开关

`LINE_CONTEXT_CHAT_ENABLED` 默认关闭，只有环境变量等于 `true` 才打开。关闭时伴写请求与改动前完全一致。

## 测试

- `shared/lineModules.test.ts`、`server/services/lineContext.test.ts`：新增，全部通过，不调模型。
- `pnpm check`（即 `tsc --noEmit`）通过。
- 全量 vitest：9 项失败，分布在 4 个文件，670 个文件和 5706 项通过。数量与协调会话给的基线一致。这 4 个文件不在本次改动里，我没有拿合并前结果逐项比对。

| 文件 | 失败数 |
| --- | --- |
| `server/routers.storyAgent.test.ts` | 6 |
| `client/src/architecture-boundaries.test.ts` | 1 |
| `server/_core/mediaRouteAuth.test.ts` | 1 |
| `server/_core/sdk.session.test.ts` | 1 |

## 没做的事

- 网页排版里点选模块时，没有产生当前行对象，也没有接 `moduleCompanionContext`。
- 手机正文入口 `MobileSyncedEditor.tsx` 没有接。它走的聊天路径是否与电脑端相同，我没有核实。
- 电脑端正文入口 `publishing-body` 没有改客户端，依赖现有快照里的全文和光标。
- 行 id 对账只写了纯函数和测试，没有接进存储。章节存储属于文档 03。
- 没有真机验证，没有真实模型调用，聊天里是否真的先问方向取决于模型，未验证。
- 没有更新 `docs/features/feature-ledger.json`，按协调会话要求本轮不碰。需要时由后续会话补 `writing-companion` 和 `publishing-module-chat-context` 的 history。

## 需要用户决定

- 开关何时打开，以及打开前是否要先用真实模型试几轮「先问方向」的效果。
- 网页排版点选模块和手机正文入口是否接当前行。

## 与其他文档的重叠

`shared/chapterPackage.ts` 只读，未改。`imagePackModules.ts` 未改。
