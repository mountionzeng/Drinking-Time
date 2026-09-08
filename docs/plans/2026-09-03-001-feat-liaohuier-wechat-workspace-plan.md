---
date: 2026-09-03
status: active
topic: liaohuier-wechat-workspace
origin: docs/brainstorms/2026-09-02-liaohuier-wechat-miniprogram-requirements.md
supersedes: docs/plans/2026-09-02-002-feat-wechat-miniprogram-test-shell-plan.md
---

# “聊会儿”微信原生小程序工作区实施计划

## Problem Frame

我们已经有一套能在微信开发者工具里运行的原生小程序测试壳层，但它仍停留在 mock 级别，并且产品语境还是旧的“拾光”测试壳层。现在要继续做的不是把旧壳层简单补强，而是把它升级为“聊会儿”的正式小程序工作区：同一账号在微信里创建或进入，看到自己的 Story，继续“聊聊”，编辑并安全保存正文，查看余额与费用，并在手机保存后回到电脑继续处理。

这份计划的核心约束来自原始需求文档 `docs/brainstorms/2026-09-02-liaohuier-wechat-miniprogram-requirements.md`。其中明确排除“拾光”家庭人物传记方向、图片/素材/时间线/视频能力以及支付渠道；因此本计划只覆盖“聊会儿”个人 Story 的微信入口与跨端合同，不会把家庭故事、亲属协作或纪念册语境混进来。

## Scope Boundary

本计划只规划“聊会儿”微信原生小程序的一阶段工作区能力：

- 微信身份与统一账号进入
- 当前账号的 Story 列表、新建、切换
- 同一 Story 的“聊聊”历史延续
- 权威正文查看、编辑、保存、冲突处理
- 余额与最近消费展示
- 弱网、前后台、恢复、中文输入法和窄屏适配
- 隐私、合法域名、真机验收与发布门禁

明确不做：

- “拾光”家庭人物传记、老人/亲属协作、纪念册
- 图片、素材、分镜、时间线、视频、数字人
- 微信支付、订阅、退款
- 多人实时协同编辑、光标同步、离线队列

## Origin Traceability

本计划沿用原始需求中的关键承诺：

- `R1-R4`：产品身份必须是“聊会儿”，同一用户在小程序、手机 Web 和电脑 Web 中读取同一份账号权威。
- `R5-R7`：登录后必须显示当前账号的 Story，支持新建与切换。
- `R8-R10`：小程序复用当前 Story 的“聊聊”历史，消息整轮持久化，未知结果不能重调模型。
- `R11-R13`：正文保存必须有版本冲突保护，冲突时保留本机文本和服务端文本。
- `R14-R16`：手机体验、余额/费用透明、演示状态与真实状态分层。

另一个重要前置是：伙伴给的 `shiguang-ai.zip` 更像是一个 Web 全栈参考包，不是可直接接入微信小程序的后端实现。本计划不把它当作可直接落地的后端合同，而是只参考其中的产品节奏、提示词方向和文案表达；真正接入仍以仓库里的服务权威和小程序合同为准。

## Design Decisions

### 1. 先保留技术骨架，再切换产品语境

小程序工程已经存在，适合继续沿用 `miniprogram/**` 里的纯 TypeScript 状态机、mock transport 和独立测试门禁。新的工作不会推倒重来，而是把界面、状态文案和合同边界从“拾光 mock 壳层”切换为“聊会儿工作区”。

### 2. 小程序与 Web 共用同一份业务权威

小程序不维护第二份业务数据库，不复制 Story、正文或聊天记录。它只通过新的小程序会话合同读取和写入同一份业务权威。也就是说，小程序负责“入口和交互”，真正的账号、Story、正文、账本还是由服务端统一权威控制。

### 3. 最小可用顺序优先于一次性做全

会按 U1-U7 分阶段推进，优先保证：

- 页面身份正确
- 合同边界清楚
- 能稳定保存和恢复
- 真机验收可以一步步推进

不会为了“看上去完整”而先写一堆临时逻辑。

### 4. 余额/费用必须来自 settled ledger

小程序里展示的金额不能靠前端估算，也不能直接从输入提示生成。只允许来自已经结算的账本条目和余额接口。

## Implementation Units

### U1. 从“拾光测试壳层”切换到“聊会儿”工作区入口

目标：

- 替换启动页、隐私页、工作区的产品名称、文案和视觉语境
- 保留 mock 常驻标识
- 让当前工程表达“聊会儿个人 Story 工作区”，而不是家庭传记

建议影响文件：

