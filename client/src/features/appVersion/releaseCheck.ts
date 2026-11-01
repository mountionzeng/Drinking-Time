export function isNewRelease(loaded: string, response: unknown): boolean {
  if (!loaded || !response || typeof response !== 'object' || !('version' in response)) return false;
  return typeof response.version === 'string' && response.version.length > 0 && response.version !== loaded;
}

let stale = false;
export function markAppStale() { stale = true; }
export function assertCurrentApp() {
  if (stale) throw new Error('此页面已过期，内容仍保留。请在新版页面继续编辑。');
}
