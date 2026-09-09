# 图片字幕层与手绘走向 · 2026-09-09

用户要求：把“构图与文字”作为直接加字幕层的入口，能调字大小、走向、具体效果，恢复之前手绘文字方向的功能。

在独立 codex/image-subtitle-layer worktree 实施；保留原图、exact imageId文字层、构图/OCR和时间字幕轨。主仓固定3000运行，无新服务、无AI请求。

改动：Preview“字幕”直接进入文字页签；默认台词作为未保存草稿，已有文字优先。手绘路径/闭合区域、横竖排、反转路径、字号、字距、行距、字体、颜色及描边直接可调。一次保存即调用原exact imageId命令，失败不误报。主Preview复用SVG字形渲染已保存图层；改文字不重置路径。布局重建及PNG导出使用保存的字号/间距/颜色。用户不点击保存时不写业务数据。

验证：15文件149项测试通过（包括模型、几何/字形、SVG/PNG、样式保存恢复、原图精确更新与架构），类型检查/构建通过；主仓浏览器验证待补记。

限制：本轮没有接入成片视频导出的imageTextOverlays；只有正式时间字幕轨已有成片导出。这里完成的是图片字幕编辑、保存与Preview显示。

主仓首次实测发现读取缺口：保存成功后 getStoryMaterialState 的 normalizeTimelineItems 未输出 imageTextOverlays / imageTransforms，导致 Preview 与刷新重开丢失表现。独立 codex/subtitle-readback 补齐投影；先复现2项失败，再完成4文件102项通过，包含真实保存→素材读取→再次编辑→删除→保留其他图片的完整链路。
