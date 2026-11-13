# 邮箱真实流程验收（进行中）

2026-11-13，用户授权选择本地或正式账号上线验收，随后明确批准私有发布包上传至项目既有 OSS releases/mailbox-20261113/ 并继续部署。所有新增测试内容均为虚构，不发送给外部朋友。

## 实际操作

- agent-browser 独立会话访问主仓3000，真实通过新故事→开始手写文稿，新建【临时验收】邮箱纸船1113（本地1219，章节13）。输入一段可分享文字和一段标明不能发送的私密文字。没有修改原有launch video。
- 邮箱→发送故事→选本测试稿→选择部分内容，两段可分别勾选；只选公开段落后显示已选择1项、1份章节，接口200。切换我的微信小程序显示尚未启用，准备二维码按钮禁用，与用户截图一致。
- 当前本机账号没有已连接朋友；不能把本机固定身份当作双账号验收。正式站独立窗口可加载真实微信/邮箱登录页，尚未登录。
- 界面对话“打开邮箱”首次实际请求模型，供应商401/500，返回outcome unknown。未重复该模型调用；不能将该次费用声称为0。未购买图片/音乐/视频。
- 修复：精确“打开邮箱/请帮我打开故事邮箱/Open the mailbox”等导航免模型，仍调用统一归属校验及动作实现。否定、引用、条件、复合指令继续原规划路径，发送仍需确认。新测试修复前4失败；修复后74相关回归通过。
- 开发热更新期间一次回复200但面板未出现；暂时诊断日志在稳定页面证明回调scope一致且面板可打开，日志已移除。仍需冷启动固定故事地址重测，不能以接口200代替动作。
- 正式库41条迁移哈希/时间/顺序匹配。实际92表预检发现shots.status原有错误枚举produ\\n  ction_ready；不触及。boolean/tinyint(1)及users.openId唯一索引名称差异为等价表达。尚未执行生产迁移。
- 两个云函数已下载留档。drinkingTimeBridge仅差邮箱增量；storyDesktopAccess打包含storyBooks依赖，与本地存在差异，不能整包覆盖。另一原生会话仍占开发工具验收朗读，未改变其包/云函数/配置。

## 证据与待办

证据目录/tmp/mailbox-live-20261113，含local-part-selection.png、navigation-before.log、navigation-after.log、production-inventory.txt、drift-details.log、cloud-before、release-review.md。当前主仓未提交森林测试有Duplicate identifier regionInstruction，故主仓全类型检查失败；发布应在固定提交排除其他未提交代码后复检。

待完成：固定候选构建、生产备份/迁移/发布、真实双账号收发及更新/停止联系、小程序本人扫码接收/好友观看/媒体/撤销，最后正常软删除测试1219及其新增内容。尚不宣称已上线或端到端通过。

## 20:28 网页发布完成

- db3a3585固定源码发布，前端bd8eccca-eff0-4fb9-aa86-e3d20e07e62c；281资源哈希验证，正式域名ready/mysql/required通过，未登录邮箱接口401。
- 完整MySQL备份 /opt/Drinking-Time/backups/mailbox-20261113/drinking-time-20261113-202814.sql，随后0041/0042执行成功，账本43项一致，新建5表部署时为空。旧shots枚举异常未改；旧账号/余额/故事未迁移。
- 回滚副本dist.bak-mailbox-20261113；manifest dist.release-mailbox-20261113.json。env/package/lock哈希不变，微信接收开关仍关闭。
- 发布候选类型及构建通过，源码不包含其他会话未提交更改。主仓frameRegionReview热重启仍反复打断本地浏览器，故不把间歇截图当作完整验收。
- 真实账号登录与双账号流程仍待验收；原生云函数/客户端未部署。

## 20:34 清理与原生待批准

- 本地测试故事1219通过故事库专属删除按钮→确认移入回收站清理；再次读取该删除按钮计数0。未永久删除历史，独立本地浏览器会话已关闭。
- 正式站独立会话mailbox-prod-test-20261113停在登录页，微信登录码成功生成；用户本人确认尚未完成，码已过期，待用户准备好刷新。没有导出或伪造登录凭据。
- 原生云端候选在/tmp/mailbox-live-20261113/native-cloud-src，提交015ed242，源于891902e且包含main f53dbfe。只为发布冻结storyBooks/core/access/copyAssets为已下载线上字节，未修改其他开发工作树。标准打包后storyDesktopAccess对线上仅modules/storyDesktopAccess/index.js及webLoginQr.js不同；drinkingTimeBridge仅index.js和新增mailbox.js。10项专项通过，未部署。
- 原生客户端对上次交付35e025c仅app.json、me.wxml及独立web-mailbox子包4文件不同；未上传，没有包含另一对话未交付的Logo/音频改动。
- 自动审批第一次拦截OSS上传后，用户明确批准具体私有目录，网页发布完成。第二次拦截原生双函数发布准备，要求单独明确授权；已完成纯本地候选/差异后向用户询问，尚待回复。没有绕过审批执行云函数变更。
