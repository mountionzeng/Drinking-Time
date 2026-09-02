---
title: 语义美术提示词库与时间服装规则交接
date: 2026-09-03
category: architecture-patterns
module: 统一静态图片提示词工程
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - 继续维护或扩充美术提示词库
  - 调整情绪与生命体验驱动的自动画风选择
  - 修改年代、季节或人物服装提示规则
  - 将当前工作分支交给新的开发对话
tags: [art-direction, prompt-engineering, style-library, semantic-selection, temporal-context, handoff]
---

# 语义美术提示词库与时间服装规则交接

## Context

用户希望建立一套可持续扩充的美术词库，让系统只在真正符合当前表达时调用合适的美术语言，而不是每次出图都套固定画风。明确要求包括：

- 不增加界面，先用文档和 YAML 维护、筛选词库。
- 用户明确的美术要求优先；情绪、年龄、生命体验只作有证据的选择依据。
- 旧情绪不能冒充用户当下状态，年龄本身不能单独触发画风。
- 艺术家只作内部策展参考，发给图片模型的是可观察画面特征。
- 用户说明时间时加入相应年代色调、材料和服装语境。
- 用户说的是当下事件时，按上海时区当天季节设置可信服装。
- 用户或参考图已经说明服装时不得覆盖；没有人物时不得凭空添加人物或衣服。

本次工作已实现并验证，但尚未提交、合并或推送。

## Guidance

### 工作位置

- 仓库：`/Users/yuandai/Documents/New project/drinking-time-local`
- worktree：`/Users/yuandai/Documents/New project/drinking-time-local/.worktrees/codex/semantic-art-direction`
- 分支：`codex/semantic-art-direction`
- 状态：修改仍未提交，存在已暂存与未暂存文件；不要丢弃或覆盖现有改动。
- 环境铁律：禁止在该 worktree 启动 dev server，也不要向它的 `.webdev/` 写业务数据。运行效果只能回主仓库的 3000 端口验证。

### 已完成的词库

人工筛选入口是：

- `docs/style-library/WORD_BANK.md`

当前共有 24 张卡：

- 12 张 `active`
- 12 张 `draft`
- 9 张带 `automatic_selection`、可参与语义选择
- 3 张旧 `active` 卡仍只支持手动选择

用户确认的三张核心卡已经上线：

1. `modernist-sanyu-seurat-wu`：书法性轮廓、概括色面、疏密点触、大面积留白。
2. `dreamy-colored-pencil-minimal`：朦胧彩铅、克制渐变、纸面阻力、抽象概括。
3. `diffuse-motion-blur`：只在运动边缘加入方向性拖擦与局部弥散；它是辅助效果，不是主风格。

常玉、Georges Seurat、吴冠中只保存在 `internal_references` 和 `provenance` 中。自动提示词只输出画面特征，不输出艺术家姓名。

相关维护文件：

- `docs/style-library/MANUAL.md`
- `docs/style-library/CODEX_PROMPTS.md`
- `docs/style-library/_TEMPLATE.yaml`
- `docs/style-library/entries/*.yaml`

新卡和大幅修改的卡默认必须保持 `draft`，只有用户筛选或完成出图校准后才能改为 `active`。

### 自动选择链路

核心实现：

- `server/services/styleLibrary.ts`：读取 YAML、区分 active/draft、生成运行时语义卡。
- `server/services/semanticEvidenceNormalizer.ts`：从本轮明确美术要求、当前情绪、故事和镜头文字提取确定性证据。
- `server/services/semanticArtDirectionCatalog.ts`：打分并选择最多一张主卡和一张相容辅助卡。
- `shared/semanticArtDirection.ts`：证据、卡片和选择结果的共享类型。
- `server/services/renderGate.ts`：统一静态图片提示词入口，已移除旧的硬编码艺术家谱系。

只允许以下来源进入自动选卡：

1. 本轮用户明确的美术指令。
2. 本轮明确传入的 `ctx.emotion`。
3. 当前故事或镜头文字。

长期情绪画像、出生信息和历史情绪摘要不得进入选卡。历史编辑注解仍会作为“用户创作偏好”单独加入最终提示词，但不参与当前情绪打分。

选择器行为：

- 明确美术指令权重最高；当前情绪和镜头证据次之；普通故事词权重最低。
- 否定证据会扣分，例如“不焦虑”“不要动态模糊”。
- 引号里的话、他人对白和参考图人物的偏好默认标成未知，不冒充用户当前状态。
- 低于阈值、主卡并列、用途禁止或主辅不相容时不自动套卡。
- 一轮最多一张主卡和一个辅助效果。
- `selection_context` 只供人工策展；运行时只消费审核后的 `automatic_selection.concepts`。

注意：部分卡故意共享概念。只出现“梦”时，彩铅卡与象征主义卡可能并列；只出现“神话自然”时，朴素寓言与浪漫主义幻视可能并列。当前规则会安全跳过，而不是随机选一张。若用户以后希望消除这些并列，应增加可观察且可测试的区分证据，不要降低并列保护。

### 时间、季节与服装

实现位于 `server/services/temporalVisualContext.ts`，由 `renderGate.ts` 调用。

当前规则：

