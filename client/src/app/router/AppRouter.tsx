import { Route, Switch, Redirect } from 'wouter';
import AnalysisPage from '@/pages/AnalysisPage';
import CreationPage from '@/pages/CreationPage';
import CreationEditorPage from '@/pages/CreationEditorPage';
import LoginPage from '@/pages/LoginPage';
import WelcomePreviewPage from '@/pages/WelcomePreviewPage';
import MobilePage from '@/pages/MobilePage';
import MobileWelcomePage from '@/pages/MobileWelcomePage';
import NotFound from '@/pages/NotFound';
import { useAuth } from '@/_core/hooks/useAuth';
import { useState, type ReactNode } from 'react';

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

/**
 * 触屏设备（iPad / 手机）打开桌面路由时，自动转入消费端 /m。
 * - 判定：触屏 + 视口 ≤ 1366px。桌面（无触屏）一律不动 → 保护桌面创作工作台。
 * - 逃生口：?desktop=1 强制走桌面并写入 localStorage 持久化；?desktop=0 清除。
 * - 进入时判定一次（不监听 resize），避免桌面窗口缩放误触发跳转。
 */
export function detectPrefersMobile(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const desktopParam = new URLSearchParams(window.location.search).get('desktop');
    if (desktopParam === '1') {
      localStorage.setItem('dt:forceDesktop', '1');
      return false;
    }
    if (desktopParam === '0') localStorage.removeItem('dt:forceDesktop');
    if (localStorage.getItem('dt:forceDesktop') === '1') return false;
  } catch {
    /* localStorage / URL 不可用时按默认继续判断 */
  }
  const touch =
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window;
  return touch && window.innerWidth <= 1366;
}

export default function AppRouter() {
  const [prefersMobile] = useState(detectPrefersMobile);

  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/welcome" component={WelcomePreviewPage} />
      {/* 桌面端路由（需要登录）；触屏设备（iPad/手机）自动转入消费端 /m */}
      <Route path="/">
        {prefersMobile ? <Redirect to="/m" /> : <AuthGuard><AnalysisPage /></AuthGuard>}
      </Route>
      <Route path="/analysis">
        {prefersMobile ? <Redirect to="/m" /> : <AuthGuard><AnalysisPage /></AuthGuard>}
      </Route>
      <Route path="/creation">
        {prefersMobile ? <Redirect to="/m" /> : <AuthGuard><CreationPage /></AuthGuard>}
      </Route>
      <Route path="/studio">
        {prefersMobile ? <Redirect to="/m" /> : <AuthGuard><CreationEditorPage /></AuthGuard>}
      </Route>
      {/* 手机端路由 */}
      <Route path="/m/welcome" component={MobileWelcomePage} />
      <Route path="/m" component={MobilePage} />
      <Route path="/m/storyboard" component={MobilePage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
