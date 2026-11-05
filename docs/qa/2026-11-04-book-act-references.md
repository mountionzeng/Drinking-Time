# 书稿按幕带入多参考图

2026-11-04，本地主仓 3000，未提交、未部署。

## 行为与验证

- 含“第 N 幕”标题的书稿按幕分组：一幕一镜，该幕标题后至下一标题前的图片都是参考图，不拆镜、不自动选首帧。没有图片的幕保存明确的空参考集合。
- 原文章入口仍保留插图首帧及补镜逻辑；原书稿、仓库资产所有权不变。
- 采用新书稿版本通过 Story CAS 替换旧活动版本的镜头组，并将旧正式镜头完整快照保留在原 bookVideoRecord。其他手工镜头和原音轨不自动删除。
- 素材投影按稳定身份隔离版本；同编号旧镜头的选中图不会成为新镜头首帧。参考图同时出现在画面行和生成参考选择中。
- 真实故事 1217《launch video》从最新书稿生成并采用 V2，共 7 镜，约 65 秒：参考数 **2 / 0 / 3 / 0 / 0 / 0 / 0**。第一幕资产 2000、2002，第三幕 2003、2004、2005。画面行全部标为“中间参考”，其余幕为空，没有选中首帧。
- V1 仍在历史，8 个旧正式镜头快照存在。原 3 条正式字幕保留；本次未购买图片、视频或新配乐。文本方案使用真实模型生成。
- 页面热更新后重新进入 V2，画面行和参考选择均恢复；未修改用户原标签页。

## 自动化

- 8 个文件 133 项通过：bookVideoSource、bookVideoCreation、publishingVideoStoryboard、publishingVideoStoryboardPersistence、storyMaterials、publishingArticleVideo、creationEditor.routing、ShotImageRenderControl。
- 随后补上画面行投影回归，creationEditor.routing 39 项通过（其中新增测试验证参考图可见且不成为首帧）。
- pnpm check、feature:validate（81卡）、git diff --check 通过。

## 限制

- 旧版本的完整媒体编辑恢复 UI 尚未实现；本轮保留方案、正式镜头快照及原资产，不声称所有旧时间轴编辑都能一键恢复。
- 现有书稿读取会按资产 ID 去重，同一图片跨幕重复引用尚未扩展。
- 旧正式字幕仍按人工轨权威保留；本轮没有自动改写已有字幕时间点。

截图：`/private/tmp/book-act-references-20261104.png`、`/private/tmp/book-act3-references-20261104.png`。
