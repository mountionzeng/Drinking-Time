# Drinking Time 阿里云 ECS 发布 Runbook

> 这份文档描述可审计的生产发布路径。它不是授权：远程部署、证书、域名、系统配置、生产数据库结构或数据变更都必须在执行前再次获得岱岱明确批准。

## 发布结论

生产环境只有同时满足以下条件才允许公开 `/m`：

- `https://www.drinkingtime.top` 是唯一应用 origin，HTTP 只做 308 跳转；
- `DISABLE_AUTH=false`，邮箱/Google 登录使用真实账号身份；
- `JWT_SECRET` 至少 32 字符且不是占位值；
- `DATABASE_URL` 指向共享 MySQL，并显式带 `charset=utf8mb4`；
- `CSP_MEDIA_ORIGINS` 是实际媒体来源的 HTTPS origin 白名单；
- nginx 只把本机 `127.0.0.1:3000` 暴露给应用，覆盖转发协议/IP头；
- `/healthz` 与 `/readyz` 均通过；后者会校验生产配置和 MySQL 连通性；
- Drizzle 生产 ledger/schema 与仓库迁移基线已经在只读预检中一致。

不再把公网 IP HTTP、guest 身份或 `.webdev/local-persist.json` 当作“先上线再说”的生产模式。HTTP 预置阶段不公开应用。

## 固定参数

| 项 | 值 |
|---|---|
| ECS 公网 IP | `8.160.186.193` |
| 正式域名 | `www.drinkingtime.top` |
| 应用目录 | `/opt/Drinking-Time` |
| 部署分支 | `main` |
| Node 端口 | `127.0.0.1:3000`（安全组不得放行） |
| PM2 应用名 | `drinking-time` |
| nginx 配置 | `/etc/nginx/conf.d/drinking-time.conf` |
| 默认已有证书 | `/etc/letsencrypt/live/www.drinkingtime.top/` |

## 授权边界

无需另批的常规维护仅限已有生产路径上的拉代码、安装锁定依赖、构建、重启已有 PM2 应用和只读排查。以下操作每次都要单独批准：

- 远程首次部署或公开 `/m`；
- 申请/更新证书、DNS、ICP、安全组和 nginx 系统配置；
- 修改 `.env` 中的密钥、身份或 origin；
- MySQL 建库、迁移、导入、回滚、恢复或删数据；
- 新增 swap、改系统资源或任何破坏性操作。

## 0. 只读盘点

先在 ECS 上采集现状，不修改服务：

```bash
whoami
cat /etc/os-release
node -v || true
pnpm -v || true
pm2 ls || true
nginx -v || true
mysql --version || true
git -C /opt/Drinking-Time status --short --branch || true
git -C /opt/Drinking-Time log --oneline -5 || true
test -f /etc/nginx/conf.d/drinking-time.conf && sed -n '1,220p' /etc/nginx/conf.d/drinking-time.conf || true
ss -lntp | grep -E ':(80|443|3000)\b' || true
curl -fsS http://127.0.0.1:3000/healthz || true
curl -fsS http://127.0.0.1:3000/readyz || true
```

不要把 `.env`、数据库 URL、token 或密钥贴进聊天。若目录不是预期仓库、服务来源不明或数据库 ledger 不一致，停止发布。

## 1. 本地代码闸门

在主仓库、目标提交上运行：

```bash
pnpm env:status
pnpm migration:verify
pnpm check
pnpm feature:validate
pnpm test:mysql-integration
pnpm test
pnpm build
pnpm env:check
```

`pnpm test:mysql-integration` 必须使用一次性 `TEST_MYSQL_DATABASE_URL`。没有该变量时的本地 skip 只说明“未执行”，不能算生产发布通过。

## 2. 生产迁移基线只读预检

在任何 schema 变更前，先备份，再只读比较：

1. 仓库 `drizzle/meta/_journal.json`、snapshot 和 SQL 文件哈希；
2. 生产 Drizzle applied ledger 的顺序、哈希和数量；
3. 生产表、列、索引、约束及默认字符集；
4. U0 一次性 MySQL 从零迁移的最终结构。

只读结果不一致时，不得运行 `db:push`、手工补 ledger 或跳过 migration。先形成差异报告和恢复方案，再申请单独的数据库变更批准。

## 3. `.env` 发布前条件

生产配置至少包含：

```dotenv
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://www.drinkingtime.top
OAUTH_SERVER_URL=https://auth.drinkingtime.top
DISABLE_AUTH=false
DATABASE_URL=mysql://<user>:<password>@127.0.0.1:3306/drinking_time?charset=utf8mb4
JWT_SECRET=<至少32字符的随机值>
CSP_MEDIA_ORIGINS=https://file.302.ai https://d2xsxph8kpxj0f.cloudfront.net
```

白名单必须覆盖权威数据中实际使用的图片/音视频 origin；不要使用 `*`、HTTP 或 CSP 指令片段。应用启动时会再次校验这些条件，因此 PM2 或人工直启也不能绕过。

## 4. 初始预置演练

初始脚本安装依赖、准备应用/MySQL、构建并写入“HTTP 只跳 HTTPS”的 nginx 占位配置。它不会公开 HTTP 应用。