- 支持 1800—2099 年的具体年份、年代写法、中文年代、主要历史朝代、民国、当代和未来。
- 具体年份会归入相应年代色调，例如 `1997年`使用轻微褪色暖色、室内荧光微冷偏和模拟胶片材料关系。
- 只有用户明确表达故事发生在“现在、今天、此刻、眼下、最近、当下”时，才按上海时区当前日期推导季节。
- “现在请帮我画……”属于操作指令，不会被误认为故事发生在当下。
- 被否定的年代和季节不会反向触发，例如“不要 1990 年代感，也不要夏天”。
- 明确季节优先于当前日历季节。
- 画面有人且服装未说明时才补季节服装。
- 用户已写明衣服、人物参考图或故事板已有可见服装时，保持原样。
- 没有人物时只通过环境、光线和材质表现季节，不添加人物。

`server/services/publishingCoverArtDirection.ts` 已把“时间、季节与服装”加入可从正式封面继承的美术段落。

### 提示词优先级与不可破坏规则

继续修改 `renderGate.ts` 时要保留以下顺序：

1. `preservePrompt`：正式采用提示词原文透传。
2. 锁定视觉资产与用户明确要求。
3. 参考图、故事板可见事实和产品用途约束。
4. 用户确认的故事视觉配方或手动选择风格。
5. 没有显式风格时才进行语义词库选择。
6. 历史拒绝信号与创作偏好只作矫正，不冒充当前情绪。
7. 最终始终保留静态图片风格化和像素无字硬约束。

`authoredBrief` 或锁定风格存在时，不应再叠加自动艺术谱系、时间模板、私人策展库或艺术跃迁，以免覆盖用户已经写清楚的方向。

### 旧情绪识别的处理结论

不要删除旧 `emotionAnalysis`。它仍被以下能力使用：

- 每日回信与情绪画像刷新
- 剧本共鸣
- `resonanceSignal`

正确做法是隔离，而不是删除：旧情绪继续服务原功能，美术选择只接收本轮明确情绪。相关约束已登记在 `docs/features/feature-ledger.json` 的 `semantic-art-prompt-library` 功能卡中。

### 验证证据

最终验证结果：

- `pnpm test`：386 个测试文件、3267 项测试全部通过。
- 针对词库、时间和提示词链路的 6 个测试文件、56 项测试通过。
- `pnpm check` 通过。
- `pnpm feature:validate` 通过，功能账本共 30 张卡。
- `pnpm build` 通过。
- `git diff --check` 通过。

主要测试文件：

- `server/services/styleLibrary.test.ts`
- `server/services/styleLibraryWordBank.test.ts`
- `server/services/semanticEvidenceNormalizer.test.ts`
- `server/services/semanticArtDirectionCatalog.test.ts`
- `server/services/temporalVisualContext.test.ts`
- `server/services/renderGate.test.ts`
- `server/services/publishingCoverArtDirection.test.ts`
- `shared/semanticArtDirection.test.ts`

## Why This Matters

这套设计把“好看的词”与“什么时候该用”分开：艺术词库负责可维护的视觉语言，语义证据层负责判断当前用户是否真的需要它，统一网关负责保护用户指令、参考图事实和产品硬约束。这样既能提高图片质量，也避免把旧情绪、年龄或某种固定审美永久贴到用户身上。

艺术家姓名只在内部帮助策展，可以减少直接模仿某位艺术家的倾向；运行时使用媒介、线条、色彩、构图和材质等可观察特征，更稳定也更容易测试。

## When to Apply

- 用户开始筛选 12 张 draft 卡或 3 张旧手动 active 卡时。
- 新增一种画风、媒介、动态效果或生命体验映射时。
- 修改自动选卡阈值、证据词或否定识别时。
- 扩展年代、季节、人物识别或服装规则时。
- 将分支提交、合并回主仓库并清理 worktree 时。

## Examples

用户可以按以下格式继续筛选：

```text
保留：dreamy-colored-pencil-minimal、nabist-memory
修改：modernist-sanyu-seurat-wu（更轻、更少点彩）
淘汰：vaporwave-neon
新增：夏日傍晚、刚离开校园、轻微不舍，薄水彩和长影子
```

给下一段开发对话的建议首条消息：

```text
请先完整阅读：
/Users/yuandai/Documents/New project/drinking-time-local/.worktrees/codex/semantic-art-direction/docs/solutions/architecture-patterns/semantic-art-direction-library-handoff-2026-09-03.md

继续在 codex/semantic-art-direction 分支和对应 worktree 中工作。先检查 AGENTS.md 与 docs/features/feature-ledger.json，不要丢弃现有未提交修改，不要在 worktree 启动 dev server。除非我明确要求，不要提交、合并、推送或创建 PR。
```

### 尚待用户决定

- 逐项筛选 12 张 draft 卡。
- 决定 3 张旧手动 active 卡是否补充语义选择规则。
- 决定是否处理旧手动卡中可能直接进入 provider prompt 的艺术家/流派命名；自动选择路径已经隔离姓名，但旧手动路径尚未全面迁移。
- 用户明确要求后再提交、合并并清理 worktree；当前不要自行执行。

## Related

- `docs/style-library/WORD_BANK.md`
- `docs/style-library/MANUAL.md`
- `docs/features/feature-ledger.json`
- `server/services/renderGate.ts`
- `server/services/semanticEvidenceNormalizer.ts`
- `server/services/semanticArtDirectionCatalog.ts`
- `server/services/temporalVisualContext.ts`
