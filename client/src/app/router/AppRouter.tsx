import { Route, Switch, Redirect } from "wouter";
import CreationPage from "@/pages/CreationPage";
import EditingStudioPage from "@/pages/EditingStudioPage";
import LoginPage from "@/pages/LoginPage";
import WelcomePreviewPage from "@/pages/WelcomePreviewPage";
import MobilePage from "@/pages/MobilePage";
import MobileWelcomePage from "@/pages/MobileWelcomePage";
import NotFound from "@/pages/NotFound";
import AdminVisitsPage from "@/pages/AdminVisitsPage";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffect, useState, type ReactNode } from "react";

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

/** 桌面浏览器把窗口拉到这个宽度以下，就按手机端呈现。 */
export const NARROW_VIEWPORT_PX = 768;

/**
 * 触屏设备（iPad / 手机）打开桌面路由时，自动转入消费端 /m；
 * 桌面浏览器把窗口拉成条状（≤ 768px）时同样转入，拉宽后自动回到桌面。
 * - 判定：触屏看 ≤ 1366px，无触屏看 ≤ 768px —— 阈值收紧是为了不误伤小窗口笔记本。
 * - 逃生口：?desktop=1 强制走桌面并写入 localStorage 持久化；?desktop=0 清除。
 * - 监听 resize：宽度变化时双向切换。
 */
export function detectPrefersMobile(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const desktopParam = new URLSearchParams(window.location.search).get(
      "desktop"
    );
    if (desktopParam === "1") {
      localStorage.setItem("dt:forceDesktop", "1");
      return false;
    }
    if (desktopParam === "0") localStorage.removeItem("dt:forceDesktop");
    if (localStorage.getItem("dt:forceDesktop") === "1") return false;
  } catch {
    /* localStorage / URL 不可用时按默认继续判断 */
  }
  const touch =
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    "ontouchstart" in window;
  return window.innerWidth <= (touch ? 1366 : NARROW_VIEWPORT_PX);
}

/** 跟着窗口宽度走的手机端判定；用 rAF 合并连续的 resize 事件。 */
function usePrefersMobile(): boolean {
  const [prefersMobile, setPrefersMobile] = useState(detectPrefersMobile);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setPrefersMobile(detectPrefersMobile())
      );
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return prefersMobile;
}

export default function AppRouter() {
  const prefersMobile = usePrefersMobile();

  return (
    <Switch>
      <Route path="/login">
        {prefersMobile ? <Redirect to="/m" /> : <LoginEntry />}
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
      <Route path="/creation">
        {prefersMobile ? (
          <Redirect to="/m" />
        ) : (
          <AuthGuard>
            <CreationPage />
          </AuthGuard>
        )}
      </Route>
      {/* 剪辑工作室：聊天驱动剪辑（聊聊对话 + 预览播放器 + 时间轴） */}
      <Route path="/editing">
        {prefersMobile ? (
          <Redirect to="/m" />
        ) : (
          <AuthGuard>
            <EditingStudioPage />
          </AuthGuard>
        )}
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
      <Route path="/m/welcome">
        {prefersMobile ? <MobileWelcomePage /> : <Redirect to="/editing" />}
      </Route>
      <Route path="/m">
        {prefersMobile ? <MobilePage /> : <Redirect to="/editing" />}
      </Route>
      <Route path="/m/storyboard">
        {prefersMobile ? <MobilePage /> : <Redirect to="/editing" />}
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
