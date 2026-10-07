# 修复补镜图片渲染的连接失败

## 复现与原因

主仓库 `localhost:3000/editing`，故事 1202 的第 02 镜，参考插图 1877。

真实页面提示「02 已生成 0/4 张」，原始异常为 `fetch failed`，cause 为 `ConnectTimeoutError`，10 秒内未能连接解析出的 IPv4/IPv6 地址。没有任务号，也没有新增候选。

无凭据 HEAD 探测时，`api.302.ai` 已重新解析到本机代理的 fake-IP，约 2.3 秒返回 HTTP 200。这说明故障时的连接与当前网络有差异，不能将其归因为模型拒绝或参考图缺失，也不能承诺永久消除外部网络问题。

应用的具体缺陷是：MJ 提交路径将所有 fetch 异常一律标记为 `submissionUncertain`。明确的 DNS/建连失败也被当成可能已经受理，既没有有限恢复，也让用户误以为可能重复付费。

现有只读快检脚本只识别 cueCode/shotKey；这篇文章生成的镜头没有 cueCode，因此脚本无法定位。随后依据页面第 02 镜和持久化中的精确稳定 ID 检查，未修改业务 JSON。

## 修复边界

- 仅对机器可读错误码 `UND_ERR_CONNECT_TIMEOUT`、`ENOTFOUND`、`EAI_AGAIN`，在原提交时间预算内重新连接一次。
- 两次连接均未建立时明确返回「本次尚未提交生成任务」。
- socket 中断、等待响应超时、通用 ETIMEDOUT、只有错误文案而没有错误码时，仍保留提交不确定状态，不自动重提。
- MJ POST 禁止自动跟随重定向，避免第一次 POST 已受理、重定向目的地建连失败后错误重提。
- 提交总预算到期会 abort 请求，不允许底层稍晚返回建连失败后再次发送。
- 原请求正文、参考图、MJ 模型、候选数量、费用确认和任务号保留语义不变。不改代理、DNS、密钥或供应商。

## 自动化验证

先添加回归测试，修复前 8 项失败：连接失败直接终止，只发送了一次请求。修复后加上超时后不得迟发重试的回归。

最终相关 5 文件、169 项通过：

- `server/services/imageGen.test.ts`：建连恢复、上限、错误分类、不改变请求、拒绝重定向、到期 abort、已受理任务号与断流不重提。
- `server/routers.storyAgent.test.ts`：供应商结果和任务号穿透。
- `client/src/features/creationEditor/rerender.test.ts`：前端错误和图片回传。
- `client/src/features/storyAgent/views/useShotImageRender.test.tsx`：参考、费用确认与渲染流程。
- `shared/shotImageRender.test.ts`：全部候选保留，失败后停止后续付费任务。

`pnpm check` 通过。日志：`/tmp/mj-connect-retry-before.log`、`/tmp/mj-connect-retry-regression.log`、`/tmp/mj-connect-retry-types.log`。

主线程顺序自审，没有新增自动提交入口或更改已登记能力，没有提交、推送或部署。

## 用户追加要求：固定生成四张

用户明确要求「直接修成生4张图」。镜头表改为唯一「生成4张图」按钮，删除 1–8 张输入和重复的数量解释，沿用 MJ 与约 ¥0.68 的单任务报价。参考素材仍可选择/清空，旧 localStorage 的数量统一读为 4；Hook 也固定一个任务，避免旧 8 张数据或调用方再次购买两轮。共享批处理函数保留兼容性，其他既有调用不变。

新增三项回归先复现失败，修复后控件、Hook、共享批次及架构边界共 46 项全部通过。`pnpm check` 和 `pnpm build` 通过。日志：`/tmp/mj-four-images-before.log`、`/tmp/mj-four-images-after.log`、`/tmp/mj-four-images-types.log`、`/tmp/mj-four-images-build.log`。

## 实际出图验收

依据用户此前允许付费测试的授权，在第 02 镜仅确认并提交一轮 MJ，页面报价 ¥0.68，参考图片 1877。北京时间 2026-10-05 17:18，四张候选 1880、1881、1882、1883 全部落盘到故事 1202、稳定镜头 `publishing-v1-6cb4d21a2529fa6e238e`，页面画面行显示全部候选。

界面更新后再次核对，五镜按钮均为「生成4张图」，没有数量输入。点开第 02 镜报价确认，显示「生成4张图（MJ）」、原参考 1877 和 ¥0.68，随后取消，没有第二次付费提交。既有四张图片在热更新后仍可见。实际供应商扣费金额未单独查询；本次没有生成视频。

截图：`/tmp/mj-four-images-20261005.jpg`。连接恢复逻辑由回归测试模拟验证，真实成功只能证明当前链路恢复，不能声称本次实际触发了自动重连或永久解决了外部 DNS 波动。
