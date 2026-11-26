/** Midjourney --sref/--cref must be an anonymously fetchable HTTPS URL. */
export function isProviderPublicImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password) return false;
    if (!parsed.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(parsed.hostname) ||
      /^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|\[)/.test(parsed.hostname)) return false;
    if (/\/(?:api\/images|api\/wechat-import\/media|local-images)\//.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Private, local, or inline images need public hosting or a consented reduced copy. */
export function needsProviderImageCopy(url: string): boolean {
  return !isProviderPublicImageUrl(url);
}
