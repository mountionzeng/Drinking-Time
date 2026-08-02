import { Route, Switch, Redirect } from 'wouter';
import EditingStudioPage from '@/pages/EditingStudioPage';
import LoginPage from '@/pages/LoginPage';
import WelcomePreviewPage from '@/pages/WelcomePreviewPage';
import MobilePage from '@/pages/MobilePage';
import MobileWelcomePage from '@/pages/MobileWelcomePage';
import NotFound from '@/pages/NotFound';
import AdminVisitsPage from '@/pages/AdminVisitsPage';
import { useAuth } from '@/_core/hooks/useAuth';
import { useState, type ReactNode } from 'react';

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

function LoginEntry() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated) return <Redirect to="/editing" />;
  return <LoginPage />;
}

function AdminGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (user?.role !== "admin") return <Redirect to="/editing" />;
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
      <Route path="/login">
        <LoginEntry />
      </Route>
      <Route path="/welcome">
        <WelcomePreviewPage />
      </Route>
      {/* 站点首页：桌面端直接进剪辑工作室；触屏设备（iPad/手机）自动转入消费端 /m */}
      <Route path="/">
        {prefersMobile ? <Redirect to="/m" /> : <Redirect to="/editing" />}
      </Route>
      <Route path="/analysis">
        {prefersMobile ? <Redirect to="/m" /> : <Redirect to="/editing" />}
      </Route>
      {/* /creation 的镜头表工作台已由 /editing 的故事板取代（一次四张候选 + 象限采用 +
          局部重绘 + 视频 Take 是旧「收下/再来一张」单图循环的超集）。保留重定向，
          让历史书签和直链仍能落到工作室，而不是 404。 */}
      <Route path="/creation">
        {prefersMobile ? <Redirect to="/m" /> : <Redirect to="/editing" />}
      </Route>
      {/* 剪辑工作室：聊天驱动剪辑（小酌对话 + 预览播放器 + 时间轴） */}
      <Route path="/editing">
        {prefersMobile ? <Redirect to="/m" /> : <AuthGuard><EditingStudioPage /></AuthGuard>}
      </Route>
      <Route path="/admin/users">
        <AdminGuard>
          <AdminVisitsPage />
        </AdminGuard>
      </Route>
      <Route path="/admin/visits">
        <Redirect to="/admin/users" />
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
