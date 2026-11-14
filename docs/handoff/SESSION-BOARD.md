# 会话看板 · 谁正在动什么

> **动代码之前先读这里，动之前先登记，收工之后立刻销号。**
> 这份文件是多个 AI 会话之间唯一的实时协调点。功能账本
> （`docs/features/feature-ledger.json`）记录「产品有什么能力」，这里记录
> 「此刻有谁的手在哪个文件上」。两者不重复。

建立于 2026-08-23，起因：架构收敛会话在测量基线的 20 分钟里，另一会话
（`claude/multitrack-editor-reset`）往主仓合入了三次死代码清理，触达的正是
收敛试点的隔壁文件。双方事前都不知道对方存在。

---

## 协议（四条）

1. **开工前**：在下面「当前在场」表里加一行，写清分支／worktree、正在动哪些文件、
   预计什么时候收工。同时看一眼别人占了什么。
2. **发现重叠**：不要自己绕开，也不要"顺手帮对方改"。停下来告诉用户，由用户裁决归属。
3. **收工后**：把自己那行删掉，并在「最近落地」里加一条（提交号 + 一句话 + 触达的热点文件）。
   worktree 和分支按 `AGENTS.md` 第 4 条立刻删除。
4. **热区文件**（见下表）动之前必须先登记，哪怕只改一行。

---

## 当前在场



2026-11-13 chat 01a1d3cc 邮箱局部共享及界面对话已合本地main b569edfa（含a120499a），释放合入窗口：四个重叠文件三方合成，96个非重叠未提交文件逐字节保留；148组合回归、类型/构建/102卡/43迁移通过，主仓仅3000运行。4820工作树和分支已删除。原生8336555独立树保留，另一小程序会话仍在使用开发工具；默认关闭，未部署/上传/真实扫码。当前浏览器连接无可操作网页标签，UI实点未验收。QA docs/qa/2026-11-13-mailbox-selected-sharing.md；备份/tmp/mailbox-main-integration-20261113。


2026-11-13 chat 01a1d3cc 界面感知与对话操作：codex/chat-ui-actions / 4820代码树，新增shared工作区上下文/能力契约、服务端界面助手与邮箱动作、客户端对话桥；触及EditingStudioPage、StoryAgentContext、StoryAgentChat、types/storyAgentPersistence（界面指令不生成空故事）、StoryMailbox、ChapterWriting被动保存状态、writingCompanion上下文及router注册/测试/功能卡。保留原选区编辑、费用确认、故事归属、邮箱独立接收与停止联系规则。只主仓3000运行；本轮未占合并发布窗口；代码/类型/构建/101卡和定向验证完成，全量7795通过、1旧FFmpeg超时复跑7项通过；用户明确等主仓云层编辑完成后再合入，保留4820树。

2026-11-13 chat 01a1d3cc 故事邮箱已合本地main 1b511e32，释放合并窗口：7748全量、49最终定向、隔离MySQL、类型/构建/100卡/42迁移通过。主仓3000运行；用户允许暂停3001，其工作树和数据保留。浏览器安全策略阻止实点，邮箱状态observing，真实UI验收待续。无push/生产部署。4820工作树/分支已删除，历史outputs校验备份/tmp/story-mailbox-4820-outputs-20261113。QA docs/qa/2026-11-13-story-mailbox.md。


2026-11-13 chat 01a1d3cc 双账号故事互传验收完成并释放文档范围（未提交/合并/部署）：4820 工作树只更新 QA 与 shared-story-collaboration 功能卡，状态 partial。正式站本轮虚构测试稿从邮箱账号分享到微信账号“岱”并独立接收通过；模块新增文字已保存但旧阅读页不显示，回传通知存在但作者章节候选不可见，采用未完成。未调用付费生成、未修改其他作品；测试稿/副本/链接保留待修复。证据 docs/qa/2026-11-13-two-account-story-sharing.md，截图 /tmp/story-share-author-20261113.jpg。小程序成片观看及剪辑线共享未验收；未占合并发布窗口。

2026-11-12 chat 01a1bedb 三天代码联合发布已完成，释放跨分支收敛与部署窗口：七处来源352路径已合main并push，应用源码0e27e2aa已上线drinkingtime.top，前端b9cc5a9c。7732全量、73 MySQL、215小程序、14 Python通过；生产278资源/14脚本/13模型哈希、HTTPS与鉴权验证通过。5个闲置工作树已清理；用户3001、env、作品、素材和outputs保留，原始源码快照在release-20261112。无付费生成或数据库迁移；供应商/美术/多帧缺口仍按账本保留。QA docs/qa/2026-11-12-joint-release.md。













2026-11-11 chat 01a1bedb MJ排障续修完成并释放本轮范围（未提交/合并/部署）：同图同要求仅切MJ供应商复用已有读图与美术编译，保留新原话/报价指纹/复用来源；修改内容、图版、偏好、语言等变化不复用。302新404说明编辑地址不可用。71项、类型、98卡、diff与6项冻结哈希通过；真实3001第03镜#2046的Legnext1.62/3020.68算力报价均显示免重复读图，已取消且刷新保持，累计算力27.43、图片50/Take10/剪辑23保留。没有新增付费调用；两家仍未出图，未通过美术/视频验收。供应商问题见 docs/qa/2026-11-11-mj-provider-questions.md（未代发）。保留用户指定工作树和3001副本。


2026-11-11 chat 01a1bedb 两家MJ编辑验证本轮结束并释放范围（未提交/合并/部署）：补接302 MJ Edits原图入口、原话供应商分流/报价、持久恢复及测试。246相关项、类型、98卡、diff通过。真实3001用户确认0.834482算力后，302读图/编译通过，编辑HTTP404无任务号；Legnext沿用此前最小参数失败回执，无重复购买。新增本地读图0.07742算力，无新图；50图/10Take/剪辑23、冻结哈希保留。QA docs/qa/2026-11-11-two-mj-suppliers.md。两条原图编辑路线均未取得效果，不能宣称美术或视频验收通过。


2026-11-11 chat 01a1bedb MJ真实改图验收本轮完成并释放文件（验收未通过，未提交/合并/发布）：Legnext参数与安全错误、限定美术编译、精确镜号图片ID报价、失败卡片/字典/测试/QA/账本。3001真实302看图与英文编译、原图上传已通；两笔MJ分别V6.1/官方无flags均远端Invalid_Prompt_Parameter，consume=0，无新图或视频。读图本地账本0.14088算力，50图/10Take/剪辑23保留，冻结哈希未变。用户拒绝GPT备用方案，未提交GPT。精确图片ID直接报价/取消已页面验收，类型与70相关测试通过。QA docs/qa/2026-11-11-mj-live-acceptance.md。3001运行进程临时接入真实302视觉/上传+Legnext凭据，原.env仍为禁用测试配置；重启需区分只报价/真实模式，勿直接重复购买。


2026-11-11 chat 01a1bedb 暂停帧聊天引用与上下左右快捷键本轮完成，释放范围（未提交/合并/发布）：spine/NLE/StoryboardEditRow/ShotPreview、pausedFrameChat/Badge/contentQuote、shared/router/frameReferences/renderExportImage与测试/字典/账本。3001实测引用22秒后移播放头仍绑定原图、图标预览/刷新/报价取消、视频与时间线方向键及输入框避让；187相关/架构项、类型通过。仅新增非当前参考图2050/2051，累计算力27.21不变；一次额外修饰键剪辑测试已撤销，最终修订23，全部剪辑/音字幕内容与开测前一致、Take1617保留。冻结文件哈希未变。QA docs/qa/2026-11-11-paused-frame-chat.md；CSS动态效果明确拒绝，真实语音及付费效果未本轮验收。继续保留用户指定工作树与3001副本。



2026-11-11 chat 01a1bedb 三帧定向读取与提示词修复阶段完成，释放本轮代码/QA/账本范围：302仅针对用户已授权的48/1217/2045、2046、2047；修复严格保真renderGate丢弃偏好prompt。最新6文件143项、类型通过。继续连接仍返回Local browser use is disabled in Work settings，用户已被告知需要重新切换设置；真实302读取及三张MJ均未提交，4.86算力授权未消费。3000主仓健康、持久图片任务为空、原图/视频未改；未提交部署。QA docs/qa/2026-11-11-visual-understanding.md。连接恢复后从原页面逐图继续，勿重复询问既有授权。

2026-11-11 chat 01a1bedb 看图与视觉偏好代码阶段部分完成并释放文件：新增visualEditUnderstanding shared/service/router/hook与测试，接通精修前读图、显式分范围偏好/纠正/忘记、图版次/作者/时间与自动保存保护。123相关测试、类型、97卡、diff通过；真实3000保存用户作品偏好并刷新读回。原Qwen视觉通道含60秒重试仍timeout，UI不冒充看过且未提交媒体；改用302视觉读取的操作被自动审批拒绝，已问具体三图发送授权待答。用户已授权Legnext MJ #2045/#2046/#2047三次合计4.86算力，尚未消费此授权。原1610/剪辑修订18及音字幕保留；无提交/部署。QA docs/qa/2026-11-11-visual-understanding.md，暂存/快照/tmp/visual-understanding/。后续先完成读图通道授权/验证，再在3000对话提交三张精修，不直接生成视频。

2026-11-10 chat 01a1bedb MJ原帧精修实现与本地报价验收完成，释放本轮文件：legnextImage/storyAgent、原帧编辑资格、chatImageRevision/Gallery/StoryAgentChat、videoJobs及测试/账本/QA。186项、最终报价14项、类型/96卡/diff通过；真实3000实点#2046/#2047到Retexture 1.62算力报价。三张共4.86算力授权已询问，尚未新购媒体；当前停留#2047报价。图片效果、实际返回格式及原片运镜继承视频编辑仍未验收，不宣称完整视频流程可用。原1610/剪辑修订18/音字幕保留，未提交部署。QA docs/qa/2026-11-10-mj-original-frame-refinement.md。




2026-11-10 chat 01a1bedb 第03镜真实重渲染本地完成并释放文件：videoJobs/谱系迁移及测试、chatVideoCompletion/测试、QA和账本。修复明确首帧被拒、导入镜头谱系缺失及回执等待误报失败。27专项+58关联与类型通过；真实对话仅生成授权Take1611/V02/8秒/1.50算力，原1610/剪辑修订18保留。可播放但美术偏微缩，点彩未验收；MJ改帧确认再原视频编辑为新需求，已查接口但未接入。未提交部署，其他修改保留。QA docs/qa/2026-11-10-shot03-live-rerender.md。








2026-11-10 chat 01a1c4d0 情绪第二轮本地完成并释放文件：修复明确作品/镜头情绪被声音分流截走，共享轻量识别、前端优先路由及无关推理跳过；局部情绪历史可读镜号。195项、类型/94卡/diff通过，3000独立浏览器实测书页E1→视频E2→刷新/历史→下一音乐报价读取，零付费零媒体。临时1218已删除、10测试记忆归档。未提交部署，其他会话修改保留。QA docs/qa/2026-11-10-creation-emotion-e2e.md；章节/次级图片/手机与真实艺术效果缺口仍保留。


2026-11-10 chat 01a1c4d0 共享作品情绪首轮本地完成，释放本轮文件（未提交/部署）：公共词库单源、六函数保留，creationEmotion的范围/修订/作者/CAS保护及明确对话/API入口；文字版本、分镜主出图、配乐报价/执行接通，旧内容保留并可查询来源。11文件172项、最终重点23项复查、类型/94卡/diff通过；主仓3000 ready且真实1217只读preview前后revision=0未变，无付费/作品修改。章节UI传参、次级图片入口/手机独立对话与真实艺术效果仍待接入验收，功能卡partial。接入docs/handoff/CREATION-EMOTION.md，QA docs/qa/2026-11-10-creation-emotion.md。19个文件仅同步本轮差异，其他会话保留；新对话工作树仍附着，未做git合并。



2026-11-10 chat 01a1bedb 仓库按镜头分组本地完成并释放文件（未提交/部署）：横滑浮窗增加镜头混合媒体组、名称/版本/时长，显式选镜打开，播放不重开；对话与仓库共用旧稿显式引用，声音只返回净化身份。44专项、类型/构建/93卡/diff通过；主仓3000实测01/02/03、全片10音频、同镜回选及刷新。未知旧素材不猜归属，真实故事无视频Take。QA docs/qa/2026-11-10-shot-media-warehouse.md。用户工作树保留待后续迭代；独立上下文对话01a1c440已初始化成功。


2026-11-10 文档07联合发布已完成，释放合并/生产窗口：main代码50de687f已push，包含两个对话网页工作流及清理，保留线上1a0b8b0a算力账单。生产版本9c3613ce-f740-418b-bdbb-4c59552052be；manifest=dist.release-conversation-release-20261110.json，276产物+1worker哈希、真实域名HTTPS/登录保护/ready通过，配置与数据库未改。私有Python3.11+CPU Whisper模型补齐并完成虚构语音离线对齐；全量7116、小程序215、真实MySQL73与类型/92卡/41迁移/构建通过，原跳过保留。其他会话手机号业务修复仍未提交，outputs留本地；原生qb候选未切换/提审。QA docs/qa/2026-11-10-conversation-release.md，证据/tmp/conversation-release-20261110/；后续发布以50de687f或更新已核实基线为准。

2026-11-10 文档07全系统冗余清理本地完成并释放文件：19个产品/测试文件净删515行，旧摘要/外形弹窗、无入口偏好提醒、旧抽帧/时间轴包装及重复后端辅助实现清理；用户明确保留的六个情绪检索函数已完整恢复。225专项、补充63项及构建77草稿测试通过，类型/92卡/契约/diff通过；既有架构行数测试1项失败（StoryAgentContext4558>4528，本轮未改）。Knip条目721→695，新增0。未提交/发布/付费/改作品，其他未提交修改保留。QA docs/qa/2026-11-10-system-unused-code-cleanup.md；开工快照 /tmp/document07-cleanup-20261110/。




2026-11-10 chat 01a1bedb：对话图片可点击选中已本地完成并释放文件；关联镜头图片支持文字设置帧角色，未关联候选设帧及自由意图路由仍未打通，防止绑定接口意外替换主图。真实3000验证选中 #2038，未修改镜头或购买媒体；53项测试、类型及92卡通过。QA docs/qa/2026-11-10-chat-image-selection.md。
2026-11-10 chat 01a1bedb：两图候选停留修复完成并释放文件；候选移入可滚动对话区，识别明确拒绝，素材保留仓库。真实3000输入都不要后刷新不再显示；26项测试、最终4项、类型及92卡通过，无新付费任务。QA docs/qa/2026-11-10-two-image-chat-dismiss.md。
2026-11-10 chat 01a1bedb：完成 MJ 编辑接口只读核查并释放；Legnext 现有接入为 V7 Fast 参考重绘，官方另有 upload-paint 外部原图编辑及 inpaint 任务后续编辑；后者依赖兼容的原任务和通道。302 另有 edits 接口。对话底图自动判断和真正编辑接入尚未实现；本次未提交付费任务，右侧已有两张候选，保留原状。











2026-11-10 chat 01a1bedb 两图底图顺序核对本地完成并释放文件（未提交/发布）：twoImageChat/useTwoImageChat、相关测试与账本/QA。确认当前为302 GPT Image 2，预计每图2.86算力、两图5.72；图1优先采用当前已选完整镜头，上传图片为参考，用户明确指定底图时优先；约束构图与主体相对位置但不承诺像素锁定。302/OpenAI官方文档明确GPT Image 2默认高保真且不接受input_fidelity。36项专项、类型及92卡通过；无真实生成，待用户明确费用授权，详见docs/qa/2026-11-10-two-image-chat.md。

2026-11-10 chat 01a1bedb 视频对话两张图入口本地实现并释放文件（未提交/发布，真实付费验收待用户确认）：StoryAgentChat、chatMediaAttachments、twoImageChat/useTwoImageChat、测试/词典/账本/QA。去掉附件提取追问，识别自然改图要求，准备两张候选并经文字确认与采用；原MJ四图入口保留。3000真实故事1217用用户两张原图和原话复现到第01镜5.72算力报价，未提交付费生成；53文件462项、最终48项、类型和构建通过。生成中刷新暂只能检查仓库，结果/采用真实验收尚未完成；QA docs/qa/2026-11-10-two-image-chat.md。

2026-11-10 chat 01a1bedb 镜头图片删除修复本地完成并释放文件（未提交/发布）：storyboardReviewModel/ReviewBoard、StoryCardsBoard.intent测试、账本及QA。修复已移除父图因谱系回带再次显示；镜头保存移除 ID、显式重新关联可恢复，关联他镜图片不解除原镜归属。真实3000删除故事1217首帧#2019并刷新仍不显示，尾帧#2038及仓库原图保留，无付费生成；4文件131项、类型、92卡和diff检查通过，尾帧未实际删除。QA docs/qa/2026-11-10-storyboard-image-removal.md。

2026-11-10 chat 01a1bedb 界面刷新恢复本地完成并释放文件（未提交/发布）：EditingStudioPage、BookVideoWorkspace、storyWorkspacePreference、专项测试和账本/QA。按账户及故事记住书/视频和视频子视图；原首次入口和显式跳转保留，本机存储不可用时回退。35项专项、类型、92卡及差异检查通过；3000真实故事实测视频剪辑、书页、视频分镜稿刷新保持，无付费生成或作品改动。仅本浏览器生效，QA docs/qa/2026-11-10-story-view-restore.md。

2026-11-10 chat 01a1bedb 镜头对话修改/历史本地完成并释放本轮文件（未提交/发布）：ShotChatInspector/shotChangeHistory、StoryboardPanel/ReviewBoard/ManuscriptTable、NLE、StoryAgentChat/Context、桌面排队、字段版本/自动保存与对应词典/测试/账本。点击镜头展开原对话、按稳定身份查看历史/媒体；修复自动保存清历史、切镜排队目标漂移及表格光标被抢。新字段修订记录用户ID，旧记录如实显示未知；镜头2空白媒体区也可选中。56文件469项回归、最终历史48项、类型/构建77草稿保护、92卡验证及diff检查通过；3000实点01/02、收起展开、输入草稿清空、表格焦点、剪辑空白镜、刷新历史。真实1217仍7镜/37图/0视频Take，未新购媒体。此前声音、视频完成刷新恢复/时长策略与真实付费视觉验收等缺口仍保留，不宣称全流程完成。QA docs/qa/2026-11-10-shot-chat-history.md；截图 /tmp/shot-chat-history-20261110.png。

2026-11-09 手机号登录修复本地完成并释放代码：phoneLogin改为49字符完整哈希，修复线上70字符超过VARCHAR(64)导致验证成功后建号失败；PhoneLoginPanel长等待与发送限流提示改善。线上只读证实挑战已消费/无身份/4次列超长，未读取验证码摘要或写库。20专项通过，隔离HEAD快照类型/前后端构建、88卡和diff校验通过；未提交/部署/恢复额度/发送短信，产物/tmp/phone-debug-20261109/src/dist，QA docs/qa/2026-11-09-phone-login-repair.md。生产额度定向恢复待用户批准，未占用发布窗口。


2026-11-09 手机验收与工作流发布完成，释放提交/部署窗口：6e3ea4fe、cfa6fe12及此前4提交已push main；生产版本6b247713-cfad-4f08-831f-3cb9bdaa4536，174产物哈希、HTTPS手机/编辑页/ready通过，麦克风self已上线，配置和数据库未改。6914全量、215小程序、73隔离MySQL及最终77项通过，原跳过如实保留。真机新图片/系统分享、旧ASR上游仍留缺口；outputs私人素材留本地。详见docs/qa/2026-11-09-mobile-workflow-release.md。


2026-11-09 chat 01a1bedb 当前分镜直入视频表格、声音入口及算力报价完成并释放本轮全部文件（未提交/push/部署）：BookVideoStartButton/PublishingDraftWorkspace、bookVideo路由/Creation、directBookStoryboard、publishingVideoStoryboardPersistence/videoWorkflow、BookMusicInsert/BookSoundMenu及相关测试/字典/账本QA。用户授权真实1217最终视频V6来自分镜V2；7镜60秒、13段台词/字幕、4张原参考图和配乐14已入表，章9修订144及章10原文未变，旧视频V2/V3/V4/V5快照保留。修复旧剪辑时长/图片/字幕继承、配乐复用标记与刷新后不跳转；声音入口坐标点击遮挡修复，报价显示0.60算力。最终75项、类型、构建77草稿保护、88卡及差异检查通过；真实3000实点验收，无AI/付费调用。整书朗读13/15仍待逐镜对齐，未渲染成片。详见docs/qa/2026-11-09-book-video-workflow.md及/tmp/book-current-video-table.jpg。其余会话修改保留，发布窗口仍由手机验收发布会话管理。



