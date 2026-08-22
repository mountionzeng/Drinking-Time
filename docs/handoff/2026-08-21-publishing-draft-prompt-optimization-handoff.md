---
date: 2026-08-21
topic: publishing-draft-prompt-optimization
status: 提示词优化已移植到最新 main 并提交在集成分支；待合并、待真实界面验收
branch: optimize/publishing-draft-prompt-integration
base: main 9759a17
worktree: .worktrees/publishing-draft-prompt-integration
superseded_branch: optimize/publishing-draft-prompt-contract (b22a247)
---

# 现状：发布文稿提示词优化

## 一句话状态

发布文稿提示词的内容契约优化**已经完成并落在最新 main 的实际运行时路径上**，
硬约束失败 13 → 0，全程零外部调用。代码在集成分支
`optimize/publishing-draft-prompt-integration` 的 4 个提交里，工作区干净、验证全绿，
**尚未合并进 main，也尚未做真实界面验收**。

旧优化分支 `optimize/publishing-draft-prompt-contract`（`b22a247`）已被取代，不要再合并它。

## 已完成

### 四个提交

| 提交 | 内容 | 证据 |
|---|---|---|
| `5c2cd33` | `refactor(publishing)` 把 7 段运行时提示词抽成导出的纯编译函数 | 抽取前后逐条比对文件内 66 个中文字符串字面量完全一致；tsc + 64 项测试通过 |
| `4d8d9a8` | `test(publishing)` 12 场景离线契约评测接入真实运行时编译路径 | 在该提交点跑出的即 main 基线，固化在提交历史里 |
| `1af30dd` | `optimize(publishing)` 三组提示词约束 | 硬约束失败 13 → 0 |
| `0e5d2f8` | `fix(publishing)` visualConcept 不再作为标题锚点来源 | 新回归测试，且验证过恢复旧行为时会失败 |

### 三组提示词约束具体做了什么

1. **事实边界**（`generate`、`convert`）。显式约束来源身份、时态与确定程度：看到、听说、
   报道、计划、可能或小样本都不得升级成已确认或普遍结论，且事实边界优先于用户要求。
   另外声明 `core.visualConcept` 只服务后续美术与封面，不得反向主导正文。
   清掉 8 次 `preserve_epistemic_status` 与 4 次 `visual_concept_is_not_copy_direction`。

2. **结构修复最小编辑**（三条模型兜底路径）。修复提示词原本仍带着完整的平台文风与标题
   创作上下文，等于允许模型借修复之名重写。改为修复专用上下文：`invalidOutput` 是唯一
   待修复候选，逐字段复制，只修 JSON 结构与不可避免的平台硬长度。
   用户点「只修格式」走的确定性本地路径（`repairPublishingDraftFormatting`）不受影响。

3. **标题与标签冻结**（`revise`）。`preserveAppliedPublishingTitle` 只在事后兜底，且
   `current.title` 为空时不生效——用户尚未写标题时，一句「缩短正文」仍会让模型顺手创作
   标题。改为在提示词层声明标题由独立标题操作管理，未点名的标签逐项原样复制，并移除
   改写路径的标题创作上下文。

### 一个旧文档没有记录的代码层问题

`server/services/publishingDraft.ts` 的 `publishingCoreTitleSources()` 原本把
`core.visualConcept` 列进 `titleAnchor` 的合法取材来源。由于 `titleAnchor` 必须在来源里
逐字出现才算有效，这等于在**校验层**明确放行「标题取自封面美术联想而非真实素材」的稿子，
与第 1 组刚立的内容主权边界正面矛盾。只加提示词约束压不住，因为校验器仍会放行。

已移除。行为变更：仅锚在美术概念上的标题会被判无效并丢弃，正文保留——这正是要拦的情况。

### 指标

全程离线，`provider_call_count` 始终为 0。

| 指标 | main 基线 | 现在 |
|---|---:|---:|
| `hard_invariant_failures` | 13 | **0** |
| `unsupported_fact_risk_count` | 12 | **0** |
| `conflicting_instruction_count` | 1 | **0** |
| `instruction_precedence_risk_count` | 1 | **0** |
| `generic_template_risk_count` | 11 | 11（未动，见下） |
| `prompt_character_count` | 13066 | 13651 |

提示词总长只增加 4.5%，因为第 2 组用更短的修复专用上下文换掉了旧的「平台文风 + 标题创作」
上下文，抵消了新增。

### 验证（HEAD 上跑过）

| 命令 | 结果 |
|---|---|
| `pnpm check` | 通过 |
| `pnpm exec vitest run evals/ server/services/publishingDraft.test.ts server/routers.publishingDraft.test.ts` | 133 项通过 |
| `pnpm eval:publishing-draft` | 退出码 0，五个闸门全绿 |
| `pnpm feature:validate` | 26 张卡有效 |

相邻发布服务（`publishingPersistence`、`publishingPlatformContext`、`storySync.publishing`）
另有 40 项测试通过，未见回归。

## 对旧交接文档判断的修正

