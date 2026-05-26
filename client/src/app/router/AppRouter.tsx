import { Route, Switch } from 'wouter';
import AnalysisPage from '@/pages/AnalysisPage';
import WelcomePreviewPage from '@/pages/WelcomePreviewPage';
import MobilePage from '@/pages/MobilePage';
import NotFound from '@/pages/NotFound';

export default function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={AnalysisPage} />
      <Route path="/analysis" component={AnalysisPage} />
      <Route path="/welcome" component={WelcomePreviewPage} />
      {/* 手机端路由 */}
      <Route path="/m" component={MobilePage} />
      <Route path="/m/storyboard" component={MobilePage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
