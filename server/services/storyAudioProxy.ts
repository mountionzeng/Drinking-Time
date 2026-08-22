function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 只从用户已有故事的 ChatCut 音轨中解析地址。路由不接受任意远程 URL，
 * 避免把同源波形出口变成通用代理。
 */
export function storyAudioUrl(
  storyBody: unknown,
  clipId: string
): string | null {
  const imported = record(record(storyBody).chatCutImport);
  const tracks = Array.isArray(imported.audioTracks)
    ? imported.audioTracks
    : [];
  for (const trackValue of tracks) {
    const clips = record(trackValue).clips;
    if (!Array.isArray(clips)) continue;
    for (const clipValue of clips) {
      const clip = record(clipValue);
      if (clip.id !== clipId) continue;
      return typeof clip.audioUrl === "string" && clip.audioUrl.trim()
        ? clip.audioUrl.trim()
        : null;
    }
  }
  return null;
}

/** 目前 ChatCut 导入音频来自公开 S3；限制为 HTTPS S3，阻断内网 SSRF。 */
export function isAllowedStoryAudioUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "s3.amazonaws.com" ||
      /\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * 冷启动的第一批回源常常整批失败：本机到 S3 的 TLS 握手方差极大（见
 * httpConnectionPool.ts 的实测），连接池还没热起来时并发的几条会一起抛
 * 「fetch failed」。而 <audio> 拿到 502 之后不会自己重试，那一条声轨在整个
 * 剪辑页里就永久哑掉了——所以在这里把瞬时的连接错误重掉。
 *
 * 只重试「抛出来的」网络错误；上游明确回了状态码（403/404 等）说明地址本身有问题，
 * 照实返回，不浪费时间重试。
 */
const UPSTREAM_RETRY_DELAYS_MS = [150, 500];

export async function fetchStoryAudio(
  url: string,
  options: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= UPSTREAM_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(UPSTREAM_RETRY_DELAYS_MS[attempt - 1]);
    try {
      return await fetchImpl(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
