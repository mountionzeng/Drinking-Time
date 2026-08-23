# `**/*.test.ts` 排除在类型检查之外 —— 摸底报告（2026-08-24）

> 探测者：tsconfig 类型检查线（由架构收敛线开卡）。
> 本次**没有改动 `tsconfig.json`**，全部结论来自临时探针配置（跑完即删）。
> 需要用户拍板：分批修 / 上棘轮 / 维持现状。

## 一句话结论

移除 `**/*.test.ts` 这条 exclude，会冒出 **251 个既有类型错误**；
其中 **43 个只是因为主 `tsconfig.json` 忘了写 `target`**（默认退到 ES5），
补上 `target` 后剩 **208 个，集中在 58 个测试文件**（全库共 298 个 `.test.ts`，
即 **240 个测试文件本来就是干净的**）。

**208 个不算「数量可控」，因此按约定不擅自动手，交回用户决定。**

关键的一点：**208 个错误全部落在测试文件自己身上，生产代码零错误。**
也就是说这条 exclude 没有在掩盖任何生产侧的类型问题，
它掩盖的是「测试自己写错了 / 测试跟着类型漂移了」。

---

## 一、这条 exclude 当初为什么在？——查清了：没有原因

`git log --follow -- tsconfig.json` 一共只有三次改动：

| 提交 | 时间 | 对 exclude 做了什么 |
| --- | --- | --- |
| `31793ad` | 2026-05-12 | **仓库的初始提交**，exclude 就是现在这行 |
| `e3348de` | 2026-07-26 | 只加了 `noUnusedLocals` / `noUnusedParameters`，没碰 exclude |
| `fda9ffb` | 2026-08-02 | 只往 include 里加了 `evals/**/*`，没碰 exclude |

`git blame` 显示这一行是 `^31793ad`（boundary commit，即根提交）。
换句话说，**它是随脚手架一起进来的模板默认值，不是为了绕开某个真实类型问题而加的**。

配套证据：这份 tsconfig 的形状（`client/src` + `shared` + `server`、
`allowImportingTsExtensions`、`moduleResolution: "bundler"`）是 Replit React+Express
模板的标准产物，该模板的 exclude 原样就是
`["node_modules", "build", "dist", "**/*.test.ts"]`。
`client/src/archive` 是后来手工补上去的第五项。

**结论：删掉它不会踩到任何有意为之的历史决定。**

---

## 二、口径不一致的实际后果

- `**/*.test.ts` 被排除 → **298 个** `.test.ts` 从不参与 `tsc --noEmit`
- `**/*.test.tsx` 没被排除 → **42 个** `.test.tsx` 一直在参与

同一批测试，扩展名不同待遇就不同，纯属模板默认值的副作用。

顺带一提：架构棘轮本体 `client/src/architecture-boundaries.test.ts`（U1 刚落地）
自己也是 `.test.ts`，**因此它也不在类型检查范围内**。

---

## 三、三组实测数据

在提交 `ddfb6d0` 上用三份临时探针配置测得。探针都把 `tsBuildInfoFile` 指向仓库外，
不污染共享的增量缓存；`tsconfig.json` 全程未改；探针文件写进 `.git/info/exclude`，
避免被别的会话 `git add -A` 顺走，测完已删除。

| # | 配置 | 错误数 |
| --- | --- | --- |
| A | 现状（= 今天的 `pnpm check`） | **0**，绿 |
| B | 仅移除 `**/*.test.ts` | **251** |
| C | 移除 exclude **且**补 `"target": "ES2022"` | **208**（58 个文件） |

### 关于 B → C 少掉的那 43 个

主 `tsconfig.json` **没有写 `target`**，TypeScript 因此默认按 **ES5** 判定，于是：

- `TS1378` 顶层 await 不允许 —— 35 个
- `TS2802` 迭代 Set/Map 需要 `downlevelIteration` —— 8 个

而实际运行环境是 **Node 24**，构建走 vite/esbuild，
**隔壁 `tsconfig.node.json` 自己就写着 `"target": "ES2022"`**。
所以这 43 个是配置漏写造成的假报，不是真问题。

补 `target` **不属于放宽严格度**：它不关闭任何 `strict` 家族的检查，
只是把类型检查的语言级别对齐到真实运行时。这是一个独立于本次 exclude 的既有配置缺陷，
生产代码碰巧没踩到（没在顶层 await、没直接迭代 Set），所以一直没暴露。
**建议把「补 target」跟「删 exclude」拆成两个独立决定。**

