# 正式站连接中断与手机体验版入口更新

用户报告Chrome访问`https://www.drinkingtime.top/shiguang/`出现`ERR_CONNECTION_CLOSED`，随后要求将手机小程序入口替换为提供的拾光家忆体验版二维码。

## 根因和最小修复

- 生产ready/mysql/authentication required正常；服务器经正式域名访问落地页200，证书包含主域与www，2026-12-15到期。不是此次前端构建异常。
- Mac系统代理是ClashX 127.0.0.1:7890，DNS与TUN使用198.18虚拟地址。虚拟地址本身正常，强制真实IP仍失败，排除了仅DNS缓存的问题。
- 对单个本站请求抓取Clash控制API日志：域名请求命中`DomainKeyword(.)`，由`🐟 漏网之鱼`送往美国节点；TUN只保留服务器IP时命中`Match()`，仍送往同一节点。两条路径均在TLS握手时关闭；Clash内置DIRECT访问同一HTTPS网址正常（142ms）。
- 在当前活动配置`~/.config/clash/iKuuu_V2.yaml`仅增加首两条`DOMAIN-SUFFIX,drinkingtime.top,DIRECT`、`IP-CIDR,8.160.186.193/32,DIRECT,no-resolve`，热重载并保留原代理选择。备份`iKuuu_V2.yaml.bak.drinkingtime.20261112-connection`。其他配置经解析比较完全不变，没有关闭代理或降低TLS校验。
- 新规则下浏览器显式代理与普通TUN请求都返回正确页面/发布版本/ready。本机连接失败此前已出现，却仅凭ECS回环公网验证结束验收，是上次发布检查的遗漏；以后必须包含用户电脑的实际代理路径。若更换订阅配置或服务器IP，应检查这两个局部例外仍适用。
- 浏览器自动操作工具在读取Chrome时因当前URL限制结束，未绕过限制；实际连接证据来自同机HTTP客户端与同一系统代理路径，不宣称已完成Chrome交互复验。

## 手机入口

- 原样使用用户截图替换`client/public/shiguang/wechat-trial-qr.png`；370×450，未重绘、改码或生成二维码。
- 保持现有双端选择与微信体验版区域；中英文有效期由11月9日改为11月19日前，图片URL追加`?v=20261112`防止沿用旧缓存。
- 更新图片固有尺寸声明，保持原有二维码显示区域；系统Vision只读识别及边界检查结果见证据目录。不访问二维码链接、不添加体验者。
- 对应WechatEntry、ShiguangLandingPage、AppRouter三文件18项回归通过。系统Vision成功识别二维码，目标主机为open.weixin.qq.com，完整码位于现有展示区域内；未打开二维码链接。
- 类型检查、99张功能卡校验和生产构建通过；构建内77项草稿保护测试通过。隔离构建首次因共享node_modules缓存写入被沙箱阻止，获得所需缓存写入权限后原命令通过，无代码调整。
- 未做手机实际微信扫码验收，体验码权限及有效期以微信为准。发布结果完成后补记。

证据目录：`/Users/yuandai/Documents/Codex/2026-11-09/drinking-time-workflow/incident-20261112-connection/`。
