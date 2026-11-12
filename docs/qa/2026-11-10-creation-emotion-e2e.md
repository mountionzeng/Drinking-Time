# 作品情绪第二轮：真实对话分流验收

2026-11-10，用户授权自行决定测试顺序。主仓3000，独立agent-browser会话emotion-e2e，临时故事1218（QA情绪端到端-临时-20261110）。没有运行worktree服务器。

## 复现与修复

书页发送“把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。”可保存E1，自动整包保存没有覆盖服务端情绪。

视频页发送“把第01镜情绪改为：压抑不安，但音乐轻快反衬”时，前端先执行声音分流，回复“这条声音要求已记录……单镜音量尚未调整”，没有调用storyAgent.chat、没有保存镜头情绪。这是首轮仅测服务请求未覆盖的真实入口缺口。

修复：shared/creationEmotionChat.ts提供轻量共用解析，前端与后端识别同一明确作品指令。StoryAgentChat在声音、图片候选、选区改写和创作流程之前路由它；StoryAgentContext跳过剪辑代理、美术指令及后台意图推理。保留镜头定位、排队和用户正在输入的新草稿；尚无持久ID的新故事先保存ID。普通“音乐小一点”继续进入声音编辑。个人感受、假设句和否定命令不自动写作品设定。

支持“查看第01镜情绪历史”，只有镜头局部设定、没有作品全局设定时仍可查看记录。历史用可读镜号/章节标题，不暴露内部稳定ID。

## 浏览器结果

- 修复后相同视频指令保存E2，保留E1全局与E2局部变化。
- 刷新页面后E1/E2仍显示；实际get返回revision=2，查询历史不新增修订。
- 视频页查询镜头历史成功，最终显示“E2 · 第01镜”。
- 新的音乐quoteSceneAudio请求包含全局失落到释怀、本镜压抑不安与音乐轻快反衬，保持90帧/3秒。临时故事起初没有正式时间线，报价按原约束拒绝；建立测试时间线后验证成功。未执行generateSceneAudio。
- 设置测试专用fetch保护，仅允许本地情绪chat、保存、对话持久化、活动和非模型快照；最终验收无被拦请求。早期保护误拦appendTurn和snapshot属于测试配置，已纠正，不是产品错误。
- 其他会话同时热更新导致页面重载时，重新在菜单明确选中QA故事才继续。未向真实作品发送测试消息。
- 本测试故事账本operation=0、images=0、audio=0。账户整体计费计数受其他会话影响，没有把全账户数字当作本测试证据。

截图：/tmp/emotion-video-fixed.png、/tmp/emotion-history-final.png。数据证据：/tmp/emotion-e2e-results.json。

## 回归与清理

9文件195项通过：shared/creationEmotionChat.test.ts、shared/creationEmotion.test.ts、server/services/creationEmotion.test.ts、server/services/textDraftHistory.test.ts、server/services/storyAudioGeneration.test.ts、server/routers.storyAgent.test.ts、client/src/features/storyAgent/StoryAgentContext.intent.test.tsx、client/src/features/storyAgent/StoryAgentContext.intentRecognition.test.tsx、client/src/features/storyAgent/desktopChatQueue.test.ts。

新增Context真实sendMessage动作测试：情绪含“音乐”仍调用本地chat、不调用剪辑runner/后台识别；普通声音指令仍调用runner。类型检查tsc --noEmit --incremental false通过，diff无错误。

关闭独立浏览器后，通过正常API归档10张测试对话记忆并删除精确匹配的临时故事1218。验证测试故事不存在、没有活跃测试记忆。未改用户原作品、未提交/部署。

## 仍待验收

章节编辑器自动传参、次级图片入口、手机独立对话、任意自由表达的语义理解仍沿用首轮缺口。真实作品质量和付费生成/试听未验收，功能仍为partial。
