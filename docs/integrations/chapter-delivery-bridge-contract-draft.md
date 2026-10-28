# 拾光家忆章节投递桥接契约草案（待确认）

本草案拟作为拾光家忆 ↔ Drinking Time 桥接口约定 1.7.0 的新增章节。确认前不改变 1.6.0 的正式约定，也不启用或部署任何开关。

## 身份与签名

- 所有投递 JSON 请求使用现有 HMAC、13 位毫秒时间戳、一次性 nonce 和持久防重放表；路径参与签名。
- 正文必须包含由云函数根据可信 `APPID + OPENID` 推导的 `subject`。客户端不能提交 `userId`、收件账号或发送者署名。
- 服务端从 `subject` 解析当前账号，再按已连接关系校验收件人。收件人对客户端只暴露 HMAC 不透明 `contactId` 和显示名。
- 投递桥 JSON 请求与响应上限为 256 KB。章节图片字节不得进入签名 JSON。

## 新增路径

路径均相对 `/api/shiguang`；方法均为 `POST`。每个请求都包含 `subject`，其余字段如下。

| 路径 | 额外请求字段 | 成功响应 |
|---|---|---|
| `/chapter-delivery/contacts` | 无 | `{ contacts: [{ contactId, displayName }] }` |
| `/chapter-delivery/send` | `package`, `requestId` UUID, `assetFileIDs`（assetId 到 CloudBase fileID 的映射） | `{ deliveryId, uploadTickets: [{ assetId, url, token, mime, bytes, sha256, expiresAt }], repeated }` |
| `/chapter-delivery/create-claim-link` | `package`, `requestId` UUID, `assetFileIDs` | `{ deliveryId, claimUrl, uploadTickets, repeated }` |
| `/chapter-delivery/claim` | `token` | `{ deliveryId }` |
| `/chapter-delivery/inbox` | 无 | `{ items: [{ deliveryId, packageId, kind, status, createdAt }] }` |
| `/chapter-delivery/read` | `deliveryId` UUID | `{ delivery, package, imageUrls }` |
| `/chapter-delivery/resolve` | `deliveryId` UUID, `status` 为 `kept` / `appended` / `adopted` / `declined` | `{ status }` |
| `/chapter-delivery/return` | `package`, `requestId` UUID, `assetFileIDs` | `{ deliveryId, uploadTickets, repeated }` |

服务端须覆盖包内 sender 署名；`send` 的接收人来自已连接 `contactId`，领取链接不指定接收人；`return` 只可发给父链对应根包的原作者。`read` 与 `resolve` 仅允许当前收件账号操作。领取 token 仅存摘要、七天过期且一次性使用。

## 图片字节

- 小程序先把图片放入 CloudBase 临时文件空间，并将 `assetFileIDs` 与章节包清单一同传给签名桥。
- 云函数从 CloudBase 获取临时 HTTPS 下载地址，下载并校验图片后，使用服务端签发的短时、按 `packageId + assetId` 绑定的 upload capability，将原始字节 `PUT` 到 Drinking Time 返回的 URL。
- Drinking Time 校验 MIME、字节数、SHA-256 和 capability 有效期。图片全部上传完成前，投递不进入收件箱。
- `read` 返回的网页短时图片 URL 由云函数下载后转存 CloudBase，再交由 04 现有照片登记和审核流程生成收件人自己的 `photoId`。签名 JSON 只传 URL 和元数据，不传图片字节。

## 错误和开关

- 投递专属开关 `CHAPTER_DELIVERY_ENABLED` 与既有 `CHAPTER_PACKAGE_ENABLED` 都必须为 `true`；缺省均关闭。任一关闭时路径返回 `503 bridge_not_configured`。
- 沿用 `invalid_bridge_signature`、`replayed_request`、`invalid_input`、`rate_limited`、`unavailable`；未授权或不存在的 delivery 对外返回 `404 not_found`。
- 既有 1.6.0 登录确认路径、请求/响应、V1/V2 签名向量均保持不变。

## 实施约束

- 迁移、部署、环境开关、微信开发者工具和真机验收不在本次本地实现范围内。
- 网页端需提供同等 tRPC 能力与收件/导入/发回入口；小程序端复用 04 的导入、修订、照片审核和来源 lineage 规则。
- 只有收到用户确认后，才把本草案合入权威契约并同步拾光家忆副本，再实现两端路由与契约测试。
