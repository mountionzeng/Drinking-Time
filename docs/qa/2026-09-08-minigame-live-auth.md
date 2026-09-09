# 小游戏登录与旧故事接入：部署前记录

状态：**可编辑手机版工作区后端已部署测试站；2026-09-09 微信密钥已验证并安全配置，微信登录开关开启；新预览包上传仍待明确批准，真实微信登录未验收，不可正式发布**。下方早期记录按时间保留，以本节为当前状态。

## 2026-09-09 微信登录开通

- 用户提供AppSecret，明确要求直接验证、稍后自行更换，验证成功后要求继续。密钥与AppID配套性经微信官方stable_token接口验证成功；不记录密钥/token，不强制刷新令牌。
- 只读确认测试站仍为33b5cc8与11文件小游戏staged增量，MySQL/required健康。备份环境到 `/root/dk-before-wechat-591b3170c8e5de0f.env`（0600），仅在测试站.env写入密钥并将 `WECHAT_MINIGAME_LOGIN_ENABLED=true`，只重启 `drinking-time-mobile-staging`。未改正式站或业务数据。
- 开通后readyz正常；无效code请求返回401 invalid_credentials（不是原来的关闭503），匿名workspace返回401。没有使用真实wx.login code，不能称为真实微信登录成功或账号绑定完成。
- 本地 `build.mjs --live --wechat` 和 `smoke-live.mjs --wechat` 通过，38项专项测试通过；客户端包无AppSecret，未上传。本轮没有绕过此前的预览上传安全拒绝，仍须用户明确批准上传此包到 `wxd6aeb0bc3a031d39`。
- 用户应先用原邮箱登录并点“关联当前微信”，避免先独立微信登录生成另一个账号；如果身份已占用，系统拒绝自动合并。真正跨端故事验证留给用户扫码后执行。
- 密钥已出现在聊天，按用户意愿暂用联调；后续需重置并通过不回显输入更新服务器，不要发入仓库或客户端。

## 2026-09-09 分支整理复验

- 重新通过：认证/客户端专项 38 项、真实 Express/JWT/原路由与隔离本地持久化链 4 项、根与小游戏独立类型检查、mock 构建/冒烟及 live 微信构建/替身冒烟。初次沙箱禁止临时监听，按权限流程重跑后通过，不计为产品失败。
- 本轮未重跑全量；此前六项既有图像失败仍保留，不称全量绿。没有真实账号写入、AI 调用、部署或代码上传。
- 刷新 WECHAT-SYNC.md，清除已过时的“后端未接入/touristappid”状态；Git 同步和原生还原分别验收。
- 实现提交 `66e36f0`；main `de228089473f54eeacdd586404e0fbe8dd8449df` 的 21 个来源提交经无冲突预检后合入专属分支，合并提交 `fa5a1bb`。合并后再次通过专项38项、原手机版与真实小游戏工作区链23项、两套类型检查、live微信构建/替身冒烟。记忆日历等新入口仍需Canvas适配；不宣称原生同步完成，不部署或上传。

## 2026-09-08 20:10 手机版工作区增量（历史记录）

- 用户明确否决只读壳，要求手机版迁移加微信登录。本轮复用原 Web 正文 reducer/save runner、conversation recovery/turn runner 和后端已有受限 procedures；不自行实现另一套故事数据库、CAS 或结算规则。
- 增加原邮箱验证码入口、正文编辑/冲突保留与复制、历史聊天/整轮恢复、故事切换/新建、余额、出生资料、每日来信原话修改与持久幂等重读。出生资料须用户确认同意，测试没有调用真实 AI 或修改用户资料。
- 原纳音函数与五行 SVG 组件/字体复用，仍为两日纳音规则。Canvas 用三档聊天面板、原文/回复气泡；本机存储失败保留内存文本并停止新生成，退出/过期清理账号及来信，晚到请求和确认弹窗不得跨身份操作。
- 发现测试站新版手机版已更新到 `33b5cc8e10358e0a4d22f2a8ff1758a2b1a0bbf6`，此前八文件小游戏增量已不在源码中。核对后在该精确基线上应用11文件服务端/shared增量；保留当前分支，增量staged，未改Web资源、正式站、数据库schema或用户/故事/余额归属。
- 只读迁移预检20/20哈希顺序一致。邮件配置存在，未给真实邮箱发测试邮件。小游戏API和workspace开关开启，微信开关关闭。
- 部署备份 `/root/dk-workspace-staging-20260908`（env0600、原bundle、base及patch）。候选构建/语法校验后仅重启staging。Web资产SHA256前后一致：`32b7630fed736fee07700276da38b09270429b6d9e80d98c0cf656e13183d4bd`。
- 验证：小游戏专项38项通过；真实Express/JWT/原持久化链4项通过（包括来信归属及原话revision冲突）；root tsc与小游戏独立tsc、构建、入口替身冒烟通过。全量最终4302通过/6失败/45跳过；六项为已在未修改staging基线复现的图像工具失败。前次额外旁白失败单独和最后全量均通过。
- 主线程审查（非独立审计）：`/private/tmp/compound-engineering/ce-code-review/dk-workspace-20260908/review.md`。功能账本41卡校验通过，env:status确认唯一主仓3000，无worktree业务数据。
- 部署自动验收：readyz200/mysql、login200、匿名workspace401、未知workspace404、微信503wechat_not_enabled；部署后另核对Web无Origin POST仍403。未冒用用户账号验证写接口。
- CLI预览调用**未执行成功**：自动安全审查拒绝将代码包上传微信，要求用户明确批准本次上传及目标AppID。`/private/tmp/dk-mobile-workspace-preview.png`不能作为已生成证据，旧只读二维码不能替代。本轮不做绕过尝试。
- 尚非完整迁移：真机键盘/safe area/视觉与原账号跨端内容未验收；来信自动迎面、气息/相关故事完整布局、生日滚轮、双向新邮箱绑定/链接码/两个已有账号合并未完成。AppSecret缺失阻止真正微信登录，不能宣称“已100%还原”。

