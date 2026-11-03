# 微信登录后选择导入 · 2026-11-02

状态：本地实现和隔离验证完成，真实微信联通未验收，未部署、上传、提审或修改环境配置。

## 用户入口

- `/shiguang` → “开始制作”或“进入拾光制作网页” → 原“从哪里开始？”弹窗新增微信版区块；没有新建独立入口弹窗。
- 当前没有经过核实的有效小程序码，显示“小程序体验码待更新”。`WechatEntry.qrSrc` 可接入真实图片；不能把普通网站二维码、旧预览码或占位图片当作小程序码。
- `/login` 保持单个“使用微信登录”，与邮箱/Google 同级。继续使用既有六位码、小程序确认机制；二维码进入小程序不等于扫码登录网页。
- 确认并刷新账号后进入受保护 `/wechat-import`，默认不选择故事，可选择导入或跳过；“我的 → 微信故事”可稍后回来。邮箱登录行为保留。
- 一个微信故事新建一个网页故事及一个书稿，微信章名是 `heading1` 模块，正文/图片通过 `parentId` 归入对应章。没有恢复独立章节工作台。

## 身份、数据与权限

- 复用 `resolveWechatAccount`、既有微信登录凭据和持久 nonce。首次微信身份创建网页账号，重复身份复用；不按昵称或跨 AppID openid 猜关联。
- 原生 `confirmWebLogin` 在独立开关开启时，用可信 APPID/OPENID 解析已存在的 principal/space，准备 30 天 `kind=web-import` 绑定，不复制正文；准备失败不阻断登录。
- 网页列表仅使用当前登录 userId 的已验证微信 identity；浏览器不能指定 subject、grantId、openid 或 userId。HMAC `/v1/web-import` 的 list/read/media 每次复核授权和空间，读取当前已保存修订。
- 文本及复制图片来源必须允许 view/copy/export/ai/publish/forward，否则不能将限制带到不具备对应权限体系的网页稿中。图片下载前后和提交副本前再次核对授权、修订。
- sha256 的 64 字符 requestId 绑定微信主体、storyId、revisionId、version，复用 `commitChapterImport` 的真实事务。并发重试仅建一稿，网页修改不影响回执；源新修订新建网页稿，不覆盖任一旧稿。
- 云图片校验格式/像素/大小后写入 `chapterMediaStore`，正文使用每次校验登录与归属的稳定私有媒体 URL，不保存临时 URL。未导入成功的图片不会成为可读取的书稿资产。
- 原作者、接收来源、原修订说明、源章节/块 ID 保存在 `blocks.wechatImport`；原作者的修改说明不冒充网页编辑者的新说明。纯文本换行、空行、空章保留；无章节稿可为空稿。

## 验证证据

- `pnpm check` 通过。
- Web 定向 14 个文件 123 项通过：导入服务、媒体路由、returnPath、authority client、webLogin、OAuth 微信登录、签名、WechatCodeLogin、AuthEntryPanel、LoginPage、mobileReturnPath、导入页、landing、AppRouter。
- 原生 `npm run test:files -- tests/web-book-import.test.js tests/web-login-confirm.test.js tests/story-desktop-access.test.js`：33 项通过，包含来源图片限制、过期/损坏授权、签名重放、下载期间撤权、空故事列表。
- 跨仓真实 MySQL：`TEST_MYSQL_DATABASE_URL=mysql://root@127.0.0.1 WECHAT_NATIVE_REPO='/Users/yuandai/Documents/New project/shiguang-jiayi-hackathon' pnpm exec vitest run server/integration/wechatBookImport.mysql.test.ts`：1 项综合测试通过。harness 创建并清理 `drinking_time_test_*`，不碰业务库。原生数据是虚构 fixture，调用实际原生签名与导出代码；不是微信云端或真机验收。
- MySQL 验证并发身份唯一、原子书稿/回执、章标题与图片持久化、图片跨账号拒绝、保存后重试不覆盖、新修订另建。Vitest 本地仓储也使用自动临时 `LOCAL_PERSIST_PATH`，未向真实 `.webdev` 注入测试故事。
- `pnpm build` 通过，包含 75 项草稿安全回归；构建仍有既有大 chunk 和依赖注释告警。
- 主仓唯一 3000 浏览器实点：首页原弹窗第三个微信区块、单微信登录与邮箱并列、导入关闭说明及跳过入口可见。开发固定游客会跳过 `/login`，此次借受控分享返回路径显示真实 LoginPage，没有退出用户会话或创建分享。截图：`outputs/wechat-import-20261102/{entry,login,import-disabled}.jpg`。
- 主线程顺序审查覆盖身份和来源权限、接口边界、原子写入、图片授权、异步部分成功、既有能力回归；修复了复制图片自身权限漏验、分页旧行未更新导入状态及图片读取加载整份用户书稿的问题。

## 体验码核对

按用户要求询问“架构优化”对话 `01a0d148-ce57-7b50-a102-785f41f35cd8`，该对话以已有本地记录答复：0.1.1102 于 11 月 2 日约 06:44 上传，提交 51f677e；未确认已设为体验版，最后后台截图仍是 0.1.1032；对应新二维码未保存。旧 `phone-test-226f7cf/qr.jpg` 有效性未确认，未采用。

mp.weixin.qq.com 被浏览器站点安全策略阻止；没有绕过，也没有新生成二维码。需取得当前版本真实体验码及体验成员限制后才能补入。体验版不能默认宣称所有用户都能扫码进入。

