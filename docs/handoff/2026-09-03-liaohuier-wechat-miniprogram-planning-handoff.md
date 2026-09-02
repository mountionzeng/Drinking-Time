---
date: 2026-09-03
topic: liaohuier-wechat-miniprogram-planning
status: research-complete-plan-not-written
target_plan: docs/plans/2026-09-03-001-feat-liaohuier-wechat-workspace-plan.md
---

# 交接：“聊会儿”微信原生小程序实施计划

## 一句话任务

基于已经确认的需求，继续完成一份可执行的 Deep 技术计划：让用户在微信原生小程序中创建或进入与网页端相同的“聊会儿”账号，查看、新建和切换自己的 Story，继续同一条“聊聊”历史，编辑并安全保存权威正文，同时查看余额和每次调用费用；手机保存后电脑可以继续。

当前只写计划，不实现代码、不合并分支、不部署、不迁移数据。

---

## 一、权威产品来源

唯一产品来源：

- `docs/brainstorms/2026-09-02-liaohuier-wechat-miniprogram-requirements.md`

这份需求已经明确：

- 产品名称和语境只能是“聊会儿”。
- 新用户可以创建统一账号；已有用户可以验证并进入电脑端同一账号。
- 小程序、手机 Web 和电脑 Web 共用同一 `userId`、Story、聊天、正文和余额权威，不建小程序专用业务库。
- 用户可以查看、新建和切换 Story。
- “聊聊”复用当前 Story 已有历史，完整一问一答整轮落库；结果未知时不能盲目重调模型或重复扣费。
- 正文保存使用版本冲突保护；冲突时同时保留本机和服务端文本，不能静默覆盖。
- 显示余额和每次付费调用金额；余额不足只阻止新的付费调用，不阻止查看 Story 或编辑正文，并提示联系负责人续充。
- 第一阶段依赖网络，不做离线编辑或实时协同。

明确排除：

- “拾光”家庭人物传记、亲属投稿、老人确认、纪念册等方向。
- 图片、素材、分镜、时间线、视频、数字人和完整桌面工作台。
- 微信支付、支付宝、银行卡、订阅和退款。
- 多人实时编辑、光标同步、CRDT 和离线写队列。

不要重新讨论或改变上述 WHAT；新任务只负责规划 HOW。

---

## 二、旧小程序成果：只能复用技术骨架

旧计划和交接：

- `docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md`
- `docs/handoff/2026-09-02-wechat-miniprogram-test-shell-execution-handoff.md`

已合入的测试壳层实现：

- 提交：`2ca35f7`
- 合并：PR #7，当前 `main@3b578c5`
- 47 个文件全部位于 `miniprogram/**`
- 独立 TypeScript 检查通过；Vitest 144 个用例通过
- 未完成微信开发者工具人工可视验收，不能把它算成新需求的 UI 验收

原分支与 worktree 已在合并后按仓库规则删除。后续从最新 `main` 新建工作分支，直接复用其中的技术骨架；不要恢复或重新合并旧分支。

值得复用的部分：

- 官方原生 TypeScript 工程结构。
- `src/core/**` 的纯 TypeScript 状态机。
- `src/services/transport.ts`、mock transport 和 storage 适配边界。
- 聊天 unknown 不等于 failed、正文 CAS、恢复作用域隔离、mock 状态常驻标识。
- 独立 `miniprogram/tsconfig.json`、`miniprogram/vitest.config.ts` 和 Secret 扫描。

必须替换或扩展的部分：

- 所有“拾光”、家庭传记和人物纪念文案、信息架构与视觉语境。
- 旧壳层“只打开已有 Story”的产品限制；新需求必须支持最小 Story 创建。
- 旧测试中明确禁止 Story 创建入口的断言。
- 只含 start/privacy/workspace 的页面结构；新计划需覆盖账号状态、Story 列表/创建/切换、聊天、正文、余额和费用。
- 原生 `disabled` 按钮不能同时承担点击弹 toast；规划时统一为“真正禁用 + 邻近可读说明”，或改成明确可点击的信息按钮，不能要求同一控件两种相反行为。

