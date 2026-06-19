# Codex 执行提示词包 —— Agent 脊柱第一刀

> 用法：先发**主提示词（一次）**建立上下文与铁律；然后每个单元一条提示词，按 U1→U6 顺序，一个单元一个提交。每条单元提示词执行完、跑测试、回主仓 3000 端口验证后再发下一条。
> 计划全文：`docs/plans/2026-06-18-001-refactor-agent-spine-first-cut-plan.md`

---

## ⚠️ 修订（2026-06-18，canonical 故事）—— 给正在执行的 Codex

把这段也发给 Codex：

```
计划有一处载入性修订（已写进计划文件，标 D1''）。背景：用户发现同一个故事在 4 个面板（Story Cards / Script / 动态分镜 / 提示词表）内容不统一——因为今天有 4 份并行真相、2 个层级（cards/scripts 在内存，分镜/提示词表从服务端 body 另起 normalizeStoryShots 派生）。这导致 Agent 无法有统一 context。

修订后的边界 D1''（取代原 D1'）：
- 脊柱拥有唯一 canonical 故事；cards/scripts/shots/prompts 都是它带"血缘(derivedFrom)+过时(stale)"标记的派生投影；4 面板从脊柱投影。
- 动态分镜/提示词表不再从服务端 body 另起派生；服务端 body 降级为脊柱的持久化下游，不是竞争真相。
- 同源但脱钩：下游可滞后并标"过时"，由用户按钮重生（本刀只落数据模型，不建过时 UI/按钮）。

对你的影响：
- U1（建 store + 迁移 + 收敛 effect）与本修订兼容，照常做——但 store 模型从一开始就把 cards/scripts/shots/prompts 建成 canonical 故事的派生投影，并给每个阶段产物留 derivedFrom + stale 字段。
- 写完 U1 后【暂停】，等用户确认 U3（把分镜/提示词表统一到脊柱）的最终形态再继续。U3 是这次修订的核心改动。
- 凡你在计划里看到旧 D1' 措辞（"react-query 各管各 body、脊柱只读"），一律以 D1'' 为准。
```

---

## 主提示词（每次会话开头先发）

```
你在仓库 drinking-time-local 上执行一份已评审的重构计划：
docs/plans/2026-06-18-001-refactor-agent-spine-first-cut-plan.md
配套来源需求：docs/brainstorms/2026-06-18-002-agent-spine-bidirectional-requirements.md
开工前请完整读这两份，以及 AGENTS.md。

【铁律（违反即失败）】
1. 数据安全：本地持久化 .webdev/local-persist.json 跟 process.cwd() 走（server/db.ts）。历史上有两次数据分裂事故。任何触及故事 body 的改动必须"写向也安全"——不仅读向兼容。
2. worktree 不准跑 dev server / preview，不准向 worktree 的 .webdev/ 写业务数据。要看运行效果只回主仓 3000 端口（pnpm dev）。诊断环境先跑 pnpm env:status。
3. 只做计划里当前单元的范围。计划标"surface-and-stop checkpoint / manual-gated"的地方，你必须产出你的选择、停下来等我确认，不许自行拍板继续——尤其是 worktree 内无法用 dev server 验证的 runtime 行为。
4. 特征化先行：凡计划注明 Execution note 的单元，先补"现状行为"测试作基线，再改。
5. 每个单元 = 一个聚焦提交。改完跑该单元 Test scenarios 列出的 vitest 用例 + 现有测试，全绿再停。报告：改了哪些文件、测试结果、以及任何你停下来要确认的 checkpoint。

【架构边界（D1'，载入性，别违反）】
- 脊柱（Zustand storySpine）只持有"客户端创作理解"：intent、rationale、在途编辑、选区、UI 工作态、存盘态。
- 服务端持久化 body（cards/shots/images）仍归 @tanstack/react-query 所有。脊柱经 selector 在其上读取，不复制、不接管 shots/images 所有权。
- intent / rationale = shot 上两个可选字段（per-shot）。本刀不建"编辑事件账本"。

确认你已读完三份文档并复述上述铁律与边界，然后等我发第一个单元（U1）。
```

