import { execFileSync } from "node:child_process";
import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/**
 * 用途：把 Node 全局 fetch 的连接池调成「长时间保温」，让到外部 API 的 TLS 握手
 *   只在第一次付费，之后复用同一条连接。
 *
 * 为什么值得单独一个文件（2026-08-16 实测数据，别凭直觉改）：
 *   本机到 api.302ai.cn 的耗时几乎全在 TLS 握手上——DNS ~5ms、TCP ~5ms，
 *   而 TLS 握手 2.3s / 4.5s / 11.2s，方差极大，偶尔整条连接挂死。连 baidu.com
 *   直连也要 2.8s，所以这是整条网络链路的问题，不是某一家 API，也不是应用代码。
 *
 *   决定性的一点：**新建连接 3.2–11.0s，复用连接 0.55s**。
 *   但 undici（Node 全局 fetch 的底座）默认 keepAliveTimeout 只有 4 秒，而聊天
 *   场景里用户思考几十秒是常态——每条消息都因此重新握手，每次都吃满 3–11s。
 *
 *   实测同一段代码，空闲 30s 之后再请求：
 *     默认 4s  keepAlive → 3185ms
 *     10min keepAlive → 667ms
 *
 * 有意不碰的东西：超时、重试、供应商切换都归 inferenceOrchestrator 管，这里只负责
 *   连接复用和出站代理，不负责请求重放。2026-10-13 修复裸 Agent 丢失代理路由，
 *   否则使用 FakeIP DNS 的本机可能浏览器正常、后端持续解析失败。
 */

const DEFAULT_KEEP_ALIVE_MS = 4 * 60_000;
const DEFAULT_KEEP_ALIVE_MAX_MS = 10 * 60_000;
const LOCAL_NO_PROXY = "localhost,127.0.0.1,[::1],::1,*.local";

/** Respect explicit process settings. Only local macOS development discovers
 * the user's already-enabled loopback HTTP proxy; never guess a proxy port. */
export function resolveHttpProxyOptions(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  readSystemProxy = () =>
    execFileSync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
): Pick<
  EnvHttpProxyAgent.Options,
  "httpProxy" | "httpsProxy" | "noProxy"
> | null {
  if (env.NODE_ENV === "development" && env.DEV_USE_PROXY === "0") return null;
  let httpProxy = env.http_proxy || env.HTTP_PROXY || "";
  let httpsProxy = env.https_proxy || env.HTTPS_PROXY || "";
  if (
    !httpProxy &&
    !httpsProxy &&
    env.NODE_ENV === "development" &&
    platform === "darwin"
  ) {
    try {
      const settings = readSystemProxy();
      const read = (key: string) =>
        settings.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)`, "m"))?.[1];
      const localProxy = (scheme: "HTTP" | "HTTPS") => {
        const host = read(`${scheme}Proxy`);
        const port = Number(read(`${scheme}Port`));
        if (
          read(`${scheme}Enable`) !== "1" ||
          !host ||
          !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) ||
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65535
        )
          return "";
        return `http://${host === "::1" ? "[::1]" : host}:${port}`;
      };
      httpProxy = localProxy("HTTP");
      httpsProxy = localProxy("HTTPS");
    } catch {
      // System lookup is optional; explicit environment settings work on all hosts.
    }
  }
  if (!httpProxy && !httpsProxy) return null;
  return {
    httpProxy,
    httpsProxy: httpsProxy || httpProxy,
    noProxy: [LOCAL_NO_PROXY, env.no_proxy || env.NO_PROXY]
      .filter(Boolean)
      .join(","),
  };
}

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

let configured = false;

export function configureHttpConnectionPool(): void {
  // 幂等：测试或热重载重复调用不该叠加 dispatcher。
  if (configured) return;
  configured = true;

  const keepAliveTimeout = readPositiveInt(
    process.env.HTTP_KEEP_ALIVE_MS,
    DEFAULT_KEEP_ALIVE_MS
  );
  // keepAliveMaxTimeout 是上限：对端用 Keep-Alive 头要求更长时也不超过它。
  const keepAliveMaxTimeout = Math.max(
    keepAliveTimeout,
    readPositiveInt(
      process.env.HTTP_KEEP_ALIVE_MAX_MS,
      DEFAULT_KEEP_ALIVE_MAX_MS
    )
  );

  // Replacing Node's dispatcher with a bare Agent discards its environment
  // proxy support, even when NODE_USE_ENV_PROXY=1. Keep proxy routing here.
  const proxy = resolveHttpProxyOptions(process.env, process.platform);
  const poolOptions = { keepAliveTimeout, keepAliveMaxTimeout };
  setGlobalDispatcher(
    proxy
      ? new EnvHttpProxyAgent({ ...poolOptions, ...proxy })
      : new Agent(poolOptions)
  );

  console.log(
    `[HttpPool] keep-alive ${Math.round(keepAliveTimeout / 1000)}s ` +
      `(max ${Math.round(keepAliveMaxTimeout / 1000)}s), ` +
      `${proxy ? "proxy enabled (local requests bypass)" : "direct"} — 复用连接，避免每次请求重付 TLS 握手`
  );
}
