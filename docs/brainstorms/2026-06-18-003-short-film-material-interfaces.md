# 短片素材接口地图

日期：2026-06-18

## 结论

短片生成要把“素材”分成三层权威，而不是继续让四个面板各自拿一份旧数据：

1. 项目级原始素材：`references` 表，来自拖拽/粘贴/上传文件。
2. 故事级创作理解：`stories.body`，包含 `cards`、`messages`、`visualCanvasItems`、`artDirection`、canonical `shots`。
3. 图片资产：`generatedImages` + `imageSignals`，投影成 `ImageAsset`。`body.mobileImages` 只应视为历史兼容/即时 UI 缓存，不是权威。

当前系统能完整跑到“故事素材 -> canonical 镜头 -> prompt 表 -> 图片资产 -> animatic 时间线”。还没有真正导出 MP4/视频文件的后端接口。

## 素材类型

| 层级 | 权威位置 | 主要类型 | 入口 | 用途 |
|---|---|---|---|---|
| 原始文件/文本 | `references` 表 | `BackendReference` / `Reference` | `reference.upload`、`reference.list`、`reference.update` | analysis workspace 的项目级素材池 |
| 聊天输入 | `stories.body.messages` | `ChatMessage` | `storyAgent.chat`、`storyAgent.uploadPhoto` | 小酌理解用户原话、照片、上下文 |
| 故事卡 | `stories.body.cards` | `StoryCard` | `storyAgent.chat` 返回 `card` 后保存 | 用户材料被整理后的叙事单元 |
| 视觉锚 | `stories.body.visualCanvasItems` | `VisualCanvasItem` | `artAgent.analyzeReference`、`artAgent.riff`、卡片继承照片 | 参考图、照片、riff 图、prompt 片段池 |
| 美术方向 | `stories.body.artDirection` | `StoryArtDirection` / `ArtReferenceMaterial` / `ArtRecipeDNA` | `artAgent.generateCandidates`、`setCharacterReferenceByUrl` | 故事视觉 DNA、角色锚点、风格锁 |
| canonical 镜头 | `stories.body.shots` | `StoryShot` | `storyAgent.classify`、`creationAgent.chat buildShotList`、编辑器写回 | 四面板共同投影的故事分镜真相 |
| 场景分析 | 请求/返回负载 | `SceneAnalysis` | `analyzeScene`、`composeScenePrompt`、`generateForMobile` | 画人物/空镜判断，带 `intent/rationale` |
| 提示词表 | `stories.body.shots[n]` | `PromptRow`、`PromptRunRecord`、`NarrativeJob` | `ensurePromptShot`、`recordPromptRun`、`rerenderShot` | 可解释 prompt 维度与生成记录 |
| 生成图片 | `generatedImages` 表 | `GeneratedImage` | `generateForMobile`、`creationAgent.generateNextImage`、art candidates | 实际图片资产 |
| 图片选择信号 | `imageSignals` 表 | `ImageSignal` | `recordSignal`、`creationAgent.selectImage` | selected/rejected/pending、主图投影 |
| 短片时间线 | `stories.body.shots[n].durationMs` + 图片资产 | `CreationEditorShot`、playback helpers | `updateShotDuration`、AnimaticPanel | 动态分镜播放，不是视频导出 |

## tRPC / 服务接口

### 项目素材池

- `reference.upload`: `projectId + fileName + mimeType + fileBase64 + sourceType` -> 写 `references`。
- `reference.list`: `projectId` -> 当前项目未排除素材。
- `reference.update`: pin/exclude/sort/importance。
- `analysis.run`: 读取项目 `references`，让 LLM 拆成 production `shots` 和 `analysisResults`。这是旧 analysis workspace 流，不等于故事 canonical `body.shots`。

### 故事与 canonical 镜头

- `storyAgent.chat`: 用户聊天/照片 -> reply，可生成 `StoryCard`。
- `storyAgent.uploadPhoto`: 聊天照片上传。返回给 LLM 的 data URL 与落库/渲染用 URL 是两条用途。
- `storyAgent.classify`: `cards + visualAnchors + confirmedIntent` -> `GeneratedScript` 语义和 `StoryShot[]`，并在有真实 `storyId` 时写 `director shots`。
- `storyAgent.storyUpsert`: 创建/更新故事，写 `stories.body`。服务端 `prepareStoryBody` 会删除 `mobileImages/images`，并保留 shot 上的 `intent/rationale`。
- `storyAgent.storyGet/storyList/storyDelete`: 故事读取、列表、删除。
- `shot.list/update/batchUpdate`: production/director shot 表接口，按 `storyId` 取，主要供 analysis/creation 旧表格。

### 美术与图片

- `artAgent.analyzeReference`: 图片 -> `VisualCanvasItem.analysis`。
- `artAgent.riff`: 参考图 + 指令 -> riff 图和偏好更新。
- `artAgent.generateCandidates`: 参考材料 -> 美术候选图，写 `generatedImages`，再进入 `artDirection.candidates`。
- `storyAgent.generateForMobile`: 单镜头草稿/正式出图。会走 `composeScenePrompt`、`deriveInjection`、`renderViaGate`，写 `generatedImages`。
- `storyAgent.mobileInpaint`: 局部修复，写 `generatedImages`。
- `storyAgent.recordSignal`: 写 `imageSignals`，表示收下/淘汰/编辑。
- `storyAgent.storyImages`: 读某故事当前图片。
- `creationAgent.generateNextImage`: 确定性单镜头出图入口，不经 LLM tool call。
- `creationAgent.chat`: agent 决策入口，可触发 `generateImage`、`reviseImage`、`selectImage`、`reassignImage`、`buildShotList` 等工具动作。
- `creationAgent.getProjectAssets`: 现在输入是 `storyId`，实际返回 `getStoryImageAssets(storyId, userId)`。
- `creationAgent.selectImage/reassignImage`: 图片主图信号和镜头绑定变更。

