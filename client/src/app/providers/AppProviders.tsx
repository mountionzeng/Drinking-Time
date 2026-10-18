import type { PropsWithChildren } from 'react';
import { UiLanguageProvider } from '@/features/uiLanguage/UiLanguage';
import ErrorBoundary from '@/components/ErrorBoundary';
import BeverageTransitionOverlay from '@/features/nayin/views/BeverageTransitionOverlay';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NayinProvider } from '@/features/nayin/NayinContext';

export default function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <UiLanguageProvider mobileTypography={false}>
      <NayinProvider>
        <TooltipProvider>
          <Toaster />
          <BeverageTransitionOverlay />
          {children}
        </TooltipProvider>
      </NayinProvider>
      </UiLanguageProvider>
    </ErrorBoundary>
  );
}