## 邮箱版测试部署（早期记录）

- 用户同意先邮箱试用；AppSecret 不再是本轮前置条件。`MINIGAME_API_ENABLED=true`，`WECHAT_MINIGAME_LOGIN_ENABLED=false`；live 默认隐藏微信操作。
- 基于测试站 `82600102fe4d3ab30ede7c9ab861dee3f4bc671e`，在 `codex/minigame-email-staging-20260908` 应用限定八文件服务端增量。原 Web 静态资源未重建、未覆盖；每日来信原版本保留。正式站未操作。
- 只读核对 20 条数据库 migration ledger 的哈希与顺序全部匹配；未迁移或合并用户、故事、余额。邮箱探针只使用虚构地址，正常触发认证限流计数。
- 部署前原 env（0600）和服务端 bundle 备份在 `/root/dk-email-staging-20260908`；服务端候选构建与语法检查通过后只重启 staging PM2。匿名 stories JSON401、关闭的微信入口 JSON503 已实测。
- 修正架构边界：账号事务回到 accountIdentity，故事只读适配回到 publishingPersistence，未添加第二个直接 db 账号 seam；原邮件/密码/发布正文函数行为不变。
- 验证：小游戏专项22、真实MySQL并发3、Web/账号/发布/架构回归86通过；根tsc、live构建、替身入口冒烟通过。全量初次4289通过/9失败；其中架构已修复，两项零密钥环境失败使用虚构测试JWT后通过。剩余六项图像工具失败在隔离的未修改staging基线快照同样复现（45通过/6失败），不宣称全量全绿。
- 主线程顺序检查记录：`/private/tmp/compound-engineering/ce-code-review/dk-email-20260908/review.md`。依项目要求未派独立代理；非独立安全审计。
- 新预览码目标：`/private/tmp/dk-email-minigame-preview.png`。只有生成成功才交付；不是正式发布码。用户以原邮箱密码验收故事列表与至少一篇当前发布正文；无密码先在网页验证码登录并设置。不声称微信关联、全部聊天历史或编辑功能完成。
- 预览CLI已成功生成上述二维码，包41.7KB。公网验收：readyz200/mysql/required、login200、匿名stories401、未知小游戏路由404、虚构邮箱密码401、Web无Origin POST403，均符合预期；功能账本41卡校验通过。测试站source增量仍staged，部署基线和回退产物已保存；后续集成不可直接覆盖该工作区。

## 17:30 后续进展（用户已批准测试站集成与配置）

- 测试站当前提交为 `82600102fe4d3ab30ede7c9ab861dee3f4bc671e`，`/readyz` 返回 ready/mysql/required；账号表和 users.sessionVersion 存在，未迁移任何用户数据。
- 已执行 staging-configure.mjs：配置小游戏 AppID 与独立随机签名密钥，`MINIGAME_API_ENABLED=false`。未重启、未部署，原 env 备份为 `/root/drinking-time-minigame-env-f105f6f910f79436.backup`（0600）。AppSecret 仍缺失。
- 本机 MySQL 一次性随机测试库实际通过 3 项测试：八路并发登录只有一个账号、竞争绑定只有一个身份所有者、绑定与首次登录竞争无孤儿用户；同项加入大小写不一致 openid 失败关闭。测试库已由 harness 清理，不涉及用户库。
- 新增 `enter-staging-secret.mjs`，由用户在终端不回显录入 AppSecret，通过 SSH stdin 写入测试站，不出现在聊天或 argv，不修改已启用配置、不重启服务。完成安全录入后再继续集成、安全审查、完整回归与二维码验收。

