# 微信扫码登录与可选迁移（2026-11-02，接通中）

用户确认：六位码界面改微信扫码；登录后进入正常网页，身份为微信账号；小程序有故事时才询问是否迁移。本记录替代前一轮“登录即跳 /wechat-import”的交互说明。初始验证在本地完成；下面追加云端接通过程，尚未生成真实登录二维码。

## 云端接通进展

- 原生固定源码 `3bbd25af8a00819efab2382f55ff85983baa5149`，基于最新 `59ec053`。已通过标准部署脚本上传 `storyDesktopAccess` 完整独立包与 `drinkingTimeBridge`；2026-11-02 14:38 两个函数 Active。完整 TypeScript/1669 项检查通过。
- 部署前两个云函数已下载比对；部署后源码下载连续遇到 `ECONNRESET`，CLI 仍返回 exit 0，未计为下载验证成功。云控制台核对部署时间和 `wxacode.getUnlimited` 权限；下载后的源码摘要核对仍待完成。
- 用户手动保存 `storyDesktopAccess` 签名密钥；控制台确认三项环境变量及 20 秒超时已保存，版本配置为内部 `develop`。仅开启二维码能力，故事导入和权威读写未随之启用。密钥正确性仍须签名实请求验证。
- Web 发布源从 `c155d0bc` 隔离归档，仅复制 11 个扫码实现/测试文件，保留刚上线 Legnext 基线。62 项测试、类型和构建通过。115 份产物中仅 4 份变化，上传后全部校验摘要。
- 已发布兼容扫码的 Web 后端 `dist/index.js`，前端仍旧版本；`/readyz` 为 `ready/mysql/required`，生产 `.env`、依赖文件均未改变。回退备份为服务器 `/opt/Drinking-Time/dist.bak-wechat-qr-20261102`，暂存为 `/tmp/wechat-qr-web-20261102`。
- 用户已完成腾讯云二次验证，正配置出码 HTTPS 网关。新客户端上传、真实出码/扫码、网页入口切换仍待完成。3001 仍为不能登录的纯静态预览，没有新增业务 dev server。

执行证据：本机 `/tmp/wechat-qr-live-20261102/` 与 `/tmp/wechat-qr-web-release-20261102/`。其中私有密钥文件不入库、不展示，不将静态截图当作真实二维码。

## 实现

- 登录按钮向 create 请求 `presentation=qr`，显示服务端生成的本次小程序码与倒计时；扫码后提示微信确认，确认后复用原会话发放/账号解析。原六位码和配对API兼容保留，不叠加第二个微信登录入口。
- 确认令牌是112位随机值（28位大写十六进制），二维码scene只有令牌，没有浏览器L/V、微信身份或正文。数据库仅存带密钥摘要，过期/拒绝/重放/错误浏览器凭据均不能取得会话。
- 原生分包自动解析scene并preview，仍需手动确认；客户端不指定subject或userId。固定出码页面，版本只从云端配置读取，AppSecret不进入Web或浏览器。
- 微信登录回正常手机/电脑工作区，受控returnTo保留。在工作区按微信账号读取故事metadata，有未迁移版本才询问；空/已迁移/失败均不拦页面，关闭后当前标签页会话不重复问。迁移仍另存书稿并保留原稿。
- “我的”原先把所有无邮箱账号显示成访客，现将微信身份显示为“微信账号”。没有获取或伪造用户可见的微信号、昵称。
- 审查发现原生权威签名检查将传入的时钟函数直接减时间戳，造成时间窗判断失效；提取共用验签时修为取时钟值并校验有限数值，原故事接口测试保留。

## 验证