---

## 四、208 个错误的分类

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 机械可修 | **92** | `TS2352` 桩对象 `as Response`（改成 `as unknown as`，18 个）、`TS2493` `mock.calls[0][n]` 越界索引（41 个）、可能为 undefined 需要断言（28 个）、其他 5 个 |
| 夹具形状不匹配 | **96** | `TS2322` / `TS2345` / `TS2739` / `TS2741` / `TS2353` / `TS2769`：测试里手写的 fixture 缺字段或字面量收窄不对。要逐个读类型，最费时 |
| **真·陈旧信号** | **20** | 见下一节。这才是这次的价值所在 |

### 分布是长尾，但有明显头部

前 5 个文件占 82 个（39%），前 12 个文件占 137 个（66%）：

| 文件 | 错误数 |
| --- | --- |
| `server/services/visualAssetCreation.test.ts` | 26 |
| `server/routers.storyAgent.test.ts` | 22 |
| `server/routers.publishingDraft.test.ts` | 13 |
| `server/services/storyMaterials.test.ts` | 12 |
| `server/services/creationAgent.test.ts` | 9 |
| `server/services/visualAssetBoardStructure.test.ts` | 8 |
| `server/services/emotionDailyReference302.test.ts` | 8 |
| `server/services/visionChannel.test.ts` | 7 |
| `server/services/publishingVideoStoryboard.test.ts` | 7 |
| `server/_core/context.test.ts` | 6 |
| `server/routers.storyConversation.test.ts` | 5 |
| `client/src/features/creationEditor/imageClipEditorModel.test.ts` | 5 |

---

## 五、20 个真·陈旧信号（建议无论选哪个方案都先修掉）

这些是「只有跑到那个具体测试才会炸」的那一类，正是开卡的动机：

```
client/src/features/creationEditor/rerender.test.ts(117,37): error TS2304: Cannot find name 'GenerateForMobileResult'.
client/src/features/storyAgent/views/StoryCardsBoard.intent.test.ts(1055,23): error TS2304: Cannot find name 'StoryShot'.
evals/recurringEditAnalysis.test.ts(125,34): error TS2339: Property 'shots' does not exist on type '{}'.
server/routers.publishingDraft.test.ts(367,12): error TS2339: Property 'activeVideoStoryboardVersionId' does not exist on type '{ revision: number; containerRevision: number; activeVersionId: string; core: null; drafts: {}; versions: { versionId: string; sequence: number; displayName: string; parentId: null; versionRevision: number; ... 7 more ...; conversationSnapshot: null; }[]; ... 5 more ...; updatedAt: number; }'.
server/routers.publishingDraft.test.ts(698,30): error TS2339: Property 'operation' does not exist on type 'PublishingDraftState'.
server/routers.publishingDraft.test.ts(1969,22): error TS2339: Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; coverAsset: PublishingCoverAsset | null; } | { ...; } | { ...; }'.
server/routers.publishingDraft.test.ts(2046,19): error TS2339: Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; coverAsset: PublishingCoverAsset | null; } | { ...; } | { ...; }'.
server/routers.publishingDraft.test.ts(2049,19): error TS2339: Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; coverAsset: PublishingCoverAsset | null; } | { ...; } | { ...; }'.
server/routers.publishingDraft.test.ts(2109,19): error TS2339: Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; coverAsset: PublishingCoverAsset | null; } | { ...; } | { ...; }'.
server/routers.shot.test.ts(11,8): error TS2459: Module '"./db"' declares 'InsertShot' locally, but it is not exported.
server/routers.storyAgent.test.ts(195,21): error TS2339: Property 'proposal' does not exist on type 'StoryIntentResult | { proposal: { id: string; status: "pending"; source: { storyId: number; versionId: string | null; intentRevision: number; kind: "recognition"; }; evidence: string[]; }; ... 15 more ...; modelLabel: string; }'.
server/routers.storyAgent.test.ts(195,47): error TS2339: Property 'proposal' does not exist on type 'StoryIntentResult | { proposal: { id: string; status: "pending"; source: { storyId: number; versionId: string | null; intentRevision: number; kind: "recognition"; }; evidence: string[]; }; ... 15 more ...; modelLabel: string; }'.
server/routers.storyShotFields.test.ts(374,65): error TS2339: Property 'body' does not exist on type 'never'.
server/services/imageAssets.test.ts(14,3): error TS2719: Type '{ id: number; storyId: number | null; createdAt: Date; imageUrl: string; prompt: string | null; userId: number | null; projectId: number | null; shotNo: string | null; shotIdentity: string | null; ... 5 more ...; maskKey: string | null; }' is not assignable to type '{ id: number; storyId: number | null; createdAt: Date; imageUrl: string; prompt: string | null; userId: number | null; projectId: number | null; shotNo: string | null; shotIdentity: string | null; ... 5 more ...; maskKey: string | null; }'. Two different types with this name exist, but they are unrelated.
server/services/publishingVideoStoryboardPersistence.test.ts(474,47): error TS2339: Property 'sourceParagraphIds' does not exist on type '{}'.
server/services/publishingVideoStoryboardPersistence.test.ts(533,29): error TS2339: Property 'sourceParagraphIds' does not exist on type '{}'.
server/services/storyVoice302.test.ts(33,67): error TS2339: Property 'body' does not exist on type 'never'.
server/services/videoConform.test.ts(26,41): error TS2749: 'EventEmitter' refers to a value, but is being used as a type here. Did you mean 'typeof EventEmitter'?
server/services/videoConform.test.ts(383,7): error TS2698: Spread types may only be created from object types.
server/services/videoTransition302.test.ts(379,29): error TS2558: Expected 0 type arguments, but got 1.
```

