# Codex 任务：独立验证「提示词工程评测闭环」四项改进

> 这是 Claude 在 worktree 分支 `feat/prompt-eval-harness`（`2da164d..e1935de`，5 个提交）里做的四项改进，还没合并到 main。**你的任务是独立验证，不是重新审美代码风格**——去戳每一条具体主张有没有破绽，而不是复述 commit message 里说的对不对。做完把发现写成报告；除非你确认是真 bug 且值得顺手修，否则不要改代码。

---

## 执行约定（先读）

- **另开一个 worktree**（`git worktree add .worktrees/codex-verify feat/prompt-eval-harness`），别动我正在用的 `.worktrees/evals-harness`。
- **只本地验证，不要 `push`、不要合并 main**——push / merge 由岱岱手动做。
- **`pnpm check` / `pnpm test` / `pnpm eval:prompt` / `pnpm eval:weights` 这些是普通脚本，AGENTS.md 禁止的是 `pnpm dev`/`pnpm preview:3000` 这类会常驻写 `.webdev/` 的开发服务器——不在禁止范围内，正常跑。**
- 全中文回复。
- 带着怀疑去看，尤其是我自己算出来的数字（编辑率、样本量、"0 条实时信号"这类结论）——独立复算一遍，别直接信我写在 commit message 里的数字。

---

## 背景（一句话概括每个改进，细节自己去读代码和 commit）

评测提示词工程原来完全没有度量闭环。这轮加了四块：
1. **评测闸门**（`evals/`）：4 个指标给 `compilePromptTargets()` 现编译出的提示词打分，golden set 冻结评分总体防语料漂移。
2. **检索算法**：`client/src/features/storyAgent/storyCardSimilarity.ts` 从词袋重叠计分换成 TF-IDF 加权余弦。
3. **维度权重**：`evals/dimensionWeightSignal.ts` 拿真实编辑历史检验 `shared/promptDimensionWeights.ts` 里 40 个手写权重，调了 `style_reference`（0.26→0.32，服务端+客户端两张表都改）。
4. **反馈回路**：`server/services/recurringEditSignal.ts` 检测「同一镜头同一维度被反复改」，接入小酌的系统提示词上下文注入点。

---

## 要验证的具体主张

### 改进 1：评测闸门（`evals/`）

- **主张**：4 个指标测的是「当前代码现编译的提示词」，不是历史存档——改 `shared/promptCompiler.ts` 或 `shared/promptDimensionWeights.ts` 应该让分数动。
  验证：随便改一个权重或编译逻辑，重跑 `pnpm eval:prompt`，看分数是否真的变了。
- **主张**：`golden-set.json` 冻结的镜头如果在语料里消失了，退出码是 `2`（漂移），不会被误判成 `1`（回归）。
  验证：手动改 `evals/golden-set.json` 塞一个不存在的镜头，跑 `pnpm eval:prompt`，确认退出码和报错文案。
- **主张**：真的会检测到回归（不是摆设）。
  验证：改一处明显会让某个指标变差的代码（比如把 `PROMPT_LENGTH_BUDGET` 调小到 100），跑 `pnpm eval:prompt`，确认退出码是 `1`。
- **要主动找的坑**：语料文件损坏/为空/字段缺失时会怎样？故事只有 1 个镜头时 `continuity` 指标的除零处理对不对？

跑：`pnpm exec vitest run evals/`，`pnpm eval:prompt`

### 改进 2：TF-IDF 检索（`storyCardSimilarity.ts`）

- **主张**：在本地真实语料（77 张卡、41 条真实用户发言，来自 `.webdev/local-persist.json`）上，TF-IDF 版本和旧的重叠计分版本 **top-1 检索结果完全一致，0 处不同**——因为 67.8% 的词只出现在一张卡里，IDF 目前接近拉平，还没有实际改变排序。
  验证：自己写一个对比脚本重新跑一遍这个对比，不要直接信这个数字。如果你算出的百分比不一样，说清楚是哪里对不上。
- **主张**：这不是「改了但没用」的无效改动——它是正确的基础设施，只是要等语料池变大/词分布变化后才会体现效果。
  你可以有不同意见：如果你认为这个改动现阶段就是没有产品价值、应该缓一缓，直接说。
- **要主动找的坑**：IDF 对未登录词（只在 query 里出现、卡池里没有）的回退权重算法对不对？长卡片是否还会因为词多占便宜（回归到旧 bug）？

跑：`pnpm exec vitest run client/src/features/storyAgent/storyCardSimilarity.test.ts`

### 改进 3：维度权重信号 + 修正（`evals/dimensionWeightSignal.ts`）

