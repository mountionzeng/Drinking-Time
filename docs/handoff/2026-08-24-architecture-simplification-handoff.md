---
date: 2026-08-24
topic: architecture-simplification
status: 可直接接手；地基已换，剩余工作都有明确入口
branch: codex/story-visual-assets
---

# 交接：把「简单功能改不好」当成地基信号

## 这份文件最重要的一句话

用户的原话是：**「我认为是架构不对，所以我想加一个功能，它明明是最基本的剪辑功能，但就是非常艰难。遇到麻烦后就看看能不能把架构调得更高效更精简，而不是在脆弱的代码基础上堆功能。」**

这不是抱怨，是一条可执行的判据。本轮验证了它成立，而且非常有效：

> **一个基本功能如果做起来异常艰难，先怀疑它在当前地基上「没有定义」，而不是自己实现方式不对。**

本轮实例：用户要三个功能——时间标尺、左栏悬浮、缩放。看上去是三个 UI 活。
实际查下来，分镜表的横轴总宽由「镜头数 × 固定列宽」决定，与时间无关，
于是**「每秒多少像素」这个量根本不存在**。而这三个功能全都依赖它：

- 标尺要固定的每秒像素数，否则刻度随窗口宽度漂移，`00:46:00` 钉不住；
- 悬浮要内容比视口宽才有得滚，百分比布局永远正好等于视口宽；
- 缩放本身就是改每秒像素数，100% 永远是 100%。

**它们不是难做，是在那个坐标系里没有定义。** 改动最后落在一行：总宽改由
`shared/timelineViewport` 给出。三个功能里两个随之而来，第三个（悬浮）
实测发现**本来就已经实现了**，只是分镜表被挤在 428px 宽的栏里看不出来。

接手的人请把这条判据继续用下去。它比任何具体结论都值钱。

---

## 一、接手前必读（按顺序）

1. `AGENTS.md` —— 环境铁律与功能账本闸门
2. `docs/handoff/SESSION-BOARD.md` —— 多会话协调看板，**动代码前先登记**
3. `docs/features/feature-ledger.json` —— 改之前查，改之后更新
4. `docs/brainstorms/2026-08-23-architecture-convergence-requirements.md` —— 本轮需求与债务基线
5. `docs/plans/2026-08-23-001-refactor-timeline-write-convergence-plan.md` —— 分阶段计划，U1–U8
6. `docs/qa/refactor-coupling-baseline-2026-08-14.md` —— **特别注意 2026-08-15 的复核**：
   初版列的七条「重复」里只有一条成立，照着其余几条做收敛会破坏真实的语义区分

---

## 二、本轮已经改掉的地基（都已合入）

### 1. 一个事实一个写入口

`extracted-frame-overlay-video` 功能卡第 9 条不变量此前只是**声明**，代码里
没兑现：客户端跑 planner 算出整份 `items` 再连同 `expectedVersion` 覆盖回去，
和新落地的 `moveVisualClip` 争同一批坐标。

现在收敛成服务端领域命令，客户端只说做什么：

| 命令 | 取代了 |
| --- | --- |
| `moveShotGroup` / `moveShotSingle` / `rollingTrim` / `magnetDetach` / `addTimelineAnchor` / `removeTimelineAnchor` / `trimShot` | `commitTimelinePlan` 的 7 个 planner 调用 |
| `applyVisualLayerAction` | `manageTimelineVisualLayer` |
| `undoVisualEdit` | 客户端整份快照回写 |
| `setShotIncluded` / `moveShotOrder` / `reorderShotToTarget` / `includeAllShots` / `patchImageTransform` / `removeInnerVideoClip` / `setShotDuration` / `updateVideoEdit` | 各自借道整份写入的操作 |

权威实现在 `server/services/visualClipEditing.ts`，全部走同一套
`withVisualEditDocument`：读文档 → 纯函数改 → 服务端自持版本 CAS 写。

**关键判断**：`timelineActions.ts`（7 个 planner，653 行）当时只 import
`@shared/*`、没有任何 React/DOM 依赖——它不是客户端逻辑，只是**放错了边**。
所以「批量操作也走服务端命令」是搬迁而非重写。搬到了 `shared/timelineCommands.ts`。

### 2. 一个坐标一个映射

`shared/timelineViewport.ts` 是时间↔像素的唯一映射。分镜表的总宽由它给出，
标尺与缩放建立在它上面（`StoryboardTimelineRuler.tsx`）。

模块里钉了一个算术事实：**16px/秒 时一帧只有 0.53px**。这就是「一帧图片
点不中」的根因——不是命中逻辑写错了，是它在屏幕上真的只有半个像素。

### 3. 只剩一个可编辑表面

底部时间线 `MultiTrackTimeline`（1282 行）已删除。删之前搬走了两样只住在
它里面的东西，否则会静默丢功能：