- Web扫码/登录/路由/迁移询问等9文件81项通过；改名修正macOS大小写解析冲突后，询问/路由19项复验通过。
- 原生扫码云端/确认页/旧登录/权威读写/导入38项通过，原生TypeScript通过。
- 临时MySQL跨仓综合测试1项通过，追加真实数据库扫码令牌preview、确认、错误浏览器拒绝、仅消费一次、同微信账号、确认后故事数仍为0，再验证手动导入与新版本另存。原生数据仍是虚构fixture，不是微信云端验收。
- Web类型及构建通过，包含76项草稿安全检查；临时交互预览清理后重建生产产物。保留他人修改，未使用主业务库写入虚构数据。
- 在主仓3000用临时虚构交互页渲染真实迁移询问组件：有故事弹窗、暂不迁移关闭、空故事/失败不弹窗均实点通过。预览不连接微信，文件已清理；截图 `outputs/wechat-import-20261102/optional-import-preview.jpg`。不把该截图当作正常账号或真实扫码验收。
- 两仓定向 `git diff --check` 通过，`pnpm feature:validate` 77卡通过，唯一主仓3000服务环境健康。原生 `workspace:check` 如实报告混合未提交修改及与2026-09-26旧快照不同，不能据此直接部署或推断当前云端状态。

## 发布前仍需完成

1. 从干净整合版本准备Web兼容后端、`drinkingTimeBridge`、`storyDesktopAccess`以及原生 `packages/web-login/pages/confirm`；根仓混合未提交修改不能直接上线。
2. 配置签名HTTPS `POST /v1/web-login/qr`，出码云函数新增wxacode权限和开关；设定对应已上传小程序包的版本。首页静态体验码不能替代本次动态登录码。
3. 先部署后端兼容和原生确认/出码、上传可处理scene的客户端，再验证真实扫码/身份/关闭/到期/重登；最后开启新前端。仅发布前端会提示扫码暂不可用。
4. 微信新账号故事空间未初始化、真机切换/识别、实际云图导入尚未完成。正式站仍保留原发布行为，本轮不声称可直接扫码。
5. 自动迁移询问当前依据 `loginMethod=wechat`。已绑定微信的原邮箱账号仍可手动进入“微信故事”，自动识别这种绑定身份尚未实现；不通过改写账号创建方式或合并账号来掩盖此限制。

<!-- CONTRACT -->
### 1.7.1 补充：扫码登录与可选迁移（2026-11-02，本地未部署）

- 新网页向 `POST /api/auth/wechat-scan/create` 传 `{presentation:"qr"}`。服务端生成独立112-bit确认令牌（28位大写十六进制），数据库只存带密钥摘要；返回 `{l,v,qrDataUrl,expiresAt,clientHint}`，不返回令牌明文。旧空正文请求仍返回六位码，原配对协议保留。
- `/web-login/confirm` 的 `code` 新增支持28位大写十六进制；可信微信主体、HMAC、持久nonce、限流、明确确认、120秒到期和仅原浏览器领取规则不变，V2测试向量不变。
- Web用已有authority HTTPS地址/密钥请求 `POST /v1/web-login/qr`，正文只有 `{code,expiresAt}`（毫秒）。签名采用POST/完整路径/时间戳/nonce/规范JSON。此路径不要求故事grant，仍使用同一持久nonce库。不得传入L/V。
- 云函数调用 `wxacode.getUnlimited`，页面固定 `packages/web-login/pages/confirm/index`，scene固定 `wl_<28位令牌>`（31字符）。版本由 `WEB_LOGIN_QR_ENV_VERSION=release|trial|develop` 决定，默认release，浏览器不能指定。release检查发布页面；trial/develop仍需上传正确客户端。
- 扫码只自动preview，显示浏览器信息后须人点击确认或拒绝。网页确认后进入正常工作区，再可选询问迁移；没有未迁移故事或读取失败时不拦阻工作区。
- Web需要 `WECHAT_SCAN_LOGIN_ENABLED=true`、`WECHAT_LOGIN_QR_ENABLED=true` 和 `SHIGUANG_STORY_AUTHORITY_URL/SECRET`。出码云函数需要 `WEB_LOGIN_QR_ENABLED=true`、`wxacode.getUnlimited`权限；确认云函数仍需 `WEB_LOGIN_CONFIRM_ENABLED=true`。导入开关独立。
- 没有配置时，新前端明确提示扫码不可用，不以固定体验码冒充登录码。先部署兼容新令牌的后端和原生确认云函数，再部署出码路由、上传正确小程序、真实验收，最后切换前端。
<!-- /CONTRACT -->

## 17:35 真实云出码诊断续接

HTTPS路由已建立，未签名401；共享签名密钥已由用户正确保存，合法请求验签和nonce通过。云SDK出码返回-501001，安全分类确认invalid access_token；显式指定AppID仍失败，不能据此声称未发布限制。