新计划应明确：它在产品定位上取代旧 002 计划，但保留旧计划、提交和功能卡历史，不覆盖或删除历史证据。

---

## 三、仓库和并行工作约束

主仓当前分支：`main@3b578c5`（PR #7 已合并并与 `origin/main` 同步）。

2026-09-03 断网后复核：

- `docs/plans/2026-09-03-001-feat-liaohuier-wechat-workspace-plan.md` 尚未创建，没有半成品。
- 当前无任何 dev server。
- 主仓 `.webdev/local-persist.json`、prompt lineage 和 edit snapshot 数据仍在；不要写入或清理。
- 当前只有主仓一个 worktree；旧小程序与移动端 staging 的本地 worktree、分支均已删除。
- 主仓工作区在本交接出现前是干净的；统一账号、移动 Web 与小程序测试壳层均已提交并随 PR #7 合入。

必须遵守 `AGENTS.md`：

- 只有主仓可以运行固定 3000 的 dev server；worktree 只改代码。
- 规划阶段不启动服务。
- 开工先运行 `pnpm env:status`。
- 不使用 `git reset --hard`、`git checkout -- <path>`、`git clean` 或 `git add -A` 处理他人改动。
- 跨分支合并只有一个 owner；合并后才删除 worktree 和分支。

实时协调权威：`docs/handoff/SESSION-BOARD.md`。

账号线已经收工，下面这些文件不再被旧会话占用；新实施任务触达前仍须重新在 `SESSION-BOARD` 登记：

- `server/_core/env.ts`
- `server/_core/oauth.ts`
- `server/_core/sdk.ts`
- `server/_core/context.ts`
- `server/_core/productionReadiness.ts`
- `server/db.ts`
- `drizzle/schema.ts`
- `drizzle/migrations/**`
- `drizzle/meta/**`
- `server/services/accountIdentity.ts`
- `server/services/accountSecurity.ts`
- `server/services/computeBilling.ts`
- `server/services/computeLedger.ts`
- `docs/features/feature-ledger.json`
- `docs/handoff/SESSION-BOARD.md`

新计划可以列出这些未来文件，但执行必须等账号 Agent 提交、释放所有权并由新会话重新登记。规划任务本身只新增本交接和最终计划文档。

---

## 四、功能账本边界

相关功能卡：

- `wechat-miniprogram-workspace`：`planned`。当前只有已合入 `main` 的 U1–U3 mock 壳层，没有真实微信登录、邮箱绑定、服务端适配、真机、跨端、合法域名、内容安全或发布证据。
- `account-compute-gift-payments`：`observing`。邮箱验证码/密码、身份映射和算力账本基础已合入 `main`；真实测试库迁移、普通用户入口、微信身份和支付仍是后续阶段。
- `family-biography-wechat-text`：`planned`。这是独立的“拾光”家庭人物传记方向，必须保留，不得合并、替换或改名。
- `mobile-cross-device-chat-document`：现有手机 Web 聊天与正文合同的权威能力，状态尚不足以证明正式发布。

不要整文件覆写 `docs/features/feature-ledger.json`。计划中应要求未来只由当前唯一 owner 做最小、合并友好的卡片更新，并运行 `pnpm feature:validate`。只有 mock、计划或开发者工具截图时不能把功能标为 `working`。

---

## 五、统一账号与数据迁移前置

账号线已经合入 `main`、但尚未部署到测试站的部分：

- 邮箱 OTP、密码设置/修改/找回、`sessionVersion` 撤销和 HTTP 端点已经本地实现，尚未部署。
- `OTP_DIGEST_SECRET` 是生产部署硬前置；缺失时 readiness 失败关闭。
- `ACCOUNT_AUTO_IDENTITY_RESOLUTION` 保持 `false`。
- 余额、预占、结算和 append-only 账本底层服务已本地实现，但尚无面向普通用户的余额/消费读取接口。

只读盘点和迁移文档：

- `docs/qa/account-migration-inventory-all-sources.md`
- `docs/qa/account-migration-conflict-report.md`
- `docs/qa/account-migration-cutover-rollback-plan.md`

保守迁移原则：

