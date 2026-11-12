# 第03镜本地重渲染实测

2026-11-10，主仓 localhost:3000/editing，故事1217，镜头 chatcut-launch-20261110-shot-3。

## 授权与真实结果

用户明确批准 Vidu Q2 Pro Fast，8秒、720p档、1.50算力一条。第一次确认在提交前被首帧归属挡住，无新Take；修复后通过页面对话重新输入「第03镜生成1条视频新版本」及「确认」，仅新建Take1611。状态available，首帧2045，提示词编译170383；供应商实际文件960×960、24fps、8.083333秒，无音轨。本机累计使用25.60→27.10算力。

原Take1610仍是第03镜的时间线选择，原14.5秒视频及各音轨字幕保留，未采用新候选。页面仓库按镜头显示视频V02、8.0秒。浏览器完整播放到ended=true、error=null；下载到/Users/yuandai/Downloads/take-1611.mp4。证据在工作流outputs/shot03-rerender-20261110/{result.png,contact-sheet.jpg}。

## 根因与修复

- 视频首帧校验只接受current图片，拒绝用户明确设置为首帧的原片抽帧。现在读取本故事当前精确镜头保存的firstImageId，允许非拥有引用；其他故事、未设置首帧、仅参考和rejected图仍拒绝。
- ChatCut导入更换稳定镜头ID后，已有用户聊天使旧谱系迁移直接跳过，新镜头没有节点/编译头。现在只追加缺失镜头，沿用已确认的共享约束，不覆盖旧节点、修订、编译或对话；有幂等操作号，SQL在状态锁内重读。当前真实故事通过正常页面查询补齐42个新镜头节点。
- Take先落库、再等待供应商回执时，另一页面刷新把submitted/taskId=null写成unfollowable，导致聊天提前误报失败。新submitted保留5分钟提交窗口；逾期仍待核对，不自动重购。聊天对timeout/unfollowable改为结果待核对，不再声称生成失败。

## 验证

先验证三个回归用例失败再修复。videoJobs17、promptLineageMigration7、chatVideoCompletion3共27项通过；promptLineageStore12、storyMaterials34、chatCutProjectMigration7、routers.promptLineage5共58项通过；类型检查通过。最终补了畸形shot输入保护后重跑相关测试。真实MySQL增量迁移路径本轮未接库验收。

## 效果与后续方向

逐秒拼图显示城市/森林偏具象微缩模型，云彩为团块，未达到用户要求的背景点场聚散/极简点彩，不能标为艺术验收通过。当前V02只是单帧生视频，未复用原视频的完整运动。

用户新方向：原片抽关键帧→MJ原图修改→对话逐帧确认→原视频与确认关键帧一起用于视频编辑→保留音乐/旁白/字幕及原时长→候选确认后才采用。未执行新的MJ/视频付费任务。

只读核实官方接口：Legnext /retexture支持imgUrl+remixPrompt，/upload-paint支持原图+canvas/imgPos/mask；现有代码只有/diffusion参考生图，不能冒充已接真正改图。302 Kling O3 video-edit接受video+images+prompt，但单次3–10秒限制，对14.5秒镜头必须另验分段连续性或选择支持完整时长的模型。单靠MP4无法还原原生成脚本/相机轨迹参数；可分析镜头语言但应注明是分析，不能说精确复制参数。

来源：
- https://docs.legnext.ai/api-reference/image-generation/retexture
- https://docs.legnext.ai/api-reference/image-generation/upload-paint
- https://doc.302.ai/416412686e0

本轮仅本地未提交、未推送、未部署。新MJ改帧→原视频编辑整条链路尚未实现。