原生e1cfcbd准备固定微信服务端stable_token/getwxacodeunlimit适配，缓存token、合并并发、禁止强制刷新且日志不含原始凭据。21项专项通过。WECHAT_APP_ID已保存；用户没有现成AppSecret，正手动去微信后台取得，腾讯云WECHAT_APP_SECRET空白行已准备。官方后台/文档受浏览器站点策略阻止，不绕过。

Web仍只有兼容后端上线，前端未切；真实二维码、客户端上传和跨端扫码验证未完成。不要以配置截图或替身测试宣称登录已可用。

## 续验完成：真实二维码与网页登录

- 用户保存WECHAT_APP_SECRET后，签名出码200，图片头有效；未签名401。原生e1cfcbd部署成功。
- 生产.env新增SHIGUANG_STORY_AUTHORITY_URL/SECRET与WECHAT_LOGIN_QR_ENABLED，原配置备份远端/tmp/wechat-qr-web-20261102/env-before-qr-enable；ready/mysql/required通过。
- 独立验证页使用真实WechatCodeLogin组件与真实生产接口。DevTools二维码编译识别真实scene，看到Mac·Chrome，明确点击确认后浏览器自动进入/editing；拒绝后网页提示拒绝；过期码拒绝。没有故事写入或导入。真实测试微信账号进入空故事工作区，余额15.00，无新付费调用。
- 内部开发版0.1.1102qr上传成功，源码e1cfcbd，AppID wx86ae3e9d507ce52d。env_version仍develop；不能据此声称普通用户/真机/正式审核通过。
- Web新前端ececbb11-4d21-46ac-9cad-37bc068db53b已上线，原版本491ce1bd后端兼容基线保护通过。产物校验、ready检查通过；旧assets保留供回退。
- 证据/tmp/wechat-qr-live-20261102/{client-verified.json,qr-smoke-passed.json,client-upload.log,qr-login-workspace.jpg,qr-denied-web.jpg,expired-scene.jpg}。传输用的临时诊断会话均已超时；成功浏览器验证会话已通过正常退出登录清理。
- 原生云源码下载仍未逐文件核对；两仓混合工作不能整体提交/覆盖。原生独立工作树保留部署提交，后续收敛须先比较主仓他人工作。账号标签与可选故事迁移提示未包含在本次最小Web发布包，原稿没有自动迁移。

### 手机六位码反馈续修（未上传）

手机扫码后出现旧输入页，尚未确认是直接进入还是经首页手动入口。原生独立树补onShow入口scene读取、同scene去重、重新扫码状态清理、旧异步结果隔离；无效scene停留二维码错误状态。旧手动码协议保留并澄清文案。9项定向测试和TypeScript通过。浏览器操作当前无法连接现有IAB标签，真实跨端复验未完成，未上传本次修复，不能认定手机已修好。

## 真机再次反馈：旧包仍在运行

用户提供e5bbf36078d7456ffd150115c92d405e.jpg，标题“登录电脑”、旧六位码说明，与93e9907的“登录网页”及默认折叠旧码输入不一致。上传0.1.1102qr2日志成功，出码此前配置develop；实际手机版本尚未查明，不能断言缓存或热启动就是根因。请求用户在微信后台版本管理将0.1.1102qr2设为体验版，收到明确完成后才修改云端env_version=trial。微信官方后台此前受站点安全策略阻止，未换工具绕过。本轮无生产配置变化。

体验版切换：用户确认0.1.1102qr2已设为体验版并切回腾讯云后，storyDesktopAccess的WEB_LOGIN_QR_ENV_VERSION由develop改为trial，保存后读回trial确认。凭据/其他变量未改；配置截图/tmp/wechat-qr-live-20261102/qr-trial-config.png。旧二维码不自动改变版本，已在正式登录页重新生成，真机待验收。

出码界面检查补充：点击重新生成后先显示“正在生成登录二维码”，随后观察到同一tab已进入/editing；没有捕获新二维码显示或手机确认动作，可能复用了已有会话，不能将此视为trial真机登录成功。login-trial-qr.png实际为编辑区截图，勿作为二维码证据。