- 旧库 user 11 与本地 Guest 48 都是无邮箱、持有内容的主体，没有证据证明二者相同，也没有证据证明属于负责人账号；分别迁入两个独立“待认领”主体，不能自动绑定。
- `mountionzeng@gmail.com` 在 legacy 与 staging 的两条身份映射到一个新的统一账号 ID，不沿用任一来源碰巧相同的数值 ID。
- 上述负责人账号两侧各自的项目都应保留并汇入新统一账号，不做二选一删减。
- 两个 QQ 邮箱账号应独立迁入，保持原所有权，不并入负责人账号；邮箱重新验证前不自动激活。
- 旧库 29 条 edit snapshot 全部有归属、零孤儿：user 11 为 18 条、user 1 为 10 条、user 1095 为 1 条；外键零悬挂。
- 旧库已过期的明文 OTP 和旧 access session 不迁移。
- 新合并库必须显式固定 `utf8mb4` 排序规则，不能继承来源库不一致的默认值。
- 三来源目前都没有正式 credit/billing/gift-card 账务历史；账号合并必须在产生正式账本条目之前完成。
- 切库和回滚两个方向都必须撤销旧 session；有切换后新写入时不能只改回 `DATABASE_URL`。

尚未完成：

- 本地来源最终冻结和重取哈希。
- 新合并库创建、导入器、验收脚本、恢复演练和真实切换。
- 手机与电脑以同一账号登录新库后的真实验证。

因此真实微信绑定和 live 小程序不得抢跑。建议计划前置顺序：账号身份与新合并库切换完成并通过双设备验证，然后接微信身份，最后接 live workspace。

---

## 六、已完成的仓库研究

技术栈：Node `>=24.18 <25`、pnpm 10.18.1、TypeScript 5.9.3、React 19.2、Vite 7.1、tRPC 11.6、Express 4.21、Drizzle 0.44、mysql2 3.15、Vitest 2.1。根检查不覆盖 `miniprogram/**`，小程序必须保留自己的 TypeScript/Vitest 门禁。

### Story

- `server/db.ts:listUserStories(userId)` 的本地和 MySQL 路径都按 owner 过滤，并按 `updatedAt DESC` 返回。
- `server/routers/storyAgent.ts:storyList` 已暴露列表。
- `storyAgent.storyUpsert` 可以 title-only 创建，但它同时承担复杂整包更新，且“传入不存在 id”会落入 create；不应直接暴露给小程序。
- 新计划应引入明确的最小 `createStory` 应用合同，只接收开始创作所需信息，不接收客户端 `userId` 或伪造 owner。
- 最近编辑排序要定义稳定次级排序；当前仅 `updatedAt DESC`，时间并列可能不稳定。

### 聊天

- 请求哈希权威：`shared/promptLineage.ts:computeStoryConversationTurnRequestHash`。
- 服务权威：`server/services/storyConversation.ts`。
- Web route：`server/routers/promptLineage.ts` 的移动 turn 生成、状态、append 和 list。
- Web 恢复语义：`client/src/features/mobileWorkspace/useMobileConversation.ts`。
- 必须保留 `userId + storyId + clientTurnId + requestHash` 整轮幂等；结果未知先查询原操作，不创建第二次生成。
- 消息稳定排序不应依赖客户端时钟或 id 字典序；计划应要求服务端 sequence/cursor 或等价的权威顺序合同。
- `storyConversation` 的两条真实 MySQL 测试仍受远端 SUPER 权限和跨城 120 秒超时限制，不能写成已经通过。

### 正文

- Web route：`server/routers/publishingDraft.ts:readBody/saveBody`。
- 服务权威：`server/services/publishingPersistence.ts`。
- 保存必须绑定 Story、当前 version、platform 和 `baseBodyRevision`，使用 CAS；冲突返回最新服务端文档。
- Web 恢复参考：`client/src/features/mobileWorkspace/useMobileDocument.ts` 与 `mobileDocumentStore.ts`。
- 小程序应复用状态合同，不复制 React、DOM 或 `localStorage` 实现。

### 余额与费用