其中最能说明问题的一条：

```
server/routers.shot.test.ts(11,8): TS2459
  Module '"./db"' declares 'InsertShot' locally, but it is not exported.
```

**已人工核实属实**：`server/db.ts:37` 把 `InsertShot` import 进来自用，
但从未 `export`；而 `server/routers.shot.test.ts:11` 却在写
`import { type InsertShot } from "./db"`。这就是 08-23 那次
`timelineActions` → `shared/timelineCommands` 搬迁的同款事故，
只不过这一次没有人去 grep，所以它还躺在那儿。

另外两条同类：`GenerateForMobileResult`、`StoryShot` 两个类型名在测试里被直接使用，
但从没 import 进来（`TS2304`）。

还有一条值得单独看：`server/services/imageAssets.test.ts(14,3) TS2719`
——「Two different types with this name exist, but they are unrelated」，
同名类型存在两份互不相干的定义。这是架构层面的重复定义，不只是测试的问题。

---

## 六、给用户的三个选项

**选项 1 · 分批修（推荐）**
按上面的头部分布切 3 批，每批一个会话，改完即可永久移除 exclude：

- 第 1 批：20 个陈旧信号 + 18 个 `as Response`（共 38 个，机械，风险最低）
- 第 2 批：`TS2493` 41 个 + 可能为 undefined 28 个（共 69 个，机械但量大）
- 第 3 批：96 个夹具形状（最费时，建议按文件切给多个会话）

**选项 2 · 上棘轮（跟 U1 同一套路，最快见效）**
仿照 `client/src/architecture-boundaries.test.ts` 的做法：
把这 58 个文件冻成基线清单，exclude 改成只排除这 58 个具体文件，
**其余 240 个测试文件当场纳入类型检查**，新增测试文件必须是绿的。
这样今天就堵住了「新写的测试带着失效 import 混进来」这条路，历史债务按选项 1 慢慢还。

注意棘轮要用**文件集合**而不是计数，理由跟 U1 基线文档里写的一样
（防止删一个旧的、加一个新的把债务平移过去还显示达标）。

**选项 3 · 维持现状**
不改。但那样至少建议把 `**/*.test.tsx` 也一并排除，让两种扩展名口径一致——
否则现在这种「一半查一半不查」是最容易误导人的状态：
`.tsx` 测试绿了会让人以为测试都被检查过了。

---

## 附录：本次没有做的事

- 没有改 `tsconfig.json` 本身（含 exclude 与 target）。
- 没有为了变绿去动 `strict`、`noUnusedLocals`、`noUnusedParameters`，也没有新增任何放宽项。
- 没有碰 `server/**` 的任何源码，因此没有触发共享的 :3000 `tsx watch` 重启。
- 没有碰 `shared/timelineEditing.ts` / `shared/timelineCommands.test.ts`（滚动剪辑线在用）
  与 `server/services/visualClipEditing.ts` / `CreationEditorContext.tsx`（架构收敛线 U4–U7 在用）。
  这两条线的文件在错误清单里都有出现，修的时候需要先在看板上协调。

