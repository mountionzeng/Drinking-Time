---
date: 2026-08-22
topic: simple-multitrack-editor-architecture-reset
status: 待下一会话重新建模；禁止继续修旧拖拽补丁
repo: /Users/yuandai/Documents/New project/drinking-time-local
branch_at_handoff: codex/story-visual-assets
story_for_manual_verification: 1186
---

# 交接：把抽帧流程还原成普通多轨剪辑，不要再修旧模型

## 一句话结论

用户要的是一个很普通的多轨剪辑器：**轨道管理剪辑块，剪辑块独立保存自己的位置、长度和所属轨道。** 图片与视频遵守完全相同的移动规则；抽帧只创建一个普通图片剪辑块，生成结果只是普通视频剪辑块。

今天最主要的错误不是某个 Pointer Event 写错，而是我们把一个简单编辑动作同时绑到了 Storyboard 镜头列、底部 Timeline、抽帧 overlay、生成候选、story shot 和多套持久化接口。随后不断在错误模型上补命中、同步和兼容逻辑，测试变多了，用户最基本的拖动仍没有成功。

**下一会话不要从修拖拽事件开始。先建立最小领域模型、收敛唯一写入口，再接 UI。预计可以删除大量重复代码。**

---

## 一、用户真正要的行为（已经确认）

这是标准剪辑软件的基础能力，不需要新的“二维分镜棋盘”概念，也不需要抽帧专用图层：

1. 图层就是普通视觉轨道，可以新增、删除、隐藏、上下排序，并能按需继续增加。
2. 图片和视频都是普通剪辑块，行为一致。
3. 每个剪辑块都能自由左右移动，也能上下换轨道。
4. 移动底层视频绝不能带动、重算或改写上层图片/视频。
5. 一帧图片也必须可以容易地抓取和移动；结构时长可以是一帧，交互命中宽度可以更大。
6. 图片生成的视频是独立的普通视频剪辑块，能够继续移动、换层、切割。
7. 抽帧只表示：从当前媒体取一张图，创建一个新的普通图片剪辑块，默认放到上一层的对应位置。
8. 外部图片或视频拖入后，也创建同一种普通剪辑块，落到用户指定的位置和轨道。
9. 对应位置可以建立或选中镜头详情，但镜头详情不能反向控制、拖动或联动其他剪辑块。
10. 图层整体排序只重排轨道；只有用户明确移动整个图层时才批量改变其中剪辑块的轨道归属。

需要保留一个产品细节为显式决策：图片生成视频后，是保留原图片并新增视频，还是用视频替换该图片。无论选哪一种，都只能是一次明确的编辑命令；不能继续保留 `overlay + adopted shot + imageClip` 三份隐式状态。

---

## 二、今天犯过的错误——不要重做

### 错误 1：先把拖动失败当成命中问题

我们先后修过：

- `elementFromPoint` 被拖动预览或 pointer capture 遮挡；
- 用轨道 DOM 矩形推导目标层；
- `releasePointerCapture` 与 `lostpointercapture` 的先后顺序；
- 一帧图片命中宽度过小；
- 图片和视频的 z-index；
- Pointer Events 的 4px 阈值；
- 键盘逐帧、跨层移动。

这些局部问题可能真实存在，但不是用户当前失败的主因。用户在 `localhost:3000` 拖动后，Story 1186 的 timeline version 和所有 clip 位置均未变化，说明操作根本没有可靠进入唯一保存链路。

**禁止继续以“再改一次 pointerup / hit test”作为第一步。** 先证明一个纯领域命令可以把任意图片或视频从 `(trackId, start)` 原子移动到 `(nextTrackId, nextStart)`，再让所有输入方式只调用这个命令。

### 错误 2：混淆了用户操作的表面

早期把底部 Timeline 的测试和命中宽度当成上方 Storyboard 图层的验收证据，之后又试图把上方 Storyboard 建成跨全部镜头列的绝对时间轨。用户多次强调他操作的是上面的普通剪辑图层，不希望素材被其他镜头或图层联动。