- `server/services/computeLedger.ts:getAccountBalance` 已提供余额权威。
- `server/db.ts:listCreditLedgerEntries` 按用户返回账本条目。
- `server/services/computeBilling.ts` 与 `computeLedger.ts` 提供预占、结算和余额不足保护。
- 当前缺口是普通用户可读取的窄余额/最近费用 API。
- 小程序显示的每次金额必须来自 settled ledger，不用客户端估算冒充实际扣费。

### 认证边界

- 当前 Web `server/_core/context.ts` 主要从 Cookie 建立用户上下文。
- 新计划应使用独立的小程序 Bearer route family，解析成 transport-neutral principal，再调用同一应用服务。
- 不得为了小程序全局放宽 Web Cookie、Origin 或 CSRF 边界；Cookie-only、Guest、客户端 AppID header 或请求体 `userId` 都不能证明小程序身份。

---

## 七、已完成的微信官方与安全研究

2026-09-03 网络恢复后，一位研究 Agent 成功重新打开了微信官方文档：未发现 `wx.login` 或 `code2Session` 的弃用/停服提示。部分具体 OpenAPI URL 会跳到接口列表，因此实施前和提审前仍要重新核对参数、错误码和变更公告。

关键官方结论：

- `wx.login` 的临时 code 官方说明有效期为 5 分钟，应立即交给自家后端。
- 后端用当前环境对应的 AppID/AppSecret 调用 `code2Session`。
- AppSecret、`session_key`、微信 access token 和 login code 不进入小程序包、普通日志、错误响应或客户端持久化。
- openid 是 AppID 作用域身份；`unionid` 只在官方条件满足时可能返回，不能作为 MVP 前提或统一账号 ID。
- 测试号和企业正式 AppID 的 openid 不能迁移或自动合并；正式号需要重新登录并通过已验证邮箱绑定同一统一账号。
- 微信登录只证明微信主体，不自动证明邮箱、历史 Story 或业务账号归属。
- 首次微信登录进入“未绑定身份”；用户通过已有邮箱 OTP/密码证明，或显式创建新的统一账号；冲突失败关闭并转人工处理。
- 小程序用项目自己签发的短期 Bearer 会话；服务端从该 principal 派生统一 `userId`。
- 服务器域名必须为真实 HTTPS/WSS，不能使用 IP 或 localhost，证书链完整，TLS 至少 1.2，并满足备案和微信后台配置；`urlCheck` 保持开启。
- `wx.request` 并发上限为 10；小程序进入后台后，5 秒内未结束的请求可能以 `fail interrupted` 结束。因此聊天、Story 创建、正文保存和计费都要有服务端幂等与结果查询。
- 微信隐私机制不能靠配置关闭。`wx.getPrivacySetting`、`wx.onNeedPrivacyAuthorization` 等主动接口从基础库 2.32.3 起支持；建议把 2.32.3 作为明确最低基线，或为更低版本设计兼容路径。
- 原生 TypeScript 编译只是去掉类型，不会进行完整类型检查；独立 `tsc --noEmit` 必须保留。
- 微信内容安全由服务端调用；小程序不能直连 `msgSecCheck`。

已观察微信开发者工具版本：`2.01.2510290`。它高于原生 TypeScript 和隐私接口所需工具版本，但不能替代真机证据。

官方入口：

- `https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html`
- `https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html`
- `https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html`
- `https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html`
- `https://developers.weixin.qq.com/miniprogram/dev/devtools/compilets.html`
- `https://developers.weixin.qq.com/miniprogram/dev/devtools/npm.html`
- `https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html`
- `https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html`
- `https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html`
- `https://developers.weixin.qq.com/sandbox?tab=miniprogram`

补充安全参考：

- RFC 9700 OAuth 2.0 Security Best Current Practice
- RFC 8725 JSON Web Token Best Current Practices
- OWASP Session Management Cheat Sheet
- OWASP REST Security Cheat Sheet

### 四层证据不能混用

1. 开发者工具 + mock：只证明编译、导航、状态机、mock 错误态和基本布局。
2. 官方测试号 + 真机：可以证明测试 AppID 下的真实 login、真机网络和生命周期；不能证明企业正式身份、类目、审核或发布。
3. 企业正式 AppID 的开发版/体验版 + 真机：证明正式 AppID 作用域、正式域名和跨端链路；体验版通过仍不等于审核通过。
4. 提审/发布：证明平台当次接受类目、隐私和基本路径；不证明对象级授权、幂等、CAS、扣费或迁移无损，这些仍靠自动化和内部验收。