---

## 附：208 个错误全清单（按文件，错误数降序）

### `server/services/visualAssetCreation.test.ts` — 26

- L126 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L126 `TS2532` Object is possibly 'undefined'.
- L127 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L127 `TS2532` Object is possibly 'undefined'.
- L130 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L135 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L136 `TS18048` 'visionInput' is possibly 'undefined'.
- L137 `TS18048` 'visionInput' is possibly 'undefined'.
- L138 `TS18048` 'visionInput' is possibly 'undefined'.
- L139 `TS18048` 'visionInput' is possibly 'undefined'.
- L300 `TS2769` No overload matches this call.
- L370 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L429 `TS2769` No overload matches this call.
- L536 `TS2769` No overload matches this call.
- L633 `TS2769` No overload matches this call.
- L655 `TS2352` Conversion of type 'undefined' to type 'string' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- L655 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L728 `TS2769` No overload matches this call.
- L815 `TS2769` No overload matches this call.
- L880 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L905 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L968 `TS2769` No overload matches this call.
- L1111 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L1111 `TS2532` Object is possibly 'undefined'.
- L1185 `TS2769` No overload matches this call.
- L1277 `TS2769` No overload matches this call.

### `server/routers.storyAgent.test.ts` — 22

- L153 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...
- L195 `TS2339` Property 'proposal' does not exist on type 'StoryIntentResult | { proposal: { id: string; status: "pending"; source: { storyId: number; versionId: string | null; intentRevision: number; kind: "reco...
- L195 `TS2339` Property 'proposal' does not exist on type 'StoryIntentResult | { proposal: { id: string; status: "pending"; source: { storyId: number; versionId: string | null; intentRevision: number; kind: "reco...
- L1357 `TS2322` Type '"302-vision"' is not assignable to type '"deterministic-fallback"'.
- L1465 `TS2322` Type '"error"' is not assignable to type '"ok"'.
- L1509 `TS2353` Object literal may only specify known properties, and 'candidates' does not exist in type '{ status: "ok"; imageUrl: string; imageKey: string; }'.
- L1637 `TS2493` Tuple type '[]' of length '0' has no element at index '2'.
- L1820 `TS2322` Type '"error"' is not assignable to type '"ok"'.
- L1884 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L1955 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L1958 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L2119 `TS2352` Conversion of type 'undefined' to type 'string' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- L2119 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L2127 `TS18047` 'materials' is possibly 'null'.
- L2264 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L2301 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L2332 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L2551 `TS2352` Conversion of type 'undefined' to type 'string' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
- L2552 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L2781 `TS2493` Tuple type '[]' of length '0' has no element at index '2'.
- L2905 `TS2493` Tuple type '[]' of length '0' has no element at index '2'.
- L2955 `TS2322` Type '"error"' is not assignable to type '"ok"'.

### `server/routers.publishingDraft.test.ts` — 13

- L115 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...
- L335 `TS2322` Type '{ id: string; platform: string; sourceCoreRevision: number; parentAssetId: null; feedback: string; instructions: never[]; artReference: null; assetIds: number[]; createdAt: number; }' is not ...
- L353 `TS2322` Type 'string' is not assignable to type 'null'.
- L361 `TS2322` Type 'string' is not assignable to type 'null'.
- L367 `TS2339` Property 'activeVideoStoryboardVersionId' does not exist on type '{ revision: number; containerRevision: number; activeVersionId: string; core: null; drafts: {}; versions: { versionId: string; sequ...
- L474 `TS18048` 'result.publishing.versions' is possibly 'undefined'.
- L474 `TS2532` Object is possibly 'undefined'.
- L474 `TS2532` Object is possibly 'undefined'.
- L698 `TS2339` Property 'operation' does not exist on type 'PublishingDraftState'.
- L1969 `TS2339` Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; cover...
- L2046 `TS2339` Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; cover...
- L2049 `TS2339` Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; cover...
- L2109 `TS2339` Property 'coverRound' does not exist on type '{ status: "confirmation_required"; estimate: PublishingCoverCostEstimate | PublishingCoverFallbackCostEstimate; publishing: PublishingDraftState; cover...

