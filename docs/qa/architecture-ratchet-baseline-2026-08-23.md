# 架构棘轮基线（2026-08-23 冻结）

> 守卫实现在 `client/src/architecture-boundaries.test.ts`。
> 本文档解释每条守卫**为什么存在**、基线怎么来的、豁免怎么摘。
> 计划：`docs/plans/2026-08-23-001-refactor-timeline-write-convergence-plan.md`（U1）

## 棘轮是什么，不是什么

**是**：一道只阻止**新增**债务的闸。上线时全库是绿的，历史债务原样保留。
**不是**：一次重构。它不要求任何人现在就去还债，只要求新改动不把坑挖得更深。

冻结时的门禁状态：`pnpm check` 通过，`pnpm feature:validate` 通过（29 张卡）。

---

## 守卫一：不新增 `server/db.ts` 的直接导入方

**基线：51 个生产文件**（`server/**`，排除 `*.test.ts`；`scripts/**` 不计入）。

清单硬编码在守卫里，不是一个计数。用集合而不是数字，是为了防止"删一个旧的、加一个新的"把债务平移过去还显示达标。

### 关于 51 这个数字

交接文档和需求文档最初写的是"约 49"。**实际是 51。**

差的两个是 `server/services/editContext.ts` 与 `server/services/semanticAnnotation.ts`，它们用**单引号**写 `from '../db'`，而当初那次一次性 grep 只匹配了双引号。

这正是把测量交给守卫、而不是交给一次性命令的理由：守卫每次跑都用同一条规则重新数，一次性 grep 的口径会随手写随手漂。基线以守卫算出来的为准，需求文档与计划里的 49 已按此更正。

### 怎么摘

- **某个文件不再导入 `db`**：好事，在**同一个提交里**把它从守卫的清单删掉。守卫会因为"清单里有已经不成立的条目"而失败——这是刻意的，否则清单会烂掉，几个月后没人知道它还准不准。
- **确实需要新增一个直接导入**：不要直接往清单里塞。先问该走哪个领域 persistence；确实没有合适的，在下面的豁免表登记，写清 owner、原因、到期条件。

### 豁免表

| 文件 | owner | 原因 | 到期条件 |
| --- | --- | --- | --- |
| （空） | | | |

---

## 守卫二：tRPC 不接收客户端算好的 clip 位置

**规则**：任何 `.input()` 里出现 `items: z.array(...)` 且该结构含 `timelineStartFrame` 的 procedure 都是违例。

这是本轮收敛的**终点判据**。客户端一旦能上传整份带绝对帧的 items，服务端就无从判断"用户到底想动哪一个 clip"，也就无法保证"只有它该动"——这正是 `extracted-frame-overlay-video` 第 9 条不变量要禁止的事。

### 当前豁免（U7 摘除）

| 文件 | procedure | owner | 原因 | 到期条件 |
| --- | --- | --- | --- | --- |
| `server/routers/creationAgent.ts` | `updateStoryTimeline` | 架构收敛线 | 整份 timeline 写入口尚未关闭；11 个客户端调用点待迁移 | 计划 U7 完成后删除该豁免。**摘除这条豁免就是本轮收敛的完成信号。** |

守卫从第一天就指向终点、而不是等收敛完再补，是为了让"还差多远"始终是一条会失败的测试，而不是一份需要有人记得去读的文档。

---

## 守卫三：热点文件不再增长

**基线（行数上限）**：

| 文件 | 上限 |
| --- | --- |
| `client/src/features/storyAgent/views/StoryboardReviewBoard.tsx` | 5612 |
| `client/src/features/storyAgent/StoryAgentContext.tsx` | 4528 |
| `client/src/features/creationEditor/views/EditingNleWorkspace.tsx` | 4425 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | 4329 |
| `client/src/features/creationEditor/views/StoryboardEditRow.tsx` | 3992 |
| `client/src/features/publishingDraft/PublishingDraftWorkspace.tsx` | 3305 |

只设上限，不设下限——变小随时欢迎，且**不需要**同步下调上限（与守卫一的清单不同：那里陈旧条目会误导，这里陈旧上限只是宽松一点，不会让人误判）。

**行数是代理指标，不是目标。** 把行搬到一个没有语义的 helper 里让数字变小，不算改善；这一点在计划的 U7 里再次写明：行数下降是副产品，验收看真实链路。

---

## 守卫四：跨切面语义各自只有一个权威实现

**规则**：以下符号名在全库只能被导出一次。

| 符号 | 权威模块 | 管什么 |
| --- | --- | --- |
| `compareVisualPriority` | `shared/timelineVisualPriority.ts` | 视觉赢家比较器 |
| `pickVisualWinner` | `shared/timelineVisualPriority.ts` | 同上 |
| `hiddenVisualLayerSet` | `shared/timelineVisualPriority.ts` | 隐藏层集合 |
| `normalizeShotIdentity` | `shared/shotIdentity.ts` | 稳定镜头身份 |
| `isRecoverablePublishingCoverGeneration` | `shared/publishingDraft.ts` | 付费生成可恢复性 |

### 为什么是"符号唯一导出"而不是"语义查重"

`docs/qa/refactor-coupling-baseline-2026-08-14.md` 的 2026-08-15 复核有一条硬教训：初版列的七条"重复"里**只有一条成立**，其余照做会造成实质损害——五处 `status === "failed"` 问的是五个不同问题，合并会抹平区分。

所以这条守卫刻意**只做能被证明的断言**：同名符号是否被导出了两次。它不去猜"这两段逻辑是不是一回事"。宁可漏报，不可误报——一条断言错误的守卫比没有守卫更糟，因为后来者会拿它当已经想清楚的结论。

---

## 每条守卫都配了元测试

守卫本身用正则匹配源码，而正则会悄悄失效：改错一个字符，守卫就永远通过，却没人发现。

所以每条守卫都配一条"matcher 确实匹配它声称的东西"的反向测试：喂一段人造违例断言命中，喂一段合规样本断言不命中。写法沿用文件里既有的
`the unnarrowed-invalidate matcher actually matches what it claims`。