---

## 八、尚未完成的规划工作

断网前已完整阅读 `ce-plan` 的 `SKILL.md`、计划模板、合成摘要规则和可视化规则，并完成：

- 上游需求确认。
- 仓库技术与制度性经验研究。
- 微信官方文档和安全最佳实践研究。
- 环境状态复核。

尚未完成：

1. 使用 `ce-spec-flow-analyzer` 做流程与边界分析。
2. 整理 plan-time synthesis call-outs 并让用户确认。
3. 编写最终 Deep 计划。
4. 对最终计划执行 confidence deepening 和 headless `ce-doc-review`。
5. 运行文档最终检查并向用户提供下一步选项。

建议最终计划路径：

- `docs/plans/2026-09-03-001-feat-liaohuier-wechat-workspace-plan.md`

正式写入前重新检查当天编号；如果已有新的 9 月 3 日计划，顺延序号，不覆盖。

---

## 九、需要下一位规划 Agent 明确处理的技术分歧

### 1. 小程序会话续期策略

旧 002 计划选择“2 小时内存 access token，无 refresh token，进程回收后重新 `wx.login`”。外部安全研究建议“10–15 分钟 access token + 服务端可撤销、单次轮换的 refresh token”，以提供更平滑的长期登录。

这是真实的计划决策，不要把两种方案同时写入。评估用户“随时打开就能继续写”的体验目标、`wx.login` 的重新换取成本、客户端 storage 不是安全区、现有 `sessionVersion` 撤销能力和实现复杂度后，形成推荐并在 synthesis 中让用户确认。无论选择哪种，AppSecret 和 `session_key` 都不能下发，退出/改密/找回/解绑都要撤销旧会话。

### 2. 私人正文的内容安全策略

付费 AI 输入必须在供应商调用和费用预占前由服务端检查；被拒绝或审核服务不可用时不调用模型、不扣费。AI 输出应在持久化和呈现前检查。

但“用户只保存私人正文”是否必须同步通过 `msgSecCheck` 才能保存尚未由产品需求决定。建议计划把私人草稿保存与付费 AI 调用分开：正文可保存为仅本人可见的权威草稿，付费生成或未来公开/分享前再强制审核；同时在 synthesis 中明确这是推荐假设，避免内容安全故障导致用户无法保存自己的文字。

### 3. 同邮箱来源项目的迁移

负责人邮箱在 legacy 与 staging 两侧各有内容。保守且符合“不丢内容”的处理是两侧项目都迁入新的统一账号，不保留任一来源数字 ID，也不选择性丢弃项目。这个决定应作为小程序 live 上线前置，不应塞进小程序实现单元里执行。

### 4. 旧壳层复用方式

推荐从最新 `main` 新建工作分支，复用 `2ca35f7` 已带入的工程、状态机和 transport，再改成“聊会儿”并补 Story 创建；不建议从零重写。需要在 synthesis 中向用户明确“复用技术骨架，不继承旧产品语义”。

---

## 十、建议的计划结构

这是方向建议，不是已写好的计划；下一位 Agent 应根据 flow analyzer 和 synthesis 确认再定稿。

### Phase 0 — 外部前置与唯一 owner 收口

- 账号 Agent 完成提交、身份映射、新合并库、恢复演练、切换和双设备登录验证。
- 新 Agent 从最新 `main` 建立独立 worktree，并重新登记 `SESSION-BOARD`，确认服务端、schema、共享文档热区仍未被其他任务占用。

### U1 — 把冻结壳层变成“聊会儿”产品入口

- 替换品牌和文案。
- 增加账号状态、Story 列表、最小创建、最近编辑排序和 dirty 切换保护。
- 保持 mock 常驻标识，不伪造真实账号或跨端成功。

### U2 — 建立共享 workspace 合同与应用 facade

