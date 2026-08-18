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
