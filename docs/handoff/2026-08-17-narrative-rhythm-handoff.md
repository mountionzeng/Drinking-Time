---
date: 2026-08-17
topic: narrative-rhythm
status: 服务端已完成，前端弹窗待做
branch: codex/jb
---

# 交接：叙事节奏引擎 —— 剩下前端那一步

## 一句话

用户在「进入视频制作」时选目标成片形态（画册 / 10s / 30s / 50s）和调子，
系统据此把文字稿**改编**成对应节奏的故事版。**服务端已全部就绪**，
只差前端那个小界面。

## 已完成（5 个提交，均在 codex/jb 上）

```
c0516fe  规格贯穿生成与确认 —— buildVideoStoryboard 接受 narrativeSpec
12c95fa  确认故事版时按整片预算写入每镜时长
0962cf7  剧本改编而非逐段转写 —— 镜头数由节奏预算决定
91698e9  文字稿转写时顺带标注叙事位置（beat）
8cc09b4  叙事节奏引擎 —— 整片时间预算
```

142 个测试通过，`tsc` 干净。

### 链路

```
buildVideoStoryboard({ storyId, versionId, narrativeSpec })
   ↓ 规格 → 镜头数区间 + 单镜区间，写进 generationPrompt
生成：模型改编（允许多段合成一镜、允许段落不进成片），每镜标 beat
   ↓ 生成与确认共用同一规格（不共用会「按 10 秒出镜头、按 30 秒分时长」）
确认：planConfirmedShotDurations 按整片预算算出 durationMs
   ↓
故事版看板：storyboardTiming 渲染时间轴
```

### 核心文件

| 文件 | 作用 |
|---|---|
| `shared/narrativeRhythm.ts` | 节奏引擎（纯函数，45 测试） |
| `server/services/publishingVideoStoryboard.ts` | 生成侧：prompt 带规格、模型标 beat、`assignNarrativeBeats` 全局归一 |
| `server/services/publishingVideoStoryboardPersistence.ts` | 确认侧：`planConfirmedShotDurations` 写 `durationMs` |
| `server/routers/publishingDraft.ts:910` | `buildVideoStoryboard` mutation |
| `shared/publishingDraft.ts` | `PublishingStoryVersion.narrativeSpec` |

## 待做：前端小界面

**位置**：`client/src/features/publishingDraft/PublishingDraftWorkspace.tsx`
- 按钮在 `:2248`（`进入视频制作`）
- 处理函数 `continueToVideo()` 在 `:1202`

**要做的事**：点按钮后先弹小界面，选完再调 mutation。

```ts
// continueToVideo 里现有的调用，只需多传一个字段
await buildVideoStoryboardMut.mutateAsync({
  storyId,
  versionId,
  operationToken,
  narrativeSpec,        // ← 新增："album9" | "video10" | "video30" | "video50"
});
```

**界面问两件事**：

1. **时长** —— 四档。`NARRATIVE_SPEC_LABELS`（在 `shared/narrativeRhythm.ts`）
   已有中文标签可直接用。
2. **调子** —— 用已识别的 `narrativeIntent.primaryPurpose` 预填，让用户确认或改。
   五个值：`preserve | gift | share | persuade | create`，
   `PURPOSE_RHYTHM_ANCHORS` 里各有对应节奏锚点。

**产品意图（用户原话）**：「可以理解成重新剪辑一个版本」。
所以选规格应该**产出新版本**而非覆盖当前版本 —— 仓库已有版本控制
（`createVersion` / `versionId` / `versionRevision`），沿用即可。
这一点尚未实现，需要新会话决定是复用 `createVersion` 还是在
`buildVideoStoryboard` 内部开新版本。

## 约束（都是用户明确定过的）

- **意图识别目前粗糙，只保留接口，不深挖。** 引擎与识别之间只通过
  `rhythmProfileFromIntent()` 耦合 —— 输入意图、输出 5 个 0–1 的数字。
  识别侧怎么改都不影响下游。**这是唯一需要随识别升级而重写的函数。**
- **卡片界面可以删**，但 `body.cards` 保留作不可见信号源。`segmentWeight`
  已有字数兜底，即使完全不接卡片节奏也能跑。
- **被丢掉的正文不做特殊提示。** 用户想要可自行粘回镜头表。
- **缺什么都不阻塞生成**：没选规格按 30 秒档，识别不出意图退回中性基线。

## 血的教训（这轮真踩过）

1. **绿灯不等于对。** 有一次 prompt 已要求镜头层 beat，解析却仍读段落层 ——
   模型标的 beat 被直接丢弃，而 `tsc` 和测试全绿。改跨层字段时要把
   类型、解析、构造、归一、测试**整条链**一起看。
2. **脚本静默中止。** 一个 python 批改脚本在找不到锚点时提前 `raise`，
   后面两处替换一个都没生效，我没核实就往下走了。改完务必 `grep` 确认。
3. **生成与确认必须共用同一规格。** 两边各自读不同来源，类型检查和测试
   都抓不到，只有把整条链当一件事看才发现。

## 环境

- 真仓库是 `/Users/yuandai/Documents/New project/drinking-time-local`（独立 git 仓库，分支 `codex/jb`）。
  **外层 `New project` 仓库里那份 `drinking-time-local` 是陈旧快照，不要在那儿改。**
- 起服务：`cd drinking-time-local && (setsid nohup pnpm preview:3000 > /tmp/dt3000.log 2>&1 < /dev/null &)`
  —— 必须 `setsid` 完全脱离进程组，否则会被 shell 回收。
- 数据在 `.webdev/local-persist.json`（22 个故事）。MySQL 未配置，走本地持久化，这是正常降级。
- 验证入口：http://localhost:3000/editing