不要再同时维护两套可编辑表面并双向同步。必须选一个 canonical editor。其他 Storyboard/镜头详情视图只能读取同一模型的投影，不能成为第二个位置真相来源。

### 错误 3：把抽帧和生成结果当成特殊实体

旧流程同时出现过：

- `imageClip`；
- overlay；
- source transition / candidate；
- adopted story shot；
- timeline item；
- generated Take。

这些概念可以保留在生成任务或素材谱系中，但**不能都参与剪辑位置的决定**。编辑器只应该看见普通 clip；生成记录只负责告诉 clip 使用哪个媒体源。

### 错误 4：让底层位置成为上层图片的父坐标

历史 `offsetFrames + ownerStartFrame` 语义导致移动底层视频时上层图片跟着移动。后来增加了 `timelineStartFrame` 兼容回退，但两套坐标仍共存，容易让不同读写路径得出不同位置。

新模型中每个 clip 的位置必须是独立绝对值。迁移完成后，渲染和移动路径不得再读取 owner shot 的开始位置来推导上层素材。

### 错误 5：测试通过就当成用户验收通过

上一轮 Storyboard 定向测试、TypeScript、build 和 `pnpm feature:validate` 均通过，但用户在 3000 实际拖动仍失败。单元测试只证明 helper 的预期，不证明浏览器事件、实际 DOM、保存 mutation、刷新后持久化整条链路成立。

以后必须区分：

- 领域模型测试；
- UI 事件测试；
- API/持久化测试；
- 主仓库 3000 的人工真实验收。

在主仓库 3000 没有完成“拖动 → 保存 → 刷新 → 仍在新位置”前，不得写“验收成功”，更不得因为测试绿了就合并。

### 错误 6：在功能卡里不断追加互相冲突的约束

`extracted-frame-overlay-video` 当前把抽帧、付费生成、视觉优先级、Storyboard、底部 Timeline、外部素材、图层管理、撤销、播放头和导出全部放在一个功能卡中。尤其这条 invariant 需要重新审视：

> Storyboard 与底部 Timeline 必须使用同一套视觉素材落位语义……

“同一领域模型”是对的，“两套 UI 都能独立编辑并互相同步”是错的。下一会话修改前必须先更新账本语义：**一个 canonical 多轨模型、一个写入口；其他视图只是投影。** 这是替换已有登记约束，用户已经批准按简单多轨剪辑模型重新设计，但仍应在账本 history 中明确记录替换原因。

---

## 三、建议的最小模型

不要一开始做大而全的 schema。先用最小接口证明移动成立：

```ts
type VisualTrack = {
  id: string;
  order: number;
  hidden: boolean;
};

type VisualClip = {
  id: string;
  kind: "image" | "video";
  trackId: string;
  startFrame: number;
  durationFrames: number;
  source: MediaSourceRef;
  shotDetailId?: string;
};

type MoveVisualClipInput = {
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
};
```

关键规则：

- 图片和视频调用同一个 `moveVisualClip`。
- 斜向拖动仍只提交一次 `moveVisualClip`。
- 服务端在一次写入里验证 clip、track 和边界，并同时更新 `trackId + startFrame`。
- API 接受 clip id 和目标，不接受“把整份 timeline 从客户端覆盖回来”。
- 移动单个 clip 时不能遍历并重写同层或同 shot 的其他 clip。
- 切割只针对 video clip，生成左右两个普通 clip 或调整边界。
- 图层插入、删除、排序是独立 track 命令；不要复用 clip move 的隐式副作用。
- 镜头详情关联是 clip 的可选关系，不是坐标父级。
- undo 记录领域命令前后值，不记录整份易漂移的 UI 快照。

如果暂时不能改数据库结构，可以先写一个 adapter，把现有 `timelineItem/imageClips` 投影成 `VisualClip[]`。但 adapter 必须是唯一兼容层；组件和 mutation 不得继续直接理解 `offsetFrames`、owner shot、overlay 等历史差异。

---

## 四、接口收敛建议

用户担心“接口会很乱”，这个担心是对的。动 UI 前先做一次调用图盘点。

