# 全系统冗余代码核查与第二轮清理

日期：2026-11-10。文档07接手来源会话已释放的清理范围；本轮只核查和删代码，不提交、推送、部署、调用付费模型或修改作品/素材数据。

## 实际变更

相对本轮开工文件快照，19个产品/测试文件增加4行、删除519行，净减少515行。4行均为收窄import/export的替换行，没有新增产品行为。这个数字不包含上一会话净删202行，也不包含账本、看板和本QA。

- 删除无任何静态/动态入口的 PersonalMemorySummary.tsx（126行）和 MobileFormPicker.tsx（105行）。PersonalMemoryPage仍由桌面路由和MobileMePage进入；手机外形选择已内联在MobileMePage，setPreviewElement及恢复默认入口保留。summary后端仍被现用页面读取，未删除。
- 删除摘要组件独占的describeSummarySources及其唯一专属测试；其余足迹时间分组、隐私与每日来信代码不改。
- 删除未挂载的PreferenceReminder和它独占的extractPreferenceHints、两组翻译。ShotTable仍使用GapReminder，视觉偏好存储与当前生成链路不变。
- 删除无人调用的captureFrameFromVideoUrl/captureFrameFromFile字符串包装。当前captureReferenceFrameFromVideoUrl/File与参考帧、人物裁剪实现保留。
- 删除分析页旧SOURCE_TYPE_CONFIG/PRIORITY_CONFIG及失去唯一消费者的SourceType；STATUS_CONFIG和当前状态/优先级模型保留。
- 删除timelineBoundaries、timelineFrameToMs、timelineItemHasAnchor、timelineItemDurationFrames、timelineAnchorFrames、normalizeTimelineVisualLayerState旧包装；现用统一布局、30fps换算、锚点和视觉层解析保持。NLE只收窄无消费者的转导出，不改播放或剪辑。
- 删除normalizeVideoTakeStatus、isVideoTakePlayable、sanitizeVideoError、shotNoToMobileNumber闲置辅助函数；现用校验、状态机和镜头编号规范化保留。
- 删除server/routers/_storyShared.ts里无调用的artRecipePrompt副本；共享同名权威实现及全部调用保留。删除空DNA常量，将实际内部使用的默认DNA改为非导出，defaultArtRecipe保持。
- 删除无入口的getReusableVideoAssetsForStory投影包装和getActivePublishingVersion别名。现用getStoryVideoAssets、视频/版本路由与底层视频历史仓储不动，内部resolvePublishingActiveVersion继续使用。

**用户明确要求保留情绪检索。** findSubcategory、matchByLabel、getOpposite、getMixedEmotions、getAllSubcategories、groupByNarrativeArc全部恢复，emotionTaxonomy.ts与本轮开始快照逐字节相同。未来清理不能仅因当前无调用而删除这些已明确保留的能力。

## 核查方法与保留项

- 使用现有默认Knip配置扫描client/server/shared/scripts；结合TypeScript语法节点定位、全仓符号和模块引用、测试消费者、动态加载及脚本入口核对，未使用误报较多的production模式。
- 同时搜索关联原生小程序仓库中的本轮删除符号，无引用；未修改原生仓库。小程序共享契约生成检查通过。
- 16个MySQL测试worker由测试通过文件路径派生进程启动，保留；shared/miniprogramWorkspace.ts是生成器输出，保留。scripts被现有Knip配置视为入口，不能因缺少import就判死；本轮没有证据充分的脚本整文件删除。
- 包依赖、公开路由、签名桥接合同、历史兼容、计费、任务恢复和存储均保留。未删除模型库加载入口、章节投递仓储或撤销生命周期函数等尚需进一步确认的候选。
- 功能卡清理两个已删除组件的当前owners路径，并向所属卡追加本QA与history；状态、约束、依赖和既有功能缺口保持。

## 验证

- 19文件225项相关回归通过，覆盖现用个人足迹页、手机工作区、主题、时间轴布局/编辑/图层、书稿持久化、镜头对话、刷新恢复、播放跟随和总时长标尺。
- 补充后端与架构检查：63项通过、1项失败。唯一失败是既有热点文件行数上限：StoryAgentContext.tsx为4558行，超过4528上限30行。该文件与开工快照哈希相同，证明不是本轮引入；未提高上限、删断言或搬代码凑行数。
- 完整TypeScript检查通过；首次发现删除后残留的TimelineLayoutRow导入，清理后重跑通过。
- pnpm build通过，包括7文件77项草稿安全测试及前后端构建；保留既有大bundle警告。未将构建成功视为真机或线上验收。
- 小程序生成契约检查、92卡功能账本和git diff --check通过。
- Knip默认全仓扫描按JSON各分类数组条目统计：721项/288文件降至695项/278文件，新增提示0。此口径将duplicates分组计为一项，与来源会话727的展示计数口径不同；基准原文件未改。扫描仍以退出码1报告既有提示，不能称全库全绿；依赖包和扫描配置未改。

## 证据与限制

本机完整开工快照、manifest、逐文件计数、扫描和测试日志：/tmp/document07-cleanup-20261110/。来源会话的既有修改均保留，不用HEAD覆盖现状。

这轮主要减少AI阅读噪音与维护面。已不可达代码通常已被构建器移除，因此不宣称线上响应显著加快；未做生产性能测量或发布。未宣称全系统全部冗余已清空，剩余扫描提示须继续按真实入口判断。
