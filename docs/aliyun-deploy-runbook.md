# Drinking Time 阿里云 ECS 初始部署 Runbook

这份手册给岱岱在服务器上执行。Codex 不登录 ECS、不代填密钥、不替你跑 root 命令。

目标分两段：

1. 备案前：先用公网 IP `http://8.160.186.193/` 跑通，nginx 反代到本机 `127.0.0.1:3000`。
2. ICP 备案通过后：DNS 指向 `8.160.186.193`，再运行 `scripts/switch-www-drinkingtime-after-icp.sh` 切到 `https://www.drinkingtime.top`。

固定参数：

| 项 | 值 |
|---|---|
| ECS 公网 IP | `8.160.186.193` |
| 服务器项目目录 | `/opt/Drinking-Time` |
| 远端仓库 | `https://github.com/mountionzeng/Drinking-Time.git` |
| 部署分支 | `main` |
| 应用端口 | `3000` |
| PM2 应用名 | `drinking-time` |
| nginx 配置 | `/etc/nginx/conf.d/drinking-time.conf` |
| MySQL 备份脚本 | `/opt/Drinking-Time/scripts/backup-mysql.sh` |

## 0. 先探明现状（只读，零风险）

先 SSH 到 ECS。下面命令只读，不会改任何东西。把输出贴给复核 agent 后，再决定走全新安装还是更新已有。

```bash
whoami
id
hostname
date
cat /etc/os-release

command -v apt-get || true
command -v dnf || true
command -v yum || true

node -v || true
pnpm -v || true
pm2 -v || true
nginx -v || true
mysql --version || true
mysqld --version || true
mysqldump --version || true

ls -la /opt || true
ls -la /opt/Drinking-Time || true
git -C /opt/Drinking-Time status --short --branch || true
git -C /opt/Drinking-Time remote -v || true
git -C /opt/Drinking-Time branch --show-current || true

pm2 ls || true
ls -la /etc/nginx/conf.d || true
test -f /etc/nginx/conf.d/drinking-time.conf && sed -n '1,220p' /etc/nginx/conf.d/drinking-time.conf || true

ss -lntp | grep -E ':(80|3000)\b' || true
curl -fsS http://127.0.0.1:3000/healthz || true
curl -fsS http://8.160.186.193/healthz || true
```

如果 `/opt/Drinking-Time` 已经存在且不是这个仓库，先停下来，不要直接覆盖。

## 1. 本地前置：确认 main 已经包含要部署的代码

这一步在你自己的电脑上做，不在 ECS 上做。

```bash
git checkout main
git pull origin main
git merge feat/mobile-chat-image
git push origin main
```

如果你已经手动完成，就跳过。部署脚本只会在服务器上拉 `main`。

## 2. 阿里云安全组

安全组放行：

- 入方向 TCP `80`：允许公网访问备案前 HTTP。
- 入方向 TCP `22`：只给你自己的管理 IP。

不要把 `3000` 放给公网。Node 只监听给 nginx 反代用，公网入口是 `80`，备案后是 `443`。

## 3. 第一次上传 / 拉取部署脚本

如果服务器还没有仓库，先用下面任一方式让服务器拿到脚本。

