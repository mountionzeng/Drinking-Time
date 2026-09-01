import { Route, Switch, Redirect } from "wouter";
import CreationPage from "@/pages/CreationPage";
import EditingStudioPage from "@/pages/EditingStudioPage";
import LoginPage from "@/pages/LoginPage";
import MobileWorkspacePage from "@/pages/MobileWorkspacePage";
import WelcomePreviewPage from "@/pages/WelcomePreviewPage";
import NotFound from "@/pages/NotFound";
import AdminInvitesPage from "@/pages/AdminInvitesPage";
import AdminVisitsPage from "@/pages/AdminVisitsPage";
import { useAuth } from "@/_core/hooks/useAuth";
import React, { type ReactNode } from "react";
import {
  mobileLoginHref,
  readMobileReturnPath,
  resolvePostLoginDestination,
} from "@/features/auth/mobileReturnPath";
import { rootWorkspacePath } from "@/features/mobileWorkspace/mobileWorkspaceEntry";

function AuthGuard({
  children,
  returnPath,
}: {
  children: ReactNode;
  returnPath?: string;
}) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) {
    return (
      <Redirect to={returnPath ? mobileLoginHref(returnPath) : "/login"} />
    );
  }
  return <>{children}</>;
}

function LoginEntry() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated) {
    const returnPath =
      typeof window === "undefined"
        ? null
        : readMobileReturnPath(window.location.search);
    return <Redirect to={resolvePostLoginDestination(returnPath)} />;
  }
  return <LoginPage />;
}

function RootEntry() {
  return <Redirect to={rootWorkspacePath()} />;
}

function AdminGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  if (user?.role !== "admin") return <Redirect to="/editing" />;
  return <>{children}</>;
}

export default function AppRouter() {
  return (
    <Switch>
      <Route path="/login">
        <LoginEntry />
      </Route>
      <Route path="/welcome">
        <WelcomePreviewPage />
      </Route>
      {/* 原网址按设备进入工作区；手机进入 /m，电脑进入完整剪辑工作室。 */}
      <Route path="/">
        <RootEntry />
      </Route>
      <Route path="/analysis">
        <Redirect to="/editing" />
      </Route>
      <Route path="/creation">
        <AuthGuard>
          <CreationPage />
        </AuthGuard>
      </Route>
      {/* 剪辑工作室：聊天驱动剪辑（聊聊对话 + 预览播放器 + 时间轴） */}
      <Route path="/editing">
        <AuthGuard>
          <EditingStudioPage />
        </AuthGuard>
      </Route>
      <Route path="/m">
        <AuthGuard returnPath="/m">
          <MobileWorkspacePage />
        </AuthGuard>
      </Route>
      <Route path="/admin/users">
        <AdminGuard>
          <AdminVisitsPage />
        </AdminGuard>
      </Route>
      <Route path="/admin/visits">
        <Redirect to="/admin/users" />
      </Route>
      <Route path="/admin/invites">
        <AdminGuard>
          <AdminInvitesPage />
        </AdminGuard>
      </Route>
      {/* 历史手机子路径只做兼容，统一收敛到唯一入口。 */}
      <Route path="/m/:rest*">
        <Redirect to="/m" />
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
