# 拾光登录页测试站发布与 Google 验证

2026-09-13，用户确认发布到 `https://test.drinkingtime.top`，不发布正式站。

## 发布内容

登录页改为拾光品牌，保留手写字、饮品动画、背景与日期农历；移除宜忌、生日和留言表单。邮箱视图支持 Google 入口和现有邮箱验证码 API，配对码入口折叠。微信视图明确显示尚未开通，扫码授权后选择微信端已有故事仍未实现。

仅更新四个前端文件：LoginPage、AuthEntryPanel、DailyDrinkHero 与品牌字体子集。字体保留旧字形并增加拾/光，为 14.87 KB。保留测试站 /welcome 的既有 Google 入口。

测试站源码基线为 33b5cc8 加既有微信/Google 增量；在该基线上构建，没有用本地较新整包覆盖。备份在服务器 `/root/dk-login-layout-20260913`，包含 `source-before.tgz` 和 `public-before`。部署先校验原文件哈希、取得专用锁，构建到单独目录，复制新哈希资源后原子替换 index.html。旧资源保留供已打开页面继续使用。

未重启 PM2、未改变服务器配置或数据库、未覆盖后端。发布前后 `dist/index.js` SHA-256 均为 `741da1a59e09a44f51d17a4ff9fb0b33bc46dbbd5cef15d4f727bd10b18f4436`。
新 `dist/public/index.html` SHA-256 为 `e5b0889d22d6d6b957cb6ee2826f59abf8a24b6f5d5346efc9b79dc787357393`。

## 证据与结果

- 登录/路由/品牌字体定向测试 17 项通过，TypeScript 通过，测试站基线 Vite 构建通过。
- 公网 /healthz 与 /readyz 通过，后者为 mysql / authentication required。
- 浏览器访问新 /login，确认拾光手写字、茶杯、背景、农历日期与邮箱登录表单。
- Google config 返回 configured=true，callback 为测试站 HTTPS 路径。
- 实际点击 Google 登录，进入 Google 账号选择界面，选择当前已有登录账号后返回 `/login?error=oauth_failed`，页面显示登录失败。
- 服务端错误摘要为 `AxiosError: connect ETIMEDOUT 173.194.43.95:443`，hostname 为 `oauth2.googleapis.com`。只读取脱敏错误类型、主机和状态，未导出凭据或授权码。
- 服务器直接访问 Google token HTTPS 接口也连接超时，确认回调失败位于服务器到 Google 的出站连接。

结论：登录页已发布，Google 登录未成功。需先解决测试站到 Google 令牌接口的网络连通性，再完成授权回调与会话建立验收。未更改网络、代理或密钥设置；邮件验证码真实发送、微信扫码及账号间数据映射未在本轮验收。