推荐方式：直接从 GitHub 拉 `main`。如果 `/opt/Drinking-Time` 不存在：

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone --branch main https://github.com/mountionzeng/Drinking-Time.git Drinking-Time
cd /opt/Drinking-Time
```

如果仓库已经存在：

```bash
cd /opt/Drinking-Time
sudo git fetch origin main
sudo git checkout main
sudo git pull --ff-only origin main
```

## 4. 先演练初始部署

演练模式不会安装包、不会写 nginx、不会启动 PM2、不会改数据库。

```bash
cd /opt/Drinking-Time
sudo DRY_RUN=1 bash scripts/deploy-initial-aliyun.sh
```

看输出是否符合预期：目录是 `/opt/Drinking-Time`，端口是 `3000`，nginx 配置是 `/etc/nginx/conf.d/drinking-time.conf`，PM2 应用名是 `drinking-time`。

## 5. 生成 .env 模板

真实部署脚本会自动创建 `/opt/Drinking-Time/.env` 模板。如果还没创建，先真实跑一次脚本，它会装基础依赖、拉代码、创建模板，然后在 `.env` 未填完整处停下：

```bash
cd /opt/Drinking-Time
sudo bash scripts/deploy-initial-aliyun.sh
```

然后编辑：

```bash
sudo nano /opt/Drinking-Time/.env
sudo chmod 600 /opt/Drinking-Time/.env
```

必须由岱岱手动填写的关键项：

```bash
NODE_ENV=production
PORT=3000
APP_ORIGIN=http://8.160.186.193
OAUTH_SERVER_URL=http://8.160.186.193
DISABLE_AUTH=true
DATABASE_URL=mysql://drinking_time_app:<岱岱自定数据库密码>@127.0.0.1:3306/drinking_time?charset=utf8mb4
JWT_SECRET=<岱岱生成的长随机密钥>
BUILT_IN_FORGE_API_URL=<302 或其它 OpenAI 兼容接口地址>
BUILT_IN_FORGE_API_KEY=<大模型接口密钥>
LLM_MODEL=<模型名>
FAL_KEY=<fal.ai 密钥>
```

可选但建议确认：

```bash
LLM_SUPPORTS_IMAGE=true
LLM_SUPPORTS_RESPONSE_FORMAT=true
VOICE_TRANSCRIPTION_MODEL=whisper-1
DROP_ZONE_API_URL=
DROP_ZONE_MODEL=
VISION_API_URL=
VISION_MODEL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@drinking-time.com
HUANGLI_API_KEY=
```

注意：

- 不要把 `.env` 内容贴到聊天里。
- `DATABASE_URL` 必须带 `charset=utf8mb4`。
- 备案前 `APP_ORIGIN` 和 `OAUTH_SERVER_URL` 都用 `http://8.160.186.193`。
- 登录隔离还没准备好时，保持 `DISABLE_AUTH=true`。

## 6. 正式跑初始部署

如果 MySQL root 没有密码：

```bash
cd /opt/Drinking-Time
sudo bash scripts/deploy-initial-aliyun.sh
```

如果 MySQL root 有密码：

```bash
cd /opt/Drinking-Time
sudo -E MYSQL_ROOT_PASSWORD='<只在你的终端里输入，不要贴给 agent>' bash scripts/deploy-initial-aliyun.sh
```

脚本会做这些事：

1. 安装 Node.js、pnpm、nginx、PM2、MySQL 客户端/服务端。
2. 拉取或更新 `/opt/Drinking-Time` 的 `main` 分支。
3. 校验 `.env` 必需键。
4. 本机 MySQL 建库 `drinking_time`、建账号、授权，字符集 `utf8mb4`。
5. `pnpm install --frozen-lockfile`。
6. `pnpm run build`。
7. `pnpm run db:push` 建表/迁移。
8. PM2 启动 `dist/index.js`，应用名 `drinking-time`。
9. 写入 IP HTTP 版 nginx 配置。
10. 检查 `/healthz`。

## 7. 可选：导入旧 local-persist 数据

如果要把本地 `.webdev/local-persist.json` 搬到生产 MySQL：

1. 先把备份 JSON 安全传到服务器，比如：

   ```bash
   sudo mkdir -p /opt/Drinking-Time/.webdev
   sudo chmod 700 /opt/Drinking-Time/.webdev
   # 用 scp / rsync 上传 local-persist.json 到 /opt/Drinking-Time/.webdev/local-persist.json
   ```

2. 先演练：

   ```bash
   cd /opt/Drinking-Time
   sudo -E LOCAL_PERSIST_PATH=/opt/Drinking-Time/.webdev/local-persist.json pnpm tsx scripts/import-local-persist-to-mysql.ts --dry-run
   ```

3. 确认计数后真实导入：

   ```bash
   cd /opt/Drinking-Time
   sudo -E LOCAL_PERSIST_PATH=/opt/Drinking-Time/.webdev/local-persist.json pnpm tsx scripts/import-local-persist-to-mysql.ts
   ```

导入脚本是幂等的，已存在主键会跳过，不会 truncate。

如果想让初始部署脚本顺带导入：

