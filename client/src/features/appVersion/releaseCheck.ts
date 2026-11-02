export function isNewRelease(loaded: string, response: unknown): boolean {
  if (!loaded || !response || typeof response !== 'object' || !('version' in response)) return false;
  return typeof response.version === 'string' && response.version.length > 0 && response.version !== loaded;
}

let stale = false;
export function markAppStale() { stale = true; }
export function assertCurrentApp() {
  if (stale) throw new Error('编辑器已更新，尚未提交这次修改。请点击顶部“保留草稿，打开新版”，恢复后继续保存和制作视频。');
}
