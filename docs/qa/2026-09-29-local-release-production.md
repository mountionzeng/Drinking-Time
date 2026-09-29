# 2026-09-29 本机版本正式发布记录

## 目标

按用户要求，将本机发布候选部署到 `https://www.drinkingtime.top`。候选提交为 `faa1deb8a06c3b62dc073cf62976ea93756d913f`：本机的文字版本、首次引导、编辑器、故事授权与声音导演能力，与已上线的零余额供应商拦截一并发布。

## 发布前现场与备份

- 正式应用发布前为 `226c9bb4`，健康运行；正式库为 22 个迁移、4 个用户、1 个故事、0 个余额账户。
- 在服务器 root 私有目录 `/root/drinking-time-local-release-20260929-231316/` 备份了原提交 bundle、`.env`、锁文件、完整 `dist`、nginx、PM2 dump 及 MySQL 完整导出；不下载密钥或数据库。
- 仅导入经 SHA-256 校验的增量 Git bundle。测试站 `drinking-time-mobile-staging` 未启动。

## 切换与验证

- 用 PM2 已配置的 Node 24.18.0 构建候选版本；服务短暂停止期间将 Drizzle 从 22 迁移到 26。
- 确认 7 张新增表和 `stories_id_owner_unique` 索引存在，随后重启并保存唯一正式进程 `drinking-time`。
- 公网 `https://www.drinkingtime.top/login`、`/healthz`、`/readyz` 与主 JavaScript 资源均为 HTTP 200；`/readyz` 报告 MySQL ready、authentication required。
- 裸 IP 的 `/editing` 与 `https://test.drinkingtime.top/login` 均继续为 503。
- 正式库发布后仍为 4 个用户、1 个故事、0 个余额账户；未修改既有用户内容或余额。
- 正式发布源码上的 `server/services/computeRequestAccess.test.ts` 15 项通过，覆盖零余额、匿名、账本不可用、重试和请求身份隔离；测试用模拟发送器，未联系真实供应商。

## 受限项

- 未使用真实用户账户完成邮箱验证码或 Google 登录。
- 本机没有独立 MySQL 测试库，因此声音方案的真实 MySQL 并发竞争仍待后续专项演练；本次正式迁移及结构核查已经完成。
- 小程序仍是演示/模拟配置，本次没有上传或切换小程序生产版本。
- 零余额会阻止付费供应商提交；正余额逐笔预留、结算和所有历史调用路径的完整计费闭环仍是后续工作。
