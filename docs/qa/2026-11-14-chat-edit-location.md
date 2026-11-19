# 聊天帧定位与真实修改展示验收 · 2026-11-14

## 问题与修复

用户无法判断聊天指向哪帧，也看不出候选究竟改了哪里。此前结果卡只取 instruction 最后一行，范围追问覆盖了颜色处理说明；历史第03镜结果与当前第01镜0秒播放头共用“这一帧”泛指，状态文字又被单行截断。

- 修改记录注明镜号、R修订、镜内秒数、全片秒数和原图/候选编号。
- 根据保存的 forestTone 显示处理类型，完整原话在“修改要求 / Edit request”展开保留。
- 点击原图/候选仍调用实际 selection 流程；输入区固定展示对应图片和保存的帧来源，不轮播省略。未选图时显示真实播放头时间。
- “实际改动位置 / Actual changes”只在展开后读取两张图，并逐像素比较；不使用计划范围蒙版。尺寸不同或读取失败显示无法比较；切换/关闭后的迟到结果丢弃。
- 图片在浏览器以 colorSpaceConversion:none 统一解码，避免导出丢失PNG gamma元数据被误认为整图RGB样本变更。原素材未改写。

## 测试

60项通过：ChatFrameRegionReview(16)、usePausedFrameChat(23)、frameRegionPresentation(2)、imagePixelChanges(5)、shotConversation(6)、useFrameRegionReviewChat(8)。包括两条先失败后通过的根因回归、故事/镜头隔离、候选来源、相同图、单像素/透明度变化、尺寸不一致、读取失败、迟到返回。

pnpm check、pnpm build通过。构建仅已有的大bundle警告。pnpm feature:validate、git diff --check见本轮验收日志。

## 主仓3000真实页面

- /editing，user48，story1217 launch video，第03镜，原图2109→候选2111，R7，剪辑修订28。
- 未选图时：播放头 · 全片0.00s；记录显示镜内6.33s/全片24.60s。
- 点原图后：当前聊天图片2109；点候选后：2111；两个来源均明确为第03镜6.33s/24.60s。
- 顶层播放头右移一帧至0.033s，聊天仍为2111/6.33s/24.60s；再左移恢复0。
- 实际差异：135812 / 921600 = 14.74%，粉色落在树冠，与此前Python核验的变化数完全一致。
- 刷新后记录和两张图可恢复；重新点图、展开差异仍得到相同结果。刷新没有自动把历史图片当作当前选图。
- 完整要求按需展开，未新增采用/生成按钮。
- 本轮没有发送生成消息、付费、生成新资产或采用候选，原视频Take1617、剪辑修订28保留。

证据：/Users/yuandai/Documents/Codex/2026-11-14/chat-edit-location/location-selected.jpg；incremental.diff；/tmp/chat-location-final-tests.log、chat-location-final-typecheck.log、chat-location-build.log。

## 限制与后续

用户对森林2111仍不满意，不得作为已认可基准。美术结果及云/视频完整链路仍为partial，本轮修的是对象与结果可见性。
原图2109有gamma/色度元数据，2111没有；当前差异图核对存储色值，不替代跨浏览器显示色彩核验。候选导出的色彩元数据保留需后续修复/验证。没有改生成服务、收费服务或任何冻结文件。
