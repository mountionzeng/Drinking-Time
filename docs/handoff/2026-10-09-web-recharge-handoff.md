# 交接：网页端用户自助充值

目标：用户在界面上点「充值」→ 选金额 → 扫码/跳转付款 → 付款成功后余额自动到账、界面刷新。不需要人工介入。

## 现状（2026-10-09，分支 `codex/web-paid-call-billing`）

已有：
- 账本：`server/services/computeLedger.ts`。入账统一走 `appendCreditLedgerEntry`（`server/repositories/computeLedger.ts:473`），带 `idempotencyKey` 唯一约束，重复写零新增。金额单位是微元（1 元 = 1_000_000），换算用 `shared/computeMoney.ts` 的 `fromYuan`。
- 现有入账类型：`grantCredit`（gift）、`recordAdjustment`（adjustment）。**没有付费充值类型。**
- 表 `credit_ledger_entries`（`drizzle/schema.ts:2062`），`entryType` 枚举只有 `gift / adjustment / consumption / refund / release`。
- 已有 `recharge_requests` 表（`drizzle/schema.ts:2258`，迁移 `drizzle/migrations/0016_account_gift_credit.sql`）：字段是申请金额、人工审批状态、原因和审批人，意图是“追加测试算力”，不是渠道支付订单。当前 `server/`、`client/src/`、`scripts/` 没有任何运行代码引用它；不要把它误当成已可用接口，也不要为付费订单复用或重复创建同名申请表。若只恢复人工测试额度申请，应该补申请/审批服务和路由；若目标是用户真实付款，另建支付订单与支付状态模型。
- 只读接口：`server/routers/computeAccount.ts` 的 `balance`、`statement`。文件头注释明确约定这个 router **只读**，充值不要塞进来。
- 前端余额显示：`client/src/features/computeAccount/ComputeBalanceBadge.tsx` + `useComputeBalance.ts`，挂在 `client/src/app/shell/TopBar.tsx`、`client/src/features/mobileWorkspace/MobileMePage.tsx`。桌面顶栏使用 `compact` 模式，只显示余额数值；展开用户菜单会显示完整余额状态，但没有充值或申请动作。当前 Web 也没有账单页面；`statement` 目前只提供后端读模型。
- 状态提示也没有形成入口：桌面 compact 余额是不可点击的显示组件；余额确实耗尽时只显示暂停提示。用户菜单里的完整提示仅在“用过且耗尽”状态显示联系邮箱；新账号“从未入账”的 unprovisioned 状态只说还没领算力。手机“我”页复用完整余额提示，也没有申请或付款动作。
- 人工测试额度：`scripts/grant-compute-credit.ts` 调用 `grantCredit` 写 `gift` 记录，是运营/开发者手动发放脚本，不是用户付款、也不是自助充值。不可把支付标成 `gift` 或用该脚本模拟收款。
- 计费扣款：`server/services/computeMetering.ts`（`runMeteredCompute`），余额不足返回 `insufficient_balance`。

注意：这个 worktree 里还有一批未提交的计费改动（`inferenceBilling.ts`、`computeMetering.ts` 等）。开工前先 `git status`，别覆盖或回退这些文件。

## 开工前必须先问用户的事

1. **支付渠道和商户账号**：微信支付 Native（扫码）、支付宝电脑网站支付，还是两个都要？需要已开通相应 API 产品的官方商户账号。用户提供的静态个人收款码不能作为自动充值接口：它不能可靠关联订单，也没有可验证的服务端支付回调；下单后由系统向官方渠道申请并展示每笔订单自己的动态二维码/跳转链接。
2. **商户配置**：微信支付通常需要商户号、应用 AppID、APIv3 密钥、商户 API 私钥/证书序列号、平台证书或公钥及 HTTPS 通知地址；支付宝通常需要开放平台应用 AppID、应用私钥、支付宝公钥/证书和 HTTPS 异步通知地址。具体按选择的官方 SDK/证书模式核对。密钥不要发在聊天里；只通过部署环境的受控密钥配置保存，在 `.env.example` 和 `server/_core/env.ts` 里登记变量名，不写值。先准备沙箱/测试商户配置，再做真实小额验收。
3. **充值档位**：固定档（例如 ¥10 / ¥30 / ¥100）还是允许自定义金额；最低、最高金额。
4. 是否开发票、是否支持退款（第一版建议不做自助退款，走 `recordAdjustment` 人工处理）。

若尚无官方商户账号/API 资质，第一阶段可单独实现“申请追加测试算力 → 管理员审核 → 账本入账”；这不是用户付款，也不应要求用户上传静态收款码或把付款截图当到账证明。真实收款应等官方支付回调验签和订单对账链路完成后再开放。

## 要做的事

