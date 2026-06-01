#!/usr/bin/env bash
# MySQL 备份脚本：由初始部署脚本安装，也供备案后切换 HTTPS 前调用。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-30}"
DRY_RUN="${DRY_RUN:-0}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  echo "错误：$*" >&2
  exit 1
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  die "缺少命令：$1"
}

parse_database_url() {
  APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" node <<'NODE'
const fs = require("fs");
const envPath = process.env.ENV_FILE;
const raw = fs.readFileSync(envPath, "utf8");
const match = raw.match(/^DATABASE_URL=(.*)$/m);
if (!match) {
  console.error(".env 缺少 DATABASE_URL。");
  process.exit(11);
}
const value = match[1].trim().replace(/^['"]|['"]$/g, "");
if (!value || /请填|TODO|PLACEHOLDER|changeme/i.test(value)) {
  console.error("DATABASE_URL 仍是空值或占位符。");
  process.exit(12);
}
const url = new URL(value);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const password = decodeURIComponent(url.password || "");
console.log(`DB_PROTOCOL=${q(url.protocol.replace(/:$/, ""))}`);
console.log(`DB_HOST=${q(url.hostname)}`);
console.log(`DB_PORT=${q(url.port || "3306")}`);
console.log(`DB_USER=${q(decodeURIComponent(url.username || ""))}`);
console.log(`DB_PASSWORD_B64=${q(Buffer.from(password, "utf8").toString("base64"))}`);
console.log(`DB_NAME=${q(decodeURIComponent(url.pathname.replace(/^\//, "")))}`);
console.log(`DB_HAS_UTF8MB4=${q(value.toLowerCase().includes("charset=utf8mb4") ? "1" : "0")}`);
NODE
}

write_defaults_file() {
  local target="$1"
  umask 077
  cat > "$target" <<EOF
[client]
user=$DB_USER
password=$DB_PASSWORD
host=$DB_HOST
port=$DB_PORT
default-character-set=utf8mb4
EOF
}

cleanup_old_backups() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将只保留最近 $BACKUP_KEEP 份 drinking-time-*.sql 备份。"
    return
  fi

  mapfile -t old_files < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'drinking-time-*.sql' -print |
      sort -r |
      tail -n +"$((BACKUP_KEEP + 1))"
  )
  if [ "${#old_files[@]}" -eq 0 ]; then
    return
  fi
  rm -f "${old_files[@]}"
}

main() {
  [ -f "$ENV_FILE" ] || die "找不到 .env：$ENV_FILE"
  require_command node
  require_command mysqldump

  local parsed
  parsed="$(parse_database_url)"
  eval "$parsed"
  DB_PASSWORD="$(printf '%s' "$DB_PASSWORD_B64" | base64 --decode 2>/dev/null || printf '%s' "$DB_PASSWORD_B64" | base64 -d)"

  [ "$DB_PROTOCOL" = "mysql" ] || die "DATABASE_URL 必须是 mysql://..."
  [ -n "$DB_USER" ] || die "DATABASE_URL 缺少数据库用户名。"
  [ -n "$DB_NAME" ] || die "DATABASE_URL 缺少数据库名。"
  [ "$DB_HAS_UTF8MB4" = "1" ] || die "DATABASE_URL 必须带 charset=utf8mb4。"

  local stamp
  stamp="$(date '+%Y%m%d-%H%M%S')"
  local output="$BACKUP_DIR/drinking-time-$stamp.sql"

  log "开始备份 MySQL：$DB_HOST:$DB_PORT/$DB_NAME（不会打印密码）。"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将创建目录：$BACKUP_DIR"
    echo "[DRY_RUN] 将导出到：$output"
    cleanup_old_backups
    return
  fi

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  local defaults_file
  defaults_file="$(mktemp)"
  trap 'rm -f "$defaults_file"' EXIT
  write_defaults_file "$defaults_file"

  mysqldump \
    --defaults-extra-file="$defaults_file" \
    --single-transaction \
    --default-character-set=utf8mb4 \
    "$DB_NAME" > "$output"

  chmod 600 "$output"
  cleanup_old_backups
  log "备份完成：$output"
}

main "$@"
