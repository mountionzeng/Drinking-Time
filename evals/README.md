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

| 情况                    | 表现                         | 退出码 |
| ----------------------- | ---------------------------- | ------ |
| golden set 内的镜头都在 | 正常评分，与基线比           | 0 / 1  |
| 有镜头消失了            | 报告漂移并列出，**不判回归** | 2      |
| 语料有新镜头            | 提示但不参与评分             | 0 / 1  |

```bash
pnpm eval:prompt --freeze-golden      # 冻结总体
pnpm eval:prompt --update-baseline    # 冻结分数
```

改了总体就必须重冻基线——两件事要一起做，否则等于拿新总体的分数比旧总体的基线。

> 这不是假设性的谨慎：2026-08-01 首次冻结基线时是 83 个镜头，8 天后语料只剩 68 个、
> 9 个故事换掉了 4 个。当时 coverage「掉了 16%」看着像严重回归，实际只是换了一批故事。

## 它测的是什么

**测当前编译代码，不读历史 compilation 文本。** 语料提供 `nodes / revisions / bindings`，
由真实的 `compilePromptTargets()` 现场重编译，指标再对最终 `finalText` 打分。
所以改编译逻辑或维度路由会直接影响 `pnpm eval:prompt`；hygiene 也以 `finalText`
为准，并在能回溯时保留 dimension/source 定位。

这里有一个必须说清的边界：`revision.weight` 是已经保存的用户/历史状态，生产编译器
会尊重它。修改 `PROMPT_DIMENSION_WEIGHTS` 只影响以后创建的默认值，不会追溯覆盖旧
revision，因此不应伪装成会让这批生产重编译样本自动变化。默认权重策略由
`pnpm eval:weights` 的「默认权重 × 编辑率证据分数」专门观测；改默认表会改变该分数，
但不会偷偷覆盖用户自定义权重。

> 这一点很重要：谱系里*存档*的 `compilations` 是历史产物，跟当前编译器的输出可能差很远。
> 例：story48 某镜的存档编译是 4746 字符（`subject` 里全是视频文件名），
> 当前编译器重编译只有 906 字符（`subject` = 「冬夜的菜市场」）——
> 因为逐维度去重让镜头级节点覆盖了故事级的垃圾。评测必须测后者。

## 四个指标

| 指标                      | 问的问题                                     | 不合格意味着                                       |
| ------------------------- | -------------------------------------------- | -------------------------------------------------- |
| **hygiene** 提示词卫生    | 有没有混进文件名、分辨率、URL、UI 分桶标签？ | 数据管道漏进了非创作内容，稀释真正的描述           |
| **coverage** 维度覆盖率   | 期望维度填了多少？                           | 缺的维度模型会自己脑补，脑补的部分每次重渲都不一样 |
| **continuity** 视觉连续性 | 镜头共享同一个风格锚点吗？                   | 每镜各写各的风格，接起来跳戏                       |
| **budget** 长度预算       | 在 80–3000 字符内吗？                        | 太长稀释重点/可能被供应商截断，太短等于没描述      |

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

报告里的证据分数把「编辑率与默认权重的 Pearson 相关系数」映射到 0–1，只用于
观察默认策略是否跟真实编辑需求同向，不是画质分数，更不能拿来自动调权重。

编辑快照会随主 checkout 的实际使用持续变化，不在文档里冻结样本数和百分比。
合并判断以重新运行 `pnpm eval:weights` 的输出为准；需要保留历史结论时，应同时记录
语料文件副本或内容哈希，不能只记录运行日期。

## 权重表同步（`weightTableSync.test.ts`）

`shared/promptDimensionWeights.ts`（服务端）和
`client/.../promptTable/buildPromptTable.ts`（客户端）是两张独立维护的权重表，
覆盖同一组创作维度，键名规则还不一样（snake_case vs camelCase）。
`weightTableSync.test.ts` 断言两边都定义的维度权重必须相等——改一张忘了改另一张，
CI 就红，不用等到评测或线上行为不一致才发现。

## 检索算法真实语料对比（`pnpm eval:retrieval`）

该命令只读主 checkout 的 `.webdev/local-persist.json`，用旧重叠余弦和当前 TF-IDF
逐事件对比 top-1。固定口径如下：

- 卡片按 `storyId + cardId` 识别，不把不同故事里复用的 cardId 错误去重；每次检索只用
  该 story 的卡池，与产品运行路径一致。
- 同时纳入现代 `role=user/content` 和旧版 `who=u/text`；trim 后空消息排除，重复消息
  保留，因为每一条都是一次真实检索事件。
- IDF 的 df=1 比例按 `(storyId, token)` 词表项统计，不拿全局卡池稀释每个用户故事的词频。
- 用当前最终卡池回放历史消息，不声称还原每条消息当时的卡池时间切片。

本地持久化数据会持续变化，不在文档里冻结卡片数、消息数和 top-1 差异数。
“所有真实消息 0 差异、df=1 约 67.8%”只在未保存的旧筛选口径下成立，不能再当作
当前语料结论；最新数字始终以命令输出为准。

## 重复修正阈值复算（`pnpm eval:recurring`）

该命令只读 `.webdev/edit-snapshots-local.json`，输出单次 modified pair 同时变化的提示词
维度数直方图、中位数，以及 field limit 1–10 下的信号数。信号按 project 分组，runtime
口径模拟服务端每项目最近 50 条快照；不能把不同项目里相同 stableShotId 拼在一起。

分布和阈值下的信号数会随编辑历史变化，不在文档或生产代码注释里冻结具体数字。
阈值是否仍落在“目标修正”和“整镜重写”两簇之间，应以 `pnpm eval:recurring`
对合并时语料的复算结果为准。

## 语料从哪来

默认读 `.webdev/prompt-lineage-local.json`（只读，绝不写）。
查找顺序：`--corpus` 参数 → `PROMPT_EVAL_CORPUS` 环境变量 → 主 checkout → 当前目录。

默认优先主 checkout 是为 worktree 准备的：即使 worktree 里残留了事故数据，也不会抢先读到；
`git rev-parse --git-common-dir` 会指回主仓库，所以在 worktree 里也能直接跑。
这符合 AGENTS.md 的环境铁律——评测只读主仓库的数据，不在 worktree 里制造第二份。