目标不是给现有每个接口再包一层，而是收敛为少量编辑命令：

1. `moveVisualClip(clipId, toTrackId, toStartFrame)`
2. `insertVisualClip(source, trackId, startFrame, durationFrames?)`
3. `removeVisualClip(clipId)`
4. `splitVideoClip(clipId, atFrame)`
5. `insertTrack(atOrder)` / `removeTrack(trackId, policy)` / `moveTrack(trackId, toOrder)` / `setTrackHidden(trackId, hidden)`
6. `attachShotDetail(clipId, shotDetailId)` 或在插入命令中一次创建

生成流程与编辑流程分开：

- quote / submit / task status 属于 generation domain；
- generation 完成后只返回一个 media source；
- “采用结果”调用普通 `insertVisualClip` 或显式 `replaceVisualClipSource`；
- 生成任务不得直接批量改 timeline、创建 overlay、重排图层和移动其他 clip。

重点搜索和审计这些现有位置：

- `client/src/features/creationEditor/views/StoryboardEditRow.tsx`：约 4000 行，当前同时负责图层头、素材归一化、拖放、文件导入、移动、镜头、生成候选和多个轨道 UI。它是首要拆分/删除候选，不要继续膨胀。
- `client/src/features/storyAgent/views/StoryboardReviewBoard.tsx`：把 `StoryboardEditRow` 跨全部镜头列插入；确认它是否仍应承载 canonical editor。
- `client/src/features/creationEditor/views/EditingNleWorkspace.tsx`：底部 Timeline 的第二套移动实现。决定 canonical surface 后删除重复写路径或改为只读投影。
- `client/src/features/storyAgent/StoryAgentContext.tsx`：盘点 timeline mutation 和整份时间线回写。
- `shared/storyMaterial.ts`：`timelineStartFrame`、`offsetFrames`、`visualLayer`、`imageClips` 的兼容语义。
- `shared/timelineLayout.ts`：视觉赢家、图层与位置投影。不能让它反过来成为编辑写模型。
- `server/routers/storyAgent.ts`：插入/采用生成结果和 timeline 更新边界；寻找多条能够修改同一 clip 位置的接口。

建议先画出“哪个 UI → 哪个 mutation → 哪个持久化字段”的表。凡是能改 clip 坐标但不走统一命令的入口，都要删除、迁移或设为只读。

---

## 五、实施顺序（不要跳到浏览器拖拽）

### 第 0 步：环境与保护

必须先执行：

```bash
pnpm env:status
git status --short --branch
```

只允许主仓库 `/Users/yuandai/Documents/New project/drinking-time-local` 的 3000 服务运行。worktree 不得启动 dev/preview server，不得向 worktree `.webdev` 写业务数据。

主 checkout 当前分支是 `codex/story-visual-assets`，并有另一会话的未提交视觉资产服务端修改。不要覆盖、stash、reset 或混入本任务。开始前重新检查实际状态。

### 第 1 步：更新功能账本的设计约束

修改前检查：

```text
docs/features/feature-ledger.json
功能卡：extracted-frame-overlay-video
```

把“Storyboard 与底部 Timeline 双向共用落位语义”改成“唯一多轨编辑模型和唯一写入口；其他视图只读投影”。在 history 里明确记录：此前 Pointer/hit-test 修复没有解决真实移动，原因是写模型分裂。

### 第 2 步：先写领域测试

完全不渲染 React，先验证：

- 图片左右移动；
- 视频左右移动；
- 图片/视频上下换轨；
- 一次斜向移动同时改变位置和轨道；
- 移动底层视频不改变任何其他 clip；
- 刷新/重新读取后位置保持；
- 相同 operation id 重试不会移动两次或创建副本；
- 图片一帧结构时长保持为 1。

如果这些测试需要构造整份 story/timeline 才能移动一个 clip，说明接口仍然太大。

### 第 3 步：建立 adapter 和唯一 mutation

先让现有数据能投影为统一 `VisualClip[]`，再让唯一 mutation 写回。不要在这一步改拖拽 UI。

