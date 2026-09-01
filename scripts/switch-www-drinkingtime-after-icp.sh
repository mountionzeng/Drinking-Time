#!/usr/bin/env bash
# ICP/DNS/证书均已准备好后，将 Drinking Time 从未公开的 HTTP 占位配置切到 HTTPS。
# 本脚本不申请证书、不修改 .env、不运行数据库迁移；这些操作都有独立批准边界。

set -euo pipefail

DOMAIN="${DOMAIN:-www.drinkingtime.top}"
APP_DIR="${APP_DIR:-/opt/Drinking-Time}"
APP_PORT="${APP_PORT:-3000}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/drinking-time.conf}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/$DOMAIN}"
DRY_RUN="${DRY_RUN:-0}"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  echo "错误：$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

validate_inputs() {
  printf '%s' "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || die "DOMAIN 格式不安全。"
  printf '%s' "$APP_PORT" | grep -Eq '^[0-9]+$' || die "APP_PORT 必须是数字。"
  [ "$APP_PORT" -ge 1 ] && [ "$APP_PORT" -le 65535 ] || die "APP_PORT 超出范围。"
}

print_dry_run() {
  log "[DRY_RUN] HTTPS 发布切换演练"
  echo "[DRY_RUN] HTTP → HTTPS：80 端口将以 308 跳转到 https://${DOMAIN}。"
  echo "[DRY_RUN] HTTPS：443 将反代到 http://127.0.0.1:${APP_PORT}。"
  echo "[DRY_RUN] nginx 将覆盖 X-Forwarded-Proto 为 \$scheme，覆盖 X-Forwarded-For 为 \$remote_addr。"
  echo "[DRY_RUN] 将检查证书：${CERT_DIR}/fullchain.pem 与 ${CERT_DIR}/privkey.pem。"
  echo "[DRY_RUN] 将备份 ${NGINX_CONF}，再运行 nginx -t，通过后 reload。"
  echo "[DRY_RUN] 将检查 /healthz 与 /readyz。"
  echo "[DRY_RUN] 不会修改 nginx、证书、.env、PM2 服务或数据库。"
}

verify_release_prerequisites() {
  local env_path="$APP_DIR/.env"
  [ -f "$env_path" ] || die "找不到 $env_path；先完成生产环境配置。"
  [ -f "$CERT_DIR/fullchain.pem" ] || die "证书不存在：$CERT_DIR/fullchain.pem"
  [ -f "$CERT_DIR/privkey.pem" ] || die "证书私钥不存在：$CERT_DIR/privkey.pem"

  APP_DIR="$APP_DIR" DOMAIN="$DOMAIN" node <<'NODE'
const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join(process.env.APP_DIR, ".env"), "utf8");
const env = new Map();
for (const line of raw.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ""));
}
const expectedOrigin = `https://${process.env.DOMAIN}`;
const failures = [];
if (env.get("NODE_ENV") !== "production") failures.push("NODE_ENV=production");
if (env.get("DISABLE_AUTH") !== "false") failures.push("DISABLE_AUTH=false");
if (env.get("APP_ORIGIN") !== expectedOrigin) failures.push(`APP_ORIGIN=${expectedOrigin}`);
if (!String(env.get("DATABASE_URL") || "").toLowerCase().includes("charset=utf8mb4")) {
  failures.push("DATABASE_URL=mysql://...?charset=utf8mb4");
}
if (String(env.get("JWT_SECRET") || "").length < 32) failures.push("JWT_SECRET 至少 32 字符");
if (!String(env.get("CSP_MEDIA_ORIGINS") || "").trim()) failures.push("CSP_MEDIA_ORIGINS 显式白名单");
if (failures.length) {
  console.error(`生产发布前置条件不满足：${failures.join("；")}`);
  process.exit(2);
}
NODE

  curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null
  curl -fsS "http://127.0.0.1:$APP_PORT/readyz" >/dev/null
}

nginx_config() {
  cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    return 308 https://$DOMAIN\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
}

install_nginx_config() {
  local backup=""
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"

  install -d -m 0755 "$(dirname "$NGINX_CONF")"
  if [ -f "$NGINX_CONF" ]; then
    backup="$NGINX_CONF.before-https-$timestamp"
    cp -p "$NGINX_CONF" "$backup"
    log "已备份 nginx 配置：$backup"
  fi

  nginx_config > "$NGINX_CONF"
  if ! nginx -t; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$NGINX_CONF"
    else
      mv "$NGINX_CONF" "$NGINX_CONF.failed-$timestamp"
    fi
    die "nginx -t 失败；已恢复发布前配置。"
  fi
  systemctl reload nginx
}

verify_https() {
  curl --fail --silent --show-error --resolve "$DOMAIN:443:127.0.0.1" \
    "https://$DOMAIN/healthz" >/dev/null
  curl --fail --silent --show-error --resolve "$DOMAIN:443:127.0.0.1" \
    "https://$DOMAIN/readyz" >/dev/null
  log "HTTPS 已切换；/healthz 与 /readyz 均通过。"
}

main() {
  validate_inputs
  if [ "$DRY_RUN" = "1" ]; then
    print_dry_run
    return
  fi

  [ "$(id -u)" = "0" ] || die "真实切换请用 root 执行：sudo bash $0"
  require_command node
  require_command curl
  require_command nginx
  require_command systemctl
  verify_release_prerequisites
  install_nginx_config
  verify_https
}

main "$@"