---

## U1 —— 建脊柱 store + 迁移状态 + 同刀收敛 effect/ref

```
执行计划单元 U1（见计划文件 U1 节）。

目标：引入 Zustand storySpine 作客户端理解单一真相源，迁移 canonical 客户端态，并在同一提交内把脆弱的持久化机制收敛掉——不许留"状态在 store、effect 仍读 React 旧值"的双真相窗口。

必做步骤：
1. 先产出 client/src/features/storyAgent/StoryAgentContext.tsx 里 14 个 useEffect 的"effect 清单"，每个分类：(a)纯派生→selector (b)持久化副作用→收敛为对 store 的单一订阅 (c)ref 镜像 hack→删除。把清单贴给我。
2. 自动保存定时器（约 L699-755）改读 store.getState()，不再用 stale 闭包。
3. 把 hydratedFor、serverRevision、lastSnapshotHash 移成 store 字段。
4. 删除 storyImagesRef / confirmedIntentRef / pendingIntentDraftRef / isReplyingRef 等镜像，统一从 store 读。
5. useStoryAgent() 对外签名保持不变。

特征化先行：迁移前先补"加载→编辑→自动保存tick→快照"现状测试作基线。

验收（必须全部满足）：
- StoryAgentContext.tsx 内无残留"React 态↔store"镜像 effect。
- 两个自动保存 effect + hydration 门收敛为单一 store 驱动持久化路径。
- 测试：加一张故事图后触发自动保存tick→快照含该图不丢字段；单次逻辑改动只一条持久化写（不双写）；hydration 未完成不让空 store 覆盖已加载故事。
文件：见计划 U1 Files。完成后报告 + 让我回 3000 端口验证再继续。
```

---

## U2 —— storyAgent 系面板走窄/等值 selector

```
执行计划单元 U2。前置：U1 已合并。

目标：把聊天 / StoryCards / 剧本三个 storyAgent 系面板改为按 selector 只订阅各自切片，消除"动一处全体抖"。注意派生切片的引用稳定性。

关键陷阱（评审指定，必须处理）：promptPool = buildPromptPool(visualCanvasItems) 每次返回新数组；拖动视觉锚点(updateVisualCanvasItem 改 x/y/w/h)会让派生 selector 拿到新引用、引发重渲染甚至 Zustand 循环。对每个派生切片：物化为 store 字段（由所属 action 更新）或用 zustand/shallow 比较。这一步具体策略若需按面板派生形状定，产出你的选择即停。

不做：动态分镜/提示词表（跨 creationEditor，归 U3）。

测试（必须含）：
- 改 cards 只触发 StoryCards 重渲染，剧本/聊天不重渲染（render 计数断言）。
- 拖动视觉锚点 10px → 提示词表/派生面板 render 计数不变。
- 聊天发消息 → 仅聊天面板重渲染。
文件：见计划 U2 Files。完成后报告 + 回 3000 验证。
```

---

## U3 —— 划清脊柱 ↔ react-query 所有权边界

```
执行计划单元 U3。前置：U1 已合并。

目标：实现 D1' 边界。动态分镜(AnimaticPanel)/提示词表(PromptTablePanel)继续由 CreationEditorProvider + react-query 持有服务端 body；脊柱只经 selector 向它们注入"客户端理解"（如该镜 rationale/intent 的展示），不接管 shots/images 所有权。

硬约束：不要把 shots/images 所有权搬进 Zustand。若你认为某状态确需搬进脊柱才能去耦——停下来标 checkpoint 等我确认，不许自行搬迁服务端所有权。

测试：两面板仍从 react-query 取 body 正常渲染；脊柱注入的 intent/rationale 正确显示；activeStoryId 切换后两套数据一致；脊柱无对应字段时降级正常。
文件：见计划 U3 Files。完成后报告 + 回 3000 验证。
```

