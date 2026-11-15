# Storyboard 触控板手势验收 · 2026-11-14

## 本轮范围

用户希望两个手指缩放、左右滑动。完整 Storyboard 时间表接入 ctrl-wheel 捏合（兼容 meta-wheel）和 Safari GestureEvent；横向主轴 wheel/Shift-wheel 平移，普通纵向滚动保持原生。不新增按钮，既有缩放滑杆加中英提示。简读/书稿沿用原交互。

缩放以指针下的时间为锚点，固定轨道标题不进入时间坐标。沿用整片适配到每帧248px的对数比例，连续事件以逻辑目标累计、requestAnimationFrame 合并更新，布局提交后恢复滚动。原简化/紧凑列在缩放时转为时间比例列，与原滑杆行为一致。

手势不移动播放头、不选择镜头、不改剪辑片段或修订；编辑框、片段拖动不抢手势；切故事、关闭视图取消监听与待执行更新。手动浏览期间沿用2500ms自动跟随让位。

## 自动验证

- 21项通过：6项原生手势（锚点、连续往返、横滑/竖滑、单位/上下限、Safari累计比例/中心移动/去重、编辑/拖动/销毁）；3项React桥接（每帧合并、布局后锚点、原比例往返加平移、切故事/关闭取消）；4项缩放数学；6项现有矩阵布局；2项方向键。
- `pnpm check` 通过。
- `pnpm build` 通过，内含77项草稿安全回归；仅现有大bundle提示。
- 功能账本状态保留 observing，不把整张功能卡宣称完全可用。

## 3000 实际页面

唯一主仓服务：PID30423，`http://localhost:3000/editing`，故事1217 launch video。

- 使用现有放大操作使时间表可横向浏览；页面没有新增操作按钮。
- 实际原生右滑：scrollLeft 458.5 → 771.5；左滑回到458.5；该组操作scrollTop保持0。
- 普通下滑：scrollTop 0 → 320.5，scrollLeft保持458.5。再上滑回到0。
- 页面正常显示Storyboard、轨道和预览，剪辑修订仍28、累计算力仍27.21。本轮没有抽帧、媒体生成、付费或采用操作。
- 手势事件自动测试覆盖了Chrome式wheel与Safari路径；CUA没有pinch接口。按Control再滚动未能触发工具中的捏合，因此不能把物理Mac双指捏合标记为已实测。需要使用者在完整Storyboard区域试实际手感。
- 最终截图：`/Users/yuandai/Documents/Codex/2026-11-14/storyboard-gestures/storyboard-page.png`。

## 代码与交付

权威代码：`StoryboardReviewBoard.tsx`、`StoryboardTimelineRuler.tsx`、`storyboardViewportGestures.ts`、`useStoryboardViewportGestures.ts`。没有改生成/计费冻结文件。

修改已同步主仓3000，未提交、推送或部署。暂存、基线与本轮增量补丁保存在 `/Users/yuandai/Documents/Codex/2026-11-14/storyboard-gestures`；日志同目录。原有未提交工作保留。
