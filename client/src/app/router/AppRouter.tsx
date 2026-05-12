import { Route, Switch } from 'wouter';
import AnalysisPage from '@/pages/AnalysisPage';
import NotFound from '@/pages/NotFound';

export default function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={AnalysisPage} />
      <Route path="/analysis" component={AnalysisPage} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