---

## U4 —— 删冗余共享（先清单后删）

```
执行计划单元 U4。前置：U2、U3 已合并。

目标：删除面板间点对点共享/重复状态，统一经脊柱或 D1' 边界读取。但必须先清单后删，不许开放式横扫。

必做：
1. 先产出书面清单 docs/plans/u4-redundancy-inventory.md：枚举 WorkspaceLayout/AnalysisWorkspace 透传 props 与各面板自存重复态，逐项标"走脊柱 / 真冗余可删 / runtime-only"。把清单贴给我复核。
2. runtime-only 依赖一律标 manual-gated——worktree 内不能跑 dev 验证，等我回 3000 端口确认后才删。
3. 只删我复核通过的项。

测试：删某冗余态后依赖面板仍从脊柱/边界取到等价值；A 面板改动不再经共享 prop 牵连 B 面板。
文件：见计划 U4 Files。先贴 inventory 等复核，再动手删。
```

---

## U5 —— shot 加 intent/rationale 两字段 + 写向安全

```
执行计划单元 U5。前置：U1 已合并。Execution note：触及持久化，先加 body 形状快照测试钉住现状再改。

目标：给 shot 加 intent?/rationale?（可选，per-shot，无账本），三处类型同步，并把保存改为字段保留式合并防数据抹除。

必做（三处类型同改，缺一即往返丢字段）：
- drizzle/schema.ts 的 StoryBody.shots[]
- client/src/features/storyAgent/types.ts 的 StoryShot
- creationEditor 的 normalizeStoryShots（透传新字段）
写向安全（评审指定的数据安全核心）：改 server/services/storySync.ts 的 prepareStoryBody——传入 body 缺 intent/rationale 时从既有 body 保留，绝不整体覆盖抹除（防被 defer 的手机/创作线一存抹光）。

测试（必须含）：
- 写带 rationale 的 shot→保存→重载，原样保留。
- 加载缺字段旧故事→读为 null、不破坏其余字段。
- 关键：缺 rationale 的"手机形状"body 覆盖存到已有 rationale 的桌面 body → rationale 存活。
- body→normalizeStoryShots→body 往返新字段不丢。
文件：见计划 U5 Files。完成后报告 + 回 3000 验证存取无异常。
```

---

## U6 —— 理由从剧本贯穿到出图并回显

```
执行计划单元 U6。前置：U5 已合并。

目标：让 intent+rationale 从剧本写到 shot，经 SceneAnalysis 在两个 compose 调用点都带上，理由作为生成图记录的同级字段（不进 prompt），在指定面板回显"当前为什么"。

关键事实（评审核对，别漏）：
- composePromptFromAnalysis 读的是 shared/sceneAnalysis.ts 的 SceneAnalysis（无 shot 引用/无 rationale）——要给它加可选 rationale?/intent? 字段。
- compose 有两个调用点：server/routers.ts 的 generateForMobile(约 L1648) 和 server/services/creationAgent.ts(约 L600)。两个都要改，否则桌面/手机半成品。
- compose 输出有 900 字截断——rationale 不要拼进 prompt 字符串，作为生成图记录的同级字段携带。
- 回显只显示当前 rationale，不做历史/账本列表 UI，走现有图卡片文字槽，不加按钮。落点选 spine 可读的 StoryCards 一侧，别依赖 U3 未决的 creationEditor 所有权。

测试：剧本带 rationale→两个 compose 调用点输出都保留→生成图带可回看的"为什么"；选中镜头"再压抑一点"→调整+理由→写回脊柱+出图回显(covers AE3)；剧本无 rationale→降级不报错；两调用点端到端不丢。
文件：见计划 U6 Files。完成后报告 + 回 3000 验证：改剧本→出图→图上看到对应"为什么"。
```
