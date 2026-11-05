# 11月2日晚至11月3日发布差异审计

审计方式：读取两个仓库的本地改动、提交图与交接记录；实时查询GitHub分支；通过既有阿里云CLI执行只读脚本，检查发布清单、产物哈希；读取公网app-release.json。未合并、构建、重启、部署、修改配置或业务数据。仅更新远端跟踪引用。

## 已证实的问题

1. **P1 书转视频增量没有进入线上发布线。** 本地codex/book-video-release-20261102停在a557124e，43文件1292增/159删；不在远端最新main 70031a98中。远端main缺少confirmBookVideo.ts、BookVideoStartButton.ts和viduSingleVideo.ts；bookVideoCreation仍缺少这批confirmedBookVideoVersions/briefConfirmedAt与reuseBookMusicForStory增量。影响确认直达表格、已确认方案历史、书内图乐复用等新增能力，不能把此前已有的基础书转视频功能当作这批增量已上线。远端查询没有同名候选分支。
2. **P1 分镜Legnext恢复与保留仓库增量没有上线。** 本地主仓storyboardImageTask.ts仍未跟踪，相关router/rerender/图片仓储改动未提交。远端main没有该文件；当前线上后端也没有pendingStoryboardImageTasks/recoverStoryboardImageTask/storyboardImageTasks标记。11月2日已发布的书稿模块Legnext切换不等于分镜表这条路径已更新。依据docs/qa/2026-11-02-storyboard-legnext.md，与现存代码差异交叉核对。
3. **P1 本地工作副本与最新发布线分叉，直接打包会有回退风险。** 本地main fa62493a落后远端main 70031a98共23提交，主仓54个已跟踪修改、24个未跟踪项（审计报告创建前）。例如本地storyAgent.ts相对远端删掉了新后台任务接入、标题更新保护和StoryVoice302Error相关代码；这属于旧基线上未收敛的差异，不能整文件覆盖远端。需在最新已部署基线上选择性整合功能意图。
4. **P2 小程序push/upload未等于体验版切换或正式上线。** 远端main仍为f53dbfe5，内部候选987d444在codex/document07-miniapp-acceptance-20261103分支，0.1.1103qb上传日志明确成功。用户已确认的是qa设为体验版、qa后来能够输入；没有qb已设体验版的确认。qb无提审/正式发布证据，云函数也未因此次客户端修复而重新部署。微信后台站点策略阻止工具直接核实版本管理，当前体验版/正式版指向仍属待人工核对。

## 线上并非完全没有更新

实时远端Web main：70031a9807b60ec2f20a74b5fd823d4e0aa98a0e。
服务器最新清单：/opt/Drinking-Time/dist.release-tts-billing-70031a98.json，commit同上；清单列出的4个文件逐个SHA256匹配（不是声称所有历史静态资源都核验）。线上dist/index.js SHA256为ade808bb44eb223e95384172636024fefe0bad896a018ed7ebd1ece264a3be1e。
公网与服务器app-release.json版本一致：e5b8cfe5-8bd6-47f6-a62f-d808fbe7bee0。证明公网已指向较新发布，遗漏功能不能一概归因缓存；未检查用户当前旧浏览器标签的运行版本。

11月3日本对话document07-cleanup发布仅替换后端；11月3日清晨另有conversation-fixes前端发布，之后有首页二维码等更新。多次局部发布都成功，并不代表所有待发布功能已纳入。

## 交付流程断点及修复顺序

- 会话看板仍保留“等待微信发布窗口”的视频/分镜待办，而后续发布窗口已经释放；缺少一次把待办与最终发布清单逐项核销的过程。
- 先以审计时最新线上提交70031a98或之后经核实的新版本为基线，恢复/整合a557124e视频增量；随后整合分镜回执与仓库保留改动，避免覆盖最新计费、任务表、标题保护等修复。
- 合并前对重叠文件逐项取舍，验证后按功能入口实际验收，再形成明确“本次包含/仍未包含”的发布清单。小程序单列代码提交、上传版本、体验版指向、正式版指向。
- 本轮为审计，尚未实施补发；不把仓库提交数、构建成功、健康检查或上传成功等同功能上线验收。