旧版本文档写于移植前，其中三条判断已被实测推翻，保留在此以免下次重复同样的评估：

1. **「必须做语义移植，工作量很大」——高估了。** 三个优化提交的真实语义载荷约为 10 句中文
   提示词约束。`b22a247` 分支 1445 行改动里，1070 行是评测、333 行是新文件，
   `publishingDraft.ts` 的 249 行「改动」几乎全是把提示词搬进新模块的重构。

2. **「与最新 `publishingDraft.ts` 存在真实冲突」——冲突源于那次重构，不是语义。**
   main 对该文件的净改动只有 68 行三个 hunk（操作策略表、确定性格式修复、convert 的
   `currentTarget`）。放弃搬运模块拆分、改为在原文件内就地导出编译函数后，一行冲突都没有。

3. **「要先判断哪些语义已被 U4/U6 覆盖」——一条都没覆盖。** 把评测接到 main 真实运行时后
   跑出的基线（13 / 12 / 1 / 1 / 11）与旧分支当年记录的基线逐项相同，说明发布生命周期合同
   的工作没有触及任何一条内容契约，三项改进全部真缺。

另外，`evals/` 目录在 main 上早已存在并有成熟约定（`run.ts`、`baseline.json`、golden set、
退出码 0/1/2），其 README 已经写死了「测当前编译代码，不读历史 compilation 文本」这一原则。
新评测是按这套约定接进去的，不是另起炉灶。

## 还剩什么

### 1. 合并进 main（阻塞中）

主 checkout 当前在 `codex/story-visual-assets`，有约 97 个属于其他任务的未提交改动
（视觉资产、剪辑、发布画册、路由、功能账本等）。其中 `server/routers/publishingDraft.ts`
与 `server/routers.publishingDraft.test.ts` 也是脏的，但改动是 +43 行 cover/storyboard 相关，
未触及 `generate` / `convert` / `revise` / `repair` 四条路径，与本分支不冲突。

合并前要确认那批改动已经落地，且没有其他 Agent 正在做跨分支收敛。不要在主 checkout 直接
merge、rebase、stash 或清理别人的工作。

2026-08-21 观察到主 checkout 的未提交文件数在几分钟内由 97 增至 101
（新增 `client/src/features/creationEditor/publishingHandoffScope.ts` 及其测试），
说明当时确有另一个 session 正在写入。合并前重新确认。

**合并前必须先删掉主 checkout 里这份文档的未跟踪副本**：

```bash
rm docs/handoff/2026-08-21-publishing-draft-prompt-optimization-handoff.md
```

本文档已随本分支提交，主 checkout 里那份是改写时留下的未跟踪副本。已实测：即使两份内容
逐字节相同，`git merge` 仍会以「untracked working tree files would be overwritten」拒绝。
删掉后合并是 **fast-forward，零冲突**（8 个文件，+1610 / -125）——在一个游离 HEAD 的临时
worktree 上验证过，未推进任何分支。

### 2. 真实界面验收（未开始）

运行中的 3000 服务跑的是主 checkout 的 `codex/story-visual-assets`，**不含本轮改动**，
因此现在无法在界面上验收。必须等合并完成、3000 所在分支包含这些提交之后再做。

界面真实生成会调用线上文稿模型。Agent 不得代替用户点击生成；必须先说明可能的外部调用和
成本，由用户决定。尽量使用专用测试 Story，修改真实 Story 前备份 `.webdev/`。

#### 非付费/不自动提交检查

- 打开 `http://localhost:3000/editing`，进入发布区的「正文」。
- 选择已有故事和发布版本，确认切换工作台本身不自动生成、不自动扣费。
- 手工改标题和正文，切换平台/版本后再返回，确认没有串稿或静默覆盖。
- 有未保存正文时切版本，确认出现既有 dirty buffer 处置，而不是直接丢稿。
- 刷新页面，确认版本、平台、人工标题和已选标签仍保持。

#### 用户明确允许真实文稿生成后

1. **首次生成**：使用含「可能、传闻、计划、小样本、虚构」等限定词的素材，确认输出没有把
   不确定内容升级为事实，也没有把 `visualConcept` 当成正文剧情。
2. **正文改写**：先手工修改标题和标签，再只要求「缩短正文」或「更克制」。
   预期：正文变化，标题不变，未点名标签不变。
3. **标题单独修改**：明确要求改标题时才允许标题变化；正文和未点名标签保持。
4. **平台转换**：转换到一个目标平台，确认只产生目标平台候选，不串写其他平台，不无端补
   CTA、卖点、普遍结论或无来源标签。
5. **X**：确认无独立标题，thread 长度和段数符合硬约束。
6. **结构/格式修复**：构造格式不合规但内容正确的候选，确认只修 JSON、长度或 X 硬格式；
   标题、正文、标签、事实和确定程度不借机重写。
7. **候选保护**：生成/转换/改写结果先显示为候选，未点采用前不能覆盖正式稿。
8. **重复与刷新**：同一操作遇到刷新或重试时，应恢复已完成 receipt，不重复调用模型，
   不让旧响应覆盖后来编辑。

