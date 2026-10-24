# 网页用小程序确认登录：生产发布记录

日期：2026-10-23。网页端已发布，数据库迁移已执行；小程序云函数已部署并显示 Active，线上源码已回读核实，与 `ba29150` 一致。两个功能开关保持关闭，功能对用户不可用。

## 授权与范围

用户 2026-10-23 原话「部署文档05」。范围：

- 网页提交 `6503a5ae`（分支 `codex/wechat-scan-login-20261022`）合入 main 并推送，正式站发布。
- 正式库只执行新增迁移 `0035_web_login_requests`，只新建表 `web_login_requests`。
- 小程序云函数 `drinkingTimeBridge` 部署 `ba29150`。
- `WECHAT_SCAN_LOGIN_ENABLED`、`WEB_LOGIN_CONFIRM_ENABLED` 保持关闭，不改 `.env`、nginx、证书和其他环境变量。
- 上传小程序开发版、出二维码不在本次范围，未执行。

## 发布前验证（在 6503a5ae 上）

| 项 | 结果 |
|---|---|
| migration:verify | 通过，36 条迁移，最新 0035 |
| check | 通过 |
| feature:validate | 通过，67 张卡，无需新增功能卡 |
| build | 通过 |
| test | 9 项失败，5677 项通过 |
| test:mysql-integration | 未执行，没有一次性测试库 |

9 项失败均为既有基线失败，在干净的 `f6728b9b` 上同样失败，本次未新增：architecture-boundaries 1 项、mediaRouteAuth 1 项、sdk.session 1 项、routers.storyAgent 6 项。

## 生产发布记录（网页）

- main 从 `f6728b9b` 快进到 `6503a5ae` 并推送。合并在独立工作树完成，未触碰根目录 checkout。
- 服务器源码 checkout 仍为 `0f649128`，未执行 git pull，运行采用 dist 部署。
- 数据库备份：`/root/drinking-time-wechat-scan-login-20261023/mysql/drinking-time-20261023-113511.sql`。
- 迁移前核对：正式库 35 条历史迁移的时间戳和 SQL 哈希与仓库逐条一致，仅缺 0035。迁移前 81 张表，无 `web_login_requests`。
- 只执行 0035：迁移记录 35 → 36，表数 81 → 82，仅新增 `web_login_requests`。结果留档 `migration-0035-result.json`。
- 增量发布：候选 95 个文件，仅 `dist/index.js`、`dist/public/index.html`、`dist/public/assets/index-CeGaki8i.js` 与线上不同，CSS 未变。上传后在暂存目录校验哈希，再替换。
- PM2 `drinking-time` 重启后在线；本机 `/readyz` 返回 ready、mysql、authentication required。`.env` 字节哈希发布前后一致，前 16 位为 `adfa1b44071c6d7d`。
- 公网 `https://www.drinkingtime.top` 的 `/`、`/m`、`/healthz`、`/readyz` 均为 200；首页、JS、CSS 的哈希与候选一致。
- 开关关闭验证：匿名且不带 Origin 的 `POST /api/auth/wechat-scan/create` 返回 403 `invalid_origin`，来源校验先拦截。带本站 Origin 时返回 404 `{"error":"disabled"}`，说明开关关闭生效。发布前该路径同样是 403。
- 应用回滚备份：`/opt/Drinking-Time/dist.bak-20261023-wechat-scan-login-6503a5ae-public` 和 `-index.js`；发布文件清单与迁移结果为同目录下 `dist.release-20261023-wechat-scan-login-6503a5ae.sha256` 和 `-migration.json`。回滚办法：换回备份 dist 并重启 PM2，保留新表，不执行删表。
- 日志里只有外部出图服务连接超时，与本次发布无关。

## 小程序云函数 drinkingTimeBridge

状态：**已部署，Active，脚本验证通过，线上源码已回读核实，与 `ba29150` 一致。**（初版记录曾写「源码未回读核实」，网络恢复后已补做比对，见下。）

- 源码：`ba29150`（分支 `codex/wechat-scan-login-20261022`），包含 main `235932e`，工作树干净。
- 命令：标准脚本 `node scripts/wechat-cloud-deploy.mjs --execute --env cloud1-d5ghzk30ve609f544 --only drinkingTimeBridge`，不设置任何环境变量。部署前干跑确认计划只含 `drinkingTimeBridge`，不影响 getOpenId、storyBooks、familyInvite。
- 第一次执行脚本报「CLI 报告失败」，输出被脚本隐藏，原因未知。随后 `info` 遇到一次 ECONNRESET，重试后为 Active。
- 第一次失败后的下载只得到 206 字节的示例 `index.js`（Hello World），说明那次失败的部署没有传上代码。
- 第二次执行脚本成功，脚本内 `info` 验证通过，记录的源码提交 `ba2915040ea93726c716ef5a0ea022bf1ff12a4c`，时间 2026-10-23T03:52:06Z。
- 部署后回读：共尝试 6 次下载。前 3 次为部署后立即尝试，后 3 次为协调会话批准的间隔 2 分钟重试，每次都下载到新空目录。全部 ECONNRESET（多数在 TLS 握手前，个别发生在拉取环境列表时），未取得任何文件。因此无法证明云端 `core.js`、`egress.js`、`package.json`、`index.js` 与 `ba29150` 一致。
- 未重新部署，未改任何环境变量。
- **补做的线上源码比对（网络恢复后，第 1 次下载即成功）：** 把云端 `drinkingTimeBridge` 下载到全新空目录，与 `ba29150` 的 `cloudfunctions/drinkingTimeBridge` 逐字节比对，排除 `node_modules` 和 `package-lock.json`。云端 4 个文件、仓库 4 个文件，数量一致，4 个全部相同，无多余、无缺失。

| 文件 | 字节数 | 结果 |
|---|---|---|
| core.js | 4300 | 相同 |
| egress.js | 5623 | 相同 |
| index.js | 4140 | 相同，不是 206 字节示例 |
| package.json | 151 | 相同 |

## Known gaps

- `test:mysql-integration` 没有一次性测试库，未执行。
- 两个开关仍关闭，真实的网页扫码或小程序确认登录链路未在正式站验证。开启开关、上传小程序开发版、出二维码都在后续范围。
- 云函数线上源码已确认为 `ba29150`，但云函数侧的 `WEB_LOGIN_CONFIRM_ENABLED` 仍关闭，小程序端页面是否已随开发版上传、真机是否走通，本次未验证。
