# 支付宝上线核查（2026-11-02）

当前结论（22:11更新）：支付已开启、真实¥1订单已进入官方收银台；订单尚未付款，自动入账待用户扫码验收。以下早期只读记录保留为过程证据。

## 实测证据

- 开放平台应用 2021007109633311 显示“已上线”。可调用产品页列出“电脑网站支付”和 alipay.trade.page.pay，并提示列表产品已完成开通。
- 正式服务器 /opt/Drinking-Time，PM2 drinking-time，核查时 PID 497877；/readyz 为 ready/mysql/authentication required，服务器本机 HTTPS /m 为 200。git HEAD 为 0f649128，但线上存在其他会话发布增量，不能用此 HEAD 覆盖运行包。
- ALIPAY_PC_CHECKOUT_ENABLED=false；AppID、商户PID、私钥、公钥和通知地址已配置。本次未导出密钥。
- 用现有服务器私钥签名查询随机不存在的订单，支付宝返回 HTTP 200、40004 / ACQ.TRADE_NOT_EXIST，支付宝响应签名用已配置公钥验证通过。这证明请求认证与查单连接正常，不等于支付下单通过。云助手 t-wl071wi5kkl4z5s。
- 正式订单表及 userId/requestId、channel/providerTransactionId 唯一索引存在，订单数量为零。线上 bundle 包含支付回调和开关，仍包含旧 /account?payment=return。只读云助手 t-wl071wiqd8xjf28。
- 浏览器真实访问 /account 为 404；/editing 已登录，单次充值 10 算力显示 ¥10，支付宝付款按钮禁用，提示收银台暂不可用。

## 本地修复（未部署）

- server/routers/computePayment.ts：付款同步返回改为现有 /m?payment=return，返回不视作付款成功，入账仍依赖验签回调。
- server/services/payments/alipay.ts：请求 timestamp 明确使用 Asia/Shanghai，避免将 UTC 时间当北京时间。
- 支付专项 5 文件 15 项通过，包含服务器定价、签名、时间、返回路径、未配置禁用及数据库边界。
- 全仓 tsc --noEmit 未通过：另一会话未提交的 server/repositories/computeLedger.ts:147 出现 giftPrefixes 未使用、ReserveComputeCreditInput 不含 oncePerAccountPrefixes/oncePerAccountPrefix；未修改该文件。

## 发布前剩余步骤

1. SESSION-BOARD 中微信真实出码会话仍占线上发布窗口。已请求用户授权联系协调；未得到回复前不发消息、不重启服务。先保留线上微信兼容后端并取得实际运行基线，不能打包整个混合工作树。
2. 发布上述最小修复，备份配置后开启 ALIPAY_PC_CHECKOUT_ENABLED，重启并核验 readyz、登录及 availability。当前会话尚未执行这些动作。
3. 从用户当前登录账号创建 1 算力 / ¥1 未付款订单，展示官方收银台；付款由用户扫码确认。核对回调 paid、单笔 purchase 流水与余额 +1，重复回调不重复增加。
4. 产品额度限制/ICP备案授权流程与应用上线为不同事项。本轮没有证明额度限制已解除；如真实下单返回渠道限制，记录准确错误后再处理对应申请。

无真实订单、扣款、赠送或余额写入；生产程序、配置和进程未改变。

## 22:04 最小发布与22:09真实下单

- 用户授权联系微信会话协调。微信会话在共享看板21:49明确释放窗口，最新源码 /tmp/wechat-account-followup-20261102/src。复制到 /tmp/alipay-enable-20261102/src，原样后端重建与线上基线SHA完全相同，再应用两处支付宝修复；产物差异仅两处。
- 隔离源码15项支付测试、tsc --noEmit、node --check通过。主仓其他未提交工作未带入上线。
- 初次云助手提交超时，查调用列表确认没有执行；第二次配置格式预检因false带引号失败，在备份/修改/重启之前退出；按已核实格式修正后成功。
- 成功调用 t-wl071wl9i9ho7b4，PM2新PID498425，ready/mysql/required；后端SHA7572fce979a69b877e226cbbc6935f41d6ae2081f95c3ec2bf111d368ee718af。
- 备份 /opt/Drinking-Time/dist.bak-alipay-enable-20261102 包含旧index.js和.env；生产manifest /opt/Drinking-Time/dist.release-alipay-enable-20261102.json。配置唯一变更ALIPAY_PC_CHECKOUT_ENABLED=false→true。前端全部产物哈希保持，微信登录/导入/共享钱包完整保留。
- 浏览器正式 /editing → Add credits → 用多少充多少 → 1算力/¥1 → 支付宝付款成功，官方 excashier.alipay.com 展示收款方北京曦岱文化有限公司及¥1二维码。浏览器企业登录提示付款人与收款人不能相同，已请用户用个人支付宝扫码。
- 订单 f76cdc7d-334a-41c3-8c6f-44af9f7b5829，userId133211，amountFen100，creditMinor500000（显示1算力），创建时间2026-11-02 22:08:57北京时间。22:11只读查询仍pending、purchase流水0，付款前网页余额15.00。
- 付款必须由用户确认，尚未声称已收款或已自动到账。没有人工写余额/伪造支付回调。用户付款后核验订单paid、单笔purchase以及余额增量；真实回调重复与补偿仍待后续验收。
- 已向微信会话交接最新基线并释放发布窗口；主仓修复未提交。收银台截图在任务output/pdf/alipay-one-yuan-checkout-1102.png。
