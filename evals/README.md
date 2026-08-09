# 提示词工程评测（evals）

回答一个此前答不上来的问题：**这版提示词比上一版好吗？**

`fingerprint` 只能告诉你提示词**变了**；这套评测告诉你它**变好还是变坏了**。

## 怎么跑

```bash
pnpm eval:prompt
```

其他参数：`--corpus <路径>` 指定语料，`--json <路径>` 输出机器可读结果。

退出码：`0` 正常，`1` 有回归，`2` 语料漂移（见下）。可以直接挂进 CI 或 pre-push。

## golden set：为什么分数必须在固定总体上算

语料是**活的**——你天天在创作，故事会新增、会删除。如果评测「当前语料里恰好有什么」，
那么分数掉了永远分不清是**代码退步**还是**换了一批故事**。

`golden-set.json` 冻结参与评分的镜头列表。三种情况：

| 情况 | 表现 | 退出码 |
|---|---|---|
| golden set 内的镜头都在 | 正常评分，与基线比 | 0 / 1 |
| 有镜头消失了 | 报告漂移并列出，**不判回归** | 2 |
| 语料有新镜头 | 提示但不参与评分 | 0 / 1 |

```bash
pnpm eval:prompt --freeze-golden      # 冻结总体
pnpm eval:prompt --update-baseline    # 冻结分数
```

改了总体就必须重冻基线——两件事要一起做，否则等于拿新总体的分数比旧总体的基线。

> 这不是假设性的谨慎：2026-08-01 首次冻结基线时是 83 个镜头，8 天后语料只剩 68 个、
> 9 个故事换掉了 4 个。当时 coverage「掉了 16%」看着像严重回归，实际只是换了一批故事。

## 它测的是什么

**测当前代码，不是历史存档。** 语料只提供 `nodes / revisions / bindings` 这些*事实*，
由真实的 `compilePromptTargets()` 现场编译，指标再对编译结果打分。
所以改编译器、改 `PROMPT_DIMENSION_WEIGHTS`、改维度路由，分数都会动——这才是回归闸门。

> 这一点很重要：谱系里*存档*的 `compilations` 是历史产物，跟当前编译器的输出可能差很远。
> 例：story48 某镜的存档编译是 4746 字符（`subject` 里全是视频文件名），
> 当前编译器重编译只有 906 字符（`subject` = 「冬夜的菜市场」）——
> 因为逐维度去重让镜头级节点覆盖了故事级的垃圾。评测必须测后者。

## 四个指标

| 指标 | 问的问题 | 不合格意味着 |
|---|---|---|
| **hygiene** 提示词卫生 | 有没有混进文件名、分辨率、URL、UI 分桶标签？ | 数据管道漏进了非创作内容，稀释真正的描述 |
| **coverage** 维度覆盖率 | 期望维度填了多少？ | 缺的维度模型会自己脑补，脑补的部分每次重渲都不一样 |
| **continuity** 视觉连续性 | 镜头共享同一个风格锚点吗？ | 每镜各写各的风格，接起来跳戏 |
| **budget** 长度预算 | 在 80–3000 字符内吗？ | 太长稀释重点/可能被供应商截断，太短等于没描述 |

每条违规都带 `dimension` 和 `source`（如 `story.visualCanvasItems`），直接指向该去哪个模块修，
而不是只给一个分数。

## 已知的口径限制

- **continuity 是逐字比对**。两个语义相同、措辞不同的风格描述会被判为「不一致」。
  升级路径是换成 embedding 语义相似度（见改进 2），届时分数口径会变，需要重新冻结基线。
- **coverage 的期望维度集是人定的**（`metrics/coverage.ts` 的 `EXPECTED_DIMENSIONS`），
  不是学出来的。它表达的是「我认为一个镜头该被描述到什么程度」，可以随产品认知调整。
- **没有画质指标**。这套评测只看提示词本身，不看生成出来的图/视频好不好——
  那需要 LLM-as-judge 或人工评分，是下一步。

## 加一个新指标

1. 在 `metrics/` 下写一个函数，签名 `(samples) => MetricResult`
2. 在 `run.ts` 的 `runMetrics()` 里挂上
3. 在 `metrics/metrics.test.ts` 里补单测（用 `sample()` 构造数据，不依赖真实语料）
4. `pnpm eval:prompt --update-baseline` 重新冻结

## 维度权重信号（`pnpm eval:weights`）

`shared/promptDimensionWeights.ts` 里 40 个权重是手写的，没有数据支撑。
这个工具拿真实编辑历史（`.webdev/edit-snapshots-local.json` 里 old/new 镜头字段对比）
检验它们：一个维度如果总被用户改，说明 agent 在这个维度上的默认产出经常不够好，
权重却给得不高，就是「值得调高」的证据；反之亦然。

```bash
pnpm eval:weights
```

**这不是自动调权重的工具**，只是把编辑率 vs 权重的排名错配列出来。
权重要不要改、改多少，是产品判断——脚本给证据，不替你下结论。

已知限制：

- 编辑率高不是「agent 做错了」的因果证明，也可能是这个维度天然更主观、
  用户本来就想反复调。样本量小的维度（<8 个镜头）不参与判定，避免用几个样本的噪音下结论。
- 只分析**真正会被编译进最终提示词的维度**，不是镜头上所有可编辑字段——
  参考图绑定、出图模型配置这些字段永远不会出现在提示词文本里，
  问「该给它多少权重」没有意义（完整边界见 `editSnapshotCorpus.ts` 的 `KNOWN_DIMENSION_FIELDS`）。

**已知的真实发现**：`style_reference` 编辑率 29.9%（77 个镜头样本），
跟 mood/location 同一档，权重却只有同类维度的八成——已按此证据调到 0.32
（两份权重表都改了，`weightTableSync.test.ts` 保证以后不会只改一边）。
更多维度（`time_light`、`negative_prompt`、`intent` 权重可能偏高）有信号但样本量
还薄，留给后续数据积累后重跑再判断。

## 权重表同步（`weightTableSync.test.ts`）

`shared/promptDimensionWeights.ts`（服务端）和
`client/.../promptTable/buildPromptTable.ts`（客户端）是两张独立维护的权重表，
覆盖同一组创作维度，键名规则还不一样（snake_case vs camelCase）。
`weightTableSync.test.ts` 断言两边都定义的维度权重必须相等——改一张忘了改另一张，
CI 就红，不用等到评测或线上行为不一致才发现。

## 语料从哪来

默认读 `.webdev/prompt-lineage-local.json`（只读，绝不写）。
查找顺序：`--corpus` 参数 → `PROMPT_EVAL_CORPUS` 环境变量 → 当前目录 → 主 checkout。

最后一档是为 worktree 准备的：worktree 自己没有 `.webdev/`，
`git rev-parse --git-common-dir` 会指回主仓库，所以在 worktree 里也能直接跑。
这符合 AGENTS.md 的环境铁律——评测只读主仓库的数据，不在 worktree 里制造第二份。
