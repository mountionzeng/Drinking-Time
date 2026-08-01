# 提示词工程评测（evals）

回答一个此前答不上来的问题：**这版提示词比上一版好吗？**

`fingerprint` 只能告诉你提示词**变了**；这套评测告诉你它**变好还是变坏了**。

## 怎么跑

```bash
pnpm eval:prompt
```

```bash
pnpm eval:prompt --update-baseline
```

其他参数：`--corpus <路径>` 指定语料，`--json <路径>` 输出机器可读结果。
有回归时退出码为 1，可以直接挂进 CI 或 pre-push。

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

## 语料从哪来

默认读 `.webdev/prompt-lineage-local.json`（只读，绝不写）。
查找顺序：`--corpus` 参数 → `PROMPT_EVAL_CORPUS` 环境变量 → 当前目录 → 主 checkout。

最后一档是为 worktree 准备的：worktree 自己没有 `.webdev/`，
`git rev-parse --git-common-dir` 会指回主仓库，所以在 worktree 里也能直接跑。
这符合 AGENTS.md 的环境铁律——评测只读主仓库的数据，不在 worktree 里制造第二份。