- `miniprogram/src/app.json`
- `miniprogram/src/app.wxss`
- `miniprogram/src/pages/start/index.*`
- `miniprogram/src/pages/privacy/index.*`
- `miniprogram/src/pages/workspace/index.*`
- `miniprogram/src/core/workspacePresentation.ts`
- `miniprogram/src/core/runtimeMode.ts`
- `miniprogram/src/services/mockTransport.ts`

测试文件：

- `miniprogram/tests/workspacePresentation.test.ts`
- `miniprogram/tests/runtimeMode.test.ts`
- `miniprogram/tests/projectSafety.test.ts`

需要验证的场景：

- 启动页、隐私页、工作区都不再出现“拾光”家庭传记语境
- mock 状态仍清晰可见，不伪装成真实账号
- 页面加载顺序与小程序壳层仍可独立运行

### U2. 定义工作区的最小共享合同

目标：

- 先把 Story list/create、chat list/generate/status/append、body read/save、balance/last charge 定成窄合同
- 为 Web 与小程序后续共用同一业务权威准备接口形状
- 明确幂等键、冲突语义和 unknown 状态

建议影响文件：

- `miniprogram/src/services/transport.ts`
- `miniprogram/src/services/mockTransport.ts`
- `client/src/features/mobileWorkspace/useMobileConversation.ts`
- `client/src/features/mobileWorkspace/useMobileDocument.ts`
- `server/services/storyConversation.ts`
- `server/services/publishingPersistence.ts`
- `server/services/computeLedger.ts`

测试文件：

- `miniprogram/tests/mockTransport.test.ts`
- `miniprogram/tests/conversationState.test.ts`
- `miniprogram/tests/documentState.test.ts`
- `server/services/storyConversation.mobile.test.ts`
- `server/services/publishingPersistence.test.ts`
- `server/services/computeLedger.test.ts`

需要验证的场景：

- 同一 turn 的未知结果先查询，不重复生成
- 正文保存带版本号和 base revision
- 余额不足时阻止新的付费调用，但不阻止阅读和编辑

### U3. 接入微信 code2Session、服务端 principal 与会话边界

目标：

- 小程序通过微信登录拿到临时 code，再换取服务端签发的短期会话
- 服务端从 principal 派生统一 `userId`
- 不放宽现有 Web Cookie / Origin / CSRF 边界

建议影响文件：

- `server/_core/oauth.ts`
- `server/_core/context.ts`
- `server/_core/sdk.ts`
- `server/_core/env.ts`
- `server/_core/productionReadiness.ts`
- `server/services/accountIdentity.ts`
- `server/services/accountSecurity.ts`

测试文件：

- `server/_core/oauth.account.test.ts`
- `server/_core/oauth.invite.test.ts`
- `server/_core/context.test.ts`
- `server/services/accountIdentity.test.ts`
- `server/services/accountSecurity.test.ts`
- `server/_core/productionReadiness.test.ts`

需要验证的场景：

- AppSecret、session_key 和登录 code 不进入小程序包或日志
- 微信主体不等于业务归属，第一次微信登录进入未绑定态
- 会话过期、撤销、轮换都能拒绝旧身份继续写入

### U4. 显式邮箱绑定与新账号创建

目标：

- 微信身份首次进入后，能显式绑定已有统一账号
- 找不到归属时允许创建新账号
- 冲突必须失败关闭，不能静默认领历史内容

建议影响文件：

- `server/services/accountIdentity.ts`
- `server/services/accountSecurity.ts`
- `server/routers/index.ts`
- `server/routers/_projectAccess.ts`
- `server/db.ts`
- `docs/qa/account-migration-cutover-rollback-plan.md`

测试文件：

- `server/routers.projectOwnership.test.ts`
- `server/routers.ownershipBoundaries.test.ts`
- `server/db.accessAnalytics.test.ts`
- `server/db.inviteAccess.test.ts`

需要验证的场景：

- 一个微信身份只能安全绑定到一个业务主体
- 重复绑定或并发绑定不会偷改别人的 Story
- 旧会话在绑定后必须失效

### U5. 接入真实 Story、聊天、正文、余额和消费

目标：

- 小程序从 mock 切到真实数据读取
- 仍然只读写同一份业务权威
- 展示真实余额和最近费用

建议影响文件：

- `server/routers/storyAgent.ts`
- `server/routers/promptLineage.ts`
- `server/routers/publishingDraft.ts`
- `server/services/storyConversation.ts`
- `server/services/publishingPersistence.ts`
- `server/services/computeLedger.ts`
- `server/services/computeBilling.ts`
- `server/db.ts`

测试文件：