用直接 API 或测试证明：指定 clip 从 A 移到 B，只有该 clip 的 `track/start` 变化，timeline version 递增一次。

### 第 4 步：把 UI 缩成薄层

UI 只负责：

- pointerdown 记录起点；
- pointermove 显示临时 transform；
- pointerup 将像素换算成 `toStartFrame/toTrackId`；
- 调用一次 `moveVisualClip`；
- 成功后使用服务端结果，失败则回滚预览并明确提示。

图片和视频必须复用同一 DraggableClip 外壳。不要复制两套 handler。

### 第 5 步：主仓库 3000 真验收

只在主仓库已有服务验收，不在 worktree 起服务。至少逐项操作并刷新：

1. 拖动一张图片向右，刷新后仍在新位置。
2. 拖动同一图片到上一层，刷新后仍在新层。
3. 斜向一次拖动图片。
4. 对普通视频重复以上三项。
5. 移动底层视频，记录上层所有 clip id/位置前后完全一致。
6. 切割生成视频，得到两个可独立移动的视频块。
7. 抽一帧，确认产生普通图片块；移动它。
8. 将该图片生成视频，确认结果是普通视频块；移动并切割它。
9. 从 Finder 拖入图片和视频到指定层/位置，刷新后保持，并能进入对应镜头详情。
10. 新增、隐藏、排序、删除空轨道；非空轨道删除必须明确迁移策略，不能静默删素材。

每项都要验证“UI 看起来移动”与“服务端持久化后刷新不回弹”。

### 第 6 步：删旧代码，再跑全量验证

新链路跑通后再删除：

- 旧 overlay 的交互写路径；
- 图片/视频各自重复的拖动 handler；
- Storyboard 与底部 Timeline 的双向位置同步；
- `offsetFrames` 的运行时位置推导（迁移完成后）；
- 只服务于旧命中补丁而不再被调用的 helper/test；
- 生成采用流程中直接修改多份编辑状态的代码。

最后运行定向测试、`pnpm check`、build（若仓库惯例要求）和 `pnpm feature:validate`。账本证据只写实际通过的内容。

---

## 六、当前代码和数据状态

### 已合入但用户未验收通过的提交

这些提交不能当成功基线；也不要未经审计直接 revert，因为可能夹带独立有效修复：

```text
1b23902 fix(editing): make storyboard layer drags commit reliably
8917eb8 merge: stabilize storyboard visual layer dragging
e332321 docs(features): attach storyboard drag evidence correctly
d1861f5 merge: correct storyboard drag ledger evidence
51ff97f fix(editing): make one-frame clips easy to grab
d84eca4 fix(editing): unify visual clip placement across layers
```

应逐项判断：哪些测试/样式可保留，哪些同步和 helper 会被统一模型删除。

### Story 1186 的最近基线

- title：`SheSelf V03`
- timeline id：`1133`
- 最近观察 version：`226`
- `visualLayerState` 最近观察为 `{ count: 3, hidden: [] }`
- 用户失败拖动后，timeline version 与 clip 位置没有变化

此前观察到的素材包括：

- `legacy-sh01-shot`：底层视频，`timelineStartFrame=0`, `visualLayer=0`
- 图片 `#1702` 的两个 clip：frame 0 / layer 1
- `image-clip-1708`：frame 107 / layer 1
- `transition-shot-c366b38f2373671c`：frame 71 / layer 1
- 图片 `#1723`：frame 141 / layer 2

这些只是诊断基线。主仓库数据持续变化，下一会话必须重新读取，不得盲写旧 version。

### 主仓库未提交修改

交接时主 checkout 中存在另一会话的视觉资产工作，至少包括：

```text
docs/features/feature-ledger.json
server/_core/env.ts
server/routers/storyAgent.ts
server/services/imageGen.ts
server/services/visualAssetCreation*.ts
server/services/visualAssetGenerationContext*.ts
server/services/visualAssetPersistence*.ts
docs/handoff/2026-08-22-visual-asset-ui-completion-handoff.md
scripts/check-oss-public-refs.ts
server/services/publicReferenceHost*.ts
```