2026-11-09 chat 01a1bedb 统一新版本与整书声音本地完成并释放文件（未提交/push/部署）：书页版本/生成新版本与聊天共用影片或文字流程；标题单一添加声音菜单，文字为有声书、分镜为台词，配乐和朗读按整书处理。中英法文案、转换→视频素材需求来源及长文朗读指纹/续签防重已接入。组合106项、声音18项、最终定向50项（重叠）、类型/构建77草稿保护与88卡账本通过；3000实际入口及英文截图已验收，无真实模型/付费生成。详见 docs/qa/2026-11-09-book-video-workflow.md，原其他会话未提交工作保留。





2026-11-09 麦克风/桌面听写本地完成并释放 securityHeaders、useVoiceInput、StoryAgentChat、语言词典及对应测试/账本：修复响应头禁止录音，电脑原话筒复用实时听写，短错误原位显示并隔离跨故事迟到回调。60项相关测试、类型与86卡账本通过。Chrome真实启动/出字/停止成功，测试草稿已清空且未发送；Safari已弹出录音授权，但实时识别启动超时，内置浏览器仍拒绝录音；普通旧ASR403/500未改。未提交/push/部署，不占发布窗口。详见 docs/qa/2026-11-09-microphone-permissions.md。












2026-11-06 中文三音色短试听完成并释放（chat 01a1b107，main，未提交/部署）：豆包温柔小雅/温暖阿虎、MiniMax淡雅学姐同稿66字符一次生成资产10/11/12，13.92/11.645875/12.968375秒，实际合计0.06算力。Qwen旧版本404/Model not exist，应用0扣费，未重试且未保留不可用适配。最终87专项、类型、84卡、三文件解码/206通过；只变更storyVoice302及对应测试、旁白测试、本地配置/示例/QA与账本，本轮没有保留storyNarration/storyAudioImport行为增量。默认暂为minimaxi/danya_xuejie，等待用户选择，未写书稿/分镜/Page。输出outputs/launch-video-storyboard-20261106/chinese-auditions/，QA docs/qa/2026-11-06-chinese-voice-auditions.md。

2026-11-06 ElevenLabs选声反馈复查完成并释放（chat 01a1b107，main）：用户否定Sarah英语语调中文，本作品淘汰候选9，保留历史资产/账务。只读完整25音色中仅Stella Gu标签zh但描述冷淡疏离，未找到适合温暖叙述的原生中文选项，未再付费；仅更新声音QA/功能卡听验结论，84卡校验通过，未改原对话书稿/分镜/Page。运行配置仍Sarah，下一次生成前须重新选声，不能将接口成功视为用户认可。


2026-11-06 ElevenLabs中文试听完成并释放（chat 01a1b107，main，未提交/部署）：storyVoice302/storyNarration/storyAudioImport及对应测试、本地配置/示例、账本与独立QA。302实际模型eleven_multilingual_v2、Sarah音色EXAVITQu4vr4xnSDxMaL，故事1217同稿一次生成资产9，46.718549秒，应用结算0.06算力；供应商标价约0.0699 PTC而非实际账单。84专项、类型、完整解码/206读取通过，章节9仍version108，未采用时间轴；MiniMax/OpenAI保留，未动原对话Page/实验稿与章/节/场/镜头代码。音频outputs/launch-video-storyboard-20261106/launch-video-302-elevenlabs-sarah-narration.mp3，听感待用户确认；QA docs/qa/2026-11-06-302-elevenlabs-narration.md。


2026-11-04 批量有声书/台词完成并释放 BookBlockCanvas/ChapterTextModules/BookModuleConvert、bookMedia路由/storyNarration及测试/账本：多选仅提取文字，完整原文预览/全组报价签名和源变更拒绝，结果按末源插入并入仓库；台词批量分类一次提交。91项相关测试、类型通过；3000实点六项菜单/两段朗读预览，未付费生成、未改真实书稿、未提交/部署。QA docs/qa/2026-11-04-book-multiselect-menu.md。

2026-11-04 模块删除快捷键完成并释放 BookBlockCanvas、BookWritingContext.test 及账本/QA：单选多选 Delete/Backspace 复用删除撤销，选择后书页聚焦，保护文字编辑/IME/连发/组合键。61项相关测试、类型通过；主仓3000纯内存临时页实测单删、多删、恢复与输入保护，临时文件已清理；未改真实书稿、未提交/部署。QA docs/qa/2026-11-04-book-multiselect-menu.md。

2026-11-04 引号尺寸微调完成并释放 BookDialogueText 及账本/QA：字号减半为0.625em，主仓3000截图及DOM比例验证通过，83卡和差异检查通过；未提交/部署。

2026-11-04 台词高亮引号本地完成并释放 ChapterTextModules、BookDialogueText、bookBlockLayout 及测试/账本：按分类显示绿色前后引号，装饰不入正文，布局自动留位重排。56项相关测试、类型检查通过；主仓3000既有台词截图/DOM核对通过，未改真实正文、未调用模型、未提交/部署。QA docs/qa/2026-11-04-book-dialogue-review.md。

2026-11-04 图像方案历史卡本地完成并释放 BookImageCompositionChat/History/Card/Session、bookModuleActions/ChapterTextModules、StoryAgentChat、bookImageComposition/bookMedia/shared 类型及测试账本：原任务历史显示Vn状态/时间/摘要卡，打开参数、接续最新讨论；校验源快照且重开不重复插图。54项相关测试、类型、83卡和差异检查通过；主仓3000实点既有V1/V2卡片、V2参数/结果与源变化拒绝。旧任务无时间显示历史记录，未确认草稿仍为临时，未真实生成/扣费/提交/部署。QA docs/qa/2026-11-04-book-image-history-cards.md。

2026-11-04 台词字幕分类与视频确认本地完成并释放 bookWritingStyle/chapterBlockTree/BookBlockCanvas/mergeBookText、bookVideoSource/Creation、publishingArticleVideo/publishingVideoStoryboard 生成与持久化、BookVideoChat/confirmBookVideo 及测试/账本：持久用途分类与精确台词传递，方向确认只到预览，逐镜人物/台词/背景音核对后显式采用并校验修订；旧稿/参考图/CAS/费用确认保留。139项相关回归、类型、83卡和差异检查通过；主仓3000实点菜单及V2只读核对表，第一幕2图/第三幕3图可见。未改真实正文、未调用真实模型/付费媒体、未提交/部署；完整新方案人工验收仍待试用。QA docs/qa/2026-11-04-book-dialogue-review.md。

2026-11-04 多选六点菜单本地完成并释放 BookBlockCanvas、ChapterTextModules、BookModuleConvert、bookBlockLayout、bookModuleSource、storyAudioGeneration、bookMedia/timelineMedia 及测试/账本：原位绿色把手统一文字/音乐/图像/删除四项菜单；全组选材及签名指纹、最后源之后插入、批量删除与一次撤销，拖动/缩放保留。108项相关测试、类型、82卡与差异检查通过；主仓3000实点两图多选/六点菜单/音乐弹窗通过，未调用付费生成、未删真实正文、未提交/部署。QA docs/qa/2026-11-04-book-multiselect-menu.md。

2026-11-04 书稿合并为图像本地完成并释放所登记文件：多选右键、图片菜单、自然语言三个入口统一聊天方案；轻量汇聚、原图优先302 Sunburst、逐轮确认、事务防重与GET恢复、书稿安全插入及仓库保存。216项回归、类型、82卡、差异检查通过；主仓3000实点图文混选/全文菜单/聊天触发与补充要求通过。未新增真实付费生成，未提交/部署；全链付费验收与生产MySQL仍列缺口。详见 docs/qa/2026-11-04-book-image-composition.md。

2026-11-04 分镜图片自动取回完成并释放 useShotImageRender、pollStoryboardImage、storyboardImageTask/legnextImage及测试、账本/QA：正常排队自动串行查询原任务，完成刷新画面行与仓库；切换取消、明确失败停止、十分钟后保留原恢复入口。75专项、类型/81卡/差异检查通过；真实三轮共12图已入库，新自动流程以模拟测试验证，浏览器绑定不可用。未新购媒体/提交/部署。QA docs/qa/2026-11-04-storyboard-auto-recovery.md。

2026-11-04 原图优先修复完成并释放 shared/shotImageRender、renderGate、storyAgent生成路由、useShotImageRender及测试/账本/QA：用户明确批准严格保留时取消冲突的强制重绘/无字规则；有有效参考和明确保留要求才跳过导演二次改写与历史偏好，原费用确认说明MJ不能保证像素级复刻。135专项、类型/81卡通过；未改原图/已选候选，不切模型、不付费生成，未提交/部署。QA docs/qa/2026-11-04-reference-fidelity.md。

2026-11-04 视频参考图上传修复完成并释放 imageGen/legnextImage及对应测试/账本/QA：视频按钮已走Legnext，修复本地参考图误走旧302存储代理，改用现有302文件上传，保留OSS优先和模型/报价/单次提交。219测试、类型/81卡通过，空白1像素测试图真实上传及匿名GET200通过，未发起付费生成；原参考图上传被自动审批拒绝而未执行。未提交/部署。QA docs/qa/2026-11-04-storyboard-reference-upload.md。

2026-11-04 书稿按幕多参考图完成并释放：bookVideoSource/Creation、publishingArticleVideo/publishingVideoStoryboard及持久化、storyMaterials与客户端参考图投影、测试/账本/QA。故事1217真实生成并采用V2七镜，画面行第一幕2图、第三幕3图，其余无图；V1八镜快照与原资产保留。133专项及新增画面投影39项、类型/81卡通过，未提交/部署。另用户授权旧第02镜旁白一次最高0.04算力诊断，连接失败无HTTP响应、供应商结果未知，未重试。QA docs/qa/2026-11-04-book-act-references.md 与 storyboard-voice-failure.md。

2026-11-04 旁白失败反馈本地修复完成并释放 StoryboardPanel/StoryboardReviewBoard/StoryboardMatrix：失败按故事+镜头显示在原按钮下，52专项/类型/81卡通过；1217请求178已失败且预占释放、实际扣费0。供应商真实生成仍未恢复，待用户确认一次最高0.04算力测试（尚未提交），未部署。QA docs/qa/2026-11-04-storyboard-voice-failure.md。

2026-11-04 空格播放与默认简化显示已完成并释放：StoryboardEditRow 路由、ShotPreview/StoryboardReviewBoard 焦点与默认状态、相关测试/账本/QA；176专项、类型/81卡门禁通过，主仓3000真实标题及Preview空格播放暂停、输入空格保护、默认简化和双向切换通过。未提交/部署，未购买媒体，未动用户原标签。QA docs/qa/2026-11-04-storyboard-space-default.md。

2026-11-03 文档07输入布局候选待真机：987d444已push，0.1.1103qb已上传；移除写作提示、避免普通正文键盘双重缩放、区分本机冲突与云端已保存。1673测试/类型及真实虚构标题正文保存重开和清理通过。保留Documents/Codex/2026-11-03/document07-miniapp-acceptance候选待验，释放代码/开发工具独占；未合主干/提审/部署云函数，用户冲突草稿保留。

2026-11-03 文档07小程序内部验收待用户：bf1438b隔离候选整合12ce517与main清理，1671测试及七核心云源码下载核对通过；电脑保存/重开及清理完成，0.1.1103qa已上传，待用户设体验版及新账号真机验收。微信后台站点策略阻止自动操作；未提审/未正式发布。释放开发工具独占，保留候选工作树供续验，主仓脏文件未覆盖。

2026-11-03 文档07提交发布完成，独占main收敛/生产发布窗口已释放：Web fa62493a已上线，116产物及ready校验通过；原生PR #10 CI通过并合入f53dbfe5，客户端仍待既有完整验收，未上传/提审。其他会话脏文件保留。详见docs/qa/2026-11-03-document07-cleanup-release.md。

2026-11-02 22:04 支付宝最小发布成功，释放生产发布窗口：以微信账号续修为基线，/tmp/alipay-enable-20261102/src为最新后端源码，只有返回/m与北京时间两处修复。15专项/隔离类型通过；线上manifest=/opt/Drinking-Time/dist.release-alipay-enable-20261102.json，后端SHA7572fce979a69b877e226cbbc6935f41d6ae2081f95c3ec2bf111d368ee718af，PID498425，ready/mysql/required通过。115产物除后端外全部保留；ALIPAY_PC_CHECKOUT_ENABLED=true，其余配置未改。备份dist.bak-alipay-enable-20261102。真实网页¥1/1算力下单已进入支付宝官方收银台，订单pending，等待用户扫码核验回调。后续发布必须保留支付源码修复及开关，勿用旧manifest覆盖。详见支付宝QA。

2026-11-02 支付宝准备完成（释放代码、不占发布窗口）：server/routers/computePayment.ts 返回/account 404修为/m，server/services/payments/alipay.ts 改北京时间，15项专项及77卡账本通过；未提交部署。真实应用已上线、电脑网站支付可调用、生产查单签名与响应验签通过，订单表和唯一索引就绪。线上开关仍false、零订单。微信会话仍占窗口，已询问用户能否联系协调；无授权不跨对话发消息，不重启。全仓类型检查另有computeLedger.ts:147未提交错误。证据 docs/qa/2026-11-02-alipay-readiness.md。

2026-11-02 分镜等待与移除本地完成：上述文件释放，106项专项通过；原第02镜GET恢复1996–1999，无新购买。镜头移除1997后仓库仍可预览/绑定；恢复按钮与重新打开查询原任务已接入。尚未提交/部署，发布树旧包需要同步本轮增量，禁止直接发布旧包；微信窗口仍不占用。详见storyboard-legnext QA。

2026-11-02 分镜Legnext发布准备：用户已授权部署；本会话只在隔离树打包分镜供应商/任务恢复与验证，不占用线上窗口。保留微信已部署兼容后端，待微信窗口明确释放再push/切换服务。

2026-11-02 书转电影续验完成并释放 BookVideoChat.tsx/test：历史列表后台刷新，运行等待反馈与防重复点击；慢列表回归先红后绿，25项及类型通过，实点V3进入两镜表格。未提交/部署/购买媒体，缺主图与最终成片仍待验；证据见book-video-entry QA。

2026-11-02 书转视频待发布（准备已完成、不占窗口）：用户要求合main/push/部署；隔离工作树 /tmp/book-video-release-20261102/worktree，分支 codex/book-video-release-20261102，提交 a557124e。139项视频、45项微信后端兼容、75项草稿安全测试及构建通过；线上微信扫码后端与main不同，已核对已发布源码。微信会话仍占发布窗口，待释放并核实其他发布收敛后合并/推送/部署；不得重置或删除此待发布分支。具体交接 /tmp/book-video-release-20261102/HANDOFF.md。

2026-11-02 分镜MJ过载本地修复完成并释放：storyAgent/legnextImage/storyboardImageTask/storySync/rerender及测试，分镜新请求改走Legnext V7 Fast，回执CAS与并发恢复保护。故事1214第01镜单次80点/$0.08，超时后恢复取回1992–1995四图，刷新仍显示；116项/类型/账本通过，未新增第二单、未生成视频、未提交/部署。微信发布窗口不占用，QA docs/qa/2026-11-02-storyboard-legnext.md。

2026-11-02 书内图乐复用已完成并释放 bookVideoSource/Creation/shared、BookVideoChat、timelineAudioEditing 及对应测试：正文/旧布局选图引用、书内ready音乐盘点与确认后配乐复用，保留人工轨/删除选择，持久去重、失败可续。76项相关与最终类型/77卡账本通过，实点进入视频表格通过；没有新增付费生成，未提交部署，真实带音乐成片未验。QA docs/qa/2026-11-02-book-video-media-reuse.md。


2026-11-02 微信真实出码续接（本对话）：用户授权继续至登录页出现真实二维码。占用微信扫码服务/配置及独立3001预览、相关QA/账本；Legnext已释放，现登记微信网页登录后端发布窗口，基于c155d0bc隔离准备最小扫码增量，不重启本地3000、不覆盖其他会话代码。原生独立codex/wechat-qr-live-20261102，提交3bbd25a已部署两个微信函数，云端密钥由用户保存、腾讯云二次验证已完成；Web兼容扫码后端已发布且ready/mysql/required，前端未切换。HTTPS出码网关、客户端和真实扫码继续接通，部署后云源码下载ECONNRESET待核对。

2026-11-02 Legnext发布完成并释放窗口：ed084cc3已push main并部署，书稿模块MJ V7 Fast、回执恢复及IPv4图片下载。223专项+75草稿安全、类型/构建/账本、115产物与HTTPS资源/readyz通过；生产四图同任务GET通过无新增付费。完整按钮付费闭环待验。主仓113份工作文件内容保留，临时worktree/分支已删除，视频会话不受影响。QA docs/qa/2026-11-02-legnext-release.md。

2026-11-02 视频确认直达表格已完成并释放上述文件：BookVideoChat/confirmBookVideo、VideoVersionHistory、shared/bookVideoCreation、bookVideoCreation/router、publishingVideoStoryboard及测试。收起后保留下一步，确认直达表格并保留V1/V2历史；修同段多镜丢失，真实V3特写+全景及历史展开通过。47项/类型通过；仅本地未提交/部署、未购买媒体。QA docs/qa/2026-11-02-book-video-entry.md。

2026-11-02 旧页保存恢复完成并释放 appVersion、ChapterWriting/ChapterWorkspace及测试：独立草稿恢复入口；修首次挂载抹掉冲突提示。用户当前纸船故事实点对比→保留修改→已保存→视频需求对话通过；33项回归/类型通过，无付费生成，未提交/部署。QA docs/qa/2026-11-02-stale-save-recovery.md。


2026-11-02 模块MJ版本选择本地完成并释放：用户授权直接选择，核对302目录后固定书稿文生图V7正式版，imageGen/storyAgent/BookModuleConvert及测试；206项相关测试通过，未新增付费请求/未部署，不能视为过载已解决。其他入口默认与历史任务原通道保留；详见MJ routing QA。

2026-11-02 本地MJ续验收工释放：imageGen默认普通/mj/，专用通道显式配置（取消域名推断）；首次404、修正后真实请求明确过载未受理，无候选/出图扣费，不再提交。209项回归及新增404不跨路由重买测试通过，未部署/提交，详见MJ routing QA。



2026-11-02 模块图片任务恢复本地完成并释放（未提交/部署）：BookModuleConvert/storyAgent及测试，新增回执服务/仓储/共享类型；storySync保护回执，ChapterTextModules防重复图片插入。217项回归+真实MySQL事务/多进程测试、tsc、76卡账本通过。等待中的模块不阻塞其他模块；无新付费生成，MJ旧49%仍未解决。QA：docs/qa/2026-11-02-midjourney-routing.md。保留其他助手改动。

2026-11-02 视频需求确认：已完成并释放 BookVideoChat、bookVideoCreation/shared定义及 PublishingDraftWorkspace。自由描述→条件追问真实推理通过，画册生成/重开已接通，35项回归通过；见 docs/qa/2026-11-02-book-video-entry.md。本地未提交/部署，保留其他会话改动。

2026-11-02 书转视频入口收工并释放：ChapterTextModules与EditingNleWorkspace新增共用BookVideoStartButton，BookVideoChat补步骤与处理中状态；两入口实点进入同一左侧对话，书稿/参数/历史保留。48项相关测试、类型通过，未付费生成、未提交/部署。保留其他未提交修改；未改PublishingDraftWorkspace既有差异。QA：docs/qa/2026-11-02-book-video-entry.md。

