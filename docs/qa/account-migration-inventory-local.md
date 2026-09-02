# 账号迁移只读盘点：本地主仓数据源

生成时间：2026-09-02T13:47:02.288Z

> 这份报告**只读生成**，不包含任何自动归属建议。映射必须由人给出。

## 来源标识

- 主文件：`.webdev/local-persist.json`
- 主文件 sha256：`1ba00cecf0c7e2144e1f3f38d8c5e658c7a36d69264a2001c654ed9ddfd98ff7`
- sidecar `prompt-lineage-local.json`：9758451 字节，sha256 `0fe575af98fa5f5ea3da4d2ca7f0951b33a8c712b52b62de7f3c084f76700a6d`
- sidecar `edit-snapshots-local.json`：34760374 字节，sha256 `9991dfb38cface36b22e85fb18d96f3a40323ae64e11ed6303adf5ee8da7b70a`

## 每表计数与内容摘要

| 集合 | 条数 | 内容 sha256 |
|---|---:|---|
| `emotionAnalysisProfiles` | 1 | `2d3420eb69b232b0…` |
| `emotionDailyLetters` | 34 | `3a60ac598577c337…` |
| `generatedImages` | 533 | `99c9e76c8c572213…` |
| `imageSignals` | 682 | `571e07cf122bffe0…` |
| `previewMaskedImageOperations` | 1 | `ecda696f5c809f67…` |
| `projects` | 18 | `1300cbe975579f13…` |
| `semanticAnnotations` | 72 | `4029d817f4bce6d8…` |
| `shots` | 19 | `24c19a9615e2d2c8…` |
| `stories` | 35 | `aded47b6b0b47b8f…` |
| `storyTimelines` | 4 | `57d201177ea755ef…` |
| `timelineFrameExtractionOperations` | 12 | `b577c0f20d15e9bf…` |
| `users` | 63 | `a43ce9b7ee49f17f…` |
| `videoTakeRanges` | 107 | `ab210af76b1a9e4a…` |
| `videoTakes` | 406 | `dde5ee7f1fe94bd5…` |
| `videoTimelineSelections` | 47 | `458f3b23d86d7f7d…` |

## 邮箱身份分组

- 唯一解析：0 个邮箱
- **冲突（同邮箱多账号）：0 个**
- 无邮箱账号：63 个

## 拼写相近的邮箱（同域名，编辑距离 ≤ 2）

无。

## 内容归属：需要人工映射的账号

| user id | 名称 | 邮箱 | 项目 | Story | 为什么不能自动决定 |
|---:|---|---|---:|---:|---|
| 48 | Guest | **无** | 18 | 35 | 没有邮箱：无法证明它属于谁。持有的内容必须由人给出显式映射才能归属。 |

## 持有内容的账号一览

| user id | 名称 | 邮箱 | 项目 | Story |
|---:|---|---|---:|---:|
| 48 | Guest | **无** | 18 | 35 |

## 下一步

1. 岱岱对上面「需要人工映射」的每一行给出显式归属，或明确说明保持独立。
2. 拼写相近的邮箱逐对确认是同一个人还是两个人。
3. 映射批准后才生成导入计划；导入器对任何无法唯一证明的映射一律失败关闭。
4. 在此之前 `ACCOUNT_AUTO_IDENTITY_RESOLUTION` 保持 `false`。