### 1. 数据层
- `credit_ledger_entries.entryType` 枚举加 `purchase`，写迁移。
- 新表 `payment_orders`：`id`、`userId`、`orderNo`（我方生成，唯一）、`provider`、`amountMinor`、`status`（`pending / paid / closed / failed`）、`providerTradeNo`（与 provider 组成唯一键，可空）、`paidAt`、`createdAt`、`expiresAt`、支付通知的必要审计字段。不要默认长期保存含个人/支付数据的完整回调原文；确需留存时先定加密、访问权限和保留期限。
- 跑 `server/integration/migrationBaseline.mysql.test.ts`、`accountSchema.mysql.test.ts` 确认迁移基线。

### 2. 服务层：`server/services/computePayment.ts`
- `createRechargeOrder(userId, amountYuan, provider)`：校验档位 → 落 `pending` 订单 → 调渠道下单 → 返回二维码链接 / 跳转 URL + `orderNo`。
- `handlePaymentNotify(provider, headers, body)`：
  - **先验签**，验签失败直接拒。
  - 按 `orderNo` 找订单，**金额以我方订单为准**，并比对回调金额，不一致记异常不入账。
  - 在一个事务里：订单 `pending → paid`（条件更新，防并发） + 追加 purchase 账本事实。
  - 重复回调必须幂等：已 paid 直接返回成功，不再入账。
  - 首次充值是否顺带开通工作台（`enableAccess`），跟现有赠送卡行为对齐，问用户。
- **事务接入点需要先设计好**：`server/repositories/computeLedger.ts:473` 的 `appendCreditLedgerEntry()` 内部会自行 `getDb()` 并开启事务；不能在订单事务中直接调用它并宣称两步原子。应将 repository 写入口改为可接收调用方的 transaction，或新增一个 repository 命令，在同一 MySQL transaction 中条件更新订单、插入账本记录并更新 `credit_accounts` 投影。`credit_accounts` 是投影、`credit_ledger_entries` 是事实；两者必须和订单状态一起原子提交。补 MySQL 并发回调测试覆盖“一个订单只增加一次余额”。
- 建议给账本新增 `paymentOrderId`（唯一/可空）或等价的强关联字段；幂等键优先绑定我方不可变 `orderNo`，并对 provider trade number 建唯一约束。仅靠通知重试层的内存去重不够。
- `server/services/computeStatement.ts` 的 `entryLabel()` 当前只专门识别 consumption/gift/refund/release，其他 entry 会落成“额度调整”；加入 purchase 后必须加“充值”展示语义，并覆盖金额正负和对账状态。
- `queryOrder`：前端轮询用；如果回调迟迟没到，主动向渠道查单补单（同一入账路径，同一幂等键）。

### 3. 接口
- 新 router `server/routers/computePayment.ts`，在 `server/routers/index.ts` 注册：
  - `createOrder`（protectedProcedure，input 只有金额档位和渠道，**userId 只从 `ctx.user.id` 取**）
  - `orderStatus`（只能查自己的订单）
- 支付回调是普通 HTTP 路由（不是 tRPC），挂在 Express 上，需要原始 body 验签，不要让 JSON 中间件先吃掉 body。
- `server/_core/index.ts:128` 当前先挂了 `express.json({ limit: "50mb" })`；原始 body 回调路由必须在该 JSON middleware 前挂载，或用精确路径的 raw-body middleware 保留原始字节，不能事后从解析过的 JSON 重新序列化冒充签名原文。
- `isLocalUnlimitedCompute()` 为真时创建订单直接拒绝，前端也隐藏充值入口。

### 4. 前端
- `client/src/features/computeAccount/RechargeDialog.tsx`：选档位 → 调 `createOrder` → 展示二维码（桌面）/ 跳转（支付宝）→ 每 2 秒轮询 `orderStatus`，`paid` 后关闭弹窗并 `invalidate` `computeAccount.balance` 和 `statement`；超时给“我已付款，刷新状态”按钮。
- 入口：`ComputeBalanceBadge` 旁边加「充值」按钮；`MobileMePage` 加入口；`runMeteredCompute` 返回 `insufficient_balance` 时的提示里也给充值按钮。
- 账单明细（`statement`）里 `purchase` 条目要有文案，比如「充值」。
- 金额展示继续用微元转元的现有工具，不在服务端转浮点。

### 5. 测试与验收
- 单测：重复回调只入账一次；金额不符不入账；验签失败拒绝；并发两个回调只入账一次；他人订单查不到。
- 用渠道沙箱（或 mock provider）跑一次完整链路：下单 → 模拟回调 → 余额增加 → 再调一次付费生成能扣款成功。
- 浏览器里走一遍：顶栏点充值 → 付款 → 余额数字自动更新，截图留证。QA 记录放 `docs/qa/`，并更新 `docs/features/feature-ledger.json`。

## 安全红线
- 不信任前端传来的金额和到账状态，一切以验签后的回调或主动查单为准。
- 回调接口不需要登录，但必须验签；日志里不打印密钥和完整证书。
- 入账只追加，不改历史条目。