验收时保存输入、生成前稿、候选稿和采用后稿，用于逐项比较。不要只凭「读起来还行」判断；
重点找事实新增、观点反转、确定程度升级、标题被覆盖、标签被改、平台串写、营销化和模板化
AI 腔。

### 3. `generic_template_risk_count` 仍为 11（已另开一轮）

根因是 `narrativeIntentContext()` 结尾那句对所有用途通用的表述：

> 「无论用途是什么，都从人的基本诉求出发：被看见、被理解、归属、尊严、安全、成长、爱或
> 创造……」

同函数里 gift 分支的「想说却没说出口的话」也有同样的诱导补写风险。诊断集中在 5 个 case：
4 个 `initial_generation`（preserve / gift / share / create 各一）+ 1 个 `platform_conversion`。

**已经失败过的做法，不要重复**：旧分支第 4 次实验直接删掉这两处，并把素材边界收窄为
「人、物件、动作、判断、情绪」一条通用枚举。分数只升 0.17（低于 0.2 保留门槛），而且新枚举
遗漏了 create 场景需要的世界规则，因此完整回退。结论是不要再用一条通用枚举覆盖所有用途，
应按 preserve / gift / share / persuade / create 分别定义素材边界和写作顺序。

### 4. 功能账本未更新

`publishing-workspace` 等相关卡的 history、权威文件和测试证据尚未更新。按约定，在真实 UI
全链路验收完成前保持 `observing`，不能因为代码和单测通过就升级成 `working`。

### 5. 有意未移植的部分

旧分支为三条修复路径准备了中性的 `DRAFT_REPAIR_OUTPUT_SCHEMA`（字段描述一律写「字符串」，
避免 schema 描述本身携带写作指令）。本轮未移植：接入后硬约束已经归零，没有测得增益，
按「只改评测确认的问题」的约定跳过。如果以后修复路径仍出现借机重写，这是第一个可以补的点。

旧分支的模块拆分（`server/services/publishingDraftPrompts.ts`）也未移植——那正是冲突的来源，
就地导出即可满足评测需求。

## 权威文件

| 文件 | 作用 |
|---|---|
| `server/services/publishingDraft.ts` | 7 个提示词编译函数 + 运行时调用、解析、验证、修复路径 |
| `server/services/publishingDraft.test.ts` | 服务层单测，含 visualConcept 锚点回归测试 |
| `evals/publishingDraftPromptCases.ts` | 12 个固定场景 |
| `evals/publishingDraftPromptContract.ts` | 契约检查、评分与故障诊断 |
| `evals/publishingDraftPromptContract.test.ts` | 评测器自身测试 |
| `evals/run-publishing-draft-prompt-contract.ts` | `--offline` 入口与退出码 |
| `package.json` | `pnpm eval:publishing-draft` |

## 不可破坏约束

以下约束已登记在功能账本或由现有生命周期实现保证；如果计划削弱、替换或删除其中任何一条，
必须停止并让用户明确选择：

- 六个平台稿相互隔离，转换只写目标平台。
- X 不使用独立标题。
- 人工标题不得被转换、正文改写、格式修复或无效模型标题清空。
- 未点名的人工内容默认保持；已有人工稿先进入候选，不能自动覆盖。
- V2 写入不能改变 V1；`versions[]` 是发布内容唯一持久权威。
- 版本 CAS、revision、operation token 和幂等 receipt 语义不得改变。
- 迟到响应不能跨 Story、版本、平台或覆盖之后的新编辑。
- 实质故事内核/意图变化只能提出创建新版本，不能原地改写当前版本。
- 无授权实时趋势来源时必须 fail closed，不能抓网页、猜接口或让模型伪造热点。
- 不启动 worktree dev server，不向 worktree `.webdev/` 写业务数据。
- 不自动触发付费生成或外部文稿模型调用。
- 用户已经明确：只改他指出或评测确认的问题，其他满意部分不要动。

## 完成定义

代码侧的完成条件已经全部满足。剩余条件：

- [ ] 集成分支合并进 main，且没有误伤主 checkout 里其他任务的未提交改动。
- [ ] 运行中的主仓库 3000 已包含这些提交。
- [ ] 用户按上面的清单完成真实界面验收；未验收的部分明确标为未验收。
- [ ] 功能账本相关卡的 history 与测试证据更新。
- [ ] 合并后清理 `.worktrees/publishing-draft-prompt-integration` 与集成分支；
      旧分支 `optimize/publishing-draft-prompt-contract` 的价值已被吸收，可在用户授权后清理。

已满足的：

- [x] 优化语义落在最新 main 的实际运行时路径上，而非旧分支或离线 fixture。
- [x] 评测编译的正是当前运行时提示词，硬门禁全过且 provider 调用为 0。
- [x] 人工标题、候选保护、平台隔离、版本 CAS、receipt 和竞态测试无回归。
- [x] `pnpm check`、相关 Vitest、离线评测与 `pnpm feature:validate` 通过。
