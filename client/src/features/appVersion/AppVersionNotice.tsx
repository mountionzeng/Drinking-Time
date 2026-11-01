import { useEffect, useState } from 'react';
import { isNewRelease, markAppStale } from './releaseCheck';

export default function AppVersionNotice() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const loaded = document.querySelector('meta[name="app-release"]')?.getAttribute('content') ?? '';
    if (!loaded) return;
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/app-release.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (response.ok && isNewRelease(loaded, await response.json()) && !disposed) {
          markAppStale();
          setStale(true);
        }
      } catch { /* A network outage is not evidence of a newer release. */ }
      finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(check, 15000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  if (!stale) return null;
  return <aside role="alert" className="fixed inset-x-0 top-0 z-[10000] flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
    <span>页面已有新版。本页内容仍保留，可复制；请在新版继续编辑和保存。</span>
    <a href={window.location.href} target="_blank" rel="noopener" className="rounded bg-amber-900 px-3 py-1.5 text-white">打开新版</a>
  </aside>;
}