2026-11-02 草稿版本发布收工，发布窗口释放：以已上线1d79e444为基底追加ChapterWriting修复，新版本6dd8d506-7d0f-480a-9a1b-487a69db366f。仅3个前端产物更新，后端/配置不变；39专项、75草稿安全、类型/构建通过，115产物及服务器HTTPS页面资源/readyz通过。本机浏览器ERR_CONNECTION_CLOSED，线上生成闭环未验。未commit/push，其他会话文件未变，证据docs/qa/2026-11-02-writing-base-version.md。

2026-11-02 草稿基准回退修复完成并释放 ChapterWriting.tsx/test：保存确认后旧事件不得将baseVersion回退；39项测试、tsc、76卡账本通过。仅修改这两文件及QA/账本，本轮未提交/部署，其他会话文件哈希未变。续验：保留旧页草稿，新版同故事单次授权MJ请求通过prepare并到达供应商，但上游过载未受理（服务端现有3次重试），未出图、未切备用。闭环未验收，详见docs/qa/2026-11-02-writing-base-version.md。

2026-11-02 微信续验收工，释放工具/云环境占用：原生 quick-memory-conversation-20261101 干净cbac7c7，业务0523fe3。拒绝授权提示和正常设置恢复已实点；真实两轮纠正→整理→明确追加→重开通过，测试新增段落已正常删除并重开核对基线，原图/原文/历史保留。未发送测试输入和生成草稿已清空，本机虚构聊天历史保留。每日一问一次DAILY_TOPIC_INVALID后手动重试成功；DevTools Offline不能阻断云函数，已恢复Online，不计断网通过。仍缺真实新账号、真机冷启动、真实断网及其余图片/记忆入文分支，无二维码/提审。完整记录见原生docs/handoff/2026-11-01-release-acceptance-followup.md。



2026-11-01 手机图片过载隔离修复完成并释放imageGen/imageProviderHealth及测试：MJ过载只冷却自身、不污染全局失败计数，107项/类型通过；供应商未恢复，无新付费请求。备用GPT入口等待用户选择，默认MJ不变，未部署。

2026-11-01 翻译菜单精简完成并释放BookBlockCanvas：中文只显示翻译英文，英文只显示翻译中文，混合保留两个；真实双模块菜单验证、类型通过，不调用模型/不部署。

2026-11-01 电脑/手机按钮实测完成并释放文件：MobileMemoryFollowupChat/test修恢复消息误锁模块动作，MobileNewStoryCompanion修恢复聊天误标新故事，ChapterTextModules补媒体key。48项测试/类型/76卡通过，真实文章保存与旧稿对比、手机音乐播放/合并/翻译/素材新故事、跨端提醒与接收通过；图片仍供应商过载。未部署，见docs/qa/2026-11-01-web-button-acceptance.md。

2026-11-01 模块中英翻译完成并释放文件：BookBlockCanvas/BookModuleConvert、bookMedia router、新bookModuleTranslation及测试；32项专项和类型通过，虚构故事中英双向真实翻译、原文保留与下方插入保存通过。未提交/部署。

2026-11-01 聊天到文章生成衔接完成并释放：textDraftHistory/textDraftPrompt保留同故事前轮用途与禁写范围；writingCompanion指向现有生成入口；DailyLetterWelcome标明AI回信来源。6项断点回归先红后绿，82项相关与类型通过；无新付费调用、未提交/部署。生成UI与applyGenerated由来源会话负责，真实自动写入验收仍待完成；QA见conversation-exploration。

2026-11-01 文章聊天衔接前端已释放：articleGenerationOptions默认优先沿用聊天已确认的形式/篇幅/受众/用途/语气/禁写范围，最新修正优先，不将助手猜测当事实；3项回归及76卡账本通过。书稿自动保存与偏好adoption分开已更新账本。服务端snapshot/delta与伴写引导由自我探索对话负责，未部署。

2026-11-01 生成文章整理已释放文件（未提交/未部署）：StudioCreateMenu移除排版生成；TextDraftVersions/articleGenerationOptions细分形式、事实性质、篇幅与要求；appReleasePlugin修HMR误判过期；DesktopWritingContext/desktopWritingSession/ChapterWriting直接写入新稿并保留旧版。70项专项与类型通过，真实首轮出稿/保存/旧稿对比通过，第二轮模型断连可能计费未重试，直接写入新路径真实复验仍待上游恢复。

2026-11-01 手机模块聊天操作已释放文件（未提交/未部署）：MobileNewStoryCompanion跟随当前模块、MobileMemoryFollowupChat上下文栏增加生成图片/音乐和勾选合并；ChapterTextModules/bookModuleActions复用原转换与保存。42项专项及类型通过，390px实点图片/音乐窗口通过，未付费生成。

2026-11-01 桌面生成文章入口修复已释放文件（未提交/未部署）：StoryAgentChat不再因选中书模块隐藏入口；TextDraftVersions/textDraftBasis读取当前书稿含未保存修改，生成期间书稿变动不覆盖；59项专项与类型通过，实际点击模块后生成新版本入口仍可见。未重新付费调用模型。

2026-11-01 微信续聊来源修复已释放代码及开发工具：隔离树 `codex/interview-source-read-20261101` 基于架构会话67e532b，补丁86f2be9、1edeabf、8aefc77已交其整合部署。指定来源读完整记忆/原会话，拒绝缺失与错配，云上下文6000字头尾保留，并保留文档07死链删除；1649项完整检查及清理后51项相关回归通过。主仓混合代码未覆盖。开发工具由架构会话独占验新随手记；本会话虚构1101记忆正常软删除后活动数16→15。尚未交付二维码，详见原生conversation-exploration交接。

2026-11-01 手机模块默认入口与触屏菜单已完成并释放文件：MobileWorkspace默认书稿、BookBlockCanvas触屏操作常显、mobileNewStoryCompanion.css仅书稿小鸟遮挡修复。41项专项/类型通过，390px同一故事直达→模块转换菜单→有声书界面实点通过。未付费生成/未部署，QA见mobile-book-modules。

2026-11-01 手机模块可见入口修复完成并释放文件（本地未提交/未部署）：AppRouter手机editing入口、MobileStoriesPage首页直达书稿、MobileWorkspace初始入口已接通；53项专项/类型/76卡通过，390px实际点击直达手机书稿验证，保留标签与原文字稿。QA：docs/qa/2026-11-01-mobile-book-modules.md。原生模块入口与转换仍由文档04实施，不能视作原生验收通过。

2026-11-01 持续对话与表达探索首轮已释放文件：Web shared/creativeExploration、writingCompanion、storyReply 对话承接修复在main本地；151项专项、类型/76卡账本通过。原生普通模块误判/每日问题线索历史/续聊来源已接回主仓，1619项通过，独立保存点1e2a879，临时工作树已删除。真实11次短文本测试含两次失败迭代，最终纠正→试样→结束三轮通过；未部署/提审，自动长期记忆开关未改变。QA：docs/qa/2026-11-01-conversation-exploration.md。

2026-11-01 手机模块编辑 Web 本地接入完成，释放相关文件（未提交/未部署）：保留标签，复用模块保存/转换/版本，旧稿编号保存、小屏重排、多选与小鸟定位；81项测试/类型通过，390px保存重开与0.04算力朗读报价实测通过，未付费生成。原生文档04对话继续实施。详见 docs/qa/2026-11-01-mobile-book-modules.md。

2026-11-01 MJ过载排查完成并释放imageGen/BookModuleConvert文件：一次虚构提交实测302模型过载HTTP429，无任务号；精准中文映射与防重复测试101项、类型通过。未修改模型/价格/其他改图工作，未部署；上游恢复未验证，详见book-module-conversion QA。

2026-11-01 Web故事标签完成并释放文件占用：标题下MobileStoryTags与列表搜索、storyAgent标签接口/CAS保护已接入，14项测试和实际添加/刷新/搜索/清空通过。MobileStoryWorkspace仅新增MobileStoryTags import及标题下挂载，请模块编辑会话保留。未部署；小程序标签未接入。QA: docs/qa/2026-11-01-story-tags.md。

2026-11-01 素材录音权限反馈修复完成，释放useMaterialCapture/captureRecordingError：内置浏览器实点复现权限拒绝，中文恢复提示已显示；14项测试、类型与账本通过。浏览器/系统授权尚未放行，不能声称实际录音成功。未部署。

2026-10-31 图片429状态修复完成，BookModuleConvert.tsx/test文件已释放：明确限流恢复手动入口，未知任务继续防重复，6项组件测试通过；未付费重发，未部署，上游恢复待验证。

2026-10-31 合并换行修复已完成并释放：合并保留换行/空行，样式记录模块行数，光标/源转换/图片目标同步适配；72项测试、类型检查通过。未提交/未部署，QA见2026-10-31-merge-audiobook.md。

2026-10-31 本会话手机素材收集Web验收已完成本地范围，释放文件占用：标准ASR及持久任务恢复，桌面/390窄屏真实图文+MP3/M4A保存重开通过，17项回归、类型检查和账本通过。测试故事1213/1214留给用户检查。未部署，真机/系统分享待验收。详见 docs/qa/2026-10-31-web-material-capture.md。











2026-10-30 手机素材收集：`codex/mobile-material-capture` 两仓隔离开发。当前负责新增 capture 服务、仓储、手机聊天附件与系统分享入口；网页集成仅添加 schema 两表、runtime 数组、router 接线、storySync 来源保护及 visionChannel 可选禁止重放参数，保留已释放的图片/视频/每日来信改动。主仓唯一3000进行验收，不部署、不提审。

2026-10-29 live book media acceptance paused at external generation failures, files released (uncommitted): real scribble-to-subject mask and signed masked quote verified; whole/masked GPT edits return 401/-10003, MJ video routes return 404 without task ID. Routing, vision payload/annotated context/JSON, async error parsing, MJ endpoint/auth/quote fixed. 146 targeted tests plus final 93 regression tests, typecheck/ledger/migration/diff checks pass. No successful image/video candidate adoption or history-reopen test, no deployment. Preserve all originals and task receipts; see docs/qa/2026-10-29-book-media-editing.md before retrying paid work.



2026-10-29 每日一信接手已收工（未提交、本地预览）：用户批准接替旧个人记忆线同文件预留；作品选材与黄历原文展示修复完成，78 项相关测试、类型/72 卡账本通过。涉及 emotionDailyLetters / emotionDailyReference302 / almanac / dailyLetterWorks、DailyLetterWelcome / MobileDailyLetter / DailyAtmospherePanel 与测试，文件已释放。未部署，QA：docs/qa/2026-10-29-daily-letter-works-almanac.md。

2026-09-10 接管：用户已停止「9.7 DK上线微信小程序」，由任务 `01a08a06-dd10-7230-b5d4-b75fd8502d46` 承接 `codex/minigame-launch-stability` 的现有诊断改动、QA、功能账本及上线交接清单。本轮先验证并收敛发布阻塞，不占后端、不执行跨分支合并；原任务停止后的 API 状态仍滞留 waitingOnApproval。预计本轮完成验证与交接，真机及后台状态由用户补充。

小游戏安卓黑屏诊断（2026-09-10，本任务承接原小游戏同步线）：在 `codex/minigame-launch-stability` 仅改 `minigame/scripts/{build.mjs,diagnostic-entry*}`、`minigame/src/liveGame.ts` 启动标记及该分支 QA/账本。现有认证、正文与聊天业务逻辑不改，不占共享后端；不跨分支合并。原 `codex/wechat-mobile-parity` 暂不同步同路径，防止改变真机排查基线。根因未确认，诊断包不称修复版。



小游戏微信优先关联邮箱（2026-09-09）：本地已完成“微信优先独立登录，登录后自愿关联；已有邮箱保留故事和余额，微信账号有内容则停止”。仅在 `codex/wechat-mobile-parity` 修改 `minigame/src/{liveGame,liveClient,accountView,workspaceView}*`、`server/services/{accountIdentity,minigameEmailOtp,minigameAccountLock}*`、`server/_core/minigame{Router,Routes}*`、隔离 MySQL 测试与本分支账本/QA；认证 50 项、MySQL 13 项、两套类型检查及构建通过。全量仍有既有失败，详见分支 QA。未部署/上传此版，等待仅测试站更新和新版预览二维码批准；未改真实账号，不改 schema、server/db.ts 或主仓业务代码，不执行跨分支合并。保留上一轮未提交 Intl 修复。

小游戏启动兼容修复（2026-09-09）：上述专属分支已修复 `client/src/features/nayin/nayin.ts`、`shared/shichen.ts` 的无Intl路径，并补 `minigame/src/runtimeDate.test.ts`/`smoke-live.mjs`；50项定向、两套类型检查及账本通过，621.6KB修复预览已上传并交付 `/private/tmp/dk-minigame-intl-fix-20260909.png`。等待用户真机结果及本地提交选择，改动未提交；不占主仓对应源码、不部署后端。

小游戏同步线已释放合并窗口（2026-09-09）：实现 `66e36f0`，main `de22808` → 专属分支合并 `fa5a1bb`；合并后专项38项、手机版/小游戏工作区23项、两套类型检查与live构建冒烟通过。不改 main 代码、不 push、不部署；真机验收与新版界面适配仍待继续。

| 会话 | 分支 / worktree | 正在动 | 状态 | 更新时间 |
| --- | --- | --- | --- | --- |
| 06 章节投递技术验证收尾 | Drinking Time `codex/chapter-delivery-20261022` / `.worktrees/codex/chapter-delivery-20261022`；拾光家忆同名 `.worktrees/codex/chapter-delivery-20261022` | 投递额度与媒体安全测试、06 功能账本和验收交接；不触碰数据库、微信开发者工具、部署或主仓其他改动 | 两仓修复与交接均已提交：网页 `39e554ed`、`94bef0be`；小程序 `9375294`。未部署、未 push、未合 main | 2026-10-24 |
| 小游戏账号与旧故事接入 | `codex/wechat-mobile-parity` / `.worktrees/codex/wechat-mobile-parity` | `minigame/**`、新增 `server/_core/minigame*`、`server/services/wechat*`/`minigameEmailOtp*`、`shared/minigameWorkspace.ts`、`server/_core/index.ts`，本分支 `accountIdentity.ts`/`publishingPersistence.ts` 适配及功能账本 | 测试站33b5cc8上的11文件服务端增量已部署并staged；Web资源hash不变，备份 `/root/dk-workspace-staging-20260908`。**后续手机版部署须保留/集成本增量。** 微信凭据已验证并仅配置测试站，微信登录开关开启，真实wx.login/旧账号绑定待真机验收；新预览上传待明确批准。本轮整理专属分支提交并进行 main→本分支的只读合并预检；不改来源分支、不部署、不占主仓功能账本。 | 2026-09-09 |
| Codex「聊会儿」微信工作区 | `codex/liaohuier-wechat-workspace` / `.worktrees/codex/liaohuier-wechat-workspace`；`codex/liaohuier-wechat-live-auth` / `.worktrees/codex/liaohuier-wechat-live-auth` | U6 客户端认证与视觉：`miniprogram/**`；U3 小程序受限会话：`server/_core/{oauth,sdk}.ts` 及新增测试。**不改** schema、migration、`server/db.ts`、Story／账务路由 | **实施中**：前者只改小程序且不启动 dev server；后者基于最新 `main` 建干净 worktree，先 test-first 定小程序会话合同，未部署、未配置 AppSecret | 2026-09-03 |
| 视觉资产标准板 | `affectionate-bartik-1d9c06` | 原待办会触达 `server/routers/storyAgent.ts` 的 provider 白名单/估价分支 | **协调暂停、不占用文件**：旧统一账号线已随 PR #7 收工；本线若恢复，须基于最新 `main` 重新登记文件所有权 | 2026-09-03 |
| 个人记忆与每日来信执行 | `codex/personal-memory-daily-letter` / `.worktrees/codex/personal-memory-daily-letter` | U1-U7 全部已合入 `main`（`7e10858`）。**下一步 U6 会占用**：`server/services/personalMemorySelection.ts`（新增）、`server/services/{emotionProfileDailyRefresh,emotionDailyLetters,emotionDailyReference302}.ts`、`server/routers/index.ts`、`client/src/features/analysis/views/DailyLetterWelcome.tsx` | U7 完成：账号级足迹聚合、来源解析与记忆控制 API。租户边界新增失败关闭护栏（routers.ownershipBoundaries.test.ts）：personalMemory router 只要有 procedure 接受客户端身份字段或不读 ctx.user.id 就直接红，已验证真的会红。时间线 keyset 分页真实 MySQL 验证同一秒多事件靠 id 兜底不丢；来源 resolver 六种 sourceType 逐条验证归属，失败关闭；新增受保护足迹媒体端点 `/api/personal-memory/media/:eventId`，不重定向到不鉴权的 `/api/images`。顺带修一个真实 bug：日期详情曾靠「最近 100 条事件」过滤，活跃用户翻旧日期会静默返回空，已改精确查询+两条回归测试锁定。合并后主仓门禁绿：tsc 干净、452 文件/3956 用例、MySQL 集成 38/38、feature:validate 通过。来信仍未写新事件——daily_letter_version 语义留给 U6 决定 | 2026-09-04 |
| 手机端界面落地 | `claude/lucid-turing-bdeb39` / `.claude/worktrees/lucid-turing-bdeb39` | 把 `docs/prototypes/liaohuier-miniapp` 的界面落成 `/m`：`client/src/features/mobileWorkspace/**`、`client/src/app/router/AppRouter.tsx`、`client/src/features/auth/{mobileReturnPath.ts,views/AuthEntryPanel.tsx}`。**不改** server、schema、migration、tRPC 合同 | **实施中**：`83efa18` /login 按设备落点；`c919217`+`433d8f8` 外壳落地（正文常驻 + 聊聊三档 + 桌子底栏）；`4bc30a4` 修展开态点「故事」聚焦到隐藏 select。数据层未动。**回复原型线（localhost-3030-redesign）**：你提的两条我已经有了——遮罩本来就是全透明（只接点空白收起），header 拉开即收。差异说明：/m 的状态与「保存正文」在 MobileDocumentView **底部**（展开时本就被面板盖住），且没有版本/平台/修订号胶囊、没有测试模式横幅（那是小程序 mock 才有），所以这边只让出 60px 不是 152px，实测正文 385→445px。`client/src/features/mobileWorkspace/**` 确认归我，还在写 | 2026-09-06 |
| DK 上线跟进：手机 Web 与微信 | `claude/dk-launch-followups` → **已合入 main** | `client/src/features/mobileWorkspace/**`、`client/src/features/nayin/{NayinContext,views/BeverageTransition}`、`client/src/index.css`、`minigame/src/{liveGame,workspaceView,accountView,peekSpeech.test}.ts`、`client/public/liaoliao/` | **已合入 main 并推送**。手机 Web 已获用户界面确认；微信预览包已交付、**真机四项待用户回报**。遗留：存入故事弹层偶发自关（数据不受影响）；版本列表接口缺失；表情素材经用户决定不补。**注意**：`minigame/src/liveGame.ts` 在 `.worktrees/codex/minigame-launch-stability` 里另有 15 行未提交的 `bootMark` 启动打点，本轮未触及其区域，该线合并时请保留。 | 2026-09-11 |
（收工时删掉自己这行。）

渲染四张无反馈修复已收工（2026-09-08，工作区未提交）：`StoryboardReviewBoard.tsx` 改页面内费用确认和可见错误；main:3000 镜头02点击/取消实测通过，未付费生成；63项测试、类型检查、构建及功能账本验证通过。

> **2026-09-03 收敛状态：** 统一账号线和微信测试壳层已随 PR #7 合入 `main`，旧会话、
> 本地分支与 worktree 已销号，不再占用热区。后续 staging 数据迁移、小程序 live 接入或
> 视觉资产工作恢复时，都必须基于最新 `main` 重新登记；视觉资产标准板当前仍暂停且不占文件。

> **交叉点已解除**（08-24 02:41）：滚动剪辑修复线已收工，`shared/timelineCommands.ts`
> 与 `shared/timelineEditing.ts` 交还，架构收敛线 U4–U7 可以正常取用。
> **但请注意签名变了**：`trimTimelineItem` 与 `splitTimelineItem` 的 `startFrame`
> 现在是必传项，值必须是调用方按整份 items／rows 解析出来的真实起点。这是刻意做成
> 必传而不是可选的——隐式位置的镜头没有自己的 `timelineStartFrame`，漏传会静默退回
> 「整条时间线被砍短」那个 bug。U4–U7 新增的命令若要调用它们，从领域命令已有的
> 布局里取起点即可，不要在函数内部重新推导。

