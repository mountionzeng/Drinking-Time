import AppProviders from '@/app/providers/AppProviders';
import AppRouter from '@/app/router/AppRouter';
import AccessTracker from '@/features/admin/AccessTracker';

function App() {
  return (
    <AppProviders>
      <AccessTracker />
      <AppRouter />
    </AppProviders>
  );
}

export default App;