- **播放时钟** → `useTimelinePlaybackClock.ts`，父层持有；
- **音频播放** → `TimelineAudioPlayback.tsx`，父层渲染。
  故事版没有自己的音频播放，这条是第一版取舍清单**漏掉的**，
  靠逐项 grep props 才发现。删界面前请务必做这一步。

### 4. 错误分类与人工接管

命令的错误分 `conflict`（别处刚写过，刷新重来）与 `invalid`（操作本身不成立）
两类，各给可执行出路。这条来自视觉资产线的教训：他们也立过「唯一写入口」
不变量，结果质检判 unknown 时锁定按钮永久置灰、唯一能改判的接口没有 UI 入口，
用户花了钱却无处申诉。

> **唯一写入口若没有人工接管出路，不变量成立而用户被锁在外面，那是收敛失败。**

### 5. 聊聊知道你在看哪一秒

播放头进 `storySpine`，聊天指令带 `playheadMs`，服务端用
`resolveTimelineFrameSource`（与预览、导出同一个入口）解析成那一帧可见的镜头。
所以「把这里改一下」有了确定所指。空档处如实返回 null，不硬猜最近一镜。

---

## 三、两次我自己诊断错了——请引以为戒

本轮我下过两个错误结论，都不是代码问题，是**验证方法有盲区**。接手的人
会用同一套工具，很可能踩同样的坑：

### 坑 1：无头浏览器里 rAF 被冻结

我用浏览器工具测播放，播放头一动不动，于是判定「播放是既有 bug」并据此
「修」了一个不存在的问题。

真相：浏览器面板是隐藏页面（`document.hidden === true`），浏览器会**冻结
`requestAnimationFrame`**，实测 600ms 内触发 **0 次**。

**绕法**（本轮验证有效）：在页面里临时把 rAF 换成 setTimeout 垫片。

```js
window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 50);
```

换上之后播放立刻正常：`00:00.080 → 00:02.361`，速率与墙钟一致。
**任何依赖动画帧的东西，不加垫片测出来的「不动」都不算证据。**

### 坑 2：读错了对象就下结论

我测「连按方向键」时，聚焦的是 `manual-sh17`，却去查 `transition-shot` 的
位置，于是得出「按 5 次只动 1 帧，4 次被吞」。实际单次按键**恰好一个 clip
移动恰好一帧**，完全正确。

**教训**：断言前先确认「我操作的」和「我读的」是同一个对象。这个仓库里
一个界面上有几十个 clip，搞错太容易了。

---

## 四、剩下的活（按建议顺序）

### A. 连按会丢输入 —— 真问题，优先级最高

实测：4 次方向键只产生 3 次写入。原因是 `CreationEditorContext` 的写锁，
上一次还在保存时后续请求被挡下、返回「上一步剪辑还在保存中」，而**这个
提示没人显示**。所以微调时会觉得时灵时不灵。

两条修法，建议前者：

1. **把连按合并成一次移动**：累积帧数、防抖后提交一次。手感最好，也顺带
   消掉「N 个并发命令打同一个 clip」这类竞争。
2. 把被挡的原因显示出来。能解释现象，但手感依旧差。

### B. 关掉最后的整份写入口（计划里的 U7，未完成）

`saveTimelineItems` 还剩 **3 处引用**（`CreationEditorContext.tsx:1824` 定义、
`:3207` 撤销分支、`:3298` 依赖数组），`creationAgent.updateStoryTimeline` 的
input 仍接收整份 `items` 数组。

**挡路的是第二个家族**（原计划漏算的）：若干服务端 mutation 会返回
`beforeItems` / `undoSnapshot` 给客户端，客户端压进撤销栈、撤销时整份写回。
调用点在 `CreationEditorContext.tsx:1881 / 3187 / 3284 / 3533 / 3570` 与
`EditingStudioPage.tsx:629`。

要真正关掉整份入口，这些 mutation 也得改成在服务端记撤销日志
（`server/services/visualEditUndoJournal.ts` 已经在跑，接上即可），
而不是把快照发给客户端保管。

做完之后：删 `saveTimelineItems`、收窄 `updateStoryTimeline` 的 input、
**摘掉 `client/src/architecture-boundaries.test.ts` 里守卫二的豁免登记**——
豁免表为空就是这件事完成的信号。

### C. `StoryboardEditRow` 的 58 处百分比

本轮用「换总宽来源」绕过了逐个改造，这是对的（改动小、风险低）。
但那 58 处百分比 + 8 处 `getBoundingClientRect()` 反向换算仍在，
它们现在是「时间正比容器内的百分比」，语义正确但绕了一圈。

**不建议现在动**。等下一个真实需求逼到它（比如要做帧级吸附或者波形对齐）
再改，那时才知道该改成什么形状。没有需求驱动的坐标重构容易改成另一套猜测。

### D. 已登记但未做的