不要把这些改动算作本任务，不要还原。`docs/features/feature-ledger.json` 与 `server/routers/storyAgent.ts` 可能重叠，修改前必须人工合并意图。

还有旧保护 stash：

```text
stash@{0}: codex-pre-unified-visual-integration-20260822
```

必须保留，除非用户明确要求处理。

---

## 七、付费与运行环境红线

- 本次重构和移动验证不需要提交任何付费生成任务。
- 不得充值、购买额度或为了测试重复生成。
- 如果要验证已生成视频，先查既有任务和 Take，复用现有结果。
- 不得直接编辑 `.webdev/local-persist.json`。
- 不得在 worktree 启动 dev/preview server。
- 主仓库 3000 是共享进程；修改 server 文件可能触发重启并打断其他会话任务，动之前确认没有正在进行的生成。
- 浏览器验证无法完成时必须如实写“未做 UI 验收”，不得用单测代替。

---

## 八、完成定义

只有同时满足以下条件才能向用户说“改好了”：

1. 一个统一 clip 模型覆盖图片和视频。
2. 一个唯一 mutation 完成单 clip 的横向和纵向移动。
3. 移动底层 clip 不写任何其他 clip。
4. 抽帧、生成结果和外部导入最终都产生普通 clip。
5. 生成视频可切割，切割后的两段可独立移动。
6. 图层可新增、隐藏、排序和安全删除。
7. Story 1186 或用户指定故事在主仓库 3000 完成逐项真实拖动，刷新不回弹。
8. 测试、类型检查、功能账本验证通过。
9. 旧的重复写路径已删除或明确只读，不再保留“双向同步以后再说”的尾巴。
10. 先让用户验收，再合并；不要再次把自动化绿灯当成用户验收。

最重要的判断标准很简单：**抓住任何一张图片或一个视频，拖到哪里，它就独立地留在哪里；刷新以后仍在那里。**

---

## 九、可直接粘贴给下一对话的开场提示词

```text
请接手 drinking-time-local 的普通多轨剪辑器架构收敛。开始前完整阅读：

docs/handoff/2026-08-22-simple-multitrack-editor-architecture-reset.md

先遵守 AGENTS.md：第一步运行 pnpm env:status；修改前检查 docs/features/feature-ledger.json 中 extracted-frame-overlay-video。worktree 只改代码，不启动任何 dev/preview server，也不写 worktree 的 .webdev；真实效果只在主仓库现有 localhost:3000 验证。

今天已经犯过的错误是：把简单的轨道/剪辑块移动同时绑定到 Storyboard、底部 Timeline、overlay、story shot 和多套写接口，然后不断修 Pointer Event 和命中逻辑。自动化全绿后用户真实拖动仍失败。不要继续修旧拖拽 helper，也不要把单测当 UI 验收。

目标是标准多轨剪辑模型：图片和视频都是独立普通 clip；每个 clip 只保存自己的 track、start、duration、source；左右移动改 start，上下移动改 track，一次斜向拖动只提交一个原子命令。移动底层视频绝不能改上层素材。抽帧创建普通图片 clip；生成结果与外部导入都进入同一种普通 clip；生成视频可正常切割。轨道可新增、删除、隐藏和排序。

请先盘点所有能写 clip 位置的接口，建立唯一领域命令和兼容 adapter，再接薄 UI；不要继续扩充约 4000 行的 StoryboardEditRow.tsx。新链路跑通后删除重复同步、旧 overlay 交互写路径和 ownerStartFrame/offsetFrames 的位置推导。主仓库当前有其他会话未提交修改，必须保留，不得 reset/stash/覆盖。

完成前必须在 localhost:3000 逐项验证图片、普通视频、生成视频的左右/上下/斜向移动，刷新不回弹；验证底层移动不牵连上层、视频可切割、外部素材可落位、轨道管理可用。没有真实验证就明确报告未验收，不要合并。移动验证不需要付费，禁止充值或重复提交生成任务。
```