### `server/services/storyMaterials.test.ts` — 12

- L97 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L112 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L146 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L185 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L203 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L262 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L286 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L320 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L345 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L364 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L377 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.
- L407 `TS2345` Argument of type '{ stableShotId: string; shotNo: number; plannedDurationMs: number; }[]' is not assignable to parameter of type 'readonly StoryShotFact[]'.

### `server/services/creationAgent.test.ts` — 9

- L82 `TS2322` Type '{ id: number; projectId: number | null; storyId: number | null; userId: number | null; rawShotNo: string | null; canonicalShotNo: string | null; shotIdentity?: string | null | undefined; ... ...
- L485 `TS2322` Type '"blocked"' is not assignable to type '"disabled"'.
- L512 `TS2322` Type '"ready"' is not assignable to type '"disabled"'.
- L544 `TS2345` Argument of type '{ readonly prompt: "夜间近景，人物回头"; readonly shotNo: "SH01"; readonly projectId: 7; readonly storyId: 8; readonly userId: 9; readonly imageProvider: "midjourney"; readonly assets: rea...
- L547 `TS2345` Argument of type '{ visualAssetCostConfirmation: { accepted: true; estimatedCny: number; fingerprint: string; }; prompt: "夜间近景，人物回头"; shotNo: "SH01"; projectId: 7; storyId: 8; userId: 9; imageProvi...
- L668 `TS2322` Type '"302-vision"' is not assignable to type '"deterministic-fallback"'.
- L787 `TS2322` Type '"lineage"' is not assignable to type '"legacy"'.
- L788 `TS2322` Type 'number' is not assignable to type 'null'.
- L789 `TS2322` Type 'string' is not assignable to type 'null'.

### `server/services/emotionDailyReference302.test.ts` — 8

- L178 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L178 `TS2532` Object is possibly 'undefined'.
- L310 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L310 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L312 `TS18048` 'init' is possibly 'undefined'.
- L313 `TS18048` 'init' is possibly 'undefined'.
- L436 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L436 `TS2532` Object is possibly 'undefined'.

### `server/services/visualAssetBoardStructure.test.ts` — 8

- L40 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L40 `TS2532` Object is possibly 'undefined'.
- L41 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L41 `TS2532` Object is possibly 'undefined'.
- L152 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L152 `TS2532` Object is possibly 'undefined'.
- L153 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L153 `TS2532` Object is possibly 'undefined'.

### `server/services/publishingVideoStoryboard.test.ts` — 7

- L355 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L366 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L380 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L389 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L394 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L397 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...
- L405 `TS2345` Argument of type 'ModelParagraph[]' is not assignable to parameter of type '{ paragraphId: string; scriptText: string; visualTreatment: string; shots: { beat: never; subject: string; action: string...

### `server/services/visionChannel.test.ts` — 7

- L56 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L56 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L59 `TS18048` 'init' is possibly 'undefined'.
- L60 `TS18048` 'init' is possibly 'undefined'.
- L79 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L79 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L81 `TS18048` 'init' is possibly 'undefined'.

### `server/_core/context.test.ts` — 6

- L68 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.
- L111 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.
- L142 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.
- L177 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.
- L215 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.
- L248 `TS2345` Argument of type '{ req: any; res: any; }' is not assignable to parameter of type 'CreateExpressContextOptions'.

### `client/src/features/creationEditor/imageClipEditorModel.test.ts` — 5

- L37 `TS2322` Type '{ shotNo: number; shotKey: string; stableShotId: string; dialogue: string; timelineItem: { stableShotId: string; included: true; position: number; plannedDurationMs: number; transform: { zoom...
- L107 `TS2322` Type '{ shotNo: number; shotKey: string; stableShotId: string; dialogue: string; timelineItem: { stableShotId: string; included: boolean; position: number; plannedDurationMs: number; transform: { c...
- L147 `TS2322` Type '{ shotNo: number; shotKey: string; stableShotId: string; timelineItem: { stableShotId: string; included: boolean; position: number; plannedDurationMs: number; transform: { zoom: number; cropX...
- L156 `TS2322` Type '{ shotNo: number; shotKey: string; stableShotId: string; timelineItem: { stableShotId: string; included: boolean; position: number; plannedDurationMs: number; transform: { zoom: number; cropX...
- L203 `TS2322` Type '{ shotNo: number; shotKey: string; stableShotId: string; timelineItem: { stableShotId: string; included: boolean; position: number; plannedDurationMs: number; transform: { cropX: number; crop...

