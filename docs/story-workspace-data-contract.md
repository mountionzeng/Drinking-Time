# 故事工作区数据范式

这个约定用于故事版看板、动态分镜、提示词表和素材仓库，目标是避免同一份镜头、台词、图片或视频被多个入口互相覆盖。

## 唯一数据出口

- 故事文字、镜头顺序、台词、旁白、时长：以 `stories.body.shots` 为保存后的唯一事实来源。
- 图片和视频素材：以 `StoryMaterialState` 为前端唯一读取出口。
- `StoryMaterialState.shots[]` 只放能匹配当前故事镜头的素材。
- `StoryMaterialState.unassignedImages` 放未绑定当前镜头的图片。
- `StoryMaterialState.unassignedVideoTakes` 放属于这个故事、但 stableShotId 已经匹配不到当前镜头的旧视频 take。
- `StoryMaterialState.reusableVideoTakes` 放同一用户其他故事里已经可播放、尚未标记不可用的视频 take。

## 前端读取规则

- 故事工作区面板统一通过 `CreationEditorContext` 读取镜头和素材。
- 面板不直接从旧 story spine 或其他临时状态里拼素材。
- 素材仓库展示这个故事的全部素材：当前镜头素材、未绑定图片、未匹配旧视频 take。
- 其他故事的视频 take 作为可复用素材展示；用户点击“复用”后才复制到当前故事，不移动原故事数据。

## 写入规则

- 修改台词、旁白、镜头顺序、镜头时长时，写回 `stories.body.shots`。
- 导入图片或视频时，先进入当前故事的素材池，再按用户选择绑定到具体镜头。
- 标记不可用的视频 take 只改变该 take 的状态，不删除文件，不占用可用 take 的候选位置。
- 复用其他故事的视频 take 时，在当前故事创建新的 take 记录，保留 `reusedFromTakeId` / `reusedFromStoryId` 来源。

## 不再新增的模式

- 不新增只在某个面板内部存在的镜头数据源。
- 不让本地 spine 覆盖已保存故事的最新台词。
- 不因为当前镜头列表匹配不到旧 stableShotId 就隐藏旧视频。
- 不把“故事卡片”作为制作面板的默认数据来源。

## 回归保护

- 空的 `StoryMaterialState.currentImage` 不能隐藏 `storyImages` 里的旧图片。
- 旧 stableShotId 的视频 take 必须出现在 `unassignedVideoTakes`。
- 其他故事已可播放的视频 take 必须出现在 `reusableVideoTakes`。
- 素材仓库的视频列表必须合并当前镜头 take、未匹配旧 take 和可复用旧故事 take。
- 本地旧台词不能覆盖服务端最新台词。
