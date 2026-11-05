# 视频经济单条渲染（本地）

用户认为5秒8.08算力过高，授权改为更适合视频渲染的版本。原MJ是每批四条5秒；保留原通道，故事版单图入口默认显式选择经济单条Vidu Q2 Pro Fast / 720p。每镜选择随generationParams保存，服务端接收renderMode，未传新字段的旧调用仍走原供应商。首尾帧Vidu和简单缩放/平移本地免费路径不变；既有图片、视频与历史未替换。

来源：https://doc.302.ai/294604653e0.md ，2026-11-02只读获取，Pro Fast 720p首秒8积分、后续每秒2积分，1积分0.005PTC，支持1-10秒。按既有PTC/CNY及算力换算，5秒0.54元即1.08算力；MJ原四条报价8.08算力。此为产品报价，不是供应商账单核销。界面沿用1-8秒控件；MJ付费候选固定5秒并禁用时长选择。经济模型不支持的幅度控件不展示。

提交走现有身份/资产所有权、报价核对、预占与Take持久回执；成功按报价结算。模型/720p/单条数量和renderMode进入快照；查询与账务恢复按回执mode，不随默认MJ配置变化切换。未知提交不自动重试或切模型；旧任务仍使用旧通道。单图Vidu直接传当前首帧，不调用额外上传接口。2000字提示词限制前置，省去重复导演模板，保留用户要求和视觉约束，超长明确报错不静默裁掉内容。

一键生成按当前镜头模型/草稿/时长汇总视频报价；提交前逐镜重新核对，已确认金额不匹配就停止该镜付费提交。原图像生成与报价未在此范围改动。

## 验证

- 12文件78项通过：shotDirector、viduSingleVideo、videoGen、videoJobs、mediaComputeBilling、creationAgentCost、videoPromptEngineering、storyboardCostEstimate/StartEndTuning/OneClickVideo、StoryboardMatrix.accessibility/version。日志 /tmp/video-economy-verified.log。
- pnpm check通过：/tmp/video-economy-verified-types.log。
- 模拟服务回执集成覆盖真实账本预占0.54元、重复请求仅1次POST、改变默认配置后仍查Vidu且仅结算一次；断连预占保留不重买。没有调用真实付费供应商。
- 本地3000蓝色纸船虚构故事实点：5秒经济单条1.08算力→MJ四条8.08算力（5秒锁定）→恢复经济单条，值及总费用行同步变化。第二镜4秒显示0.96算力。没有购买图片/视频、没有改变原书稿。截图 /tmp/video-economy-20261102/economy-controls.png。

## 限制

尚未真实付费验收新供应商受理、下载和成片播放，不能声称已出片；需实际生成确认当前网关可用性和质量。产品报价与供应商账单仍需核对。单图经济模式不生成声音，音乐/旁白沿用已有单独入口。未提交、未push、未部署。
