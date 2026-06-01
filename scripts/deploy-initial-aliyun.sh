#!/usr/bin/env bash
# 初始部署脚本：在阿里云 ECS 上把 Drinking Time 从零部署到公网 IP HTTP。
# 备案通过后的域名和 HTTPS 切换由 scripts/switch-www-drinkingtime-after-icp.sh 负责。

set -euo pipefail

PUBLIC_IP="${PUBLIC_IP:-8.160.186.193}"
APP_DIR="${APP_DIR:-/opt/Drinking-Time}"
APP_PORT="${APP_PORT:-3000}"
PM2_APP="${PM2_APP:-drinking-time}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/drinking-time.conf}"
REPO_URL="${REPO_URL:-https://github.com/mountionzeng/Drinking-Time.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
NODE_MAJOR_MIN="${NODE_MAJOR_MIN:-20}"
PNPM_VERSION="${PNPM_VERSION:-10.4.1}"
IMPORT_LOCAL_PERSIST="${IMPORT_LOCAL_PERSIST:-0}"
DRY_RUN="${DRY_RUN:-0}"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

die() {
  echo "错误：$*" >&2
  exit 1
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[DRY_RUN]'
    printf ' %q' "$@"
    printf '\n'
    return
  fi
  "$@"
}

run_bash() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] bash -lc $1"
    return
  fi
  bash -lc "$1"
}

write_file() {
  local target="$1"
  local content="$2"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将写入 $target"
    return
  fi
  install -d -m 0755 "$(dirname "$target")"
  printf '%s\n' "$content" > "$target"
}

need_root() {
  if [ "$(id -u)" = "0" ]; then
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "当前不是 root；演练模式继续。真实部署请用：sudo bash $0"
    return
  fi
  die "请用 root 执行：sudo bash $0"
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 当前缺少命令 $1；真实部署会先安装或在此失败。"
    return
  fi
  die "缺少命令：$1"
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  else
    echo "unknown"
  fi
}

install_packages() {
  local pm="$1"
  shift
  if [ "$#" -eq 0 ]; then
    return
  fi
  case "$pm" in
    apt)
      run apt-get update
      run apt-get install -y "$@"
      ;;
    dnf)
      run dnf install -y "$@"
      ;;
    yum)
      run yum install -y "$@"
      ;;
    *)
      if [ "$DRY_RUN" = "1" ]; then
        echo "[DRY_RUN] 未检测到 apt-get/dnf/yum；真实 ECS 上会用系统包管理器安装：$*"
        return
      fi
      die "找不到 apt-get/dnf/yum，请先手动安装：$*"
      ;;
  esac
}

install_base_packages() {
  local pm="$1"
  log "安装基础依赖：git、curl、ca-certificates、nginx、MySQL 客户端。"
  case "$pm" in
    apt)
      install_packages "$pm" git curl ca-certificates gnupg lsb-release nginx mysql-client
      ;;
    dnf|yum)
      install_packages "$pm" git curl ca-certificates nginx mysql
      ;;
    *)
      install_packages "$pm" git curl ca-certificates nginx mysql
      ;;
  esac
}

node_major() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo "0"
}

install_node_if_needed() {
  local pm="$1"
  local current_major
  current_major="$(node_major)"
  if [ "$current_major" -ge "$NODE_MAJOR_MIN" ]; then
    log "Node.js 已满足要求：$(node -v)。"
    return
  fi

  log "安装 Node.js 22 LTS（当前主版本：${current_major}，最低要求：${NODE_MAJOR_MIN}）。"
  case "$pm" in
    apt)
      run_bash "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"
      install_packages "$pm" nodejs
      ;;
    dnf)
      run_bash "curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -"
      install_packages "$pm" nodejs
      ;;
    yum)
      run_bash "curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -"
      install_packages "$pm" nodejs
      ;;
    *)
      die "找不到可用包管理器，无法自动安装 Node.js。"
      ;;
  esac
}

install_pnpm_and_pm2() {
  log "启用 pnpm，并安装 PM2。"
  if command -v corepack >/dev/null 2>&1; then
    run corepack enable
    run corepack prepare "pnpm@$PNPM_VERSION" --activate
  else
    run npm install -g "pnpm@$PNPM_VERSION"
  fi
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 已安装：$(pm2 -v 2>/dev/null || true)。"
  else
    run npm install -g pm2
  fi
}

