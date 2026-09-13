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

## Supabase 托管登录修复（待测试站验收）

为绕过阿里云服务器无法访问 Google token 接口的问题，Google 入口改为由 Supabase 托管完成 Google 授权。浏览器收到 Supabase 返回的短期访问令牌后立即从地址栏清除令牌，再通过同源 POST 交给拾光后端；后端校验一次性 HttpOnly state，并调用 Supabase `/auth/v1/user` 核实已确认邮箱和 Google provider。

账号归属仍由拾光自己的 accountIdentity 和 MySQL 决定：已知邮箱进入原 userId，故事、素材和余额保持原归属；冲突或历史身份需要人工映射时不自动合并；新的 Google 邮箱默认要求此前已经领取邀请。手机 `/m` 发起的登录完成后返回 `/m`，其余返回路径不会透传。

代码验证覆盖授权地址、state Cookie、防伪回调、已确认 Google 身份、原账号映射、新邮箱邀请限制和手机返回路径。部署要求把 `https://test.drinkingtime.top/auth/supabase/callback**` 加入 Supabase Redirect URLs，并配置公开的项目 URL 与 publishable key。Supabase 仅保存认证用户目录；拾光故事和业务数据不会写入该项目。

## 托管登录发布与真实验收

已在 `berichmyfriend-prod` Supabase Auth 的 Redirect URLs 中新增 `https://test.drinkingtime.top/auth/supabase/callback**`，没有修改该项目的 Site URL。测试站设置 `SUPABASE_AUTH_URL`、publishable key 与 `GOOGLE_INVITE_REQUIRED=true`，只同步本次认证所需的六个源码文件；构建成功后重启 `drinking-time-mobile-staging`。部署备份位于服务器 `/root/dk-supabase-auth-20260913-180829`，包括修改前源码、`.env` 和完整 `dist`。公网服务返回 health `ok`，readiness 为 MySQL ready、authentication required。

第一次真实 Google 回调被账号安全闸门按设计拦下。只读核对测试 MySQL：已验证邮箱仅对应 `userId=1`，该账号有 1 个项目和 2 个故事，没有第二个候选身份；随后为这个唯一用户登记 email identity。第二次真实登录成功进入 `/editing`，页面显示余额 ¥20.00，故事菜单显示 2 个原有故事，其中当前故事正文与聊天内容可见。

最终验证：Supabase 托管授权、一次性 state、服务端令牌验证、拾光会话建立、原账号映射和原故事读取均通过。自动化共 40 项通过，功能账本、TypeScript 和生产构建通过。新的未受邀请 Google 邮箱由自动化测试确认返回 `invite_required`，本轮没有使用第二个真实 Google 账号手测；邮箱验证码真实发送、微信扫码和正式站发布仍不在本次范围。

## 测试站开放 Google 注册

用户明确要求测试站允许所有 Google 账号直接注册。仅将测试站 `/opt/Drinking-Time-mobile-staging/.env` 的 `GOOGLE_INVITE_REQUIRED` 改为 `false`，修改前备份为 `/opt/Drinking-Time-mobile-staging/.env.before-open-google-20260913-184229`；随后使用 `pm2 restart drinking-time-mobile-staging --update-env` 载入配置。重启后的 `/healthz` 返回 `ok`，`/readyz` 返回 MySQL ready、authentication required。正式站及代码默认值均未修改，未显式设为 `false` 的环境仍要求邀请。

使用第二个真实 Google 邮箱 `janezeng82@gmail.com` 完成授权和回调，成功进入 `/editing`。页面显示余额 ¥0.00、“当前账号 · 云端故事库”和“还没有故事”，没有显示原账号 `mountionzeng@gmail.com` 的 ¥20.00 或 2 个故事，证明新邮箱建立了独立账号且数据隔离。回归测试同时覆盖：邀请制环境继续拒绝未受邀新邮箱，开放环境为已确认的全新 Google 邮箱建立账号和会话；历史邮箱冲突及人工映射安全闸门保持不变。