## 本次实现

- 独立 `/api/minigame` 命名空间，在 Web Origin 中间件之前挂载；不读取 Cookie、不继承开发 guest，不开放通用 tRPC。
- 一小时独立签名 Bearer，绑定小游戏 AppID、issuer/audience、userId、sessionVersion；版本必须精确一致。签名密钥与 Web JWT 分开。
- 原邮箱密码登录复用现有验证与限流，不新建邮箱账号、不赠送余额。微信登录使用服务端 code2Session 与事务身份解析。
- 十分钟内的登录会话 + 新 wx.login code + confirm=true 才可绑定当前微信。唯一身份约束冲突返回 merge_required；不静默重绑。
- 按服务端账号过滤旧故事，正文读取复用 publishingPersistence 当前版本/平台权威。无正文明确提示，不把结构化故事或演示文案当作发布正文。
- live 客户端会话仅驻内存、密码不落盘，退出/过期清理账号数据，晚到请求不能回填旧账号内容。未部署返回 HTML 时明确报错。

## 2026-09-08 只读现场检查

- 测试站 `/api/minigame/stories` 返回 HTTP 200、`text/html`（SPA），不是已部署接口。
- 远端目录 `/opt/Drinking-Time-mobile-staging` 当前是 `feat/mobile-daily-letter`，不是小游戏分支。存在三个 `.env.bak.*` 未跟踪备份，保持不动。
- 仅检查 `.env` 键是否存在，不读取或输出值：`WECHAT_MINIGAME_APP_ID`、`WECHAT_MINIGAME_APP_SECRET`、`MINIGAME_SESSION_SECRET` 缺失；`OTP_DIGEST_SECRET`、`DATABASE_URL` 存在（不代表配置有效或 schema 已验收）。
- 本机没有 `TEST_MYSQL_DATABASE_URL`，未执行真实 MySQL 并发绑定、唯一键竞争和回滚测试。

## 开通闸门

须按 aliyun-deploy-runbook 取得测试站部署及密钥配置明确批准。不能直接覆盖正在运行的每日来信分支。

1. 在一次性 MySQL 中验证新账号创建、重复/并发登录绑定、冲突回滚、无重复用户和无重复赠送；不得在用户库跑测试。
2. 与测试站当前分支协调集成并完成生产构建、Web 邮箱回归、数据库只读 schema 验证；不擅自切数据库、迁移或合并用户。
3. 服务器安全设置 `WECHAT_MINIGAME_APP_ID=wxd6aeb0bc3a031d39`、对应 `WECHAT_MINIGAME_APP_SECRET`、独立随机至少 32 字符的 `MINIGAME_SESSION_SECRET`，审核后设置 `MINIGAME_API_ENABLED=true`。AppSecret 不能进入仓库、客户端或聊天。
4. 微信后台 request 合法域名包含 `https://test.drinkingtime.top`。核验用户协议、隐私说明与邮箱采集告知。
5. 经批准部署测试站后，匿名 GET stories 应为 JSON 401，不得是 HTML、guest 或故事列表。
6. 构建 --live、重新生成预览二维码；用户亲自输入密码/授权微信。核对旧故事数量与至少一篇正文；退出后微信登录应回同账号。不能用替身测试代替这一步。

## 验证边界与未完成

隔离测试覆盖真实 Express/JSON/JWT/Origin 链，持久化与微信用替身。Canvas 构建入口测试也用替身。
根 tsc 不覆盖 minigame，需另跑其新增代码类型检查。没有真机截图、键盘安全区验收或跨端内容核验。
未实现邮箱验证码/注册的小游戏 UI、微信账号绑定新邮箱、链接码、已存在两账号合并、聊天/编辑、全功能与视觉还原。原 mock 仍保留用于布局开发。
生产部署前仍须正式安全审查和完整回归，不能以本记录替代发布批准。

## Post-Deploy Monitoring & Validation

执行人：本任务与用户联合验收。部署后第一轮登录立即检查，完成跨端故事核对后再扩大测试。
观察 `/api/minigame` 的 HTTP 401/409/429/503 比例与 /readyz；日志不得记录请求体、code、Bearer、密码或 AppSecret。
健康信号：未登录 401、登录返回短期 token、故事与网页一致、绑定后微信回原账号、别人的 storyId 为 404、Web 无 Origin POST 仍为 403。
失败信号：跨账号数据、HTML 200、503 持续增加或网页登录回归。立即停止扩大使用，禁用 MINIGAME_API_ENABLED 并按批准流程回退代码；不删除身份/故事，不盲目回滚数据库。
