// 鉴权开关的唯一判定入口。默认开启真实鉴权；只有同时满足以下条件才允许关闭：
//   1. 显式 DISABLE_AUTH=true；
//   2. NODE_ENV 不是 production（production 下由 productionReadiness 拒绝启动）；
//   3. 服务只监听本机回环地址（见 resolveListenHost）。
// 任何一条不满足都按鉴权开启处理，宁可登录页能用，也不让全站变成访客可写。

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** 与 index.ts 的 server.listen 保持一致；undefined 表示监听全部网卡。 */
export function resolveListenHost(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  // Development auth is relaxed; production is exposed only through nginx.
  return ["development", "production"].includes(env.NODE_ENV ?? "")
    ? "127.0.0.1"
    : undefined;
}

export function isLoopbackHost(host: string | undefined) {
  return host !== undefined && LOOPBACK_HOSTS.has(host);
}

export function isAuthDisabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.DISABLE_AUTH !== "true") return false;
  if (env.NODE_ENV === "production") return false;
  return isLoopbackHost(resolveListenHost(env));
}

/** 启动时打印，避免"以为开着鉴权其实没开"或反过来。 */
export function describeAuthMode(env: NodeJS.ProcessEnv = process.env) {
  if (isAuthDisabled(env)) {
    return "[auth] DISABLE_AUTH=true：本机开发模式，鉴权已关闭（仅监听 127.0.0.1）";
  }
  if (env.DISABLE_AUTH === "true") {
    return "[auth] 警告：DISABLE_AUTH=true 被忽略（NODE_ENV 为 production 或服务未只监听本机回环），鉴权保持开启";
  }
  return null;
}