- 明确 Story list/create、chat list/generate/status/append、body read/save、balance/last charge 的窄合同。
- Web tRPC 和小程序 JSON route 共同调用现有服务权威，不复制 SQL 或业务规则。
- Story 创建、聊天、正文保存和费用 operation 各有持久幂等键。

### U3 — 微信 code2Session、应用会话和统一 principal

- AppID 作用域微信身份。
- 服务端 Secret 边界。
- 独立 Bearer route family，不放宽 Web Cookie/Origin/CSRF。
- 会话过期、轮换、撤销、日志脱敏和环境隔离。

### U4 — 显式邮箱绑定与新账号创建

- 未绑定微信身份通过邮箱 OTP/密码进入已有统一账号，或显式创建统一账号。
- 绑定、冲突、重复请求和并发均事务化；不自动认领历史内容。
- 记录审计并撤销旧会话。

### U5 — 接入真实 Story、聊天、正文、余额和消费

- 小程序 live transport 只使用 U3 principal。
- 手机和 Web 读取同一 MySQL。
- 余额不足仍能浏览和保存正文。
- 本次实际费用来自 settled ledger。

### U6 — 弱网、前后台、恢复与移动体验收口

- 覆盖 `fail interrupted`、未知结果查询、进程回收、迟到响应、dirty 切换和 CAS 冲突。
- 320/360/390 宽度、中文 IME、软键盘、safe area 和大字号。
- 账号切换前清理上一账号恢复数据。

### U7 — 隐私、内容安全、合法域名、跨端与发布门禁

- 基础库最低版本、隐私同意/拒绝/重置。
- HTTPS 合法域名、证书、备案、企业 AppID 和体验版。
- 服务端内容安全与费用语义。
- fresh MySQL、双账号隔离、双设备跨端、真机生命周期、审核和上线证据分层。

计划应使用 Deep 模板，包含依赖图、跨组件交互图、每个 feature-bearing U-ID 的明确测试文件和具体测试场景、风险表、分阶段交付、回滚和文档/运维说明。

---

## 十一、下一位 Agent 的开场步骤

1. 完整阅读根 `AGENTS.md`。
2. 完整阅读 `ce-plan` 的 `SKILL.md`，不要只读摘要。
3. 阅读本交接、权威需求、旧 002 计划、旧小程序执行交接、实时会话板、功能账本相关卡和三份账号迁移 QA 文档。
4. 运行只读 `pnpm env:status` 与 `git status --short --branch`；不要启动服务。
5. 不重复仓库和微信外部研究，除非文件或官方状态已变化；本交接已经保存研究结论与引用。
6. 运行 `ce-spec-flow-analyzer`，重点覆盖首次创建/绑定、会话过期、Story 空态/创建/dirty 切换、聊天 unknown、正文冲突、余额不足、账号切换、隐私拒绝和测试号→正式号。
7. 向用户呈现 1–3 行 implementation synthesis 和真正需要拍板的 call-outs；得到明确确认后再写计划。
8. 规划阶段只新增最终计划文档；若开工时出现其他未提交文件，停止触达并按会话看板协调。
9. 写完运行 confidence deepening、headless `ce-doc-review` 和文档最终检查。

---

## 十二、可直接发给新对话的提示词

> 请继续完成“聊会儿”微信原生小程序的 Deep 技术实施计划。只写计划，不实现、不测试、不合并、不部署、不迁移数据库。先完整阅读 `AGENTS.md`、`docs/handoff/2026-09-03-liaohuier-wechat-miniprogram-planning-handoff.md` 和其中列出的权威需求、旧计划、会话板、功能账本及账号迁移文档。当前任务与“拾光”无关；`2ca35f7` 的测试壳层已经随 PR #7 合入 `main`，后续只复用技术骨架，不继承旧产品语义。请从尚未完成的 `ce-spec-flow-analyzer` 开始，按 `ce-plan` 完整流程完成 synthesis 确认、计划写盘、confidence deepening 和 headless 文档审查。计划预计写到 `docs/plans/2026-09-03-001-feat-liaohuier-wechat-workspace-plan.md`，写前先重新核对当天编号。开工时重新检查并登记会话看板，不启动任何 dev server。
