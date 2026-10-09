# 2026-10-09 正式站 Google 登录修复

## 已确认原因

- 浏览器错误页为 Google `400 redirect_uri_mismatch`；请求回调是 `https://www.drinkingtime.top/api/auth/google/callback`。
- Google Cloud 的 `drinking time` 客户端只登记裸域和测试站回调，没有 www 正式域名。
- 正式 `.env` 缺少 Supabase 两项配置，因此代码静默选择直连；测试站已配置托管登录。
- 正式服务器访问 `oauth2.googleapis.com/token` 12 秒超时；访问已有 Supabase 项目返回 HTTP 401，TLS/网络可达。只修 Google 白名单仍不能完成登录。
- Supabase 项目 `yvrsjzbgoqpffbgnhkyq` 的回调白名单只有另一产品及测试站，没有正式站。Site URL 属于另一产品，不能改写它。
- Supabase 实际使用另一个既有 Google 客户端（ID 后缀 `0qen81ao1ci272jc28n4p7tk8377ins4`），授权范围只有 `email profile`；不增加 Google API 权限。控制台显示项目处于测试状态，不能仅以入口跳转成功宣称所有账号已验收。

## 修复与不变约束

- 正式部署默认托管 Google，明确 `GOOGLE_AUTH_PROVIDER=supabase`；任何缺失配置均拒绝发起授权，不能静默改走直连。本地兼容直连，生产直连需要明确设置 `direct`。
- APP_ORIGIN 在正式环境必须为固定 HTTPS origin，不接受请求头替代；诊断端点显示实际应用回调及 Google 上游回调，不暴露密钥。
- 已保存白名单：`https://www.drinkingtime.top/auth/supabase/callback?state=*`。不改变已有白名单、Site URL 或其他产品的客户端配置。
- `GOOGLE_INVITE_REQUIRED` 正式实际值为 false，本次保持。账号身份映射、冲突人工处理、故事、余额与零余额登录语义保持。
- `pnpm auth:check-google` 检查配置、实际授权入口、状态 Cookie、Supabase → Google 的重定向；已接入 `scripts/update-prod.sh` 成功门槛。它不冒充真实用户登录，外部白名单和账号会话仍须浏览器验收。

## 已完成验证

- 修改前 HTTP 回归明确复现：生产缺失托管配置仍 302 到直连；诊断接口返回直连回调而真实入口使用托管回调。
- 6 个认证/账号测试文件共 88 项通过，覆盖已有账号、新账号独立身份、邀请门槛、未确认邮箱、state 防伪和错误配置；测试使用本地隔离持久化，无生产数据库连接。
- `pnpm check` 通过。最小后端基于正式源码 `9ceba9c` 构建成功；不包含本地尚未发布的计费改动。
- 服务器私有备份 `/root/drinking-time-google-login-20261009/before.tgz` 已备份 `.env`、后端构建及涉及的原源码；候选包已启用；SHA-256 为 `395234704b0ed9b2fd426734c1a4436381f4c80d9d1a366dd3e123a1de5e46c5`。

## 上线与真实登录状态

用户明确确认两项操作后，已保存正式站 Supabase 回调；使用独占部署锁、原文件逐字节校验、私有备份和自动回滚步骤，启用最小后端补丁及托管配置，仅重启 `drinking-time`。正式 `/readyz` 返回 MySQL ready / authentication required；服务器端和本机公网 `pnpm auth:check-google` 均通过。

浏览器从正式 `/login` 点击 Google，选取现有账号，成功返回 `/editing`；刷新后仍保持登录。只读核验 Google 身份绑定到原 `userId=1`、原角色保持，用户总数 4、故事总数 1 不变。未运行真实付费调用，也未导入本机资料。另一真实账号本轮未手测，独立账号与邀请门槛由回归测试覆盖。

另经正式库只读事务发现 4 个用户、1 个故事，email/google identity 均为 0；三个有邮箱的历史用户（1、1095、1103）均未登记新版身份。它们各自原 email 唯一、`openId=email:<原邮箱>` 完全相等，三个账号均无故事；无邮箱用户的故事不作归属推断。全局自动关联开关未启用，保持不变。

私有脚本 `/root/drinking-time-google-login-20261009/repair-legacy.mjs` 的 dry-run 已通过。仅在单独人工批准后，为上述三个账号把原邮箱登记回原 userId，不新增用户、不改角色、不合并账号或搬移数据。提交时再次加锁核验所有前置条件，并保留插入行 id 的私有审计；用户确认后已在事务中执行，插入 email identity 行 1、2、3，分别对应 userId 1、1095、1103；真实 Google 登录随后正常登记原 userId 1 的 Google identity。私有审计保留全部插入 id。

回滚：恢复私有备份中的 `.env`、原后端构建与源码，并重启 `drinking-time`；不运行数据库迁移或测试，不修改用户业务数据。回滚会恢复原有登录故障，仅用于本次补丁引发新的运行故障时。

## 后续发布约束

保留 `GOOGLE_AUTH_PROVIDER=supabase`、`SUPABASE_AUTH_URL`、`SUPABASE_AUTH_PUBLISHABLE_KEY` 和 `APP_ORIGIN=https://www.drinkingtime.top`。更换域名或托管项目时先核对两段回调白名单；发布验收必须包括 `pnpm auth:check-google`，涉及认证配置变更还须完成真实浏览器登录。接口 configured=true 只代表本地配置完整，不能作为 Google 端白名单已登记的证明。
