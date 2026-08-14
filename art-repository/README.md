# 私人美术策展库

这不是公开素材库，也不是训练集。它只负责把创始人认可的图片提炼成可泛化的美术 DNA，交给全站唯一的提示词工程入口 `server/services/renderGate.ts` 使用。

## 安全边界

- 原始截图只作离线分析，不在每次出图时发送给图片模型。
- 运行时只读取 `curator-profile.json` 和 `catalog.json` 中已经派生、清洗后的美术 DNA。
- 水印、文字、作者签名、账号、手机状态栏、应用界面和截图黑边永远属于污染层。
- 不复制参考图的人物身份、具体物体、地点、情节、作者签名或现成构图。
- 来源或权利状态不明的图片不得用于官网展示、商业素材分发、模型训练或直接风格迁移。

## 文件

- `curator-profile.json`：人工确认的集合级审美底线，是唯一会立即影响出图的策展配置。
- `catalog.json`：图片清单、内容哈希、分析状态、权利状态和派生 DNA。
- `references/`：本地私有源图。新导入图片被 `.gitignore` 排除，不能继续提交进 Git。

旧的 `metadata.json` 和 `rules/global-rules.md` 已移除，避免出现多个互相冲突的信息源。

## 添加更多图片

先预检，不会写入、不会调用 AI：

```bash
pnpm art:import -- "/Users/yuandai/Desktop/仓库" --dry-run
```

确认后同步。导入只复制和登记图片，不产生模型费用：

```bash
pnpm art:import -- "/Users/yuandai/Desktop/仓库"
```

新图片会进入 `pending-analysis`。查看待分析数量不会产生费用：

```bash
pnpm art:analyze
```

只有明确加入确认参数才会调用付费视觉模型：

```bash
pnpm art:analyze -- --limit=10 --confirm-paid-analysis
```

分析结果会再次经过污染词过滤；只有状态为 `ready` 的派生 DNA 才能参与线上情境匹配。

## 上线迁移

上线前将 `references/` 中现有的 99 张历史图片迁移到私有 OSS bucket，并从 Git 当前版本中停止跟踪。生产服务器只需要部署：

1. `curator-profile.json`；
2. 去除源图 URL、人物和情节信息后的 `catalog.json`；
3. 必要时通过 `ART_REPOSITORY_DIR` 指向只读配置挂载目录。

私有源图 bucket 必须关闭公共列表与匿名访问，使用服务端短期签名读取；图片只在离线分析任务中读取。若要彻底清除 Git 历史中的旧图，需要单独安排仓库历史重写和所有部署端重新拉取，不能在普通功能提交里顺手处理。
