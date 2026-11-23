import CreationEntryTracker from '@/features/activityJourney/CreationEntryTracker';
import AppVersionNotice from '@/features/appVersion/AppVersionNotice';
import AppProviders from '@/app/providers/AppProviders';
import AppRouter from '@/app/router/AppRouter';
import AccessTracker from '@/features/admin/AccessTracker';

function App() {
  return (
    <AppProviders>
      <AppVersionNotice />
      <AccessTracker />
      <CreationEntryTracker />
      <AppRouter />
    </AppProviders>
  );
}

export default App;
