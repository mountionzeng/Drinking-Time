#!/usr/bin/env bash
# dev-mobile.sh —— 手机自测用的「强壮版」本地 dev server 管理脚本
#
# 解决的痛点：以前 dev server 是临时后台进程，会话一收尾 / 被清理就掉，手机突然连不上。
# 这个脚本让它：
#   ① 崩溃或退出后自动重启（外层看护循环，2 秒拉起一次）；
#   ② 脱离发起它的终端（nohup + disown），关掉那个窗口也不会被带走；
#   ③ 给你一组好记的命令，自己就能管。
#
# 用法（在哪个目录执行都行，脚本会自己切到项目根目录）：
#   bash scripts/dev-mobile.sh start     启动
#   bash scripts/dev-mobile.sh stop      停止
#   bash scripts/dev-mobile.sh restart   重启（改了 server 端代码后用这个）
#   bash scripts/dev-mobile.sh status    看运行状态 + 手机访问地址
#   bash scripts/dev-mobile.sh logs      实时跟日志（Ctrl-C 退出查看，不影响 server）
#
# 想要「彻底不受助手会话影响」：自己在「终端」App 里跑一次 `bash scripts/dev-mobile.sh start`，
# 它就挂在你自己的登录会话下，跟助手的进程生命周期完全无关，最稳。

set -uo pipefail

# ── 路径与常量 ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

export PORT=3000
RUN_DIR="$ROOT/.webdev"
PID_FILE="$RUN_DIR/dev-server.pid"   # 看护进程（外层 while 循环）的 PID
LOG_FILE="$RUN_DIR/dev-server.log"
MATCH="server/_core/index.ts"        # 用于查找 / 清理实际的 node 进程
# GUI / 精简环境下，tsx 运行时需要 node 在 PATH 里；这里补上 Homebrew 的 bin
export PATH="/opt/homebrew/bin:$PATH"

mkdir -p "$RUN_DIR"

# ── 工具函数 ──
is_running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; }
# 取当前 Wi-Fi 的局域网 IP（先 en0，再 en1 兜底）
lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true; }

start() {
  if is_running; then
    echo "已经在跑了（看护 PID $(cat "$PID_FILE")）。"
    status
    return 0
  fi
  # 清掉可能残留的旧 node 进程，避免端口被占
  pkill -f "$MATCH" 2>/dev/null || true
  sleep 1

  export NODE_ENV=development
  # 看护循环：用 plain tsx（不是 tsx watch）——这样进程一旦崩溃 / 被杀就会退出，
  # 外层 while 立刻把它拉起来，真正自愈。
  # 前端改动由 Vite 中间件的 HMR 负责热更新，不需要重启进程；
  # 只有改了 server 端代码，才需要 `restart`。
  nohup bash -c '
    export PATH="/opt/homebrew/bin:$PATH"
    # 让 server 的出站请求走本机代理（Clash/Surge 等）。否则像 api.302.ai 这类
    # 解析到代理 FakeIP（198.18.x.x）的域名，直连会「fetch failed」。
    #
    # 这里踩过两个坑，改之前先读完：
    # ① 光 export 代理变量是不够的：Node 的全局 fetch(undici) **默认不读**
    #    HTTP_PROXY/HTTPS_PROXY，必须显式打开 NODE_USE_ENV_PROXY=1（Node ≥ 24）。
    #    而同进程里的 axios（oauth.ts / sdk.ts）**默认就读**。结果是同一份环境变量下
    #    两个 HTTP 客户端各走各的：fetch 直连、axios 走代理——只要代理没在监听，
    #    axios 那条路就 ECONNREFUSED 秒挂，fetch 那条路却正常。表现就是"环境很不稳定"。
    # ② 所以不能无脑写死 7890：开关一旦打开，代理地址就成了硬约束，没人监听时所有
    #    外部请求全废。先探测端口，探得到才启用，探不到就干脆全部直连——两个客户端
    #    始终保持一致，这才是这段代码的目的。
    # 默认直连：2026-08-16 实测本机直连与走代理没有实质差别（两条路都被 TLS 握手
    # 主导），而直连少一跳、也少一个会挂的依赖。需要靠代理解 FakeIP 的机器，显式
    # 用 DEV_USE_PROXY=1 打开即可。
    if [ "${DEV_USE_PROXY:-0}" = "1" ]; then
      PROXY_URL="${HTTPS_PROXY:-${HTTP_PROXY:-http://127.0.0.1:7890}}"
      PROXY_HOSTPORT="${PROXY_URL#*://}"
      PROXY_HOSTPORT="${PROXY_HOSTPORT%%/*}"
      PROXY_HOST="${PROXY_HOSTPORT%%:*}"
      PROXY_PORT="${PROXY_HOSTPORT##*:}"
      [ "$PROXY_PORT" = "$PROXY_HOST" ] && PROXY_PORT=80
      if nc -z -G 1 -w 1 "$PROXY_HOST" "$PROXY_PORT" 2>/dev/null; then
        export HTTP_PROXY="$PROXY_URL"
        export HTTPS_PROXY="$PROXY_URL"
        export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
        export NODE_USE_ENV_PROXY=1
        echo "[supervisor] proxy $PROXY_URL 有响应，fetch 与 axios 统一走代理"
      else
        unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
        echo "[supervisor] 要求用代理，但 $PROXY_URL 无人监听——改为统一直连"
      fi
    else
      # 关键：主动清掉继承来的代理变量。留着的话就是上面说的分裂状态：
      # axios 走代理、fetch 直连，代理一旦没在监听，axios 那条路秒挂而 fetch 正常。
      unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
      echo "[supervisor] fetch 与 axios 统一直连（要走代理设 DEV_USE_PROXY=1）"
    fi
    while true; do
      echo "[supervisor $(date "+%F %T")] starting dev server ..."
      node_modules/.bin/tsx server/_core/index.ts
      echo "[supervisor $(date "+%F %T")] server exited (code $?), restarting in 2s ..."
      sleep 2
    done
  ' >> "$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
  disown 2>/dev/null || true

  sleep 3
  echo "已启动。看护 PID $(cat "$PID_FILE")，日志写到：$LOG_FILE"
  status
}

stop() {
  # 先停看护循环（停了它就不会再把 server 拉起来），再清掉实际的 node 进程
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
  fi
  sleep 1
  pkill -f "$MATCH" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "已停止。"
}

status() {
  if is_running; then
    echo "● 运行中（看护 PID $(cat "$PID_FILE")）"
  else
    echo "○ 未运行"
  fi
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:$PORT/m" 2>/dev/null || echo "000")
  echo "  本机： http://localhost:$PORT/m   (HTTP $code)"
  local ip
  ip="$(lan_ip)"
  if [ -n "$ip" ]; then
    echo "  手机： http://$ip:$PORT/m   （手机连同一 Wi-Fi 打开）"
    if ! grep -q "$ip" "$ROOT/vite.config.ts" 2>/dev/null; then
      echo "  ⚠️ 当前 IP $ip 不在 vite.config.ts 的 allowedHosts 里，手机会被挡——需要的话把它加进去。"
    fi
  else
    echo "  手机： （没取到局域网 IP，确认 Wi-Fi 已连）"
  fi
}

case "${1:-status}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  logs)    tail -n 40 -f "$LOG_FILE" ;;
  *) echo "用法: bash scripts/dev-mobile.sh {start|stop|restart|status|logs}"; exit 1 ;;
esac