```bash
cd /opt/Drinking-Time
sudo -E IMPORT_LOCAL_PERSIST=1 LOCAL_PERSIST_PATH=/opt/Drinking-Time/.webdev/local-persist.json bash scripts/deploy-initial-aliyun.sh
```

## 8. 初始部署验收

在服务器上：

```bash
pm2 ls
pm2 logs drinking-time --lines 80
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://8.160.186.193/healthz
nginx -t
```

在你自己的电脑浏览器打开：

```text
http://8.160.186.193/
```

## 9. MySQL 备份

手动跑一次备份：

```bash
cd /opt/Drinking-Time
sudo bash scripts/backup-mysql.sh
sudo ls -lh /opt/Drinking-Time/backups
```

演练：

```bash
cd /opt/Drinking-Time
sudo DRY_RUN=1 bash scripts/backup-mysql.sh
```

可以后续加 cron，例如每天凌晨 3 点备份：

```bash
sudo crontab -e
```

加入：

```cron
0 3 * * * cd /opt/Drinking-Time && bash scripts/backup-mysql.sh >> /opt/Drinking-Time/backups/backup.log 2>&1
```

## 10. ICP 备案通过后的域名切换

前置：

1. DNS：`www.drinkingtime.top` 和 `drinkingtime.top` 都解析到 `8.160.186.193`。
2. 安全组：放行 `80` 和 `443`。
3. 当前应用已经由 PM2 跑在 `127.0.0.1:3000`。
4. `/opt/Drinking-Time/scripts/backup-mysql.sh` 存在且可执行。

先演练：

```bash
cd /opt/Drinking-Time
sudo DRY_RUN=1 bash scripts/switch-www-drinkingtime-after-icp.sh
```

确认无误后执行：

```bash
cd /opt/Drinking-Time
sudo bash scripts/switch-www-drinkingtime-after-icp.sh
```

默认不会打开账号隔离。等旧故事迁移和 OAuth 都准备好后，再明确执行：

```bash
cd /opt/Drinking-Time
sudo ENABLE_AUTH=1 bash scripts/switch-www-drinkingtime-after-icp.sh
```

## 11. 回滚

### 回滚应用代码

查看最近提交：

```bash
cd /opt/Drinking-Time
git log --oneline -5
```

回到上一个提交并重启：

```bash
cd /opt/Drinking-Time
sudo git checkout <上一个可用commit>
sudo pnpm install --frozen-lockfile
sudo pnpm run build
sudo NODE_ENV=production PORT=3000 pm2 restart drinking-time --update-env
```

恢复到 main 最新：

```bash
cd /opt/Drinking-Time
sudo git checkout main
sudo git pull --ff-only origin main
sudo pnpm install --frozen-lockfile
sudo pnpm run build
sudo NODE_ENV=production PORT=3000 pm2 restart drinking-time --update-env
```

### 回滚 nginx 配置

初始部署脚本覆盖 nginx 前会生成：

```text
/etc/nginx/conf.d/drinking-time.conf.before-initial-<时间戳>
```

回滚：

```bash
sudo cp /etc/nginx/conf.d/drinking-time.conf.before-initial-<时间戳> /etc/nginx/conf.d/drinking-time.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 数据库恢复

先停应用：

```bash
sudo pm2 stop drinking-time
```

确认要恢复的备份：

```bash
sudo ls -lh /opt/Drinking-Time/backups
```

恢复前请先另存当前库；不要直接覆盖生产数据。需要恢复时，把具体备份文件和当前情况交给复核 agent 再操作。

## 12. 常见问题

### 脚本停在 `.env 还没填完整`

这是预期行为。脚本已经创建模板，但不会替你编密钥。填好 `/opt/Drinking-Time/.env` 后重跑即可。

### `DATABASE_URL 必须带 charset=utf8mb4`

把连接串末尾改成：

```text
?charset=utf8mb4
```

### 80 端口健康检查失败

依次查：

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
ss -lntp | grep -E ':(80|3000)\b'
curl -fsS http://127.0.0.1:3000/healthz
pm2 logs drinking-time --lines 120
```

### 3000 被公网直接访问

这是安全组问题。应用可以监听本机 3000，但阿里云安全组不要对公网放行 3000。
