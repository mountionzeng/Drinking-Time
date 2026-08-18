import { Agent, setGlobalDispatcher } from "undici";

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
 *   「连接活多久」。两件事分开，改一个不会顺手改坏另一个。
 */

const DEFAULT_KEEP_ALIVE_MS = 4 * 60_000;
const DEFAULT_KEEP_ALIVE_MAX_MS = 10 * 60_000;

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

  setGlobalDispatcher(new Agent({ keepAliveTimeout, keepAliveMaxTimeout }));

  console.log(
    `[HttpPool] keep-alive ${Math.round(keepAliveTimeout / 1000)}s ` +
      `(max ${Math.round(keepAliveMaxTimeout / 1000)}s) — 复用连接，避免每次请求重付 TLS 握手`
  );
}