- `server/archive/` 目录名与事实不符——里面是**活的生产代码**，被 6 个文件
  导入。用户已决定排到收敛之后，改名会触达 6 个导入方，属独立提交。
- `client/src/features/analysis/` 同理：`/analysis` 只剩重定向，目录却仍在
  服务 `/editing` 与 `/welcome`。只登记，不动。
- knip 未用导出 198 + 未用类型 200。**注意其中大量是 `components/ui/*` 的
  shadcn 原语**，那是第三方模板的完整 API，不是死代码。

---

## 五、当前实测数字（2026-08-24，别当永久事实）

| 指标 | 值 |
| --- | --- |
| `StoryboardReviewBoard.tsx` | 5,632 行 |
| `CreationEditorContext.tsx` | 3,922 行（本轮 −407） |
| `EditingNleWorkspace.tsx` | 3,014 行（本轮 −1,411） |
| `StoryboardEditRow.tsx` | 3,992 行（未动） |
| `server/db.ts` | 6,563 行 / 109 导出（未动） |
| 直接 import `db` 的生产文件 | 53（未动） |
| `saveTimelineItems` 引用 | 3（本轮 11 → 3） |

**已知失败一条，与本轮无关**：`server/routers.creationAgentImport.test.ts`
的 “binds an imported image directly to the requested stable shot”。
把本轮改动 stash 掉之后依然失败，属既有问题。

---

## 六、架构棘轮：它拦过我两次，都是对的

`client/src/architecture-boundaries.test.ts` 里有热点文件行数上限。本轮它
两次拦下我自己：

1. `CreationEditorContext` 4329 → 4337。我把命令客户端挪到独立文件，降到 4161。
2. `StoryboardReviewBoard` 5612 → 5715。我把标尺/缩放/视口抽出去，降到 5632。

**两次都不是靠抬基线解决的，是靠把代码放回它该在的地方。** 这条守卫真正
起的作用不是「限制行数」，是逼着问一句「这段代码属于这个文件吗」。

它也有局限：数原始行数，分不清 20 行接线和 200 行新职责。第二次抽完仍差
20 行接线压不下去，我上调了基线**但在守卫里写清了为什么、多少、到期条件**。
接手的人如果也遇到——可以调，但必须记下来，不要默默改数字。

`EditingNleWorkspace` 的基线已从 4425 兑现压到 3014，**不许退回**。

---

## 七、红线（照抄自 AGENTS.md 与本轮实践）

- **只有主仓库能跑 dev server，固定 3000**。`server/_core/portPolicy.ts` 会
  强制这一点，换端口起不来——这是防数据分裂的守卫，不要改它。
- 主 checkout **永远不要跑 `pnpm dev`**，`predev` 会对整个进程组发 SIGTERM。
  用 `pnpm preview:3000`。
- `~/Library/LaunchAgents` 里那个 launchd 常驻任务**已停用**（它从未成功启动过，
  launchd 拿不到 `~/Documents` 权限，日志曾滚到 92MB）。详见
  `docs/environment-guide.md`。
- 改 `server/**` 会触发 `:3000` 重启，**可能打断正在飞的付费出图**。动手前确认。
- 不自动执行真实付费任务。视觉资产那条线的板子是真金白银验出来的（累计 ¥31.29）。
- 多会话并行：**动代码前在 `docs/handoff/SESSION-BOARD.md` 登记**。归属判定
  只认两条——`git reflog` 里是 `commit:` 还是 `merge <分支名>:`，加上触达文件
  属于哪条线。**不要用「时间重合 + 刚跟谁通过信」归因**，2026-08-23 下午
  已经连错两次。

---

## 八、给下一位的开场提示词

```text
请接手 drinking-time-local 的架构精简工作。先完整阅读：

docs/handoff/2026-08-24-architecture-simplification-handoff.md

核心方法（用户的要求，比任何具体结论都重要）：一个基本功能如果做起来异常
艰难，先怀疑它在当前地基上「没有定义」，而不是自己实现方式不对。查清楚地基
缺了什么量，补上那个量，功能往往随之而来——不要在脆弱的代码上继续堆。

先遵守 AGENTS.md：跑 pnpm env:status；在 docs/handoff/SESSION-BOARD.md 登记；
改之前查 docs/features/feature-ledger.json，可能削弱已登记能力就停下来问用户。

第一件事建议做「连按方向键会丢输入」：实测 4 次按键只产生 3 次写入，写锁把
飞行中的后续请求挡下并静默返回。建议把连按合并成一次移动，而不是只把提示
显示出来。

验证有两个已知盲区，务必注意：无头浏览器是隐藏页面，requestAnimationFrame
被冻结，测任何依赖动画帧的东西前先装 setTimeout 垫片；断言前确认「操作的」
和「读的」是同一个对象——这两个坑上一轮各踩过一次，都导致了错误结论。
```
