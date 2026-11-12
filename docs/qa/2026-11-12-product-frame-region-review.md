# 原产品多帧范围确认 · 本地验收

日期：2026-11-12。分支 feat/chat-i2v-loop，用户明确指定现有 http://localhost:3001/editing。未开替代页面，未提交、合并、部署或启动额外服务；未碰 3000 数据和冻结视频供应商文件。

## 实测结果

真实账号 48 / Story 1217 launch video / stableShotId chatcut-launch-20261110-shot-3。
当前剪辑修订 24，当前 Take1617。抽取来自正在采用的 8 秒视频，非历史 Take1610 的 14.5 秒版本。
5 帧为 #2086–#2090，镜内 0、2、4、5.967、7.967 秒，均保持 960×960。

在原聊天实际发送抽 5 帧和三项修改；先显示范围图，未改图。思考时输入框可继续输入，后续消息会排队。
实际点击 4 秒原帧 #2088，输入只定位森林树冠、其他物体保持不变；R4 定位回到该帧。
实际输入“第03镜森林范围扩大一点，其他范围保持不变”，得到 R5。
实际输入“确认森林范围”，得到 R6 / image_review，森林候选 #2091 已保存仓库、原图/候选并排显示。
飞机和云层没有被确认、没有生成候选；没有付费调用或视频任务，页面累计用量仍为 28.63。

真实像素核对：候选 960×960，范围 60,598 像素，改变 57,494 像素；范围外 0 像素改变、保护区 0 像素改变。
时间线/选用视频/Take/声音资产与确认前快照完全相同。证据 /tmp/frame-review-pixel-validation.json。
范围和候选保存在 stories.body.frameRegionReviews；刷新恢复会查询服务端最新结果，消息快照不能伪造确认或覆盖记录。

## 质量判断与未完成部分

本轮只证明原产品入口的“多帧 → 范围修订 → 明确确认 → 本地森林配色候选”链路。不能宣称整镜制作可上线。
CLIPSeg 是离线粗定位，未训练自定义模型：部分树冠漏选；首段飞机初次仅 95 像素，不算完整对象定位。新定位已拒绝极小蒙版，旧 R2 记录保留供追溯。必须查看范围后确认。
当前候选偏局部，完整森林配色和边缘美术效果未通过用户验收；不得自动采用。
飞机数量、从面板飞出、更大，以及云层更大更厚属于形态/运动修改，本轮没有连接对应的生成步骤。
视频原参数继承、多帧编辑候选合成新视频仍未实现，不能用普通首帧生视频代替。付费前继续原报价确认。
刷新时曾恢复到另一个最近打开的 Story1219；重新选择 launch video 可查看已保存记录。尚未定位通用故事恢复问题，不能声称刷新始终停在同一故事。
同工作树另一会话的导出修复引起热更新，期间有 Failed to fetch；恢复后未自动重购。运行源码窗口已协调，未停止父进程。

## 自动化与性能证据

9 个 TS 测试文件 71 项通过：shared/frameRegionReview、chatFrameReference；server/services/frameRegionReview、chatFrameReferences、storySync.frame-review；client 的 ChatFrameRegionReview、frameReviewRecovery、usePausedFrameChat、StoryAgentContext.intentRecognition。
Python 6 项通过：保护区/范围外像素不变、尺寸锁定、无已有绿色拒绝、缓存损坏重算、极小定位拒绝。
类型检查 node node_modules/typescript/bin/tsc --noEmit --incremental false 通过（/tmp/frame-review-typecheck-final2.log 为空）。
既有更广回归 113 通过/5 失败是 intentRecognition 静态测试未隔离 paused RPC；补 fixture 后该套件 22 项通过。没有删除真实 paused-frame 测试。

模型视觉编码从每图 7 次改为一次，文本条件与各标签解码仍独立。真实模型旧/新 logits 最大误差 0.000005722，allclose 通过；单帧计算 10.74s → 1.45s。
5 帧首轮总进程 52.90s；同帧缓存复用 5.45s。包括导入、磁盘和模型启动，不承诺所有机器都相同。
缓存键包括原图字节 SHA、模型所有权重与配置字节、标签及算法版本；私有 .webdev/cache/frame-regions，384 MiB 上限，损坏重算，未使用外部识别API。
/tmp/frame-inference-benchmark.log、/tmp/frame-review-benchmark/{cold-time,warm-time}.log。

## 部署前依赖

服务需 Python、scripts/frame-regions/requirements.txt 中版本以及完整 CLIPSeg 权重和 tokenizer/config。FRAME_REGION_PYTHON 指向解释器，FRAME_REGION_MODEL_DIR 指向模型目录（默认 .webdev/models/clipseg）。
本机模型目录当前是实验室模型的软链接；部署需要独立复制并校验权重，不可依赖 Mac 绝对路径。模型未安装会明确失败，不能暗中切付费服务。
HTTP 请求本地分析 180 秒有界；当前任务队列/锁是单进程，生产多实例需要分布式任务与容量控制，部署前必须补验收。
模型缓存是可删除的私有中间数据，资产/蒙版/候选使用既有图片存储，原尺寸不变。不要删除已保存资产作为缓存清理。

## 顺序代码审查

按用户要求主线程顺序审查，未派子代理。范围仅本轮新增代码及接线增量，保留其他会话工作。
已修：对象间指令串用；开头/结尾候选时间约束；请求热更新后结果恢复；取消后旧结果复活；手动上键帧及无关图片被抢路由；旧图库遮挡新回复；重复视觉编码；小蒙版虚假定位；局部确认误批准其他物体；重复确认重复出图。
安全：userId 只取已认证 ctx；Story 与镜头归属校验；源图与蒙版 SHA；时间线修订和review修订 CAS；旧确认拒绝；通用 story autosave 保留 server-owned review。
测试/质量残余是上文已披露的模型定位和完整视频缺口，本轮不发布。

## 后续验证

继续从原 3001 的第03镜聊天和仓库候选 #2091 开始；不重复抽帧或购买历史未知状态任务。
先改进树冠范围与边缘效果，再取得用户对候选的明确选择；之后连接飞机/云形态候选与报价，全部图片确认后才做视频新版本。
上线前验证：同一故事刷新定位、5帧冷启动延迟、多实例任务恢复、全部保护区像素、完整视频和声音同步。失败时保留原资产，撤销本轮功能入口即可回旧抽帧/选图流程。