---

## 最近落地

2026-11-14 chat 01a1d3cc 释放邮箱代码/部署/开发工具窗口：受控后端158f1c04及真实网页双账号局部双向收发、本人小程序接收/复开/分享撤销已通过；原稿恢复、网页新增副本软删除，私密虚构来稿按授权保留。官方样式及上传副本空白压缩未消除包限；用户另批准8张PNG无损IDAT压缩，原像素/标记与开发原图不变，d034707类型+1906项及首页通过，0.1.1113m实际上传成功（主包2096871字节）。用户已确认后台体验版为0.1.1113m，好友真机/媒体/完整剪辑线仍未验收；未改云配置/业务，QA mailbox-live-acceptance。

2026-11-13 chat 01a1d3cc 释放邮箱代码/云部署/开发工具范围：原生015ed242双函数已授权部署且23份业务源码一致，客户端d3a351a/9b91007修复实点发现的WXML编译及云错误外露；集成7b72bd0保留8221ba3，1904项基线+13专项/类型/wcc/真实失败重试通过。邮箱客户端未上传、三开关仍关闭；0.1.1113a不含邮箱页，正式独立登录码过期待本人确认，真实收发/播放/撤销未验收。文字版本修复1e6059f6已上线，110项/281产物/ready/鉴权通过；媒体未验收。QA为mailbox-live-acceptance与book-version-generation-repair，未碰其他会话文件或真实故事。

2026-11-13 chat 01a1bedb 正式连接与小程序入口修复完成，释放部署范围：e74800c7已合main/push并上线，前端900de010。Mac错误代理路由已加本站域名及服务器/32直连；TUN/显式代理均恢复。用户新二维码原样上线（11月19日前有效），18入口/77草稿保护/类型/99卡/构建、279文件/14脚本哈希、HTTPS/鉴权及同机双路径验证通过。3001/PID17192与全部内容保留，无迁移或付费生成。浏览器自动操作因URL限制停止，未绕过；真机扫码未验收。QA docs/qa/2026-11-12-connection-and-miniapp-entry.md。

2026-11-12 chat 01a1cdf8 选中图树冠改色本轮完成并释放文件（未提交/合并/部署）：shared/service/local worker/hook/view与回归修复2062被换成2088的来源问题，风格化树细轮廓、取色对象与编辑范围分离；3001原聊天2062→R8→R9/2092，960×960，275864像素变化、范围外/保护区0，旧图/云/飞机/剪辑24/声音/Take保留，无付费。60TS/14Python/类型通过；美术效果待用户认可，仍可能漏小树，整镜视频未接通。QA docs/qa/2026-11-12-selected-image-tree-color.md。

2026-11-12 chat 01a1cdf8 云层定位本轮已完成原页面验收（未提交/部署）：本地局部语义+SAM2、改单目标保留其他候选，15项TS/11项Python及类型通过；3001/Story1217 R7云范围224369像素，森林2091及飞机逐字段保留，所有媒体/剪辑24不变，无付费。QA docs/qa/2026-11-12-cloud-region-refinement.md。继续处理用户新反馈：截图2062整体配色已认可，只树木改绿。

2026-11-12 chat 01a1cdf8 原页面多帧范围确认本轮释放范围（未提交/合并/部署）：现有3001原对话抽当前Take1617五帧2086–2090，范围修订与“确认森林范围”返回候选2091（960×960、57494像素变化，范围外/保护区0变化）。71项TS、6项Python、类型与99卡账本通过；共享视觉编码10.74s→1.45s、同帧缓存5.45s。Story1217剪辑24、Take/选用/声音不变，无新付费。新卡chat-keyframe-region-review为partial，部分树冠漏选/边缘效果、飞机云形态/整镜视频、通用刷新误回另一故事仍未通过；不能宣称上线。QA docs/qa/2026-11-12-product-frame-region-review.md。其他会话修改和用户指定工作树/3001服务保留。


2026-11-12 chat 01a1c440 拾光Ai 工程恢复完成并释放范围（未提交/合并/部署，保留用户指定工作树/3001）：新故事1219，67素材/76剪辑/21文字图层/五音轨，V1正常导出165.1秒；修复透明图层导出及色彩元数据重建丢字。56相关、类型、99卡、diff/6冻结哈希通过；真实页面播放/刷新、21层图像对照、全片解码通过。Launch1217未改、无付费；文字PNG及旧中断导出状态回收缺口见 docs/qa/2026-11-12-chatcut-shiguang-migration.md。creationAgent已交还01a1cdf8；其文件与UI范围保留。


2026-11-12 chat 01a1c440 抽帧提示移入输入框完成并释放范围（未提交/合并/发布）：usePausedFrameChat.tsx、StoryAgentChat.tsx、功能账本与QA；3001真实位置/图标/取消回退验证，14项测试及类型检查通过，无聊天提交或模型调用。保留用户指定工作树和3001。证据 /tmp/frame-placeholder-20261112/。

2026-11-12 chat 01a1bedb 对象配色二次实测结束并释放范围（未提交/合并/部署）：framePaletteEdit对象色值/比例合同与固定编译、selectedObjectPaletteReference/hook/测试、gallery判断摘要、shared/readChatImageRevisions与QA/账本。157回归、20归属及类型通过。3001底图2062+参考2055，单任务c3bda99c-7ca2-438c-8638-9c2f499b4707→候选2063/960×960，实际0.50686算力；刷新仍可见，原剪辑23/Take1617/音字幕不变。判断层给出绿55/黄30/蓝15，输出仍偏蓝、图像验收未过，未采用或重购。HEX/比例到模型执行的可靠性及生成后视觉核验待继续，不能称完整改图已通。QA docs/qa/2026-11-12-frame-selection-and-reference.md；截图/tmp/frame-object-palette-20261112/page-result.jpg；保留工作树/3001，不重跑该付费任务。

2026-11-12 chat 01a1bedb 配色单图实测结束并释放本轮范围（未提交/合并/部署）：3001抽帧#2060+参考#2055→确认→候选#2062/960×960→刷新保留；实际0.52394算力，仅一张，原剪辑23/Take1617/音字幕保持。framePaletteEdit/路由/hook/持久元数据/计费/恢复/尺寸已接通，145项与类型通过。旧点彩风格夹入仅配色提示词，用户现要求共同调整按对象判断颜色和比例的流程，未继续改图，未写死树绿色；结构化编译方案未实施，原服务4项复查通过。QA docs/qa/2026-11-12-frame-selection-and-reference.md。保留工作树及3001，不重复购买requestId 4f2e0fb0-34d3-4dd8-aa95-fdefea29cb9a。

2026-11-12 chat 01a1bedb 选帧与尺寸本轮结束并释放上述3条占用（未提交/合并/部署）：3001逐帧21.100s→Up直接输入→原素材帧预览960×960，复用#2060/Take1617/修订23；单次抽帧、焦点、@图片和等待取消竞态修复。新增对话改图源尺寸持久锁、即时/恢复候选等比还原、异比例保留提示及采用拒绝；16文件214项、类型、98卡、diff通过，6冻结哈希和视频/剪辑/音轨/账本不变。无新付费媒体。本轮已否决整图配色#2059，森林语义区域/时间范围及正确局部匹配、多帧成片仍未实现；此前#2053是真AI结果但保真失败，旧Pro未知费用/Dev记账缺口未动。证据 docs/qa/2026-11-12-frame-selection-and-reference.md、/tmp/frame-dimension-page-verified.jpg。保留用户指定工作树及3001副本，继续顺序主线程开发。

2026-11-11 chat 01a1bedb FLUX真实提交本轮结束（仅QA/账本记录，无代码编辑/提交/发布）：用户确认0.54算力后，真实3001对话提交FLUX原图编辑一次（f181e6bb-23a1-4818-8e17-781846d01bca），受理unknown无任务号、无新图。免费302日志为空，同端点无图无prompt诊断HTTP500空响应；不能证明原请求未受理或供应商费用0，未重购。50图/10Take/修订23/账本186保持，图像效果与视频升级未完成。 当前3001保留受理不明提示；不要凭0.54旧授权再次POST，先找原任务。QA docs/qa/2026-11-11-cheaper-original-image-edit.md。

2026-11-11 chat 01a1bedb 低价模型切换完成并释放本轮范围（未提交/合并/发布）：302 FLUX Kontext Pro官方原图编辑、0.54算力一致报价、读图编译复用、单次提交及持久回执/恢复接通；7文件182项、类型、98卡、diff与冻结6哈希通过。真实3001第03镜#2046页面显示0.54算力和免重复读图，尚未确认生成、无新增费用/素材。50图/10Take/剪辑23/账本186保持；真实FLUX受理/效果待费用确认后验收，GPT2未提交。QA docs/qa/2026-11-11-cheaper-original-image-edit.md；截图/tmp/flux-kontext-quote.png。保留用户指定工作树与3001副本，冻结文件和主库未动。

2026-11-11 chat 01a1bedb 接续闭环完成并释放本轮文件（feat/chat-i2v-loop，未提交/合并/部署）：接回既有美术导演限定修改→renderGate→MJ/GPT，按内容找图/合并报价/取消/进度预览、首尾帧拆镜、采用primary和导入时长修复。最终7456通过/74原配置跳过、类型/97卡/架构通过。3001副本网页验收报价取消、拆镜提案取消、1617→1616刷新→1617恢复，音字幕/画面项保持、仅新剪辑历史19→21及测试对话，无新付费；真实新媒体效果未验收。冻结文件和test-only preflight未改。QA docs/qa/2026-11-11-chat-i2v-loop.md；主线程审查 /tmp/compound-engineering/ce-code-review/chat-i2v-20261111。保留工作树等待用户下一步。

2026-11-10 chat 01a1bedb 本地完成并释放本轮文件（未提交/推送/部署）：聊天抽帧/仓库通用文件/点彩规则保存并发修复。3000故事1217真实抽帧#2045–2047、文件#1/#2上传/预览/下载SHA/刷新/点击聊天验证；保存微彩点彩世界V03待确认，旧版本与时间线rev18/Take1610保留，未新购媒体。抽帧115项、文件与美术43项、容量增量4项（有重叠），类型/构建77草稿保护/96卡/diff通过。文件仅本地保存解析，任意文件自动外部AI分析因审批拒绝未启用。QA docs/qa/2026-11-10-chat-frame-reference.md、2026-11-10-warehouse-files-pointillism.md。原其他会话改动及既有工作树保留，主仓3000唯一服务继续运行。

2026-11-10 chat 01a1c440 ChatCut Launch Video迁移本地完成并释放文件（未提交/部署）：故事1217迁移前V1/后V2、Timeline16，3视频/58双语字幕/4声音轨5片段原参数迁入；原素材及备份已归档。多轨字幕编辑/绑定/预览/导出、项目画布导出及PNG解码性能修复；174专项、77草稿、最终类型/构建、94卡/diff/env通过。真实3000播放/刷新/历史及1080×1920/30fps/68秒成片全解码、4帧核查通过；原黑场32.87–68秒与未全量下载媒体池/丢失脚本限制如实保留，无付费。QA docs/qa/2026-11-10-chatcut-launch-migration.md。当前3000继续运行，其他会话改动与用户工作树保留。


2026-11-10 chat 01a1c4d0 情绪第三轮本地完成并释放文件（未提交/部署）：章节文字ID与归属校验，章节模块/文字合成图、封面/插图/阅读纹理/画册背景接入；背景报价绑定情绪来源，任务恢复沿用原设定，首次新增章节覆盖后旧图识别修复。15文件323项、工作树类型、94卡、范围diff通过；主仓3000 ready、editing与两组件编译200。25文件哈希核对后定向同步，账本仅更新本卡，其他会话修改保留。QA docs/qa/2026-11-10-creation-emotion-chapters.md。零付费零作品修改；章节自然语言/手机/真实审美仍为缺口。工作树仍用于持续工作，未执行git合并。


2026-11-10 chat 01a1c440 仓库生成反馈本地完成并释放文件（未提交/部署）：additional-web-feature，仅同步本轮前端差异到主仓。warehouseRenderActivity/useWarehouseRenderActivity/WarehouseRenderCards、EditingStudioPage、MaterialWarehousePanel、WarehouseShotGroups/BookMedia、warehouseShotMedia及测试/词典/QA/账本；提交即显示图像/声音/视频占位，账号回执恢复、独立状态查询与原故事完成刷新。27专项、类型、含77草稿回归的构建、94卡/diff通过；3000真实仓库及模拟并发/输入/刷新/切故事/查询失败隔离验证，测试页及假回执已清理，无付费或作品修改。工作树仍供后续迭代，未做Git合并。QA docs/qa/2026-11-10-warehouse-render-feedback.md。

2026-11-10 chat 01a1bedb 仓库工具栏收紧完成并释放：移除标题，镜头胶囊菜单并入唯一工具栏，浮窗方向键隔离。主仓3000验证切组/同项回选/单排41px及移动；7专项、类型/93卡/diff通过。MaterialWarehousePanel、WarehouseShotGroups、FloatingWarehouse、词典/QA/账本；未提交/部署。

2026-11-10 chat 01a1bedb 紧凑时间线本地完成并释放文件（未提交/部署）：工作树 codex/book-video-workflow-20261110，保留供用户继续迭代；StoryboardReviewBoard/ManuscriptSection、StoryboardEditRow/VisualLayerRow、字幕/音频/版本控件及词典。双视图左栏176px，轨道总高约减少35%，图层操作收进名称菜单，播放滚动不遮挡标签。100项、类型、构建、92卡及3000双视图验证通过；主仓仅同步本轮文件，未生成媒体，其他手机号修改保留。QA docs/qa/2026-11-10-compact-timeline-layout.md。

2026-11-10 chat 01a1bedb 冗余清理首批完成并释放（未提交/发布）：storyboardReviewModel无入口30秒planner/类型、其旧专属测试/翻译、StoryAgentChat恒false分支、ShotChatInspector无效prop及测试、QA/账本；相对本轮起点净删202行。89相关/类型/92卡/diff通过，Knip既有727提示未新增；保留逐镜/对话生成、素材数据/历史兼容和其他未提交工作。QA docs/qa/2026-11-10-unused-workflow-cleanup.md。

2026-11-10 chat 01a1bedb 播放闪动/界面精简完成并释放（未提交/发布）：EditingNleWorkspace/storyboardSelectionFollow及测试、StoryboardReviewBoard、StoryboardTimelineRuler、StoryAgentChat/QA/账本。根因是时钟选镜与旧聊天选区反复回拉，改为显式选择只跟随一次；总时长20px红色、移除约30秒一键按钮、退出镜头历史回到对话底部。135项/类型/92卡/diff通过；真实3000播放至64.467秒无新循环错误、退出底部差值0、按钮0与20px颜色验证。临时main诊断已移除，无媒体/音轨/算力变更，QA docs/qa/2026-11-10-playback-ui.md。

2026-11-10 chat 01a1bedb 镜头对话入口完成并释放本轮文件（未提交/发布）：StoryAgentChat/Context、ShotChatInspector、gallery、shotConversation、Storyboard/NLE、两图归属服务与路由、storySync、声音作用范围保护、测试/词典/QA/账本。镜头小框打开双方对话/修改/图片，右侧点击与自然镜号定位一致；新两图落盘后保留稳定镜头来源且不自动采用，旧无归属图折叠保留。157专项、95增量、40最终及类型通过（重叠）；真实3000切镜/选图/本地历史查询/刷新通过，算力25.21未变，无素材改动。旧归属缺失与单镜音量编辑仍有缺口，详见 docs/qa/2026-11-10-shot-conversation-context.md。

2026-11-10 chat 01a1bedb 图像版本卡英文显示完成并释放：BookImageCompositionCard、uiLanguage/messages.json、账本/QA。标题/状态/历史标记/默认要求/结果说明与参数固定文案补齐翻译；3000真实1217书工作区English下V1/V2验证通过，原始创作要求保留。14项测试、类型、91卡和diff通过；未提交/部署，无AI或媒体变更。QA docs/qa/2026-11-10-image-history-language.md。

2026-11-10 chat 01a1bedb 对话改图输入/预览/文字替换完成并释放（main，未提交/push/部署）：StoryAgentChat/Context、mediaChatSession、desktopChatQueue、rerender/useShotImageRender、storyboardImageTask/storyAgent、新chatImageRevision与gallery/choice、EditingStudioPage、字典/测试/账本。154相关测试、主图同步增量80项、类型、构建77草稿保护、91卡校验通过；唯一3000实测报价等待时发其他消息、取消后续处理、2038原图回显并刷新恢复。无新付费、真实时间轴仍15；新GPT/MJ效果仅模拟供应商测链路，待真实生成验收。QA docs/qa/2026-11-10-chat-image-preview.md。

2026-11-09 chat 01a1bedb 图像历史镜号标注完成并释放：shared/bookImageComposition、bookImageComposition服务、BookImageCompositionCard/History/Chat、词典及相关测试/QA/账本。35专项、类型、91卡与diff通过；真实3000图像V1/V2及详情标明第01镜。只读关联投影，原图片/历史不变；无AI调用、未提交部署。QA docs/qa/2026-11-09-image-history-shot-label.md。

2026-11-09 chat 01a1bedb 对话美术/示意流程本地完成并释放全部登记文件（未提交/push/部署）：artSystem/Skill、StoryAgent 对话制作/费用确认、artPreview 跨镜头方案/候选/文字采用、storySync 服务端方案保护、Legnext 回执与并行取回及首尾帧参考修复。311相关测试、类型、构建77草稿保护、91卡与diff通过。3000真实7镜方案/28图9.52算力报价、文字取消、刷新保留与仓库查看通过；单镜改图2.86/视频7.10报价取消通过；没有新付费媒体提交，两次文本规划约0.50算力。用户已明确采用#2038，第02镜旧2030–2037退仓保留。迁移真实画质/视频效果未验收、音频节拍未分析、13秒镜头当前视频报价8秒、视频完成问答刷新续接仍有缺口，详见 docs/qa/2026-11-09-conversation-art-system.md。

- 2026-11-09 chat 01a1bedb 对话声音编辑与视频生成解阻本地完成并释放文件（未提交/push/部署）：EditingStudioPage/StoryAgentChat/队列按书视频区分上下文；timelineMedia声音窄命令支持音量、静音、淡入淡出并记录原话子版本；StoryboardReviewBoard/reviewModel/逐镜生成自动准备本镜完整帧，合并算力确认、取消旧裁图与封面门槛。156专项、类型/构建77草稿保护、90卡账本及diff校验通过。3000真实书页音乐指令打开原整书入口；视频音量修改创建V08.3后恢复V08.1（25%），旁白/字幕不变。第02镜原补图任务已取回4图，未重复购买，未新增VideoTake；完整付费视频及生产/MySQL仍未验收。302 MJ原图edits/局部modal已查官方文档，尚未接入。其他未提交工作保留。QA docs/qa/2026-11-09-sound-chat-video-flow.md，截图 outputs/sound-chat-video-20261109/sound-chat-final.png。

2026-11-09 chat 01a1bedb 旁白字幕节奏与全片配乐完成并释放本轮文件（未提交/push/部署）：bookVideoCreation/shared、publishingVideoStoryboardPersistence/videoWorkflow、bookVideoAudio共享规划与服务、离线对齐脚本、配置/测试/账本QA。分镜入口自动匹配整书录音、0.9倍保调慢放加停顿、13段字幕同步与全片配乐；真实1217当前视频V8源分镜V2，7镜64.466667秒，派生16/17复用，旧V6声音15/14及原稿原图保留。76项、最终24项/类型/构建77草稿保护/88卡通过，真实3000完整回放至64.467秒，音频边界误差≤0.03秒；无付费调用。Python/Whisper/FFmpeg为本机已配依赖，生产未验收；详见docs/qa/2026-11-09-book-video-audio-pacing.md。其他手机号登录会话改动保留。