ensure_mysql_server_if_local_or_unknown() {
  local pm="$1"
  local mode="$2"
  if [ "$mode" = "external" ]; then
    log "DATABASE_URL 指向外部 MySQL，跳过本机 MySQL Server 安装。"
    return
  fi

  if command -v mysqld >/dev/null 2>&1 || command -v mysqladmin >/dev/null 2>&1; then
    log "检测到 MySQL 相关命令，继续校验服务。"
  else
    log "安装本机 MySQL 8 Server。"
    case "$pm" in
      apt)
        install_packages "$pm" mysql-server
        ;;
      dnf|yum)
        install_packages "$pm" mysql-server
        ;;
      *)
        if [ "$DRY_RUN" = "1" ]; then
          echo "[DRY_RUN] 未检测到包管理器；真实 ECS 上会安装 MySQL Server。"
          return
        fi
        die "找不到可用包管理器，无法自动安装 MySQL。"
        ;;
    esac
  fi

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files | grep -q '^mysqld\.service'; then
      run systemctl enable --now mysqld
    elif systemctl list-unit-files | grep -q '^mysql\.service'; then
      run systemctl enable --now mysql
    else
      log "没有找到 mysqld/mysql systemd 服务；如果 MySQL 已用其它方式运行，可忽略。"
    fi
  fi
}