### `server/routers.storyConversation.test.ts` — 5

- L25 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...
- L82 `TS2345` Argument of type '{ storyId: number; userMessage: { clientMessageId: string; content: string; selection: { sourceType: "shot"; sourceId: string; selectedText: string; fullText: string; storyId: num...
- L84 `TS2345` Argument of type '{ storyId: number; userMessage: { clientMessageId: string; content: string; selection: { sourceType: "shot"; sourceId: string; selectedText: string; fullText: string; storyId: num...
- L281 `TS2322` Type '{ sourceType: "timeline-range"; sourceId: string; selectedText: string; fullText: string; storyId: number; stableShotId: string; shotNo: number; videoTakeId: number; rangeId: number; objectVe...
- L306 `TS2322` Type '{ videoTakeId: number; objectVersion: string; sourceType: "timeline-range"; sourceId: string; selectedText: string; fullText: string; storyId: number; stableShotId: string; shotNo: number; ra...

### `server/routers.storyShotFields.test.ts` — 4

- L42 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...
- L220 `TS2345` Argument of type 'Promise<void>' is not assignable to parameter of type 'Promise<undefined>'.
- L374 `TS2339` Property 'body' does not exist on type 'never'.
- L374 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.

### `server/services/imagePromptDirector.test.ts` — 4

- L87 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L87 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L89 `TS18048` 'init' is possibly 'undefined'.
- L90 `TS18048` 'init' is possibly 'undefined'.

### `server/services/videoPromptDirector.test.ts` — 4

- L145 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L145 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L147 `TS18048` 'init' is possibly 'undefined'.
- L148 `TS18048` 'init' is possibly 'undefined'.

### `shared/timelineCommands.test.ts` — 4

- L481 `TS2741` Property 'effects' is missing in type '{ takeId: number; sourceStartSec: number; sourceEndSec: number; }' but required in type 'StoryTimelinePrimaryVideoEdit'.
- L697 `TS2353` Object literal may only specify known properties, and 'reason' does not exist in type '{ applied: boolean; }'.
- L699 `TS2353` Object literal may only specify known properties, and 'reason' does not exist in type '{ applied: boolean; }'.
- L721 `TS2322` Type 'false' is not assignable to type 'true'.

### `client/src/features/creationEditor/rerender.test.ts` — 3

- L107 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L107 `TS2532` Object is possibly 'undefined'.
- L117 `TS2304` Cannot find name 'GenerateForMobileResult'.

### `client/src/features/storyAgent/spine/storySpine.test.ts` — 3

- L49 `TS2345` Argument of type '{ purpose: string; confidence: number; }' is not assignable to parameter of type 'SetterInput<StoryIntent | null>'.
- L115 `TS2353` Object literal may only specify known properties, and 'durationMs' does not exist in type 'StoryShot'.
- L139 `TS2353` Object literal may only specify known properties, and 'durationMs' does not exist in type 'StoryShot'.

### `client/src/features/storyAgent/storyboardLocalMedia.test.ts` — 3

- L31 `TS7006` Parameter 'type' implicitly has an 'any' type.
- L32 `TS7006` Parameter 'type' implicitly has an 'any' type.
- L32 `TS7006` Parameter 'value' implicitly has an 'any' type.

### `server/services/videoJobs.test.ts` — 3

- L830 `TS2493` Tuple type '[]' of length '0' has no element at index '0'.
- L831 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.
- L831 `TS2532` Object is possibly 'undefined'.

### `shared/publishingVideoStoryboard.test.ts` — 3

- L142 `TS2739` Type '{ draftShotId: string; stableShotId: string; segmentIds: string[]; sourceParagraphIds: string[]; scriptText: string; subject: string; action: string; imageRequirement: string; videoRequiremen...
- L153 `TS2739` Type '{ draftShotId: string; stableShotId: string; segmentIds: string[]; sourceParagraphIds: string[]; scriptText: string; subject: string; action: string; imageRequirement: string; videoRequiremen...
- L191 `TS2739` Type '{ draftShotId: string; stableShotId: string; segmentIds: string[]; sourceParagraphIds: string[]; scriptText: string; subject: string; action: string; imageRequirement: string; videoRequiremen...

