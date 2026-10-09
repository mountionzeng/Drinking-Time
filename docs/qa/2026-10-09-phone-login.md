# 手机号验证码登录：实现与启用

状态：本地实现与真实 MySQL 已验收，真实短信和正式部署未验收。小程序扫码确认不在本次范围内。

## 用户入口

`/login` 新增「手机号登录」，兼容拾光与纳音主题。首版仅支持中国大陆 +86 手机号。
获取六位验证码后登录，未注册手机号会建立独立账号；不会根据手机号猜测或合并邮箱、Google、微信账号，不赠送额外算力。
原邮箱/Google 与微信短码入口保留。登录成功使用现有 30 天 HttpOnly Cookie 和会话版本；整页跳转销毁旧身份查询缓存，返回目标沿用现有白名单。

## 腾讯云短信配置

1. 开通腾讯云短信应用，准备有发送权限的服务端密钥、SdkAppId，以及已审核的签名和模板。
2. 模板只有一个变量（验证码），有效期写成固定文字「5 分钟」。例如：`您的登录验证码为{1}，5分钟内有效。如非本人操作，请忽略。` 实际文案以审核通过为准。
3. 服务端配置 `.env.example` 中 `TENCENT_SMS_SECRET_ID`、`TENCENT_SMS_SECRET_KEY`、`TENCENT_SMS_APP_ID`、`TENCENT_SMS_SIGN_NAME`（签名文字，非 ID）、`TENCENT_SMS_TEMPLATE_ID` 和地域（默认 `ap-guangzhou`）。密钥不要放入前端或 Git。
4. 配置独立随机 `PHONE_OTP_DIGEST_SECRET`，至少 32 字符；轮换会使尚未使用的旧验证码失效，不改变已有手机号身份。
5. 备份目标数据库，按已有发布流程执行 `0028_phone_login.sql` 迁移：新增验证码表、追加身份 provider；迁移不合并或改写用户数据。保持 `PHONE_LOGIN_ENABLED=false`，直至配置和迁移就绪。
6. 设置 `PHONE_LOGIN_ENABLED=true` 并重启应用。生产环境必须配置真实 `DATABASE_URL`。用本人手机号验收真实收信、首次注册、退出后再登录和旧账号内容隔离。不得在正式站开启模拟发送。

`GET /api/auth/phone/config` 仅返回配置完整性，不证明供应商已审核或数据库可连接。短信接口固定使用腾讯云 `SendSms` / `2021-01-11`；按官方 SDK 的 E.164 手机号与 `SendStatusSet` 结构核对返回。供应商接口参考：<https://cloud.tencent.com/document/api/382/55981>；字段参考：<https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/sms/v20210111/sms_models.ts>。

## 验证码与限流

- 有效期五分钟；只存 HMAC 摘要，绑定手机号和随机挑战 ID，五次错误后拒绝当前挑战。
- 同一号码只有一个当前挑战，重发替换旧挑战；供应商明确接受后才允许使用，超时/失败不激活，不自动重发付费短信。
- 发送限制：每号码 60 秒一次、24 小时最多 10 次；每 IP 每小时 20 次；全站 24 小时 500 次。窗口从首次请求计时；失败请求也占额度，以免故障期间反复收费。上线可按实际需求调整这些保守上限。
- 校验限制：每号码十分钟 20 次，每 IP 十分钟 60 次；限流持久化，MySQL 挑战校验持有行锁；本地替身使用持久化串行锁。
- 请求/校验接口受现有同源门禁保护；不向客户端或日志暴露验证码、手机号发送响应和供应商密钥。业务数据库仍保存规范手机号作为登录身份及挑战键。
- 开关关闭/配置缺失时，入口显示暂未开放，接口返回 503，不假发送。回退时关闭开关即可，保留新增表、身份及已有账号，不反向缩减枚举或删除数据。

## 验证证据

普通定向测试通过 **85 项**。后续建立一次性真实 MySQL 与受限测试账号，另外 **2 项**迁移与跨进程测试全部通过：

```sh
pnpm exec vitest run server/services/phoneLogin.test.ts server/_core/phoneLoginRoutes.test.ts server/_core/oauth.account.test.ts server/repositories/stateCompatibility.test.ts client/src/pages/LoginPage.test.tsx client/src/features/auth/views/AuthEntryPanel.test.tsx shared/loginReturnPath.test.ts server/services/accountIdentity.test.ts server/integration/phoneLogin.mysql.test.ts server/integration/migrationBaseline.mysql.test.ts
```

覆盖验证码错误/过期/重放/重发、并发单次消费、身份隔离、供应商拒绝/失败、持久化重载、同源门禁及完整 Cookie 签发/解析。短信通过 mock，不发生真实发送或费用。
测试曾捕获新账号无昵称时 token 被 SDK 拒绝的问题，统一会话建立函数已补默认显示名，保留会话签名与版本校验。

`pnpm check`、`pnpm build`、`pnpm migration:verify` 通过。功能账本由 `pnpm feature:validate` 验证。
在唯一主仓库 3000 服务中实点查看：三个登录入口、手机号表单、未配置提示和禁用按钮呈现正常；本地访客通过既有分享返回登录入口查看页面，未发送短信或建立真实手机号账号。

## 未完成的外部验收

- 已进入腾讯云短信控制台：当前主账号已企业认证，短信服务尚未开通。停在「同意短信服务协议 → 开始接入」，已请求当次明确确认。尚未接受协议或购买套餐。
- 未执行真实短信发送、供应商实收核对、真实手机号端到端登录。
- 真实 MySQL 两项测试已执行通过：从零应用29条迁移，独立进程竞争验证码仅一次成功，重启后拒绝重放，错误次数持久化及身份唯一约束生效。临时实例已关闭，使用的受限测试账号事先验证不能读取 mysql.user。
- 未执行正式库迁移或发布。手机号绑定已有账号、换号/找回、国际号码不在本次范围。

## 后续推进记录

只读查询正式站：运行版本 `004b3554`，工作树无已跟踪改动，服务端尚无 PHONE/TENCENT_SMS 配置。
补充 `pnpm auth:check-phone [origin]`：仅检查环境配置完整性及可选站点配置入口，打印缺失配置名称，不发送短信、不输出密钥。配置不齐时以非零退出，不把它当作发送成功证明。

按 ce-code-review 的正确性、测试、维护性、项目约束、agent入口、权限、接口、数据库迁移、可靠性和前端异步视角在主会话顺序审查。修复被拒重发仍消耗全站额度、前端网络请求无限等待、effect清理后迟到结果可能回填三个问题。全站额度现在仅在手机号限流通过后领取；真实发送失败仍计入额度。未发现需改变账号归属规则的代码问题。

腾讯云开通后待填：应用名称「拾光网页登录」，模板类型「验证码」，正文「您的登录验证码为{1}，5分钟内有效。如非本人操作，请忽略。」；签名须依据真实主体和审核材料确定，不编造资质或代签声明。