prepare_app_dir() {
  log "准备代码目录：${APP_DIR}。"
  if [ -d "$APP_DIR/.git" ]; then
    run git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR"
    run git -C "$APP_DIR" fetch origin "$DEPLOY_BRANCH"
    run git -C "$APP_DIR" checkout "$DEPLOY_BRANCH"
    run git -C "$APP_DIR" pull --ff-only origin "$DEPLOY_BRANCH"
    return
  fi

  if [ -e "$APP_DIR" ] && [ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
    die "$APP_DIR 已存在但不是 git 仓库。请先备份/清理，或把 APP_DIR 指到空目录。"
  fi

  run mkdir -p "$(dirname "$APP_DIR")"
  run git clone --branch "$DEPLOY_BRANCH" "$REPO_URL" "$APP_DIR"
  run git -C "$APP_DIR" config --global --add safe.directory "$APP_DIR"
}

env_template_content() {
  cat <<'EOF'
# Drinking Time 生产环境配置模板。
# 真实值由岱岱在服务器上填写；不要提交此文件，不要贴到聊天里。

NODE_ENV=production
PORT=3000
APP_ORIGIN=http://8.160.186.193
OAUTH_SERVER_URL=http://8.160.186.193
DISABLE_AUTH=true

# MySQL：本机自建示例。密码由岱岱自己填；必须保留 charset=utf8mb4。
DATABASE_URL=mysql://drinking_time_app:请填数据库密码@127.0.0.1:3306/drinking_time?charset=utf8mb4

# 认证 / Cookie
VITE_APP_ID=请填应用ID
JWT_SECRET=请填长随机密钥
OWNER_OPEN_ID=

# 大模型中转站 / OpenAI 兼容接口
BUILT_IN_FORGE_API_URL=请填大模型API地址
BUILT_IN_FORGE_API_KEY=请填大模型API密钥
LLM_MODEL=请填模型名
LLM_SUPPORTS_IMAGE=true
LLM_SUPPORTS_RESPONSE_FORMAT=true
VOICE_TRANSCRIPTION_MODEL=whisper-1
LLM_THINKING_BUDGET=

# DROP ZONE / 视觉模型覆盖项（可选；留空则复用上面的通用模型）
DROP_ZONE_API_URL=
DROP_ZONE_MODEL=
VISION_API_URL=
VISION_MODEL=

# fal.ai 图片生成 / 分割 / inpaint
FAL_KEY=请填fal.ai密钥

# Google OAuth（DISABLE_AUTH=false 前必须填好）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email OTP（登录邮箱验证码；需要时填写）
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@drinking-time.com

# 老黄历 API（可选）
HUANGLI_PROVIDER=
HUANGLI_API_KEY=
TIANAPI_KEY=
JISUAPI_APPKEY=
HUANGLI_API_BASE_URL=
HUANGLI_TIMEOUT_MS=5000

# 旧 archive 前端变量（如不用 archive 可留空）
VITE_FRONTEND_FORGE_API_URL=
VITE_FRONTEND_FORGE_API_KEY=
EOF
}

ensure_env_file() {
  local env_path="$APP_DIR/.env"
  if [ -f "$env_path" ]; then
    log ".env 已存在，保留现有文件。"
    return
  fi
  log "创建 .env 模板：${env_path}。真实密钥需要岱岱手动填写。"
  write_file "$env_path" "$(env_template_content)"
  if [ "$DRY_RUN" != "1" ]; then
    chmod 600 "$env_path"
  fi
}

parse_database_url() {
  local env_path="$APP_DIR/.env"
  APP_DIR="$APP_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");
const envPath = path.join(process.env.APP_DIR, ".env");
const raw = fs.readFileSync(envPath, "utf8");
const match = raw.match(/^DATABASE_URL=(.*)$/m);
if (!match) process.exit(11);
const value = match[1].trim().replace(/^['"]|['"]$/g, "");
if (!value || /请填|TODO|PLACEHOLDER|changeme/i.test(value)) process.exit(12);
const url = new URL(value);
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const password = decodeURIComponent(url.password || "");
const params = url.searchParams;
const charset = (params.get("charset") || params.get("connectionLimit") || "").toLowerCase();
const host = url.hostname;
const isLocal = ["127.0.0.1", "localhost", "::1"].includes(host);
console.log(`DB_PROTOCOL=${q(url.protocol.replace(/:$/, ""))}`);
console.log(`DB_HOST=${q(host)}`);
console.log(`DB_PORT=${q(url.port || "3306")}`);
console.log(`DB_USER=${q(decodeURIComponent(url.username || ""))}`);
console.log(`DB_PASSWORD_B64=${q(Buffer.from(password, "utf8").toString("base64"))}`);
console.log(`DB_NAME=${q(decodeURIComponent(url.pathname.replace(/^\//, "")))}`);
console.log(`DB_IS_LOCAL=${q(isLocal ? "1" : "0")}`);
console.log(`DB_HAS_UTF8MB4=${q(value.toLowerCase().includes("charset=utf8mb4") || charset === "utf8mb4" ? "1" : "0")}`);
NODE
}

validate_env_file() {
  local env_path="$APP_DIR/.env"
  log "校验 .env 必需键是否已填写。"
  if [ "$DRY_RUN" = "1" ] && [ ! -f "$env_path" ]; then
    echo "[DRY_RUN] 当前没有真实 .env；真实运行会先创建模板，岱岱填完后再通过校验。"
    return
  fi
  APP_DIR="$APP_DIR" node <<'NODE'
const fs = require("fs");
const path = require("path");
const envPath = path.join(process.env.APP_DIR, ".env");
const raw = fs.readFileSync(envPath, "utf8");
const env = new Map();
for (const line of raw.split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;
  env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ""));
}
const required = [
  "NODE_ENV",
  "PORT",
  "APP_ORIGIN",
  "OAUTH_SERVER_URL",
  "DISABLE_AUTH",
  "DATABASE_URL",
  "JWT_SECRET",
  "BUILT_IN_FORGE_API_URL",
  "BUILT_IN_FORGE_API_KEY",
  "LLM_MODEL",
  "FAL_KEY",
];
const missing = required.filter((key) => {
  const value = env.get(key) || "";
  return !value || /请填|TODO|PLACEHOLDER|changeme/i.test(value);
});
if (missing.length) {
  console.error(`.env 还没填完整，请填写后重跑。缺少/仍为占位符的键：${missing.join(", ")}`);
  process.exit(2);
}
if (env.get("PORT") !== "3000") {
  console.error("PORT 必须是 3000。");
  process.exit(3);
}
if (!String(env.get("DATABASE_URL")).toLowerCase().includes("charset=utf8mb4")) {
  console.error("DATABASE_URL 必须带 charset=utf8mb4。");
  process.exit(4);
}
NODE
}

mysql_defaults_file() {
  local target="$1"
  local user="$2"
  local password="$3"
  local host="$4"
  local port="$5"
  umask 077
  cat > "$target" <<EOF
[client]
user=$user
password=$password
host=$host
port=$port
default-character-set=utf8mb4
EOF
}