2026-11-06 拾光算力只读流水（`4d824576`，分支 `feat/shiguang-compute-statement`，待审，未合并、未部署）：`POST /api/shiguang/compute/statement` 复用余额鉴权，只返回本人预占、结算和释放。触达 `server/db.ts` 只读导出、`server/repositories/computeLedger.ts`、`server/services/computeLedger.ts`、`server/_core/shiguangComputeBridge.ts` 及测试和功能账本。6 项桥测试、类型检查和功能账本通过。未改 `.env`、价格或退款。

- 2026-11-09 素材提交前失败恢复完成并释放（未提交）：useMaterialCapture及新增hook测试，只对尚未上传的新批次解锁读取/暂存失败，未知请求保留原锁定与幂等。32项相关/类型通过；既有6份原件真实3000读取与SHA/Range验证通过。QA见2026-11-09-mobile-import.md；按用户要求不再尝试镜像，不占合并部署窗口。

- 2026-11-09 素材极简布局完成并释放（未提交）：素材区改输入栏双图标，移除长说明/重复入口，返回聊天与系统分享移至原更多操作；MOV误选短提示，未改变素材生成或原件。触达MobileCaptureAttachments/MobileCaptureChatView/MobileChatView/MobileCompanionActions、materialCaptureDraft和测试/账本。48项相关测试及类型通过，真实浏览器图标选文件/分享展开/返回聊天通过；QA见2026-11-09-mobile-import.md，未付费/部署。

2026-11-09 chat 01a1bedb 书页简化第一步完成并释放：按用户截图移除文字版、分镜版、作品版本与转换三个按钮及展开表单；仅ChapterWorkspace/测试mock/账本/QA，原稿历史保留。3000截图核对、12专项、类型、88卡通过；未提交/部署，后续交互按用户逐步确认。


2026-11-09 双稿件与视频版本完成并释放（chat 01a1bedb，main e75430bd）：章/节文字稿与场/镜分镜稿独立版本、用途驱动互转预览/采用、历史恢复、来源/作者/时间及视频剪辑快照导出。旧视频留档与新方案替换同事务。169专项、类型、88卡账本、草稿保护构建及3000入口实点通过；真实模型/MySQL/触屏未验收，未付费生成/push/部署。工作树分支已清理，其他会话脏文件保留，合并窗口释放。QA docs/qa/2026-11-09-book-video-workflow.md。


- 2026-11-09 回形针用途提示完成并释放（未提交）：MobileCaptureAttachments 原按钮下标“素材”，展开区说明图像/录音/文字整理为新故事并保留原件，不增加按钮。14项既有测试通过；用户确认手机文本到电脑本地可见。QA见2026-11-09-mobile-import.md，不占合并/发布窗口。

- 2026-11-09 手机导入修复本地完成并释放（未提交）：回形针单击打开文件选择，保留录音/分享；目标列表标当前故事与创建时间区分同名独立故事。42项相关测试、类型通过；Chrome真实filechooser及导入表单通过，自动选文件受扩展权限限制，手机上传待复验。触达MobileCaptureAttachments/MobileChatView/MobileCompanionActions、测试、词典与账本；详见docs/qa/2026-11-09-mobile-import.md。未改真实故事、未付费或部署。

2026-11-09 手机一键实时听写完成本地实现并释放（main 50f4c97a，未push/部署）：原位话筒单击启动浏览器识别，中间文字进入输入框、结果去重追加草稿、停止/错误保留已识别内容，卸载拒绝迟到结果；无API时自动启动旧录后转写兼容，失败只显示短提示。78相关+26架构测试、类型/86卡通过；主仓3000隔离页模拟识别实点单击/实时文字/末次修正/停止恢复，临时文件已删，无付费调用/业务写入。iOS/Android真机识别、系统分享仍待验，截图旧豆包403/302 500未修复。QA docs/qa/2026-11-09-mobile-live-dictation.md。

2026-11-09 本地页面补验完成并释放（main，证据提交 71fd6cb8）：浏览器已可用，手机素材原文/整理稿展开、同故事聊天收起重开、视频分镜稿与剪辑预览第03镜往返通过；四张图片加载成功，两页无捕获的控制台error。已恢复书稿界面，无付费调用/故事内容修改；功能提交9d9a75c2及本轮证据均在本地main，未push/部署。真机录音/系统分享/真实供应商失败恢复/生产MySQL仍未验。详见docs/qa/2026-11-09-other-worktree-integration.md。

2026-11-09 其他工作区验收完成并释放（main，提交 9d9a75c2，未推送/部署）：手机素材网页代码已在main，手机聊天重开保留会话，MJ已完成但取回失败保留原任务，分镜稿显示最新视频失败原因；用户明确选择维持无任务号超时自动释放规则，旧预占改动未合。273项相关（2项提权隔离复跑）、118恢复/发布回归、77草稿安全、类型/86卡通过；3000手机入口及模块编译HTTP200。Work设置禁用浏览器自动操作，真机/真实付费/生产MySQL未验，未清理其他会话工作区。QA docs/qa/2026-11-09-other-worktree-integration.md。

2026-11-08 书稿标题、场镜/视频与来信发布准备完成并释放（main，待部署）：dbdd25b4 已提交且推送 origin/main；隔离完整测试6848通过/73跳过、类型/构建/86卡/差异门禁通过，热点 StoryboardReviewBoard 已抽出 StoryboardManuscriptSection 保持原交互。打包前确认101个源码文件与提交一致，174项产物在 /private/tmp/book-overview-release-20261108/，版本3fb2627c-3f06-472c-a481-94f4b9e296bd。生产 SSH 在密钥交换前连接关闭，本机及浏览器 HTTPS 同样连接中断，未能只读预检或部署，未碰生产文件/配置/库；恢复连接后先核对当前生产清单、保留旧资源并部署 dbdd25b4，禁止无基线直接覆盖。无其他会话改动或本地素材被提交。

2026-11-08 场/章编号字号完成并释放（main，未提交/部署）：BookBlockCanvas 的场/章及导入章编号统一26设计像素，位置与层级沿用原样；53项现有回归、类型及3000场字号截图通过。证据见 docs/qa/2026-11-08-book-outline-overview.md。

2026-11-08 场镜/章节层级与概览完成并释放（main，未提交/部署）：chapterBlockTree/bookBlockLayout/bookBlockSelection/BookBlockCanvas、新增bookOutlineSummary、bookStoryboardPreparation、对应测试/词典/账本/QA。统一父子转换和排序、真实内容统计与展开参考图、新生成场展开/镜头收起；150专项+77草稿安全、类型/86卡/差异检查通过。3000实点7场7镜及第三镜3图加载，当前书稿仅通过正常控件保存折叠状态，原文媒体顺序不变，无付费生成。证据 docs/qa/2026-11-08-book-outline-overview.md。


2026-11-08 来信日期/精简展示完成并释放（main，未提交/部署）：按用户要求删除书稿列表、摘录和来源说明，后台选材不变；页头公历/农历明确，旧信阅读与翻译输入对经核验的“今天九月最后一天”补农历标签，生成上下文区分两种历法，原存档不改。51项相关测试、类型、86卡、差异检查及3000实际页面通过，无付费调用。释放 dailyLetterCalendar、emotionDailyReference302、来信桌面/手机/正文、翻译、词典与账本；QA docs/qa/2026-11-08-daily-letter-calendar.md。

2026-11-08 每日来信创作读取修复完成并释放（main，未提交/部署）：修正空章节污染正文日期、最近正文优先选材及 who=u 旧消息日期；桌面/手机共用当前可读书稿与旧信来源回执，明确凌晨旧信早于晚间保存，来信专用留言不再误称全站无内容。59项相关回归、12项最终定向复跑、类型/86卡/差异检查通过，3000实测11月6日分镜正文与日期；未付费生成、未重写历史信、未开启长期采集。释放 dailyLetterWorks/emotionDailyReference302/emotionDailyLetters、来信路由与桌面/手机/共享来源展示、stories、语言词典及账本。QA docs/qa/2026-11-08-daily-letter-writing.md。

2026-11-07 同一视频双视图与自动剪辑修订完成并释放（本对话，main，未提交/部署）：BookVideoWorkspace、EditingStudioPage/EditingNleWorkspace、StoryboardPanel/ReviewBoard、新逐镜表；visual persistence/timelines、creationAgent 时间轴保存、videoEditHistory、VideoVersionHistory及测试/QA/账本。正式镜头共享稳定编号与时间排序、每镜生成菜单、同控制器切换，候选确认门保留；剪辑CAS原子留存最近30状态，不修改成品组合。258项/19文件、类型、86卡、差异检查通过，主仓3000真实第03镜选择→Preview03/00:16及三参考图、三项生成菜单、候选返回均通过。修正旧镜头视频列表缺省和隐藏返回文字框高度问题。未改真实时间轴、未购买媒体；整版恢复与生产MySQL实测仍为缺口。QA docs/qa/2026-11-07-unified-video-storyboard.md，截图 outputs/unified-video-20261107/。

2026-11-06 视频宽幅分镜稿完成并释放（main，未提交/部署）：BookVideoChat/test、BookVideoWorkspace/test、bookVideoReviewDraft、EditingStudioPage、spine-bridge.test及QA/账本。视频默认展示逐镜稿，聊天原入口直达，同一草稿会话；原剪辑/Preview另视图保留，切换不生成/采用。83专项、类型、主仓3000实页及草稿切换/取消通过；7镜60秒、4书图与旧画面可见，候选V3仍ready/revision4。截图outputs/launch-video-storyboard-20261106/video-workspace-wide-storyboard.png，QA docs/qa/2026-11-06-video-wide-storyboard.md。

2026-11-06 通用分镜稿与图片继承完成并释放（main，未提交/部署）：原视频对话增加默认先整理分镜稿选项，完整模块连续分组、原子版本保存与干净书页接收；跨格式/发布版本继承生成画面及人工首尾帧，折叠图数可见。180专项、类型、85卡及差异检查通过。故事1217实际V3已生成7镜60秒待确认预览，13段台词逐字相同、4书图+旧画面2010可见；修复整片文本90秒超时与误报，未购买媒体、未采用正式视频。进度Page sequence10，QA docs/qa/2026-11-06-reusable-book-storyboard.md；配音会话修改保留。

2026-11-06 有声书男女声选择完成并释放（chat 01a1b107，main，未提交/部署）：用户认可豆包女声温柔小雅/男声温暖阿虎，BookModuleConvert新增选择、默认女声，切换重报费用；bookMedia/storyNarration/shared映射绑定签名并保留未知防重，时间轴全局配置不变。77项相关测试、类型、84卡及3000真实选声/报价验证通过，无新增付费或书稿写入。QA docs/qa/2026-11-06-audiobook-voice-choice.md。

2026-11-06 launch video真实分镜稿已保存并释放原对话范围（main，未提交/部署）：章节9版本110为7场7镜，原23模块与4图完整保留，模块13改画面描述，版本108可恢复。真实持久结构/13段台词/1与3图归属、浏览器重开截图及84卡验证通过；Page修订8和实验md/json同步。V3方向记录42f2cdf8已保存，逐镜预览两次请求均被文本超时或配音热更新中断，仍proposed/revision3、无preview，未adopt；原正式镜头完全不变。恢复须等服务稳定和原claim到期后沿同记录继续，勿新建重复方案。声音已转独立对话01a1b107继续。QA docs/qa/2026-11-06-launch-video-manuscript.md。

2026-11-06 302正式旁白续修完成并释放（main，未提交/部署）：storyVoice302/storyNarration/storyAudioImport及测试，本地TTS配置和示例、账本/QA与实验文档。MiniMax Speech 2.8 Turbo女性有声书音色真实一次生成成功，故事1217资产8、43.668秒、0.06算力已结算；原书章节9版本108保留，未采用时间轴。80专项、类型、完整MP3解码/本地206读取及Page音频更新读回通过。原OpenAI上游500未宣称修复；本机Tingting试听已弃用。详见 docs/qa/2026-11-06-302-minimax-narration.md。

2026-11-06 launch video 分镜实验完成并释放文档范围（未提交）：个人Page https://chatgpt.com/space/page_0e014f713e608191acd65cef0fdcdc01 及 docs/brainstorms/2026-11-06-launch-video-storyboard-experiment.md/json 已记录7场7镜60秒、23模块全去向与待确认项；20非空模块精确覆盖、13段旁白原文、章节9版本108及正文hash未变。用户新增授权可花少量算力后，在线Alloy旁白仅提交一次（operationId ad3a11cc-e2e2-4590-b667-34b0034aca0c，报价0.06），上游HTTP500，本地账本actualCostMinor=0/hold released，未重试；另生成免费Tingting本机60秒节奏试听于 outputs/launch-video-storyboard-20261106/，已上传Page附件。Page图文/附件已读回及浏览器核对。未采用新视频、未改真实书稿、未部署。用户新建格式对话01a1b0d8-8b48-7c30-99de-3d1a16469158已完成本地实现与629项相关验证，精确音乐入出点仍待接入；本原对话只维护上述实验文稿，没有修改该对话代码。

2026-11-06 书稿章/节/场/镜头格式本地完成并释放（main，未提交/部署）：chapterBlockTree、ChapterTextModules、BookBlockCanvas、bookBlockLayout/Selection、shared/bookWritingStyle/Numbering、bookStoryboardModules/bookVideoSource及规划接口、测试与账本。原菜单新增真实场/镜头子树，移动/折叠携带全部图文音频，编号随位置推导、标题与ID不变；章/节及微信目录保留。显式镜头一镜一行优先转视频，旧第N幕路径保留；归属不完整明确拒绝，音乐仍沿用整片顺接，逐镜音轨入/出点待接入。84文件626项+新增3项定向复跑累计629测试、类型/84卡/差异检查通过；主仓3000纯内存实际拖动二场三镜→一场二镜、两图/台词展开、重开、整场折叠和菜单通过。未改真实故事、未付费生成、未push；临时验证文件清理，其他会话脏文件及原对话brainstorms保留。QA docs/qa/2026-11-06-book-scene-shot-modules.md。

2026-11-05 本对话书稿/视频汇总发布完成，main/生产发布窗口已释放：42ee3e29已push并上线book-video-20261105；前端版本b705715c-e7be-4c3b-83b6-94a5417a5966。6733测试、类型/构建/83卡/41迁移基线通过；175产物哈希、正式HTTPS/ready/mysql/required与发送平台菜单实点通过，保留旧资源和dist备份。未改生产配置/数据库、未付费生成；其他会话4份修改与outputs保留，MySQL集成未配置不算通过。无本轮临时worktree/分支。QA docs/qa/2026-11-05-book-video-release.md。

- 2026-11-04 自动字幕与生成中预览完成并释放（main，未提交/部署）：timelineSubtitleEditing/publishingVideoStoryboardPersistence、shared/generatedSubtitles、ShotPreview/previewPlaybackModel及相关测试/QA/账本。确认方案自动按台词与绝对帧初始化正式分段字幕；人工改字/删空/撤销/legacy保持权威，失败可幂等续做。复用走带，Preview随镜头显示描述、静帧与已有字幕。82专项（含FFmpeg一致性）、76草稿安全、类型、81卡账本与环境通过；真实launch video第1至7镜预览通过，原3条字幕未改，无付费生成。QA：docs/qa/2026-11-04-auto-subtitles-preview.md。

- 2026-11-04 聊天底部留白与状态收拢完成并释放（main，未提交/部署）：StoryAgentChat、desktopCompanion.css、新增ChatCompanionStatus、BookVideoChat及QA/账本。保留Logo/输入框尺寸与位置，透明区域多出约24px聊天空间；状态单行4.2秒轮换、220ms渐变，视频进度复用同一行，错误/确认和排版详情保留。30项回归、类型、81卡账本通过；真实模块定位/进入聊天/Esc回全文及无业务模拟动画验证通过，无付费/发送，临时验证页已删。QA：docs/qa/2026-11-04-chat-status-spacing.md。

- 2026-11-04 发送平台入口恢复完成并释放（main，未提交/部署）：BookSendMenu/ChapterWorkspace、新增BookPlatformShareDialog/bookPlatformExport及测试、publishingCoverExport及测试和账本/QA。现有发送按钮选择小程序/朋友圈/其他平台，保留文章链接；先保存当前稿，平台文案及全套配图独立导出，不自动改稿或发布。36项专项、76项草稿安全、类型、81卡账本及环境门禁通过；真实6图朋友圈1080×1080、小红书1080×1440预览通过。小程序本机未启用，显示禁用态，未改开关/付费/发送。QA：docs/qa/2026-11-04-book-send-platforms.md。

- 2026-11-04 本地白屏修复完成并释放（main，未提交/部署）：server/_core/vite.ts先求值函数配置再创建嵌入式Vite，恢复client目录、别名和插件；新增配置接线测试先红后绿，19项专项、类型、81卡账本及env:check通过。原白屏标签刷新后《launch video》聊天/正文/6图正常，发送菜单实点通过；用户稿件未编辑，未触发生成，主仓仅3000服务。QA：docs/qa/2026-11-04-local-editor-white-screen.md。

2026-11-04 书稿编辑与图文分享已上线，释放main合并/生产发布窗口：0db079d4已push，release=book-editor-20261104，manifest=/opt/Drinking-Time/dist.release-book-editor-20261104.json，前端be19c96d-5a0a-4ad9-a4be-8fd132be34b6；175产物、HTTPS页面/JS/CSS/公式字体、ready/mysql/required通过。已含本轮Logo/聊天布局、跨模块选字、改写采用、LaTeX/生成格式、全文定位、图片导入、共用标题、快捷按钮精简/说明位置及发送图文；未包含其他会话视频/分镜增量。148原变动文件按审核三方结果保留，主仓类型通过，临时worktree/分支/stash已清理；备份与源码包/private/tmp/book-editor-release-20261104，生产回滚dist.bak-book-editor-20261104。配置/数据库未改，正式站入口实点通过，无付费请求；10项全量剩余失败在原基线复现，详见docs/qa/2026-11-04-book-editor-release.md。

2026-11-04 书稿发送及图片分享本地完成，释放相关文件（未提交/部署）：ChapterWorkspace/ChapterWriting/ChapterTextModules接入视频按钮右侧发送菜单，ArtworkShareDialog/SharedArtworkPage与artworkShare增加连续图文阅读快照；原权限、重编码、幂等、撤销、保存CAS及投递开关保留。43项分享专项、76项草稿安全、类型/构建、80卡账本和差异检查通过；主仓3000真实文章6图预览通过，未创建真实链接、向他人发送或调用付费模型。后续发布须同时包含前后端；QA docs/qa/2026-11-04-book-send-menu.md。

- 2026-11-04 修改说明位置调整本地完成（未提交/部署）：释放ChapterWriting/ChapterWorkspace及QA/账本；修改说明原折叠项紧接版本按钮，保留草稿/自动保存/CAS与正文间距。21项章节回归、类型、80卡账本和diff检查通过；主仓3000实点展开/收起与同排位置确认，未改用户正文或说明。QA docs/qa/2026-11-03-book-change-note-position.md。

- 2026-11-03 书稿两个快捷按钮已移除（本地未提交/部署）：释放ChapterWorkspace/BookMusicInsert及QA/账本。按用户要求去掉生成图片与添加音乐按钮，音乐聊天弹窗及模块图片转换保留；36项相关、类型、80卡账本与3000真实页只读核对通过。QA docs/qa/2026-11-03-book-shortcut-removal.md。

- 2026-11-03 故事与书稿标题统一本地完成（未提交/部署）：释放 PublishingDraftWorkspace/PublishingImagePack/ChapterWorkspace/ChapterWriting、StoryTitleInput/StoryAgentContext 及测试/QA/账本。桌面书稿与聊天共用storyTitle和改名接口，自动/回车/失焦保存，无新增按钮；118项相关、76项草稿安全、类型/构建、80卡账本通过。临时页双向同步/失败重试、真实用户页两处launch video只读核对通过，未改真实故事；QA docs/qa/2026-11-03-book-story-title.md。

- 2026-11-03 生成正文格式修复（本地未提交/部署）：已释放 textDraftHistory/textDraftPrompt/writingTechniqueLibrary/writingCompanion、shared/textDraftHistory/bookLatex/bookTextFormat、TextDraftVersions、BookMathText/StoryAgentChat 及测试/QA/账本。书稿新生成从源头规范LaTeX加粗/标题，旧Markdown仅阅读兼容；137项专项、76项草稿安全、类型/构建、80卡账本与3000内存页编辑/撤销/跨块选区通过。未改用户真实稿、未刷新旧页、未操作剪贴板/购买生成。QA：docs/qa/2026-11-03-book-text-format.md。