## 后续联通所需条件（本轮未执行）

1. 原生部署 `drinkingTimeBridge`、`storyDesktopAccess`，按仓库脚本包含既有 storyBooks 依赖；开放签名 HTTPS `POST /v1/web-import`，验证云集合/查询索引和响应大小/执行时限。
2. 两个函数分别设置 `WEB_STORY_IMPORT_ENABLED=true`。保留原登录所需配置；网页版设置 `WECHAT_BOOK_IMPORT_ENABLED=true`、`CHAPTER_PACKAGE_ENABLED=true`，配置 `SHIGUANG_STORY_AUTHORITY_URL` 与匹配的 `SHIGUANG_STORY_AUTHORITY_SECRET`。不使用网页可见变量存密钥。
3. 新开关打开后需重新微信确认登录，才能准备新的导入绑定。未建立原生 principal 或 storyBooks 的账号目前会收到授权/读取失败，不会假装空列表；已初始化而无故事的账号返回真实空列表。旧无 chapters 结构须先在微信迁移，未在此隐式迁移。
4. 真微信验证全新账号、重复登录、手机切换小程序再返回、选择/跳过/稍后导入、图片与折叠标题、原稿未变、新修订另建。手机刷新或系统杀掉网页后六位登录码状态不持久化，需要重新发起。
5. 只支持当前已保存修订；微信本机图片/不允许复制的图片显示占位提示，底图、自由布局和分页不作像素级复刻。大图超过 2 MiB 或超过 100 张会明确失败；导入后编辑器中的付费图像/视频工具未做真实调用验收。
6. 此轮功能状态为 partial；真实云桥配置、真机导入和可扫码体验入口均不是本地测试可以替代的证据。

## 12:59 后续：用户提供临时体验码

用户上传“截屏2026-11-02 12.59.04.png”，并明确要求先放上、以后再更新。图片标注“拾光家忆体验版”“该二维码11月9日前有效”。已原样复制到 `client/public/shiguang/wechat-trial-qr.png`；不重新生成、不修改二维码像素。首页原设备选择弹窗通过CSS展示原图顶部二维码及完整静区，并以文字保留有效期，隐藏截图里的开发路径。后续更换不同尺寸图片时同时核对展示框比例与日期文案。

浏览器实点确认二维码及期限完整可见，截图 `outputs/wechat-import-20261102/entry-with-qr.jpg`；首页3项回归与账本通过。此次仅补展示，不部署/不改登录与导入服务、不声称已验证扫码权限或此码的版本号。此前“没有二维码”的记录已由这次用户供图补齐，真实微信导入验证仍未完成。

## 20:30 线上迁移流程完成及待清理项

- 用户确认新增公网路由后，cloud1 `/v1/web-import` 指向 storyDesktopAccess，完整路径透传，由函数校验HMAC/nonce和用户故事授权；无签名真实401。storyDesktopAccess与drinkingTimeBridge的WEB_STORY_IMPORT_ENABLED已开启，未修改凭据。
- 原生93e990785c600704e6cba6fd4ac0f87db1cc4107上传内部开发版0.1.1102qr2。确认页默认扫码；旧六位码需明确打开兼容按钮，onShow参数处理/去重/异步串请求隔离。9项原生专项和类型通过。四个源码/测试文件在主仓仍等于旧基线时安全同步；独立树保留提交供后续收敛。
- Web独立源码 `/tmp/wechat-import-release-20261102/src` 基于已上线QR版本，只带25项相关源码/测试增量；补齐shared/chapterStore来源类型后类型通过。48项隔离测试、75项草稿安全、跨仓真实MySQL1项通过。构建既有chunk告警保留。
- 发布wechat-import-20261102，115产物校验、ready/mysql/required通过。Web只新增WECHAT_BOOK_IMPORT_ENABLED=true，原配置保留。远端备份 `/opt/Drinking-Time/dist.bak-wechat-import-20261102`，发布元数据 `/opt/Drinking-Time/dist.release-wechat-import-20261102.json`，旧assets保留。
- 真实生产Web二维码→DevTools本人确认→正常编辑区→有故事迁移询问通过；暂不迁移后继续工作区、账号显示微信账号、我的→微信故事返回本人目录通过。未选择前无故事写入。
- 仅选已有“验收纸船1029虚构故事”版本11，成功生成网页故事#115；打开核对“纸船与灯塔验收”折叠标题和两段虚构正文，源小程序稿未改。未调用付费AI。
- 清理：已点击#115删除（实际mutation为memorySpace.trash，可恢复），随后IAB CDP失去响应，getJsDialog无结果。电脑工具禁止操作Codex应用，已请求用户确认回收弹窗；尚不能声称清理完成。
- 证据：outputs/wechat-import-20261102/live-import-prompt.png，/tmp/wechat-qr-live-20261102/{qr2-workspace.png,qr2-default-entry.png,qr2-denied.png,import-catalog-before.png,imported-fictional-book.png}。
- 真机首次/重复扫码、全新真实微信、云图片完整迁移仍需验收。当前小程序env_version=develop，不宣称普通用户正式版已发布。

2026-11-02 清理回执：用户明确回复“已清理”，确认处理本次虚构网页测试副本#115的回收提示。浏览器连接未恢复，未独立复核状态；小程序源稿未改。