- **主张**：`evals/editSnapshotCorpus.ts` 只统计「真的会被编译进提示词」的字段，排除了参考图绑定/出图配置这类字段（`characterReference`/`generationModel`/…）——这些字段永远不会出现在最终提示词文本里。
  验证：看 `shared/promptFieldDimensions.ts` 的 `KNOWN_DIMENSION_FIELDS` 白名单，抽查几个被排除的字段，确认它们真的从不进入 `shared/promptCompiler.ts` 或 `shared/promptContext.ts` 的输出。
- **主张**：`style_reference` 编辑率 29.9%（77 个镜头样本，去重后），跟 mood/location 同一档，但权重明显偏低，已调到 0.32。
  验证：自己跑 `pnpm eval:weights`，独立核对这个数字。同时确认**只有** `style_reference` 这一处权重被改了——`shared/promptDimensionWeights.ts` 和 `client/.../promptTable/buildPromptTable.ts` 的 diff 里不该有别的数字变化。
- **主张**：`evals/weightTableSync.test.ts` 真的会在两张权重表不同步时报错。
  验证：故意改一边的数字（比如把 `buildPromptTable.ts` 里的 `styleRef` 权重改成别的值），跑这个测试，确认它红了；改完记得转手改回来。
- **要主动找的坑**：`editSnapshotCorpus.ts` 里「字段两端都是空字符串不算 present」这条判断——有没有漏掉别的「假阳性存在」情况（比如 `"0"`、`"undefined"` 这类字符串）？

跑：`pnpm eval:weights`，`pnpm exec vitest run evals/ shared/promptFieldDimensions.test.ts`

### 改进 4：反复修正信号（`server/services/recurringEditSignal.ts`）

- **主张**：真实编辑历史里，单次快照 diff 的中位数是**同时改 9 个提示词维度**（整镜重写/重新生成），如果不排除会把「小酌重新生成了 7 次」误读成「用户对 7 个维度都很纠结」。`TARGETED_EDIT_FIELD_LIMIT = 3` 是照这个双峰分布校准的。
  验证：自己写脚本统计一遍 `.webdev/edit-snapshots-local.json` 里单次 diff 同时变化的维度数分布，确认双峰形态和中位数。
- **主张**：应用这个阈值后，**当前本地语料上一条实时信号都没有**——这是诚实的结果（数据里目前没有真正的"单维度反复调"模式），不是掩盖 bug。
  验证：自己复现这个结论。同时判断一下：`TARGETED_EDIT_FIELD_LIMIT = 3` 这个数字选得是否合理，还是应该更松/更紧？有没有更好的判定"整镜重写 vs 目标修正"的办法（比如看字段是否语义相关，而不是单纯数字段数）？
- **主张**：接入点是 `server/archive/storyReply.ts` 里 `formatEditContextBlock` 已经存在的注入点，用同样的 try/catch 静默降级，不会因为这个新信号抛错而让整个系统提示词失败。
  验证：读 `server/archive/storyAgent.test.ts` 里 `proceeds with vanilla prompt when annotation fetch throws` 这个测试，确认它现在仍然覆盖到新加的 `getRecurringEditSignalsForProject` 调用路径（不只是覆盖旧的 `getRecentAnnotations`）。
- **已知的、故意没做的事，帮忙确认这个判断对不对**：`creationAgent.ts`（主对话"小酌"，`/creation` 页面用的）完全没有接这套编辑上下文机制——只有次要的 `storyAgent` 路由在用。这个改动因此只影响一个较少用的入口。你觉得这个"先接现有注入点、不扩到主对话"的取舍合理吗？

跑：`pnpm exec vitest run server/services/recurringEditSignal.test.ts server/archive/storyAgent.test.ts`

---

## 全局检查

- `pnpm check`（tsc）必须干净。
- `pnpm test` 应该看到 4 个文件、8 个测试失败，且**只有**这 4 个：`client/src/app/shell/TopBar.test.tsx`、`server/_core/mediaRouteAuth.test.ts`、`server/_core/sdk.session.test.ts`、`server/routers.storyAgent.test.ts`。这是本轮改动之前就存在的环境问题（worktree 缺 `.env`），不是新引入的。**自己验证这句话**：`git checkout 2da164d` 建个干净 worktree 跑一遍 `pnpm test`，确认这 4 个文件在改动之前就已经失败、失败的测试名字也一样。
- 除了这 4 个文件之外，如果你发现任何新的失败测试，那就是真问题，需要报出来。

---

## 报告怎么写

不要写"审美"或代码风格意见。只写：
1. **确认成立的主张**：简短列出。
2. **有问题的主张**：具体到文件:行号，说清楚"我跑了 X，结果是 Y，跟声称的 Z 不一致"，给出可复现步骤。
3. **你自己发现的新问题**：即使不在上面的主张清单里，只要是真 bug 或有风险的判断，都写出来，附文件:行号和触发条件。
4. 如果所有主张都站得住、没有新发现，就直说"验证通过，没有异议"，不用硬凑问题。
