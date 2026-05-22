import { Route, Switch, Redirect } from 'wouter';
import AnalysisPage from '@/pages/AnalysisPage';
import CreationPage from '@/pages/CreationPage';
import LoginPage from '@/pages/LoginPage';
import WelcomePreviewPage from '@/pages/WelcomePreviewPage';
import NotFound from '@/pages/NotFound';
import { useAuth } from '@/_core/hooks/useAuth';
import type { ReactNode } from 'react';

function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

export default function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/welcome" component={WelcomePreviewPage} />
      <Route path="/">
        <AuthGuard><AnalysisPage /></AuthGuard>
      </Route>
      <Route path="/analysis">
        <AuthGuard><AnalysisPage /></AuthGuard>
      </Route>
      <Route path="/creation">
        <AuthGuard><CreationPage /></AuthGuard>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
