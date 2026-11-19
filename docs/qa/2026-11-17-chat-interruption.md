# 2026-11-17 反复聊天中断：原话报价恢复与文字通道缺口

## 实际结果

仅主仓 localhost:3000、故事1217。代码已逐文件同步；未commit/push/部署，未新调用模型、未生成或采用图片。原页面失败消息可点“继续改图 · #2126”，显示原话、原图缩略引用、预计2.86算力与确认/取消。刷新后仍能从同一报价重新准备，不重放旧文字请求、不重复追加消息，不恢复费用授权。最终页面留在待确认，未点“确认并生成”。

**普通聊天仍未完全恢复。** 本机LLM_TEXT_ONLY_302_MODEL未配置；当前Next401、旧Claude500。本轮补好代码分流但未启用新模型或做真实付费验证。附图请求仍保留原视觉通道，不能称视觉服务已修复。当前1条失败文字operation250仍submission_unknown，actualCostMinor=null，未重试或释放预占。

## 根因与范围

用户原话“这飞机他太大了，大一倍就可以，另外他还是两个飞机把小的飞机给去掉”，保存的storyboard-image引用为2126。前端未识别为改图，进入selectionEdit，主Next401后旧Claude500。项目已有显式纯文字恢复配置只在llm.ts生效；agentChannel的Claude分支绕开了它。本轮不再追加修改词关键词，修该路径并提供与措辞无关的失败恢复入口。

- server/_core/llm.ts：提取共用textOnlyRecoveryCandidates。
- server/_core/agentChannel.ts及测试：纯文字且显式配置才走已有恢复链；Next优先、媒体边界及unknown不重放保持。
- client/src/features/storyAgent/failedImageEditRecovery.ts及测试：从持久原话和原图恢复；只对当前故事最后一条失败或其持久报价，单图、非局部选区；缺图/跨故事/多图/新回合不接管。显式引用优先，不偷换当前选图。
- views/ChatImageEditRecovery.tsx及测试、StoryAgentChat.tsx：失败消息内的本地报价入口；草稿、附件和在途操作保护；复用remix.arm，不调用模型；费用确认仍是独立步骤。

## 自动验证与失败归因

- 后端红测：原实现2失败/13通过，证据chat-interruption-red.log；修后agentChannel/llm共30通过。
- 最终9文件85项通过，涵盖恢复/归档刷新/报价刷新/跨故事/缺图/区域/多图/旧通道/未知请求/输入引用/生成hook。
- 新增组件首轮测试暴露React import缺失（本轮引入），已补import并通过，不归因旧问题。
- 严格tsc通过。标准pnpm build通过，包含77项书稿草稿安全测试；第一次受共享node_modules测试缓存EPERM阻断，提升该构建命令权限后完整原门禁通过。刷新恢复补丁后再次完整构建通过。
- 范围审计首次差异为本轮8候选文件与52份既有非构建验收附件；逐项登记。一次审计误在workspace执行导致tsx解析失败，已回主仓运行成功，未降低门禁。

## 原页面可复现操作与实际结果

1. 回到最新对话：失败原话与#2126保留，出现“继续改图”。刷新后入口仍在。
2. 打开仓库，点击“继续改图”：原话带真实#2126缩略图出现；2.86报价、确认/取消可见，仓库保持展开。未点击费用确认。
3. 刷新页面：无费用授权，仍显示持久报价与“继续改图”；再次点击直接恢复待确认状态，不需要重打原话，聊天只新增同一对恢复消息。
4. 历史版本/恢复误删入口：可见视频V1/V2及剪辑36、35、34等持久历史。未确认恢复，不改变当前采用；既有恢复实现本轮未改、旧通过记录保留。
5. 最终当前剪辑36，104图/10视频/14音频；全部图片、视频、timeline、采用、音频与billingOperations/holds/ledger/providerAttempts相对开工基线逐对象相同。没有新生成、账务或候选丢失。

## 非业务内容差异记录

新增2条本地恢复/报价消息。既有compactChatMessages去掉重复原话ID46243fc8-69ad-49d6-8630-49783a5b461b，相同原话及2123引用仍在msg-1794909023285-nq200；不是新候选丢失。失败原话selectionQuote补fullText/null字段；3镜legacy shotKey省略，cueCode/stableShotId与其他镜头字段不变。accountMemorySpaces仅活动时长/session/时间字段、用户48登录时间、emotionAnalysisProfiles更新时间随页面活动变化；其余故事不变。未回写备份库。

## 仍待完成

文字备用模型启用及真实连通/结构化回复验证未完成。当前短句128输出token的系统估算为1510微元=0.00302算力，但两模型均priced=false（兜底价格）；不能当成供应商准确报价或实扣。未新付费探测，未改变密钥/环境/钱包。图片2.86报价仍仅估算，2126此前实际结算未知。最终质量/严格飞机保护/图片生成与采用仍需新的费用确认及用户反馈。

证据在本会话outputs：chat-interruption-final.jpg、chat-interruption-history.jpg、chat-interruption-data-check.json、chat-interruption-tests.log、chat-interruption-types.log、chat-interruption-build-final.log、chat-interruption-files.json、chat-interruption.diff。两份11月16日原交接及此前已验证成果保留，协作/钱包/小程序范围未推进。