```bash
cd /opt/Drinking-Time
sudo DRY_RUN=1 bash scripts/deploy-initial-aliyun.sh
```

演练不安装包、不写文件、不启动 PM2、不修改 nginx 或数据库。真实初始部署涉及系统和数据库变更，必须另行批准：

```bash
sudo bash scripts/deploy-initial-aliyun.sh
```

脚本创建 `.env` 模板后会因占位值失败关闭。由岱岱在服务器本地填写真实值再重跑，不得由 agent 编造密钥。

## 5. 数据库 expand / dual-read / enforce

手机聊天 turn 身份采用向前兼容的三段发布：

1. **Expand**：只增加可空 turn 记录、链接和索引；迁移前后核对表、列、索引、字符集及行数。
2. **Dual-read**：部署兼容代码，旧消息继续读取，新手机写入一律使用 durable turn；检查重复 client ID、孤立链接和异常配对，不替旧数据编造 turn。
3. **Enforce**：只有数据检查证明安全后，才在新的批准中收紧约束。

最后一个 rollback-safe point 是“expand 已完成、dual-read 代码已部署、尚未执行不兼容 enforce”。超过该点后，不得把应用或 schema 单独回滚到不兼容版本；优先 forward-fix，并附数据处理方案。

生产结构和数据的任何实际变化都不包含在本次手机 Web 代码交付授权中。

## 6. HTTPS 切换演练

证书须预先存在；切换脚本不会申请或修改证书，也不会修改 `.env`、PM2 或数据库。

```bash
cd /opt/Drinking-Time
sudo DRY_RUN=1 bash scripts/switch-www-drinkingtime-after-icp.sh
```

检查输出必须明确包含：

- HTTP → HTTPS 308；
- HTTPS 反代 `127.0.0.1:3000`；
- nginx 覆盖 `X-Forwarded-Proto $scheme` 和 `X-Forwarded-For $remote_addr`；
- 证书路径、nginx 备份、`nginx -t`；
- 明确说明不会修改哪些对象。

获得域名/证书/nginx 变更批准后才可执行：

```bash
sudo bash scripts/switch-www-drinkingtime-after-icp.sh
```

脚本先验证 `.env`、证书、本机 health/readiness，再备份 nginx。`nginx -t` 失败会恢复发布前配置；成功后 reload，并通过本机 `--resolve` 验证 HTTPS。

## 7. 发布后验收

自动化与公网实测必须都完成：

```bash
curl -fsS https://www.drinkingtime.top/healthz
curl -fsS https://www.drinkingtime.top/readyz
curl -sSI http://www.drinkingtime.top/m | sed -n '1,12p'
curl -sSI https://www.drinkingtime.top/m | sed -n '1,20p'
pm2 logs drinking-time --lines 80 --nostream
```

随后用两个独立设备/浏览器身份完成：

- 手机登录返回 `/m`，另一账号不能读取第一账号 Story；
- 手机聊聊 → 电脑刷新可见，电脑继续 → 手机刷新可见，turn 不重复；
- 手机正文保存 → 电脑刷新可见，反向亦然；标题、标签、其他平台/版本不变；
- 两端从同一 revision 修改，只能一个成功，冲突端保留本地和服务器正文；
- iOS Safari/Android Chrome 的 320–390px、键盘、中文 IME、safe-area、横竖屏和断网恢复。

记录到 `docs/qa/2026-09-01-mobile-cross-device-acceptance.md`。未实测的项目必须写“待验证”，不能凭本地自动化推断通过。

## 8. 备份与旧本地数据

MySQL 变更前先演练并备份：

```bash
sudo DRY_RUN=1 bash scripts/backup-mysql.sh
sudo bash scripts/backup-mysql.sh
```

`.webdev/local-persist.json` 只能作为受控迁移源，不能作为跨设备后端。若确需导入：先保存源文件哈希和备份，运行导入 dry-run，核对每类计数及 `userId + storyId` 归属，再单独批准真实导入。导入后再次核对，禁止把多台设备的本地 JSON 合并成“云同步”。

## 9. 回滚

nginx 切换会生成：

```text
/etc/nginx/conf.d/drinking-time.conf.before-https-<时间戳>
```

经批准回滚 nginx：

```bash
sudo cp /etc/nginx/conf.d/drinking-time.conf.before-https-<时间戳> /etc/nginx/conf.d/drinking-time.conf
sudo nginx -t
sudo systemctl reload nginx
```

应用回滚前先确认目标提交兼容当前 schema。数据库恢复属于独立高风险操作：先停写、另存当前库、确认备份和恢复查询，再执行。跨过 rollback-safe point 后禁止盲目回滚旧应用/旧 schema。

## 10. No-Go 条件

出现任一项即停止公开 `/m`：

- HTTP 可直接打开应用，或 Secure/Lax Cookie 不成立；
- `DISABLE_AUTH` 不是严格 `false`；
- `/readyz` 非 200，MySQL 不可用或字符集不明；
- 生产迁移 ledger/schema 与基线不一致；
- CSP 使用 wildcard/HTTP，或正常页面资源被策略意外阻断；
- 缺少备份、回滚点、iOS/Android 或双设备跨端证据；
- 账号、Story、版本/平台隔离出现任何异常。