mysql_root_exec() {
  local sql="$1"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将用 root 权限执行 MySQL 初始化 SQL（不打印密码）。"
    return
  fi

  if mysql --protocol=socket -uroot -e "SELECT 1" >/dev/null 2>&1; then
    mysql --protocol=socket -uroot < <(printf '%s\n' "$sql")
    return
  fi

  if [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
    local tmp
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' RETURN
    mysql_defaults_file "$tmp" "root" "$MYSQL_ROOT_PASSWORD" "127.0.0.1" "3306"
    mysql --defaults-extra-file="$tmp" < <(printf '%s\n' "$sql")
    rm -f "$tmp"
    trap - RETURN
    return
  fi

  die "无法用 root 连接 MySQL。若 root 有密码，请用 MYSQL_ROOT_PASSWORD=... sudo -E bash scripts/deploy-initial-aliyun.sh"
}

sql_string_literal() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

configure_database() {
  if [ "$DRY_RUN" = "1" ] && [ ! -f "$APP_DIR/.env" ]; then
    echo "[DRY_RUN] 当前没有真实 .env；真实运行会在岱岱填好 .env 后建库/校验外部库。"
    return
  fi
  local parsed
  if ! parsed="$(parse_database_url)"; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "[DRY_RUN] 当前没有可解析的 DATABASE_URL；真实运行会在岱岱填好 .env 后建库/校验外部库。"
      return
    fi
    die ".env 中 DATABASE_URL 还不可用；请填好后重跑。"
  fi
  eval "$parsed"
  DB_PASSWORD="$(printf '%s' "$DB_PASSWORD_B64" | base64 --decode 2>/dev/null || printf '%s' "$DB_PASSWORD_B64" | base64 -d)"

  [ "$DB_PROTOCOL" = "mysql" ] || die "DATABASE_URL 必须是 mysql://..."
  [ -n "$DB_USER" ] || die "DATABASE_URL 缺少数据库用户名。"
  [ -n "$DB_NAME" ] || die "DATABASE_URL 缺少数据库名。"
  [ "$DB_HAS_UTF8MB4" = "1" ] || die "DATABASE_URL 必须带 charset=utf8mb4。"

  if ! printf '%s' "$DB_NAME" | grep -Eq '^[A-Za-z0-9_]+$'; then
    die "数据库名只支持字母、数字、下划线，当前值不适合自动建库。"
  fi
  if ! printf '%s' "$DB_USER" | grep -Eq '^[A-Za-z0-9_]+$'; then
    die "数据库用户名只支持字母、数字、下划线，当前值不适合自动建账号。"
  fi

  if [ "$DB_IS_LOCAL" = "1" ]; then
    log "初始化本机 MySQL 数据库和账号（不打印密码）。"
    local sql
    local user_lit
    local pass_lit
    user_lit="$(sql_string_literal "$DB_USER")"
    pass_lit="$(sql_string_literal "$DB_PASSWORD")"
    sql="$(cat <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS ${user_lit}@'localhost' IDENTIFIED BY ${pass_lit};
ALTER USER ${user_lit}@'localhost' IDENTIFIED BY ${pass_lit};
CREATE USER IF NOT EXISTS ${user_lit}@'127.0.0.1' IDENTIFIED BY ${pass_lit};
ALTER USER ${user_lit}@'127.0.0.1' IDENTIFIED BY ${pass_lit};
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO ${user_lit}@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO ${user_lit}@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
)"
    mysql_root_exec "$sql"
  else
    log "校验外部 MySQL 连通性（不打印密码）。"
    if [ "$DRY_RUN" = "1" ]; then
      echo "[DRY_RUN] 将连接 $DB_HOST:$DB_PORT/$DB_NAME 执行 SELECT 1。"
    else
      local tmp
      tmp="$(mktemp)"
      trap 'rm -f "$tmp"' RETURN
      mysql_defaults_file "$tmp" "$DB_USER" "$DB_PASSWORD" "$DB_HOST" "$DB_PORT"
      mysql --defaults-extra-file="$tmp" "$DB_NAME" -e "SELECT 1;" >/dev/null
      rm -f "$tmp"
      trap - RETURN
    fi
  fi
}

