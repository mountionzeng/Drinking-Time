# 06 章节投递交接

## 当前实现

- 两端契约为 1.7.0，网页与小程序的 `docs/integrations` 契约副本逐字节一致。
- 网页已接通章节工作区投递、一次性领取链接、收件箱、导入/拒绝、发回候选状态同步，以及登录后领取回跳。
- 小程序已接通发送给联系人、复制领取链接、收件箱、审核后导入、拒绝和受保护章节发回。图片经独立 CloudBase 私有暂存和网页 capability 传输，不把 CloudBase fileID 放进签名业务体。
- 接收端复用 04 的章节导入、审核、来源保护与回发候选流程；导入失败或回执未知时保留幂等 requestId/目标，只有导入持久化或候选处理完成后才更新投递决议。
- `chapter-delivery` 功能卡仍为 `partial`。网页迁移 `0037` 只生成、未执行；两端开关默认关闭。本轮没有部署、push 或合 main。

## 验证

- 网页 `pnpm exec tsc --noEmit --pretty false` 通过。
- 网页投递路由与仓储定向测试：2 个文件、5 项通过。
- 小程序 `npm run typecheck -- --pretty false` 通过。
- 小程序 `node --test tests/chapter-delivery-contract.test.js tests/chapter-package-cloud.test.js`：28 项通过。
- `pnpm feature:validate` 通过：70 张功能卡。
- 网页架构边界测试仍有 1 项失败，报告 `AdminUserOverview.tsx` 与 `AdminVisitsPage.tsx` 对 `adminUsers.overview` 的既有宽范围失效；这两个文件不在本次改动中。本次新增的裸 `server/db.ts` 导入和收件箱宽范围失效已消除。
- 未运行浏览器/微信开发者工具/真机端到端测试，未执行数据库迁移。

## 部署前待办

1. 在隔离 MySQL 上验证迁移 `0037`、事务、并发领取和回滚；不要用正式库替代。
2. 补媒体 HTTP capability 路由和 UTC 每日限额的定向测试。
3. 在两端开发环境以默认关闭开关做浏览器与微信开发者工具跨端验收，覆盖账号投递、领取、图片、拒绝、导入和受保护内容发回。
4. 验收每账号 UTC 日历日 20 次上限，并确认企业环境已部署 `drinkingTimeBridge`、路由及环境变量。
5. 对象存储没有已验证的删除 API；过期媒体的物理清理仍需供应商能力确认。

部署顺序仍为先执行迁移并部署网页，再部署 `drinkingTimeBridge`，最后上传小程序。生产开关必须由用户单独安排；当前保持关闭。