2026-11-03 书稿粘贴/拖入图片本地完成并释放文件（未提交/部署）：新增BookImageImportBoundary/bookImageImport/bookImageInsert接入ChapterTextModules，原素材导入API入库、光标拆段/拖放落点、多图顺序、部分失败、一次撤销及scope/原文校验。74项相关+新增弹窗边界后5项复验、76项草稿安全、类型/前端构建/80卡账本通过。原生PNG粘贴及双文件drop事件浏览器通过，Finder原生拖入待验。未改用户正文/真实上传/付费请求，临时页及素材已清理；剪贴板恢复/只读核对被自动审批拒绝，已停止，可能保留测试PNG。QA docs/qa/2026-11-03-book-image-import.md；截图/tmp/book-image-import-20261103.png。

2026-11-03 无模块定位全文本地完成并释放上述文件（未提交/部署）：无选择显示“已定位：全文”，空白/Esc清模块及文字选区，修失焦迟到select重新选中旧模块；聊天取当前未保存全文，桌面接口支持200000字符。105项专项、类型、79卡账本及临时真实编辑器浏览器验证通过，无付费调用。用户真实页正在编辑且有版本保护提示，未刷新/恢复/声称草稿已保存。QA docs/qa/2026-11-03-book-fulltext-context.md，截图/tmp/book-fulltext-context-20261103.png；临时页/源码已清理，其他修改保留。

- 2026-11-03 书稿LaTeX公式显示（main本地未提交/未部署，文件释放）：ChapterTextModules/BookMathText/bookLatex、bookBlockLayout/Canvas与选区接入阅读公式/点击源码，多行公式分块与实际高度保护，KaTeX及字体本地打包。89项模块专项、76项草稿安全、类型、前端临时目录构建、79卡账本及diff通过；同一3000内存页公式显示/编辑/跨段复制/粘贴/撤销实点通过，临时页已清理。用户故事未改，无付费调用，纳入今日待发布内容；见 docs/qa/2026-11-03-book-latex.md。

- 2026-11-03 聊天改写一键替换（main本地未提交/未部署，文件释放）：StoryAgentChat/Context、伴写服务/路由、ChapterTextModules 与新 bookRewrite 辅助模块新增结果末尾单按钮；发送时固定目标，显式点击替换、原文变化拦截及原撤销/CAS保留。91项专项、76项保存安全、类型、78卡账本和diff检查通过；同一3000内存测试页实点替换/撤销/改文拦截通过，临时页已清理。无付费调用、未改用户故事；真实模型遵循质量待用户新一轮对话，旧回复不追补目标。见 docs/qa/2026-11-03-book-chat-rewrite.md，纳入今日待发布内容。

- 2026-11-03 跨模块文字拖选（main本地未提交/未部署，文件释放）：ChapterTextModules/BookBlockCanvas 接入跨段精确选区，复用原多模块拖动、整组缩放及右键合并，支持复制/剪切/粘贴/替换与撤销，不增常驻按钮。11文件86项模块测试、7文件76项保存安全回归、类型、77卡账本及浏览器验证通过；主仓3000已生效，未修改用户正文、无付费请求，保留其他会话修改。纳入今日汇总版本；见 docs/qa/2026-11-03-book-cross-module-selection.md。

- 2026-11-03 聊天Logo放大与位置纠正（main本地未提交/未部署，文件释放）：StoryAgentChat/desktopCompanion.css/StoryLogoMenu 保留放大效果；按用户最新要求恢复输入框上方原位，维持原62px行高并收紧顶部间距。9项菜单/头像测试、类型和diff检查通过；浏览器本轮连接不可用，待页面复验。上一版底部位置的截图和223.5→207px测量已作废。待今日汇总版本；见 docs/qa/2026-11-03-chat-composer-layout.md。

- 2026-11-03 文档07双仓死代码首批（本地未提交/未部署，文件释放）：Web删除无人调用WuxingMotifIcon；原生删除旧backendApi、专用测试及2项死配置，共449行。Web27项/类型/77卡通过；原生类型通过，1632项通过、1项既有二维码权限期望失败（未改该权限）。详见07清单，兼容/恢复路径及其他会话修改保留。

- 2026-11-03 文档07导入目录精简（main本地未提交/未部署，文件释放）：server/repositories/wechatBookImport及server/services/wechatBookImport的目录回执改为账号+当前页批量窄读，50本页50次查询降为1次；保留单本幂等和删除回执。24项专项、全项目类型、77卡账本及diff检查通过，无真实付费/用户数据修改/生产操作。

2026-11-02 视频经济单条本地完成并释放：shared/shotDirector、viduSingleVideo、videoGen/videoJobs/mediaBillingRecovery/videoPromptEngineering、creationAgent视频路由、CreationEditorContext、StoryboardReviewBoard/Matrix/reviewModel及对应测试。默认Vidu单条720p，5秒1.08算力；保留MJ四条8.08、首尾帧和免费本地动画。78项/类型通过，真实UI模型报价切换通过；未付费验证供应商出片、未提交/部署。QA docs/qa/2026-11-02-video-economy.md。

2026-11-02 微信扫码与可选迁移本地完成并释放：AuthEntryPanel/WechatCodeLogin、AppRouter、MobileMePage、webLogin/oauth与新出码/提示组件；原生storyDesktopAccess、drinkingTimeBridge及确认页。单入口扫码确认→正常网页→有未迁移故事才问，跳过不阻挡，原稿保留。Web81项/原生38项、询问路由19项复验、临时MySQL跨仓、两端类型/Web构建（76草稿安全）、77卡账本通过；虚构预览已清理。未提交/部署/改运行配置，真实扫码与云桥未验收，保持observing/partial；两仓他人修改保留。QA：docs/qa/2026-11-02-wechat-qr-login.md。

2026-11-02 微信体验码补图收工（未提交/部署）：用户提供临时二维码已原样接入原设备弹窗，标注11月9日前有效；浏览器完整展示、首页3项回归/77卡账本通过。释放WechatEntry、ShiguangLandingPage/CSS、public二维码与QA/账本。未改登录/导入服务，后续用户更新码。

2026-11-02 微信登录后选择导入本地收工（未提交/部署）：原设备弹窗新增微信区块，单微信登录后选择/跳过导入，原稿保留，章名映射折叠标题，私有图片与幂等事务。123项Web、33项原生、1项真实临时MySQL跨仓、75项草稿安全、类型/构建/77卡账本通过；真实体验码与云桥仍缺，partial。释放AuthEntryPanel/WechatCodeLogin、landing/router、MobileMePage、导入新文件、server入口/authority client与来源类型；原生bridge/desktopAccess文件也释放。QA：docs/qa/2026-11-02-wechat-book-import.md。保留所有他人未提交改动。


2026-11-02 MJ不付费续查完成（仅QA/账本，无业务代码修改）：成功与49%旧任务同为V7 Draft，不能以换版本保证恢复。另在临时副本复现模块已受理超时后无恢复按钮、关闭重开丢失任务状态的两项失败测试；需接管BookModuleConvert/storyAgent及测试才能修复，用户此前只放行imageGen路由，故未动受保护文件，等待协调。未付费、未换模型、未部署；证据见midjourney-routing QA续查节。

2026-11-02 MJ路由续修已上线并释放imageGen.ts/test及发布窗口（未commit/push）：授权单次1.36线上验收404，余额仍3.86；首轮遗漏旧.cn网关兼容，已修旧/自定义网关沿用/mj/、文档新网关按速度分流，保留其他助手重试/冷却/退款与回执恢复。精确快照267项测试、类型/构建通过；后端mj-legacy-gateway-20261102，115产物/PM2/HTTPS/readyz通过，前端仍6dd8d506、配置不变。旧MJ任务49%和原上游过载未解决，不能声称真实出图通过；未再次提交或换模型。QA：docs/qa/2026-11-02-midjourney-routing.md。

2026-11-01 晚间网页整合发布收工：`ede75c81` 已 push main 并于 20:54 部署电脑/手机 Web；6223 项全量测试、类型、构建、76 卡账本及 40 项迁移校验通过。生产 117 文件、HTTPS 页面/资源、版本标识、401 素材权限与 MySQL readyz 验证通过；备份 `backups/web-all-20261101-r2`。首次裁剪依赖缺 Vite，自动回退后改为完整锁定依赖，启动成功。本机线上浏览器受连接关闭限制，未宣称线上点击验收通过。主仓提交与发布窗口释放；原生小程序未上传或提审。证据：`docs/qa/2026-11-01-web-all-release.md`。

2026-11-01 GPT备用与标准核对完成（未提交/未部署）：BookModuleConvert及测试、imageGen及测试、storyAgent可选GPT2参数/报价守卫及路由测试已释放。MJ默认不变，显式GPT2单图预估2.86算力；虚构1216图片1990真实出图、插入、刷新保留通过。170专项/25提示词/类型通过；音乐新编曲标准尚未接入，详见web-button-acceptance QA。


- 2026-11-01 持续对话浏览器验收完成并释放文件（main本地未提交/未部署）：修空正文占半屏，以及promptLineageMigration旧稿重建删除新手机聊天/生成收据。触达MobileMemoryFollowupChat及其测试、promptLineageMigration/Store、storyConversation.mobile及MySQL worker/test；161项Web专项、5项临时MySQL、类型/76卡通过。虚构#1215手机发送→电脑刷新→手机重开、追加断线后恢复同步实测通过，最后两轮均generationAttempt=1。素材范围修复按文档07成果实点复验；原生每日问/采访61项仅本地测试，未真机/部署。QA：docs/qa/2026-11-01-conversation-exploration.md。

- 2026-11-01 文档07素材范围修复（本地未提交，文件释放）：useMobileConversation/MobileChatView/MobileCaptureAttachments 按当前故事展示已完成素材，保留账号任务、收集模式、深链接与分页。39项回归、类型、76卡校验通过；本会话浏览器工具禁用，未实点复验。见 docs/qa/2026-10-31-web-material-capture.md 追加节。未部署。

- 2026-11-01 文档07旧分析链清理（原生main本地未提交，文件释放）：chatInterview/index.js 删除144行未调用分析链，cloud-function.test.js 删除1条纯旧策略测试；类型及1618项全量测试通过，当前单次模型请求回归保留。未部署；见原生 docs/handoff/2026-11-01-conversation-exploration.md。

- 2026-10-31 精简与上下文导航（未提交）：memorySpace 联系人移除两项无用封面读取，书架独立读取并行；新增 feature:context 及 AGENTS/README 定向导航。34 项测试、类型检查、73 卡校验及 diff --check 通过。未部署、未改用户数据，文件已释放。

- 2026-10-30 `6dd749ec` 10/29四处bug修复已提交main、push、部署：书稿模式生成新版本自动写入章节（有未保存修改则打开对照）、不再误报未保存；过期且无302任务号的封面任务可重提；内联重载脚本移至/stale-module-reload.js、connect-src加入媒体源；聊天回复只剥整段成对引号。仅从混合文件里分离本轮hunk，主仓他人改动未混入。4个构建文件变化，生产109文件校验、38迁移一致、readyz通过；manus-runtime内联脚本仍受CSP限制（未改）。ChapterWorkspace/PublishingDraftWorkspace/publishingDraft/securityHeaders/writingCompanion及4张账本卡已释放。

- 2026-10-30 `0e024f2b` 微信注册赠送改为5算力已提交main、push、部署：仅改 WECHAT_REGISTRATION_GIFT_MINOR（2_500_000），幂等键v1不变，网站登录5算力不变，不回填已有账号/账本。仅 dist/index.js 变化，生产108文件校验、38迁移哈希一致、readyz通过。accountIdentity、微信/网站赠送测试及账本两卡已释放。

- 2026-10-29 `1b79fb89` 用户总览说明文字已提交main、push、部署：累计消耗不含预占、已扣款异常流水计入、历史未验证行不计入注册/待确认数、账单打开后滚动。仅3个前端文件变化，生产108文件及公网哈希校验通过。AdminUserOverview及测试、admin-user-overview账本卡已释放。

- 2026-10-29 文档07精简线收工（01a171f5，main，未提交/未部署）：8个消费者直接使用 shared/bookImageBlock 后移除单行导入桥；.env.example 视频路径对齐现有 turbo 默认。9文件52项、类型/72卡账本/diff检查通过；Knip仍有既有候选。保留媒体修复和全部原数据；七项调用/删除门槛追加原07清单。新发现仓库底图GPT报价与单参考FLUX分支不一致，已记publishing-workspace缺口，未改热点服务。导入、配置样例与账本编辑范围已释放。

- 2026-10-28 晚间 `401a1f20` 今日网页整合已提交main、push、部署：书页/仓库/格式自动保存与更新接收，充值兼容及提示词。全量6008项通过；临时MySQL配置纠正后相关失败复验通过；生产108文件校验、正式站格式保存重开通过。发布窗口释放。

- 2026-10-28 电脑导航本地调整完成（未提交/未部署）：书、视频、回忆、仓库；新书/仓库水彩图标，保留图片能力与悬浮仓库。18项测试及类型/账本检查通过，导航相关文件已释放。

- 2026-10-27 `93ec6ca7` 书架插画、电脑拖动/撤销与故事回收站已合 main、push、部署；生产99文件校验，两端回收站读取通过，保留线上章节/登录增量。发布窗口释放。

- 2026-10-14 `c06e03a8` 分享权限与作者确认改写候选已合本地 main：文字/图文双入口、同事务权限校验和独立承接；全量5384项、真实MySQL并发2项、类型与构建通过，未部署。分享与文字历史相关热点已释放；见 docs/qa/2026-10-14-share-permissions.md。

- 2026-09-15 页签统一名称与最大化小鸟 favicon：`89dd055` 将拾光/纳音页签名称统一为 `Drinking Time - Analysis Engine`，小忆头像裁去约 15px 透明边距后铺满 128px 画布；测试站仅原子替换前端入口、主 bundle 与新图片，公网 health/readiness 和文件哈希通过，后端未重启。备份 `/root/dk-shiguang-favicon-title-20260915-2218`；正式站保持 No-Go，未改证书、数据库或服务。

- 2026-09-15 拾光家忆桌面插画工作区与页签小鸟已落地主仓 `00955e5`，架构守卫随 `48b678f` 修正并通过 517 文件／4506 项全量测试、TypeScript、构建、迁移基线、功能账本和环境门禁；测试站已显示“拾光家忆”与小忆水彩小鸟 favicon。正式站只读预检发现证书过期且服务端落后主干 415 个提交，未执行生产拉取、迁移、重启或证书修改。