### `client/src/features/creationEditor/storyboardEditRow.test.ts` — 2

- L64 `TS2739` Type '{ stableShotId: string; shotNo: number; position: number; startMs: number; endMs: number; durationMs: number; }' is missing the following properties from type 'StoryboardTimingRow': startFram...
- L884 `TS2322` Type '{ stableShotId: string; shotNo: number; position: number; startMs: number; endMs: number; durationMs: number; startFrame: number; durationFrames: number; stackOrder: number; visualLayer?: num...

### `client/src/features/storyAgent/editingTransitionPersistence.test.ts` — 2

- L16 `TS2322` Type '{ stableShotId: string; shotNo: number; imageId: number; imageUrl: string; }' is not assignable to type 'EditingTransitionEndpointReference'.
- L22 `TS2322` Type '{ stableShotId: string; shotNo: number; imageId: number; imageUrl: string; }' is not assignable to type 'EditingTransitionEndpointReference'.

### `client/src/features/storyAgent/storyAgentPersistence.test.ts` — 2

- L53 `TS2345` Argument of type '{ messages: { id: string; role: "user"; content: string; timestamp: number; }[]; cards: { id: string; content: string; emotion: string; sensoryDetails: never[]; createdAt: number;...
- L62 `TS2741` Property 'title' is missing in type '{ id: string; content: string; emotion: string; sensoryDetails: never[]; createdAt: number; }' but required in type 'StoryCard'.

### `client/src/features/storyAgent/views/storyboardImageRenderPlan.test.ts` — 2

- L151 `TS2345` Argument of type '{ ready: false; reason: string; }' is not assignable to parameter of type 'ImageProviderStatus'.
- L153 `TS2345` Argument of type '{ ready: true; }' is not assignable to parameter of type 'ImageProviderStatus'.

### `server/routers.visualAssets.test.ts` — 2

- L31 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...
- L66 `TS2322` Type '"import"' is not assignable to type '"initial" | "generate" | "inpaint" | undefined'.

### `server/services/editingTransitionWorkflow.test.ts` — 2

- L122 `TS2322` Type '{ stableShotId: string; shotNo: number; imageId: number; imageUrl: string; }' is not assignable to type 'TimelineTransitionEndpoint'.
- L128 `TS2322` Type '{ stableShotId: string; shotNo: number; imageId: number; imageUrl: string; }' is not assignable to type 'TimelineTransitionEndpoint'.

### `server/services/publishingPersistence.test.ts` — 2

- L1374 `TS2345` Argument of type '{ readonly type: "create_version"; readonly storyId: 7; readonly platform: "x"; readonly core: { facts: string[]; thesis: string; emotion: string; voiceTraits: string[]; visualCon...
- L1375 `TS2322` Type '{ requestHash: string; type: "create_version"; storyId: 7; platform: "x"; core: { facts: string[]; thesis: string; emotion: string; voiceTraits: string[]; visualConcept: string; }; content: {...

### `server/services/publishingVideoStoryboardPersistence.test.ts` — 2

- L474 `TS2339` Property 'sourceParagraphIds' does not exist on type '{}'.
- L533 `TS2339` Property 'sourceParagraphIds' does not exist on type '{}'.

### `server/services/storyVoice302.test.ts` — 2

- L33 `TS2339` Property 'body' does not exist on type 'never'.
- L33 `TS2493` Tuple type '[]' of length '0' has no element at index '1'.

### `server/services/videoConform.test.ts` — 2

- L26 `TS2749` 'EventEmitter' refers to a value, but is being used as a type here. Did you mean 'typeof EventEmitter'?
- L383 `TS2698` Spread types may only be created from object types.

### `server/services/visualAssetAssociations.test.ts` — 2

- L103 `TS2322` Type '() => Promise<{ modelLabel: string; rawText: string; parsed: { bindings: { stableShotId: string; characterAssetId: string; rationale: { character: string; }; conflicts: { kind: string; field:...
- L148 `TS2322` Type '() => Promise<{ modelLabel: string; rawText: string; parsed: { bindings: { stableShotId: string; characterAssetId: string; conflicts: { kind: string; field: string; assetFact: string; shotReq...

### `shared/timelineEditing.test.ts` — 2