install_and_build() {
  log "安装依赖并构建。"
  run bash -lc "cd '$APP_DIR' && pnpm install --frozen-lockfile"
  run bash -lc "cd '$APP_DIR' && pnpm run build"
}

run_migrations() {
  log "执行 Drizzle 建表 / 迁移。"
  run bash -lc "cd '$APP_DIR' && pnpm run db:push"
}

maybe_import_local_persist() {
  if [ "$IMPORT_LOCAL_PERSIST" != "1" ]; then
    log "跳过 local-persist 导入。若要导入备份，先把 JSON 放好，再用 IMPORT_LOCAL_PERSIST=1 重跑。"
    return
  fi
  log "导入 .webdev/local-persist.json 到 MySQL：先 dry-run，再真实导入。"
  run bash -lc "cd '$APP_DIR' && pnpm tsx scripts/import-local-persist-to-mysql.ts --dry-run"
  run bash -lc "cd '$APP_DIR' && pnpm tsx scripts/import-local-persist-to-mysql.ts"
}

start_pm2() {
  log "用 PM2 启动或重启应用：${PM2_APP}。"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将检测 PM2 应用是否存在；存在则 restart，不存在则 start dist/index.js。"
    echo "[DRY_RUN] 将执行 pm2 save 和 pm2 startup。"
    return
  fi
  if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
    NODE_ENV=production PORT="$APP_PORT" pm2 restart "$PM2_APP" --update-env
  else
    cd "$APP_DIR"
    NODE_ENV=production PORT="$APP_PORT" pm2 start dist/index.js --name "$PM2_APP" --time
  fi
  pm2 save
  pm2 startup systemd -u root --hp /root >/tmp/drinking-time-pm2-startup.log 2>&1 || true
  log "PM2 开机自启命令输出已保存到 /tmp/drinking-time-pm2-startup.log；如 PM2 提示需手动执行，请照提示补跑。"
}

write_nginx_http_config() {
  log "写入备案前 IP HTTP nginx 配置：${NGINX_CONF}。"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将备份现有 ${NGINX_CONF}，并写入 server_name ${PUBLIC_IP} 的 HTTP 反代配置。"
    return
  fi
  install -d -m 0755 "$(dirname "$NGINX_CONF")"
  if [ -f "$NGINX_CONF" ]; then
    cp "$NGINX_CONF" "$NGINX_CONF.before-initial-$(date +%s)"
  fi
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $PUBLIC_IP;

    client_max_body_size 50m;

    location /healthz {
        proxy_pass http://127.0.0.1:$APP_PORT/healthz;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  nginx -t
  systemctl enable --now nginx || true
  systemctl reload nginx || systemctl restart nginx
}

health_check() {
  log "执行健康检查。"
  if [ "$DRY_RUN" = "1" ]; then
    echo "[DRY_RUN] 将检查 http://127.0.0.1:$APP_PORT/healthz"
    echo "[DRY_RUN] 将检查 http://$PUBLIC_IP/healthz"
    return
  fi
  curl -fsS "http://127.0.0.1:$APP_PORT/healthz"
  curl -fsS "http://$PUBLIC_IP/healthz"
  log "初始部署完成：请用 http://$PUBLIC_IP/ 访问。"
}

main() {
  need_root
  local pm
  pm="$(detect_package_manager)"
  log "检测到包管理器：${pm}。"

  install_base_packages "$pm"
  install_node_if_needed "$pm"
  require_command node
  require_command npm
  install_pnpm_and_pm2
  require_command pnpm
  require_command pm2
  require_command nginx
  require_command mysql

  prepare_app_dir
  ensure_env_file

  local db_mode="unknown"
  if [ -f "$APP_DIR/.env" ]; then
    if parsed="$(parse_database_url 2>/dev/null)"; then
      eval "$parsed"
      if [ "${DB_IS_LOCAL:-1}" = "1" ]; then
        db_mode="local"
      else
        db_mode="external"
      fi
    fi
  fi

  ensure_mysql_server_if_local_or_unknown "$pm" "$db_mode"
  validate_env_file
  configure_database
  install_and_build
  run_migrations
  maybe_import_local_persist
  start_pm2
  write_nginx_http_config
  health_check
}

main "$@"
