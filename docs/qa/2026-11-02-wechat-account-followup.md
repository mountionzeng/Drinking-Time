# 微信登录后账号、共享算力与新故事修复

## 用户确认

- 使用小程序同一账号及余额，不切回邮箱账号、不合并不同账号。
- 本次已有账号保留历史余额；其他新账号首次登录合计赠送5算力，微信/网页不能各送一次。
- 登录后可随时选择迁移小程序故事；不自动导入或覆盖原稿。

## 根因和修复

1. 新故事的 activeStoryId=-1，在开启统一章节时被传到 PublishingImagePack，后者对非正数 storyId 回退到旧图片画布。现在未保存的文字故事走已有 startBlankBody 入口，保存后打开章节书稿。
2. 微信主体关联正确，网页用户未保存小程序称呼，TopBar 无名回退为 G。云桥从当前 OPENID 对应的 user_accounts 读取本人 active profile（校验 wxOpenId），签名传回最多8字称呼；只在确认登录时更新微信类型账号，不改关联邮箱账号；缺失或同步失败不阻止登录。无名微信头像改为“微”。
3. 小程序 getOpenId 没有环境变量，Web SHIGUANG_COMPUTE_ENABLED 未开启，导致手机共享余额读取不可用。用户亲自保存 getOpenId 的既有连接密钥、正式站桥接地址和同步开关；本次发布启用服务端共享钱包。DevTools“我的”已真实返回15.00算力。
4. 历史账本为2026-10-24微信注册10算力+2026-10-26网页登录5算力，无消费。原记录不修改、不回收。两种首次赠送现在在同一个账户锁/MySQL事务里查两个历史前缀，串行/并发/先网页再微信都只发一次5算力。

## 证据

- 111项Web专项通过；新故事与跨端赠送测试先失败后通过。
- MySQL两个独立进程争抢不同赠送幂等键：1 appended、1 duplicate，余额5算力。独立临时数据库测试1项通过。
- 原生profile及桥接22项通过。
- 隔离源码 tsc、生产构建通过；build包含75项草稿安全验证。
- 生产115产物SHA-256校验，readyz=ready/mysql/required。
- 线上亲点“开始第一个故事”→“开始手写文稿”→可编辑空白章节，未触发AI，未写测试正文；生成空白故事#116留给用户使用。
- 用户重新微信登录后，网页“我的”真实显示岱/微信账号/15.00算力。
- 用户反馈找不到迁移入口，已从“头像→微信故事”打开 /wechat-import，真实显示本人岱、天才女友、壮可选；未替用户勾选或导入真实故事。
- 截图 /tmp/wechat-account-followup-20261102/{mini-wallet,new-story-writing,wechat-import-entry}.png。

## 发布与交接

- Web发布名 wechat-account-followup-20261102，源 /tmp/wechat-account-followup-20261102/src；基于 wechat-import-20261102，仅本次增量。manifest /opt/Drinking-Time/dist.release-wechat-account-followup-20261102.json，备份 /opt/Drinking-Time/dist.bak-wechat-account-followup-20261102。
- Web SHIGUANG_COMPUTE_ENABLED=true；保留已有登录/QR/故事导入/章节等配置。不要用旧manifest覆盖。
- 原生云 drinkingTimeBridge 提交12ce5173a77e92bc7079a75d9b95a287a4e8a54d，cloud1-d5ghzk30ve609f544；部署后下载全部JS逐文件比对通过。主仓3文件安全同步（验证旧内容一致后复制），部署树保留。
- 当前手机客户端仍是0.1.1102qr2体验版；本次未重新上传客户端。旧“首次赠送10”静态文案需要后续客户端版本统一为5；实际权威账本已按5执行。手机实际扣账仍非本次验收范围。
- 迁移入口已经可用，但在头像菜单内不够显眼；本次已打开供用户操作，未额外发布导航重设计。