- L89 `TS2322` Type '{ kind: "source"; sourceType: "image"; sourceId: string; localFrame: number; sourceTimeSec: null; effects: null; transform: null; }' is not assignable to type 'TimelineSourceResolution'.
- L93 `TS2322` Type '{ kind: "source"; sourceType: "image"; sourceId: string; localFrame: number; sourceTimeSec: null; effects: null; transform: null; }' is not assignable to type 'TimelineSourceResolution'.

### `client/src/features/creationAgent/imageAssetViewModel.test.ts` — 1

- L10 `TS2322` Type '{ id: number; projectId: number | null; storyId: number | null; userId: number | null; rawShotNo: string | null; canonicalShotNo: string | null; shotIdentity?: string | null | undefined; ... ...

### `client/src/features/publishingAlbum/publishingAlbumExport.test.ts` — 1

- L12 `TS2739` Type '{ kind: "region"; text: string; fontId: string; fontFamily: string; fontSize: number; alignment: "center"; graphemes: { grapheme: string; index: number; x: number; y: number; rotation: number...

### `client/src/features/storyAgent/chatStoryContext.test.ts` — 1

- L55 `TS2741` Property 'coverRounds' is missing in type '{ version: 1; revision: number; activePlatform: "x"; selectedPlatforms: ("x" | "xiaohongshu")[]; core: { revision: number; facts: string[]; thesis: string...

### `client/src/features/storyAgent/selectionPromptCandidate.test.ts` — 1

- L156 `TS2353` Object literal may only specify known properties, and 'sourceId' does not exist in type 'Pick<SelectionContext, "sourceType" | "selectedText" | "fullText">'.

### `client/src/features/storyAgent/views/StoryCardsBoard.intent.test.ts` — 1

- L1055 `TS2304` Cannot find name 'StoryShot'.

### `evals/recurringEditAnalysis.test.ts` — 1

- L125 `TS2339` Property 'shots' does not exist on type '{}'.

### `server/almanac.router.test.ts` — 1

- L17 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/archive/storyIntent.test.ts` — 1

- L99 `TS7006` Parameter 'message' implicitly has an 'any' type.

### `server/db.storyTimelineOverlay.test.ts` — 1

- L267 `TS2322` Type '{ id: string; kind: "generated-video"; takeId: number; sourceStableShotId: string; videoUrl: string; startFrame: number; targetEndFrame: number; mediaEndFrame: number; endFrame: number; stack...

### `server/nayin.test.ts` — 1

- L13 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.artPromptLibrary.test.ts` — 1

- L26 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.creationAgentCost.test.ts` — 1

- L21 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.creationAgentImport.test.ts` — 1

- L29 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.project.test.ts` — 1

- L23 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.projectOwnership.test.ts` — 1

- L34 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.promptLineage.test.ts` — 1

- L20 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/routers.shot.test.ts` — 1

- L11 `TS2459` Module '"./db"' declares 'InsertShot' locally, but it is not exported.

### `server/routers.startEndVideoCost.test.ts` — 1

- L20 `TS2352` Conversion of type '{ clearCookie: () => void; }' to type 'Response<any, Record<string, any>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, c...

### `server/services/characterContinuity.test.ts` — 1

- L49 `TS2322` Type '80' is not assignable to type '0 | 100 | 25 | 50 | 75'.

### `server/services/imageAssets.test.ts` — 1

- L14 `TS2719` Type '{ id: number; storyId: number | null; createdAt: Date; imageUrl: string; prompt: string | null; userId: number | null; projectId: number | null; shotNo: string | null; shotIdentity: string | ...

### `server/services/publicReferenceHost.test.ts` — 1

- L94 `TS2352` Conversion of type '[]' to type '[string, RequestInit]' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.

### `server/services/publishingDraft.test.ts` — 1

- L7 `TS6133` 'PublishingDraftModelOutputError' is declared but its value is never read.

### `server/services/shotImageReferences.test.ts` — 1

- L10 `TS2322` Type '{ id: number; projectId: number | null; storyId: number | null; userId: number | null; rawShotNo: string | null; canonicalShotNo: string | null; shotIdentity: string | null; imageKey: string ...

### `server/services/videoTransition302.test.ts` — 1

- L379 `TS2558` Expected 0 type arguments, but got 1.

### `server/services/visualAssetPersistence.test.ts` — 1

- L25 `TS2322` Type '"import"' is not assignable to type '"initial" | "generate" | "inpaint" | undefined'.