## 面板投影规则

四个面板应该只投影同一个故事：

1. Story Cards：读 `body.cards`，相关照片/故事画面从 `visualCanvasItems` 和图片资产投影。
2. Script：从 canonical `storyShots` 投影 scenes，不再相信旧 `latestScript.scenes` 是唯一真相。
3. 动态分镜：从 `CreationEditorProvider` 合并 canonical `storyShots` + `storyImages`/`ImageAsset` + `durationMs`。
4. 提示词表：从同一 `CreationEditorShot` 构建 `PromptRow[]`，生成记录写回同一个 shot。

坏的不一致是“四个面板各读一份材料”；干净的脱钩是“四个面板共享 canonical story units，各自只保存自己那层的 UI/编辑附加信息”。

## 完整短片流程（现状版）

1. 导入素材：走 `reference.upload`，或在小酌聊天中通过 `storyAgent.chat/uploadPhoto` 进入 `messages`。
2. 整理故事卡：小酌把原话/照片整理成 `StoryCard`，照片继承为 `VisualCanvasItem(source='reference')`。
3. 确认意图：`recognizeIntent`/`confirmedIntent` 作为剧本和 prompt 的上游约束。
4. 生成剧本/分镜：`storyAgent.classify` 产出 canonical `StoryShot[]`，保存到当前故事。
5. 美术定调：`visualCanvasItems -> ArtReferenceMaterial -> artDirection`，必要时设 `role='character'` 的人物锚点。
6. 构建 prompt：`ensurePromptShot -> buildPromptTable -> compilePromptRecipe`，每镜得到可解释 `finalPrompt`。
7. 出图：每镜经 `generateForMobile` 或 `creationAgent.generateNextImage`，最终都穿过 `renderViaGate`，图片写 `generatedImages`。
8. 选择主图：`recordSignal/swipe_right` 或 `selectImage` 写 `imageSignals`，由 `ImageAsset` 投影主图。
9. 动态分镜：`CreationEditorShot + durationMs + imageUrl` 进入 `AnimaticPlayer`，按阅读时长或手动时长连播。
10. 视频导出：当前缺接口。若要真正生成短片文件，需要新增 `shortFilmExport` 一类服务，把 animatic timeline 渲染为 MP4/WebM。

## 现在的接口缺口

1. `body.mobileImages` 相关注释和部分客户端命名已经过期，容易让人误以为图片仍由 body 权威保存。
2. analysis `shots` 与故事 canonical `body.shots` 是两套 shot，命名相近但用途不同；短片生成应以 `body.shots` 为准。
3. `creationAgent.getProjectAssets` 名字还叫 project，输入实际已是 `storyId`，应后续改名为 `getStoryAssets` 或保留兼容别名。
4. 还没有“短片输出物”类型：缺 `ShortFilmTimeline`/`ShortFilmExport` 的持久化与导出状态。
5. 四面板应继续收敛到一个 canonical `StoryUnit/StoryShot` 投影，不应重建四套局部事实。

## Dry-run：故事 20《你们多久没见了》

只读 `.webdev/local-persist.json`，不调用模型、不出新图、不写本地数据。dry-run 读取真实故事、用现有 `buildPromptTable` / `compilePromptRecipe` / playback 工具串了一遍短片链路。

结果：

- 故事材料：5 张 `StoryCard`，6 个 canonical `StoryShot`，0 个 `visualCanvasItems`，`artDirection.phase = empty`。
- 图片资产：8 张 `generatedImages`，13 条 `imageSignals`。
- 镜头覆盖：3/6 有图，`SH02`、`SH03`、`SH06` 缺图。
- 动态分镜：可组成 16.0s animatic，但不能显示全部帧。
- prompt 链路：6 个镜头都能从 canonical shot 构建 prompt 表并编译 final prompt。

逐镜状态：

| 镜头 | beat | prompt rows | duration | 图片 |
|---|---|---:|---:|---|
| SH01 | 开场 | 13 | 1.77s | image #63，pending |
| SH02 | 起势 | 14 | 2.55s | 缺图 |
| SH03 | 起势 | 14 | 3.32s | 缺图 |
| SH04 | 转折 | 14 | 3.94s | image #61，selected |
| SH05 | 起势 | 13 | 1.77s | image #102，pending |
| SH06 | 收束 | 14 | 2.70s | 缺图 |

如果目标是“可播放的完整短片雏形”，下一步不是重写故事/剧本，而是：

1. 给 `SH02`、`SH03`、`SH06` 生成图片。
2. 把 `SH01`、`SH05` 的 pending 图收下，或重新生成后收下。
3. 可选：先做一次美术定调/人物锚点，否则三张补图可能继续风格漂移。
4. 若目标是最终视频文件，再新增 `ShortFilmExport` 接口。