- `server/routers.storyConversation.test.ts`
- `server/routers.publishingDraft.test.ts`
- `server/routers.storyAgent.test.ts`
- `server/services/computeBilling.test.ts`
- `server/services/computeLedger.test.ts`

需要验证的场景：

- Story 列表只显示当前账号拥有的内容
- 聊天历史与正文读取的是同一份权威
- 余额展示来自 settled ledger

### U6. 弱网、前后台、恢复与移动体验收口

目标：

- 覆盖 `fail interrupted`、unknown 结果、进程回收、正文冲突和 Story 切换脏草稿
- 适配 320 / 360 / 390 宽度、中文输入法、软键盘和 safe area
- 确保真机体验可用

建议影响文件：

- `miniprogram/src/pages/workspace/index.*`
- `miniprogram/src/core/recoveryState.ts`
- `miniprogram/src/core/conversationState.ts`
- `miniprogram/src/core/documentState.ts`
- `miniprogram/src/core/workspaceState.ts`
- `miniprogram/src/core/privacyConsentState.ts`

测试文件：

- `miniprogram/tests/recoveryState.test.ts`
- `miniprogram/tests/conversationState.test.ts`
- `miniprogram/tests/workspaceState.test.ts`
- `miniprogram/tests/privacyConsentState.test.ts`
- `miniprogram/tests/runtimeIsolation.test.ts`

需要验证的场景：

- unknown 结果不产生第二次生成
- 切 Story 前 dirty 草稿有明确裁决
- 中文输入法候选确认不会误发送

### U7. 隐私、合法域名、真机验证与发布门禁

目标：

- 让小程序满足微信平台的最低发布前置
- 把隐私同意、合法域名、真机验证和内容安全门禁写进计划
- 不把 mock 验收误当成正式可发布证据

建议影响文件：

- `miniprogram/project.config.json`
- `docs/handoff/SESSION-BOARD.md`
- `docs/features/feature-ledger.json`
- `docs/qa/2026-09-01-mobile-cross-device-acceptance.md`
- `docs/qa/2026-09-03-mobile-mini-program-verification.md`（若后续需要新增）

测试文件：

- `miniprogram/tests/noRealWechatCalls.test.ts`
- `miniprogram/tests/projectSafety.test.ts`
- `miniprogram/tests/workspacePresentation.test.ts`

需要验证的场景：

- 没有真实可用域名前不声称 live ready
- 真机生命周期、前后台切换和输入法验收有独立证据
- 提审前后证据层级清楚，不混淆 mock 与正式发布

## Sequencing

建议顺序：

1. 先完成 U1，让产品语境从“拾光”切回“聊会儿”。
2. 再完成 U2，把小程序和服务端之间的合同边界定清楚。
3. 然后做 U3 / U4，把微信身份、统一 principal 和账号归属接稳。
4. 接着做 U5，把真实 Story、聊天、正文和余额打通。
5. 再做 U6，收口移动端体验和恢复边界。
6. 最后做 U7，补齐隐私、合法域名、真机和发布前证据。

## Risks and Constraints

- `shiguang-ai.zip` 不是可直接接入的小程序后端；如果误把它当权威实现，会把 Web 技术栈和微信小程序接入搞混。
- 账号、账本和迁移相关文件仍然有热区和 owner 约束，尤其是 `server/db.ts`、`docs/features/feature-ledger.json` 和 `docs/handoff/SESSION-BOARD.md`。
- 真正的微信登录、合法域名和发布证据不能靠 mock 代替。
- `wx.request` 的并发和后台中断限制意味着所有核心动作都必须有幂等和结果查询设计。
- 正文保存冲突不能静默覆盖，这是跨端用户最容易丢稿的地方。

## Assumptions

- 现有 `miniprogram/**` 的 mock 骨架会继续复用，而不是重写。
- 真实接入时，服务端仍会提供一组独立的小程序会话入口，不会直接把 Web Cookie 当成微信身份。
- 余额与消费展示最终会落到统一账本接口，不在小程序前端自己估算。
- 伙伴提供的后端参考包只作为产品与提示词参考，不作为本计划的代码权威。

## Test Strategy

实施时需要保留的验证层次：

- 小程序纯 TypeScript / Vitest 证明合同与状态机
- 服务端单测证明 Story、正文、聊天、账本和会话边界
- 微信开发者工具证明页面和 mock 流程
- 真机证明中文输入法、软键盘和窄屏可用

## Next Step

这份计划一旦确认，就可以进入 `ce-work`：先从 U1 / U2 开始，把“聊会儿”小程序从 mock 壳层改成真正的工作区入口，再沿着合同把微信身份和真实数据接起来。
