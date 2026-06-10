#!/usr/bin/env bash
# update-prod.sh —— 已在运行的生产环境「安全更新」脚本（阿里云 ECS）。
#
# 与 deploy-initial-aliyun.sh 的区别：那个是「从零初始部署」（装系统依赖、建库、写 nginx）；
# 这个只做「更新一份已经在跑的部署」，而且补上了初始脚本的一个缺口——
#   在动数据库（db:push）之前【先备份 MySQL】，并记录回滚点、健康检查失败时自动回滚。
#
# 用法（SSH 登上 ECS 后，用 root 执行）：
#   sudo bash /opt/Drinking-Time/scripts/update-prod.sh             # 真实更新
#   sudo DRY_RUN=1 bash /opt/Drinking-Time/scripts/update-prod.sh   # 先演练：只打印每一步，不真的执行
#
# 流程：备份 MySQL → 记录当前提交（回滚点）→ 拉取 main → 装依赖 → 构建 →
#       db:push（无 schema 变更则 no-op）→ pm2 重启 → 健康检查；
#       健康检查不过 → 自动回滚到更新前的提交并重启，保住线上服务。

set -euo pipefail

# ── 可被环境变量覆盖的参数（默认值对齐 deploy-initial-aliyun.sh）──
APP_DIR="${APP_DIR:-/opt/Drinking-Time}"
APP_PORT="${APP_PORT:-3000}"
PM2_APP="${PM2_APP:-drinking-time}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT}/healthz}"
DRY_RUN="${DRY_RUN:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { echo "错误：$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = "1" ]; then printf '[DRY_RUN]'; printf ' %q' "$@"; printf '\n';
  else "$@"; fi
}
run_bash() {
  if [ "$DRY_RUN" = "1" ]; then echo "[DRY_RUN] bash -lc $1"; else bash -lc "$1"; fi
}

# ── 前置校验 ──
[ "$(id -u)" = "0" ] || [ "$DRY_RUN" = "1" ] || die "请用 root 执行：sudo bash $0"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR 不是 git 仓库；初次部署请先用 deploy-initial-aliyun.sh。"
command -v pnpm >/dev/null 2>&1 || [ "$DRY_RUN" = "1" ] || die "缺少 pnpm。"
command -v pm2  >/dev/null 2>&1 || [ "$DRY_RUN" = "1" ] || die "缺少 pm2。"
command -v curl >/dev/null 2>&1 || [ "$DRY_RUN" = "1" ] || die "缺少 curl。"

cd "$APP_DIR"
run git config --global --add safe.directory "$APP_DIR"

# 记录回滚点：更新前线上实际在跑的提交
OLD_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
log "更新前提交（回滚点）：${OLD_SHA:-未知}"

# 1) 动库前先备份 MySQL（复用现有 backup-mysql.sh）
log "① 备份 MySQL（动库前的安全网）"
if [ -f "$SCRIPT_DIR/backup-mysql.sh" ]; then
  run_bash "DRY_RUN='$DRY_RUN' bash '$SCRIPT_DIR/backup-mysql.sh'"
else
  log "⚠️ 没找到 backup-mysql.sh —— 强烈建议你先手动 mysqldump 再继续，否则 db:push 出问题无从恢复。"
fi

# 2) 拉取最新 main（--ff-only：线上若有本地提交会安全报错而不是乱合）
log "② 拉取 $DEPLOY_BRANCH"
run git fetch origin "$DEPLOY_BRANCH"
run git checkout "$DEPLOY_BRANCH"
run git pull --ff-only origin "$DEPLOY_BRANCH"
NEW_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
log "更新后提交：${NEW_SHA:-未知}"

# 3) 装依赖 + 构建
log "③ 安装依赖（--frozen-lockfile）"
run_bash "cd '$APP_DIR' && pnpm install --frozen-lockfile"
log "④ 构建（vite build + esbuild → dist/）"
run_bash "cd '$APP_DIR' && pnpm run build"

# 4) 迁移（drizzle db:push；无 schema 变更则 no-op，且第①步已备份）
log "⑤ db:push（无 schema 变更则 no-op）"
run_bash "cd '$APP_DIR' && pnpm run db:push"

# 5) 重启
log "⑥ pm2 重启 $PM2_APP"
run_bash "NODE_ENV=production PORT='$APP_PORT' pm2 restart '$PM2_APP' --update-env"

# 6) 健康检查（应用要几秒启动，最多重试约 20s）
health() {
  for _ in $(seq 1 10); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

if [ "$DRY_RUN" = "1" ]; then
  echo "[DRY_RUN] ⑦ 将健康检查 $HEALTH_URL；失败则自动回滚到 $OLD_SHA。"
  log "演练结束（没有任何真实改动）。"
  exit 0
fi

log "⑦ 健康检查 $HEALTH_URL"
if health; then
  log "✅ 更新成功，服务健康。当前提交 $NEW_SHA；MySQL 备份在 $APP_DIR/backups/。"
  exit 0
fi

# 健康检查失败 → 自动回滚保住线上
log "❌ 健康检查失败，自动回滚到 $OLD_SHA …"
[ -n "$OLD_SHA" ] || die "没有记录到回滚点，无法自动回滚。请 pm2 logs $PM2_APP 排查。"
git checkout "$OLD_SHA" || die "回滚 checkout 失败，请人工处理（当前在 $NEW_SHA）。"
bash -lc "cd '$APP_DIR' && pnpm install --frozen-lockfile && pnpm run build"
NODE_ENV=production PORT="$APP_PORT" pm2 restart "$PM2_APP" --update-env || true
if health; then
  log "↩️ 已回滚到 $OLD_SHA 并恢复健康。请先排查 $NEW_SHA 的问题，再重试更新。"
  log "（注意：此时仓库处于 detached HEAD；排查好后重跑本脚本会重新 checkout $DEPLOY_BRANCH。）"
  exit 1
else
  die "回滚后仍不健康！立即人工介入：pm2 logs $PM2_APP 看日志；必要时从 $APP_DIR/backups/ 恢复 MySQL。"
fi