- 2026-09-11 手机 Web 三页重做 + 微信首个流程对齐：故事/聊聊/我三页与新导航、五种外形、认可造型进聊天、写正文时面板让位、收起档读完长回答、存入故事（来源＝故事正文，真实故事端到端验收通过）；微信端不自动展开、键盘一次发送、收起档可见思考与回答。触达 mobileWorkspace/**、nayin 主题过渡、minigame 键盘与收起档绘制。

- 2026-09-08 资产工作区与整场戏默认宠物：主仓工作区已完成，未提交；70 项定向测试、check/build/feature:validate 通过。触达 MaterialWarehousePanel、VisualAssetLibrary、ShotAssetBindingPanel、shared/visualAssets、visualAsset 持久化/生成/门禁及 storyAgent 生成快照；相关文件已释放。

> **归属怎么判**：author 字段全是 `jane-githu`，区分不出会话。可靠判据只有两条——
> `git reflog` 里这条是 `commit:`（直接在主仓提交）还是 `merge <分支名>:`（从哪个 worktree 合入），
> 加上触达的文件属于哪条线。**不要用「时间重合 + 刚跟谁通过信」归因**：
> 2026-08-23 下午已经连错两次，第二次差点让人去改错的地方。

| 时间 | 提交 | 内容 | 归属（判据） | 触达热区 |
| --- | --- | --- | --- | --- |
| 09-08 | `061893f` / `6694e07` / `482e8eb` | 照片追问已合 main；Story 1196 三图生成五视图 1787–1791 与合板1792，裁切被质检拦截；进度显示与图注顺序修复，宠物全身留边加强但未付费复验。无额外重购 | 聊天照片接手任务收工 | VisualAssetLibrary.tsx、visualAssetCreation.ts、测试及账本 |
| 09-08 | `ba0f1cf` / `3ea80c9` | 聊天照片艺术素材合入本地 main：复用素材库、原位报价确认、宠物补充顶视与回执防重。主仓定向回归 80/80、check/build 通过；main:3000 目标故事已显示聊天入口和示意。已清理对应 worktree/分支，未推送、未付费；三张猫图已收到，导入与真实成图验收待继续，功能保持 observing | **聊天照片艺术素材线**（merge codex/text-to-image-content-art） | `StoryAgentChat.tsx`、`ChatPhotoAssets.tsx`、`visualAssets/**`、`server/routers/visualAssets.ts`、`server/services/visualAsset{Creation,Persistence}.ts`、`shared/visualAssets.ts`、功能账本 |
| 09-05 | `0da6b0a` / `f997cf7` | 字幕与多音轨剪辑 U1–U10 完整落地，并扩展“添加声音”为旁白、音乐、环境声和音效；旁白按字幕 cue 对齐，生成类声音按镜头位置与情绪组织 302 提示词，付费提交前强制服务端报价确认。补齐受管资产、持久任务账本、崩溃恢复、导出混音与旧入口退役门禁。主仓浏览器验证通过；全量 492 文件、4215 用例通过，`pnpm check`、build、migration、feature ledger 与环境门禁均通过 | **字幕与多音轨剪辑线**（最终验收树直接提交 `main`，随后以 `ours` merge 记录原分支 12 条阶段提交） | `EditingNleWorkspace.tsx`、`client/src/features/creationEditor/timelineMedia/**`、`server/routers/timelineMedia.ts`、`server/services/{storyAudioGeneration,storyNarration,timeline*}.ts`、`server/db.ts`、`drizzle/**` |
| 09-04 | `7e10858` | 个人记忆与每日来信 U7：账号级足迹聚合、来源解析与记忆控制 API。tRPC router 的 userId 一律取 ctx.user.id，input schema 不接受任何身份字段；新增失败关闭护栏（routers.ownershipBoundaries.test.ts），只要有 procedure 接受客户端身份字段或不读 ctx.user.id 就直接红，已验证真的会红。时间线用 keyset 分页（occurredAt DESC, id DESC），真实 MySQL 验证同一秒内多条事件靠 id 兜底不被跳过。聚合器不跨业务表 union，只有详情 resolver 才回源理解或来信权威——来信没有写新事件，daily_letter_version 语义留给 U6 决定。来源 resolver 对六种 sourceType 逐条重新验证归属，失败关闭；新增受保护足迹媒体端点 `/api/personal-memory/media/:eventId`，不重定向到不鉴权的 `/api/images`。修了实现中途发现的真实 bug：日期详情曾靠"最近 100 条事件"过滤，活跃用户翻旧日期会静默返回空，已改精确查询并锁两条回归测试。合并前主仓门禁：tsc 干净、452 文件/3956 用例、MySQL 集成 38/38、feature:validate 通过 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/services/personalMemoryTimeline.ts`、`server/routers/personalMemory.ts`、`server/_core/{index,personalMemoryMediaRoute}.ts`、`server/db.ts`、`shared/personalMemory.ts` |
| 09-04 | `0455994` | 个人记忆与每日来信 U5：可追溯提炼、冲突处理与用户反馈状态机。提炼输入结构校验（question/quotation/hypothesis 结构性清零、project_scoped_instruction 强制 scope=project、行为信号来源强制 origin=inferred，全部服务端硬校验不信模型自报）；理解状态机新增 expectedRevision 序列检查（真实 MySQL 并发测试才抓到只查 state 不够）；归档/恢复/忘记/来源清空重算/手动纠正全部实现，忘记同事务递增隐私 epoch、建立 JSON 抑制记录。Runner 可显式 start/stop、单 tick 不重叠、单用户份额限制、独立 kill switch、SIGTERM/SIGINT 优雅关闭；提炼走算力账本，预占对象是新增的平台系统账户（默认零余额不自动充值），模型供应商 allowlist 默认空。真实 MySQL 上发现并修复第四个死锁（job claim 原子单行更新）；顺带修 U2 遗留 bug（每日留言事件快照曾截断 200 字）。端到端接线测试证明捕获→claim→提炼→完成→理解可见全链路真实打通。回填 apply 仍保持阻断 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`server/_core/index.ts`、`server/services/{personalMemoryExtraction,personalMemoryJobRunner,personalMemoryEvents,personalMemoryPersistence}.ts`、`shared/personalMemory.ts` |
| 09-03 | `4ac430d` | 个人记忆与每日来信 U3+U4：七个图片采用入口+文章create_version 映射为可追溯经历，采用语义只能由 router 边界显式传入（禁止从 metadata.source 反推）；文章采用与 stories.body 的 CAS 共享同一事务边界。回填只做 dry-run 四分类，历史图片采用基本判 ambiguous（历史signal 行区分不了用户点击与自动路径），apply 硬阻断等 U5；对账为纯函数只发现不修复。修真实 MySQL 上并发首开来信的间隙锁死锁（改乐观插入+有界重试）。**合并前用真实代码路径冒烟验证**（本地+真实 MySQL），非仅单元测试 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`server/services/{personalMemoryAdoption,personalMemoryReconciliation,publishingPersistence,storyBodyPersistence,directorAdvice}.ts`、`server/routers/{creationAgent,publishingDraft,storyAgent}.ts`、`scripts/backfill-personal-memory.ts` |
| 09-03 | `660bba9` | 个人记忆与每日来信 Phase 0 + U1 + U2：九张新表与 `0017` 迁移；跨租户引用由含 `userId` 的复合外键在库层拒绝；每日来信正文收敛为不可变版本这一个写入口，日期级 `emotion_daily_letters` 降级为当前版本指针 + 可重建投影，并加门禁测试禁止绕过；普通聊天与每日留言在服务端成功边界捕获（本地 outbox 与消息同一次 copy-on-write，跨聚合靠带水位的幂等 projector）。**首次在真实 MySQL 上跑通集成测试 26/26**（含 `0017` 在全新 utf8mb4 库上完整 journal 重演），期间修掉两个只有并发才暴露的 REPEATABLE READ 快照读问题。捕获默认全关，runner 未启动、未回填 | **个人记忆与每日来信线**（reflog 为 `merge codex/personal-memory-daily-letter:`） | `server/db.ts`、`drizzle/**`、`shared/promptLineage.ts`、`server/services/{storyConversation,promptLineageStore,emotionDailyLetters}.ts` |
| 09-03 | `3b578c5`（PR #7） | 合并手机跨端聊天与正文、统一账号和算力账本基础、微信原生 mock 壳层、成片版本、抽帧恢复、OpenAI 路由与美术语义；审查后补修历史账号会话归属和对话并发幂等。完整门禁 436 文件、3643 测试通过。测试站只读预检因迁移 ledger 7/17、缺账号表和 `OTP_DIGEST_SECRET` 判定 No-Go，未部署、未迁移、未重启 | **移动端与环境收敛线**（GitHub PR #7 合并；本地功能/staging worktree 与已吸收分支已删除） | `server/db.ts`、`drizzle/**`、`server/_core/oauth.ts`、`server/services/storyConversation.ts`、`client/src/features/mobileWorkspace/**`、`miniprogram/**`、`docs/features/feature-ledger.json` |
| 08-26 00:01 | `5c9d750` | 统一所有视觉层的对象选择、移动、剪辑、抽帧、复制粘贴、删除、会话撤销与普通镜头生成采用；抽帧资产永久留仓，Story/Timeline/Take 聚合写入原子化；同步保留刷新延迟优化。合并前门禁 380 文件、3193 测试全绿 | **统一视觉图层剪辑线**（reflog 为 `merge codex/feat-unified-visual-clip-operations:`） | `EditingNleWorkspace.tsx`、`StoryboardEditRow.tsx`、`StoryAgentContext.tsx`、`creationAgent.ts`、`storyAgent.ts`、`storyMaterials.ts`、`visualClipEditing.ts`、`server/db.ts` |
| 08-23 17:43 | `8d19b94` | 删掉图生图链路里没被用上的代码 | **图生图对话框线**（reflog 为 `commit:`，直接在主仓提交；文件全属图生图链路） | `chatImageRefs.ts`、`useChatImageRemix.ts`、`useAssetSwapProposal.ts` |
| 08-23 17:47 | `f0ce930` / `1f89f5b` | 清掉多轨剪辑重构留下的死代码 | **clip-move 线**（`1f89f5b` 的第二父提交来自 `claude/multitrack-editor-reset`）。该线当日收工，worktree 与分支已按规矩删除 | `visualClipEditing.ts` −27、`visualClipModel.ts`、`creationAgent.ts` −14、`EditingNleWorkspace.tsx`、`StoryboardEditRow.tsx` |
| 08-23 18:07 | `8e85541` | 视觉资产：参考图改走自有 OSS、一致性闸门按小句判定、冲突裁决逐条配对 | **视觉资产标准板线**（08-22 完成未落库，由架构收敛会话代为提交；原作者已核对提交信息属实）。这批是真实付费验出来的，累计 ¥31.29 | `imageGen.ts`、`storyAgent.ts`、`visualAsset*` |
| 08-23 18:12 | `6aed6d2` / `41d1797` | 补齐三份未落库交接文档；新增架构收敛需求文档与用户裁决 | **架构收敛线** | 无（纯文档） |
| 08-23 18:25 | `414331b` | 新增本看板 | **架构收敛线** | 无（纯文档） |
| 08-24 02:30 | `4cd2241` | tsconfig 移除 `**/*.test.ts` exclude 的摸底报告：exclude 系初始提交的模板默认值；移除后 208 个既有错误全在测试文件内，生产代码零错误 | **tsconfig 类型检查线**（reflog 为 `commit:`；只新增 `docs/qa/` 一个文件） | 无（纯文档，未动 `tsconfig.json`） |
| 08-24 02:42 | `8ae55a8` | tsconfig 棘轮：240 个测试文件纳入 `tsc --noEmit`，58 个存量失败文件冻结为基线；补漏写的 `target: ES2022` 并钉住 `useDefineForClassFields: false`（产物逐字节不变）。存量 208 个错误按设计未修 | **tsconfig 类型检查线**（reflog 为 `commit:`；只动 `tsconfig.json` + 新增守卫 + `docs/qa/`） | `tsconfig.json`（全库门禁，新增热区候选） |
| 08-24 02:41 | `86465a1` | 滚动剪辑在隐式位置下不再砍短总片长：`trimTimelineItem`／`splitTimelineItem` 改为必传调用方已解析的真实 `startFrame`，删掉 `buildTimelineLayout([item])` 单元素重建；隐式与显式两种形状各补一条「总结束时间不变」回归测试；顺带把 U2 搬家后账本里三处 `timelineActions` 旧路径修正，`feature:validate` 恢复通过 | **滚动剪辑修复线**（reflog 为 `commit:`；由架构收敛线开卡、用户裁决归本线执行） | `shared/timelineEditing.ts`、`shared/timelineCommands.ts`、`server/routers/storyAgent.ts`（**仅** `splitTimelineItem` 调用点一行） |
| 08-23 18:16 | `9ba6e2d` | 修竞态：素材库未拉回时，「换成素材里的人物」被静默放行给通用改写 | **图生图对话框线**（reflog 为 `commit:`；文件全属该链路） | 无（未动 `server/`） |
| 08-25 | `7325a83`→`91b0b49`（三次 `merge:` + 三次账本证据提交） | 刷新延迟修复，按 Phase A→B→C 落地：A 把 CreationEditorContext 十项 query 的 `isLoading` 拆出 `initialStoryLoading`（新增 `isStoryScopeReady()`/`resolveInitialStoryLoading()` 纯函数），EditingNleWorkspace 的整页 spinner 门改用它；B 给 `storyList`/`storyGet` 两个初始化 query key 各加 5 秒窄 `staleTime`（`recentStoryListCache.ts`），`refreshStoryList` 新增 `allowRecentColdEntryCache`，手动刷新/删除/backToList 都不受影响；C 本地模式读单 Story 提示词投影不再复制整份仓库，新增 `getLocalPromptLineageStateForStory()`/`getLocalPromptCompilationHeadsForStory()`（先筛后 clone）与 `loadStoryPromptCompilationHeads()`，`storyMaterials.getStoryMaterialState` 改用窄函数。主仓 3000 用 Story 1186 连续 3 次整页刷新实测：镜头立即可见、`storyList`/`storyGet(1186)` 各恰好 1 次请求、`getStoryMaterialState` 热调用 45-48ms→9-13ms。证据已写入 `recent-story-entry.history`/`prompt-lineage.history` | **刷新延迟修复线**（reflog 为 `merge:`，从 `.worktrees/story-refresh-latency` / 分支 `claude/story-refresh-latency` 合入；已按 AGENTS.md 收工删除） | `client/src/features/creationEditor/CreationEditorContext.tsx`、`client/src/features/creationEditor/views/EditingNleWorkspace.tsx`、`client/src/features/storyAgent/StoryAgentContext.tsx`、`server/db.ts`、`server/services/promptLineageStore.ts`、`server/services/promptLineage.ts`、`server/services/storyMaterials.ts` |

---

## 热区文件（改动必须先登记）

同一事实目前仍有多个写入者，或多条线同时在改：

| 文件 | 为什么是热区 |
| --- | --- |
| `server/routers/creationAgent.ts` | `updateStoryTimeline` 仍接收整份 items；是架构收敛第一刀的目标 |
| `client/src/features/creationEditor/CreationEditorContext.tsx` | `saveTimelineItems` 22 处引用，整份 timeline 写回的唯一来源 |
| `server/services/visualClipEditing.ts` / `shared/visualClipModel.ts` | 新落地的 `moveVisualClip` 家族，与上面两处争同一个事实 |
| `client/src/features/creationEditor/views/EditingNleWorkspace.tsx` | 底部时间轴，第二个可编辑表面 |
| `client/src/features/creationEditor/views/StoryboardEditRow.tsx` | 上方 Storyboard 图层，第一个可编辑表面 |
| `server/routers/storyAgent.ts` | 视觉资产、图生图、剧本三条线共用 |
| `server/db.ts` | 109 个导出、53 个文件直接引用，任何改动扩散面最大 |

---

## 当前待决（用户已知，未拍板）

- 用户对**两个剪辑界面**（上方 Storyboard 图层 / 底部 Timeline）都不满意，倾向合并成一个。
  合并范围尚未确定，见 `docs/brainstorms/2026-08-23-architecture-convergence-requirements.md`。
- 架构收敛的第一刀已获批：关闭整份 timeline 写入口，位置只走 `moveVisualClip` 家族，
  批量操作（撤销、整层重排）也必须表达成服务端领域命令（用户选了严格方案）。
  **这会改动上表前三个热区文件**，其他会话请避让或先协调。
- `server/routers/storyAgent.ts` 上有两条线会碰面：架构收敛（timeline 写入口）与视觉资产标准板
  （provider 白名单 + 估价分支）。后者尚未动手，动手前会先更新本看板。
- 视觉资产标准板线在等用户两件事：OSS 凭据；是否放开 gpt-image
  （用户一小时前在两个方案里选了另一个，图生图线希望改判——**这是用户的决定，任何会话不得代为翻案**）。

图片参考通道修复（2026-09-08，工作区未提交）已释放文件：单张本地参考入口及报价、供应商错误保真已完成；真实请求302 fetch failed，未出图，未重复提交。代码为StoryboardReviewBoard/storyboardImageRenderPlan/rerender及测试，证据见docs/qa/storyboard-image-confirmation-2026-09-08.md。

2026-09-09 参考图异步适配修复已释放文件（未提交）：imageGen.ts及测试；75项通过、类型/构建/账本通过。未新增付费任务，真实出图和Story回执持久化仍未验收，详见docs/qa/storyboard-image-confirmation-2026-09-08.md。

2026-09-09 统一镜头渲染入口收工：`47c226b` 实现、`ecf3845` 窄列排版，已合入main并保留微信最新更新与原图片修复基线。4408项测试、check/build/feature/migration通过；主仓库3000完成四张总价确认取消、删猫刷新和重新选择验收，无新付费请求。热点storyAgent路由、StoryboardReviewBoard、rerender与资产上下文已释放，独立worktree与分支清理；证据见docs/qa/unified-shot-render-2026-09-09.md。上文图片修复“未提交”记录已随47c226b归档，单张真实成功证据为1793。

2026-09-09 MJ镜头渲染收工：`2ccd7b1` 已合入main，按用户要求切回MJ，1–4张一次约¥0.68、5–8张两次约¥1.36；显式参考直接base64输入，不因公网托管失败切换模型。242项相关测试通过，主仓库3000无付费验收通过。热点文件释放，worktree/分支清理；证据docs/qa/mj-shot-render-2026-09-09.md。

2026-09-09 预览图聊天改版收工：460c2b5已合入main；直接点图→聊天修改→MJ报价→新候选。93项相关测试、类型、构建与功能账本通过；主仓3000猫图1793实际发送到MJ四张¥0.68确认并取消，未付费生成，原图与选图保留。工作树/分支清理，热点释放。证据docs/qa/preview-chat-revision-2026-09-09.md。

2026-09-09 图片字幕层收工：1537bed入口/排版、2ca728d读取投影修复已合main；149项初始回归、102项修复回归、类型/构建/41卡账本通过。main:3000镜头02真实手绘/样式/保存/两次刷新通过，保留原台词示例，未改原图、无付费调用；视频导出自定义图片文字层仍是明确缺口。两次独立worktree及分支已清理，ShotPreview/ImageClipEditorPanel/EditingNleWorkspace/publishingAlbum/storyMaterials及账本热点释放。证据docs/qa/image-subtitle-layer-2026-09-09.md。

2026-10-29 book media local work released (uncommitted): inline image chat, masked edit and inline video entry; media 63 tests and draft-safety 69 tests, typecheck/migration/ledger pass. Browser click/region/video quote and exit/reselect verified, no paid generation or deployment. QA: docs/qa/2026-10-29-book-media-editing.md. ChapterTextModules/ChapterWriting/BookBlockCanvas/BookMediaChat, StoryAgentChat, bookMedia routes, videoJobs and masked-target migration files released.

2026-10-29 scribble selection local changes released, uncommitted: BookMediaChat/segmentation/creationAgent plus tests and QA. UI multiple-stroke drawing verified; real vision timed out once, unknown outcome, no retry. No image modified or deployment. See book-media-editing QA.

2026-10-30 书模块发布窗口：本会话独占main提交与部署，仅发布框选、多块拖放缩放、紧凑双栏和联动缩放。以74960441为基线隔离构建，保留其他会话未提交工作，不含媒体改图/视频/每日信/迁移0038。

2026-10-30 书模块发布收工：fe12de4e已push main并部署，框选/整组变换/紧凑双栏生效；69项独立MySQL、215项小程序、类型/构建/保存回归通过；全量14项既有失败已主干对照。109文件及HTTPS资源校验通过，生产配置/数据库未改。发布窗口释放，其他会话工作保留。证据docs/qa/2026-10-30-book-columns-release.md。

### 2026-10-30 素材收集本地验收追加

本会话：手机聊天收集素材：生成记忆与故事。Web功能已接入唯一主仓3000，小程序17个业务/测试/部署说明文件已无冲突接入主仓；均未提交、未推送、未部署。另一会话的编辑器修改与小程序10份旧计划保留。工作树仍含未提交工作，不能清理。

证据见 `docs/qa/2026-10-30-mobile-material-capture.md`，功能卡 `mobile-material-capture` 为partial。真实文字自动成文、图片理解、原件失败恢复与来源重开通过；豆包ASR权限不足、备用服务不可用，已向用户请求配置；双手机系统分享未实测。请勿将iPhone快捷指令签名、SW协议单测或小程序1608项通过当作手机验收。

2026-10-31 模块转换收工（未提交/未部署）：六点菜单新增图片→文字/音乐、文字→图片/音乐；源模块保留，结果安全插入并沿用保存撤销。32项定向测试、类型、75卡账本通过；真实图片理解、插入和刷新保留已验证。音乐/图片付费供应商未实测。文件释放，QA docs/qa/2026-10-31-book-module-conversion.md。

2026-10-31 自动插入/音乐仓库完成（未提交未部署）：生成结果自动新增正文模块，文字先存仓库，音乐/图片复用现有资产；音乐与文字仓库可再次插入。18项测试、类型通过，音乐列表实测。所涉文件释放。

2026-10-31 合并文字与有声书本地交接：多选右键合并/撤销实测通过；有声书复用朗读报价与入库/自动插入，25项测试+类型通过，但真实302TTS返回HTTP500/submission_unknown，不重试，原文保留，尚未实际生成。文件释放，未部署；QA docs/qa/2026-10-31-merge-audiobook.md。

2026-11-01 书模块发布窗口：本会话独占main提交/push/部署，隔离发布多选/栏宽/章节字号、音乐/仓库/转换、合并换行及429提示；保留其他会话未提交工作，不含改图/视频/手机采集数据库迁移。

2026-11-01 书模块发布收工：c05eba77已push main并部署；109产物文件校验、生产readyz通过，保留旧hash资源及回退备份。模块专项61项/修正回归25项/小程序215项通过，MySQL68项+超时文件重跑10项通过；全量15项既有失败主干复现。发布窗口及文件占用释放，其他会话工作完整保留。详见docs/qa/2026-11-01-book-modules-release.md。

2026-11-02 17:35 微信出码待凭据：HTTPS签名/nonce已通过，SDK invalid access_token；原生e1cfcbd服务端出码适配21专项通过，等待用户从微信后台取得AppSecret后亲自填腾讯云WECHAT_APP_SECRET。相关截图/日志/tmp/wechat-qr-live-20261102，Web前端未切、兼容后端已上线。暂停占用Web生产发布窗口，其他发布必须保留已上线扫码兼容后端；本对话恢复时重新核对线上基线，禁止直接复用旧frontend发布包覆盖其他会话。

2026-11-02 18:05 微信出码恢复独占发布窗口：用户已保存AppSecret，签名请求200且真实PNG/JPEG头通过（78,961字节）。线上兼容后端及前端491ce1bd基线仍匹配，无发布锁。继续网页配置、小程序二维码编译验收和内部develop上传；其他会话暂不切换生产。

2026-11-02 微信真实扫码发布完成并释放生产窗口：原生e1cfcbd服务端出码已部署，用户AppSecret配置后200；生产Web+DevTools真实二维码确认→/editing、拒绝、过期均通过，无故事写入。内部开发版0.1.1102qr上传；Web前端ececbb11已切换，ready/mysql/required与115产物校验通过。重要：保留已上线11文件扫码兼容代码和3项QR配置；其他待发布工作树须重建在此基线上，不能覆盖为旧六位码UI。env_version=develop，普通用户正式版/手机扫码和故事导入UI尚未完成；原生工作树保留e1cfcbd部署来源，待安全收敛。QA docs/qa/2026-11-02-wechat-qr-login.md。

2026-11-02 微信手机扫码六位码反馈续修（本对话）：占用原生web-login确认页/入口生命周期及专项测试，Web扫码发布内容暂不改。检查冷/热启动scene处理；保留签名、本人确认、两分钟和旧协议。手机尚未通过，不把DevTools成功代替真机验收。原生沿用codex/wechat-qr-live-20261102独立树。

2026-11-02 用户确认登录/迁移顺序：本对话继续原生确认页默认扫码与兼容入口、Web迁移提示联通核对；不抢占其他会话发布，不把登录/导入本地验证称为线上完成。

2026-11-02 微信故事迁移发布准备：本对话占用生产发布窗口，基于已上线扫码ececbb11隔离25文件增量；不合并主仓其他修改。新增/v1/web-import已获用户确认并提交，两个云端WEB_STORY_IMPORT_ENABLED已保存。原生93e9907内部0.1.1102qr2上传成功；Web仍旧版，等待隔离类型检查和暂存上传完成后切换。

2026-11-02 微信故事迁移已发布并释放生产发布窗口：wechat-import-20261102隔离25文件、115产物验证、48专项/75草稿/1MySQL/类型通过。签名/v1/web-import路由及两云开关、Web WECHAT_BOOK_IMPORT_ENABLED已开启。真实登录→可选迁移→虚构#115书稿打开通过；回收测试副本待用户浏览器确认。其他发布必须保留本次登录与迁移代码/开关，旧扫码ececbb11已不是当前线上基线。原生93e9907/0.1.1102qr2已上传，真机待验收。

2026-11-02 清理回执：用户明确回复“已清理”，确认处理本次虚构网页测试副本#115的回收提示。浏览器连接未恢复，未独立复核状态；小程序源稿未改。

2026-11-02 微信登录后续排查：用户明确要求小程序同一账号及余额。本会话占用 PublishingDraftWorkspace 新草稿空态及对应测试、TopBar 微信身份展示的定向修复，核查小程序共享账本与 profile 来源；保留其他会话视频/章节改动，不合并账号、不直接修改余额、不触发付费生成。尚未占用生产发布窗口。

2026-11-02 21:38 本对话占用生产发布窗口：以 wechat-import-20261102 为唯一基线，隔离发布新草稿空态、微信称呼同步、用户新确认的两端合计5算力赠送去重；启用已存在的签名共享钱包接口。用户已亲自保存 getOpenId 钱包连接配置。111专项、真实MySQL跨进程赠送去重1项、构建/类型通过；不合并主仓其他修改，不回收任何历史赠送。

2026-11-02 21:49 微信账号续修发布完成，立即释放生产发布窗口（支付宝会话可接手）。最新权威运行源：/tmp/wechat-account-followup-20261102/src；生产manifest=/opt/Drinking-Time/dist.release-wechat-account-followup-20261102.json，release=wechat-account-followup-20261102，115产物校验及ready/mysql/required通过。旧wechat-import/qr基线不得覆盖。必须保留本次TopBar无名微信头像、新故事-1文字入口、server/services/{webLogin,webLoginGift,accountIdentity,computeLedger}.ts、server/repositories/computeLedger.ts、server/_core/shiguangDesktopBridge.ts及此前25项登录/导入源码。新增服务器SHIGUANG_COMPUTE_ENABLED=true，既有QR/导入/桥接配置保持。用户亲自保存getOpenId连接配置，DevTools余额15.00与网页一致；用户重登后岱真实可见。支付宝本地computePayment/payments/alipay改动未覆盖、未包含本次发布。主仓临时账本类型错误已修复，隔离tsc通过。下一会话请基于上述源复制支付宝最小差异并校验当前manifest；不要从主仓整体构建覆盖他人未发布工作。QA docs/qa/2026-11-02-wechat-account-followup.md；本对话只继续文档和导入入口说明，不再占用部署。

2026-11-02 英文界面覆盖续修：本对话按用户要求补齐桌面英文UI，沿用uiLanguage显式词典；占用uiLanguage/messages与桌面导航、聊天、书稿、生成菜单及相关弹窗的界面文案。只翻译UI，不改写用户故事/输入/生成内容，不抢支付宝发布窗口。完成后另行核对最新线上基线。

2026-11-02 23:04 英文界面发布窗口：本对话以支付宝最新 alipay-enable-20261102 源为基线隔离语言文案增量；服务器该manifest与后端7572fce9一致、无发布锁。仅发布前端资源，不重启服务、不改.env/数据库/后端；保留微信与支付宝链路。上线验证完成后释放。主仓其他未发布视频流程仍不包含。

2026-11-02 23:20 英文界面已发布并释放生产窗口。最终权威运行源=/tmp/desktop-ui-english-20261102/src；最终manifest=/opt/Drinking-Time/dist.release-desktop-ui-english-polish-20261102.json。115产物和ready/mysql/required通过；只更新前端JS/index/app-release，后端仍支付宝7572fce979a69b877e226cbbc6935f41d6ae2081f95c3ec2bf111d368ee718af，.env/数据库/进程未改。正式站English导航、书稿、导入提示、账号页已验收，岱/15.00未变。后续发布必须在本源基础保留全部语言词典与已接入UI；旧alipay-enable源不能直接覆盖前端。主仓其他未发布视频工作仍保留，未整体提交/合并。1255隔离回归的源代码断言更新后69项复跑通过，最终文案11项/类型/构建通过，账本77卡通过。详见docs/qa/2026-11-02-desktop-english-ui.md；语言新增法语及旧helper通知仍列缺口，不声称法语全量翻译。

2026-11-02 微信导入章节展示修复：本对话占用 ChapterWriting / ChapterTextModules / BookBlockCanvas 的定向界面改动及对应测试，按现有导入凭据的 heading1/parentId 显示章节序号和收起目录；不重导、不覆盖已编辑的正文/图片/字体，不恢复独立章节工作台。未占用生产发布窗口，其他会话请避免同时修改这些文件。

2026-11-02 微信章节目录修复申请发布窗口：以 desktop-ui-english-polish-20261102 源为基线，隔离六个文件的展示增量；仅替换前端资源，不重启服务，不改数据库/原故事/环境，保留微信账号与英文功能。76项测试和类型/构建通过。本次生产校验后释放窗口。

2026-11-03 微信导入章节目录修复上线并释放发布窗口。当前权威运行源=/tmp/wechat-chapter-presentation-20261102/src；manifest=/opt/Drinking-Time/dist.release-wechat-chapter-view-20261102.json；115产物与ready/mysql/required通过。仅前端，后端/环境/数据库未改；保留微信扫码、迁移与英文界面。新标签正式站对已有真实书稿只读验证11章顺序及第六章展开/收起；原文、图片和字号未写入，展开状态仅当次界面。76项测试、类型、构建及77卡账本通过；保留原书页分页和跨页行为。下一发布以此源为基线，不要覆盖为旧英文源。QA docs/qa/2026-11-02-wechat-chapter-presentation.md。主仓其他未提交修改保留。

2026-11-03 视频按钮转圈排查：本对话占用 StoryboardReviewBoard 视频生成按钮状态、人物一致性预检与对应测试；保持主图/连续性/费用确认及既有任务、账务和去重约束，不提交或重试付费生成。尚未占用生产发布窗口；具体故事与镜头待用户确认。

2026-11-03 视频按钮等待修复本地完成并释放文件：缺主图时按钮显示不可用及选择首帧的具体提示，不再显示等待鼠标；人物一致性预检30秒超时中止当次未提交的视频，迟到结果不触发提交。58项测试、类型和77卡账本通过；本地3000示例镜头01只读复现0.68算力场景，未调用AI、付费提交、刷新或取消任务。用户截图未提供故事/镜头身份，不将示例推断为用户实际请求；未提交、未部署。代码涉及StoryboardReviewBoard/StoryboardMatrix/预检deadline与语言词典；现有生产源与其他未提交修改保留。QA docs/qa/2026-11-03-video-button-wait.md。

2026-11-03 有声书 500 排查：本会话占用 BookModuleConvert 及对应测试、uiLanguage/messages 有声书提示，修正结果未知提示和当前弹窗重复提交；不触发或重试付费生成，不改变原文、账务和其他功能。跨弹窗/设备的持久任务防重与供应商 HTTP 500 根因仍需核实。未占用生产发布窗口。

2026-11-03 有声书 500 续查本地完成并释放文件：BookModuleConvert 对结果未知、等待与网络断开提示核对任务和费用，禁用当前弹窗再次提交，新增中英法文案；34 项测试、类型、77 卡账本通过。未调用付费生成、未部署；跨弹窗/设备持久防重、用户该笔费用及上游500原因尚待核实。详见 docs/qa/2026-11-03-audiobook-500.md。

2026-11-03 会话修复发布准备：本会话核对生产 wechat-chapter-view-20261102 与 main 的差异，隔离准备有声书提示、旧页草稿恢复和视频按钮修复；保留已上线微信/支付宝/语言/章节及其他会话未提交工作。尚未占用生产发布窗口，未触发付费生成。

2026-11-03 会话修复发布准备暂停：已在 /tmp/conversation-fixes-release-20261103/src 以线上 wechat-chapter-view 基线隔离草稿恢复、有声书提示与视频按钮改动，组合68项测试、类型、构建通过；远端现有115项manifest哈希一致、ready/mysql/required、无发布锁。主干 c155d0bc 与线上已发布源码相差至少153个跟踪文件，直接移植出现微信章节类型/接口不匹配；主仓另有247项未提交修改。为避免覆盖线上既有功能及其他会话工作，本次未合并、未push、未部署；临时git worktree及分支已删除，隔离源码保留。下一步须先将线上已发布源码完整、可审计地收敛进main并保护当前工作区，再核验和发布；不得从旧main构建覆盖生产。

2026-11-03 继续发布：按用户要求本会话负责跨分支收敛及生产发布；以线上 wechat-chapter-view 快照为权威基线，隔离核对并纳入此前已部署代码及本次三个修复，保留主仓未提交更改。不启动额外服务，不调用付费生成。其他会话请暂勿同时进行跨分支收敛或生产发布。

2026-11-03 会话修复开始生产发布：线上 wechat-chapter-view 基线已对齐并推送 main 044dd40c；保留主仓259个未提交文件内容并备份。仅前端资源发布，服务器后端、环境、数据库和账号余额不改；发布前重新核验manifest与锁，完成验证后立即释放窗口。组合147项测试、类型、构建和76卡账本通过；本次不触发付费生成。

2026-11-03 会话修复上线完成并释放生产/收敛窗口：main 044dd40c 代码、9f12d94b 验证记录均已push；生产 conversation-fixes-20261103 以前端独立发布，115产物、ready/mysql/required、HTTPS HTML/版本/JS哈希及三项提示文案通过；后端SHA 7572fce9、环境和数据库未改，旧资源保留。主仓259个未提交文件内容在推进main时均校验未变，备份 /tmp/conversation-fixes-release-20261103/workspace-before-merge。隔离源码 /tmp/conversation-fixes-release-20261103/src，实际产物 /tmp/conversation-fixes-release-20261103/published-artifacts，临时git worktree和分支已删除。组合147项测试、类型/构建/账本通过；未触发付费生成。旧页先复制未保存内容再打开新版；有声书供应商500、费用核对及跨窗口防重仍为缺口。QA docs/qa/2026-11-03-conversation-fixes-release.md。

2026-11-03 首页微信码发布：本会话占用 ShiguangLandingPage、WechatEntry、对应样式和临时体验码，保留原手机版/电脑版入口及微信登录导入，二维码原图不变并如实标注11月9日前有效；拟按正式站当前前端基线隔离发布，不改账号/故事/账务。尚未占用发布窗口。

2026-11-03 首页微信码申请合并/发布窗口：以 main 9f12d94b 和生产 conversation-fixes-20261103 为基线，隔离9个文件（含原有功能账本和证据），仅前端发布；保留所有主仓未提交文件，其他会话请避免同时进行跨分支合并/生产发布。4项入口测试、类型、构建和77卡账本通过；体验码未真机验证。

2026-11-03 首页微信码已上线并释放合并/发布窗口：main 2973a9d1（入口）及08590c90（验证记录）均已push，生产 release=wechat-home-qr-20261103，manifest=/opt/Drinking-Time/dist.release-wechat-home-qr-20261103.json。116产物哈希、ready/mysql/required、HTTPS二维码原图哈希通过；正式站浏览器实点确认原设备选择弹窗内手机版、电脑版、微信版二维码与11月9日前有效提示完整可见。仅前端发布，后端/环境/数据库不变，旧资源保留。4项测试、类型、构建、77卡账本通过；未进行手机扫码或体验资格验收。源码与产物保存在/tmp/wechat-home-qr-release-20261103/src，正式截图/tmp/wechat-home-qr-release-20261103/production-entry.png；临时git worktree/分支已删除。主仓原87个未提交文件已保留，备份/tmp/wechat-home-qr-workspace-before-merge-20261103。后续发布以该线上基线为准。QA docs/qa/2026-11-03-wechat-home-qr.md。

2026-11-09 chat 01a1bedb 影片内音乐/字幕子版本完成并释放本轮文件（未提交/push/部署）：shared/server videoMediaVersions、Timeline CAS/音频命令/路由、素材历史保留、快照引用与前端轨道下拉/字典/测试/账本QA。各轨按影片V02→V02.1独立递增，恢复真实切片、新身份防迟到写入、会话/CAS/幂等/撤销保持。14文件155项回归、类型、构建77项草稿保护、89卡及差异检查通过；真实3000故事1217实点音乐V06.2素材14→V08.1素材17、音量修改得到V08.2后恢复V08.1（25%），刷新保留；最终旁白16/音乐17均1934帧、13字幕、影片仍V8，账本155/供应商18/22.96算力未变。旧未保存编辑不可补造、部分作者缺失如实显示，2000项/4MiB上限保留旧记录报错。生产/MySQL未在本轮验收，其他手机号登录修复保留。QA docs/qa/2026-11-09-video-media-versions.md，截图outputs/video-media-versions-20261109/versions.png。

## 待实施：停留帧轻量聊天引用（2026-11-11 用户确认）

功能卡：`paused-frame-chat-reference`（planned）。用户允许择机加入，安排在当前美术提示词与候选确认闭环稳定后实施。本轮只登记需求，没有修改运行代码、故事或生成素材。

体验：暂停预览时在输入区域轻提示“可以直接说：把这一帧…… / You can say: change this frame…”；用户用文字或语音说“这一帧”，消息旁附一个很小的图片标记，点开才展示帧、镜头、时间和版本。无需手动抽帧、找图、上传或增加一排按钮。普通聊天不自动附图。

引用时冻结本次帧身份；随后拖动播放头、切镜头或异步处理不得偷换引用。用户显式点名图片或镜头优先；可复用附件交互更新/取消引用。服务端核验账号、故事、剪辑版本及实际可见源，正确处理裁切、变速、倒放和叠层；不能拿随机采样帧或Take首帧冒充当前画面，也不截取编辑器按钮。独立字幕不误烧成生成素材。空白、缺素材和失败如实说明，不触发付费。

图片与来源版本/时间保存在原镜头仓库和对话，刷新可回看。复用已有读图、美术编译、“修改/保留”、报价、候选与明确采用流程；抽帧不调用生成模型，后续付费调用仍先报价，确认采用前不替换。

复用点：`useFrameReferenceChat.ts`、`chatFrameReferences.ts`、`ChatFrameReferences.tsx`、`timelineFrameExtraction.ts`、`visualClipEditing.resolveShotAtPlayhead`。现有聊天抽帧按指定镜头/时间、默认15/50/85%取源视频；输入虽有playheadMs，resolveReferenceShot尚未使用它，当前不具备自动停留帧引用。

验收：文字/语音同帧；输入后播放头移动仍绑定原帧；明确选图优先；叠层/裁切/倒放/变速定位；切故事/版本不串图；刷新后图标回看；空白失败不购媒体。扩充现有抽帧/聊天测试，并在3001副本验证小图标、预览、取消。真实付费效果另行报价验收。

2026-11-12 对象局部配色续修：占用 framePaletteEdit 及测试、新增局部语义配色执行模块、storyboardImageTask 的本地结果元数据与恢复边界、usePausedFrameChat 文案及相关 QA/功能卡。由 AI 提供对象范围与配色，执行限定区域且锁定亮度；先验证范围外像素/尺寸/实际改色，再在既有 3001 副本对话实测。继承未提交改动保留，冻结文件/3000库/采用视频/音乐/字幕不动，不提交发布。

2026-11-12 对象局部配色本轮收工并释放文件（未提交/发布）：已增加 AI 轮廓＋本地 Lab 执行、有效改色/L/保护区校验、本地结果恢复及未知读图防重复计费；8文件86项和额外8项no-op验证、类型、98卡、diff与冻结哈希通过。3001实测读图请求 db29434b 超时，无新图，operation252费用待核对；缩减轮廓新方案已在3001对话报价最多0.26552算力，尚未确认，等待用户决定下一次付费调用。真实轮廓与配色效果仍未验收；generatedImages/剪辑/视频/音频均与本轮前相同。证据 /tmp/frame-semantic-palette-20261112；继续前查看QA末节，禁止把本轮当成功出图、禁止自动重购未知读图。

2026-11-12 chat 01a1bedb 0.26552算力单次复测结束并释放文档范围（未提交/合并/部署）：3001聊天确认request0d1b5500，读图失败、无新图/蒙版；本次operation253释放预占、结算0，旧operation252仍未知。图片/剪辑/Take/声音/选用记录与前置快照完全一致；不再付费重试，服务和工作树保留。只更新QA/账本/看板，运行代码未改。证据/tmp/frame-semantic-palette-20261112/retry-result.json与retry-page-result.png；具体上游错误诊断未持久化，实际效果仍未验收。
2026-11-12 chat 01a1c440 Next读图续修完成并释放文件（未提交/合并/部署）：framePaletteEdit/任务/聊天/专用env与resolver及测试、QA/账本。144项/类型/98卡/diff通过；3001弹窗批准0.53172后单次Next/Gemini2.5Flash约15秒返回，operation254结算0.16912，结构校验失败、无新图。原响应已丢失，后续已补有界保存与字段错误；未知费CAS冲突不重购保护已修。付费前后图片/剪辑24/Take/声音一致，保留期间并发新增2064。Next专用配置位于git忽略的工作树.env（600），全局占位配置保留；父服务不重启。证据/tmp/frame-palette-provider-20261112。原图效果未通过，不自动重购；训练模型另在继承上下文的新对话01a1cdf8独立推进。

2026-11-12 chat 01a1c440 视频转书本轮结束并释放文件/页面窗口（未提交/合并/部署）：聊天底部重复按钮删除已在3001刷新验收，书页自由输入/可选示例/视频取材与预览代码接通；42相关项、类型、冻结哈希通过。真实1219请求77cec732用21帧和本地转写，Next120秒超时，无文字；operation255费用未知、预占1.56092算力，超过错误展示的授权1.36754，已告知用户。已修复算力换算并阻止未知结果重购，未调整账务。原剪辑修订2/书稿哈希未变，新增同内容来源视频V2；真实预览/采用仍未验收。QA docs/qa/2026-11-12-video-to-book.md。需先核对operation255，禁止自动重购；保留用户指定3001与工作树。

2026-11-12 chat 01a1c440 视频转书可见版本续修完成并释放本轮范围（未提交/合并/部署）：本地0算力原片字幕读取、可校对预览、安全采用载入、作品版本全文与失败状态接通；真实3001故事1219生成21段字幕，校对采用文字V1，刷新后两页书稿与作者/时间/来源V3可读。修复指纹序列化差异避免重复来源导出。52独立测试、类型、账本/diff/冻结哈希通过；剪辑修订2与全部账务记录不变，operation255旧预占仍未知，付费500字改编未完成。QA docs/qa/2026-11-12-video-to-book.md末节，截图text-v1-visible.png。保留用户指定3001与工作树。
2026-11-14 chat 01a1d3cc 分镜修复上线并释放代码/生产窗口：实际回包原媒体引用无text及多个错误父索引；f9742ac6主线2ce3c315，仅后端上线，39项/类型/281哈希/ready/匿名401通过。生成结果仍待确认，真实重生成未验收；未改环境/依赖/账务或用户故事。QA docs/qa/2026-11-14-film-generation-connection.md。
2026-11-14 chat 01a1d3cc 分镜镜头媒体/索引修复上线，释放生产和代码窗口：d8a0ce62/d8eaefa5合main，44项/类型/最新真实回包脱敏回放、281哈希及ready通过；账户真实重生成及界面受浏览器安全限制未验收。QA docs/qa/2026-11-14-film-generation-connection.md。
2026-11-14 chat 01a1d3cc 微信原图转视频修复本地完成，释放生产及代码窗口：f6a2ce67/main a4187b3c，虚构完整导入/隐私/幂等、相关回归、类型和MySQL临时表通过；自动审批阻止上传补丁，正式站未更新，待用户明确授权后继续。QA docs/qa/2026-11-14-wechat-image-video.md。
2026-11-14 chat 01a1d3cc 微信私密图片转视频上线并释放发布窗口：用户明确确认上传，f6a2ce67仅后端，281哈希/ready及线上本人归属、跨账号隔离、文件哈希只读通过；虚构完整导入通过，未写用户故事或重复生成，真实浏览器受限制未验收。QA docs/qa/2026-11-14-wechat-image-video.md。
