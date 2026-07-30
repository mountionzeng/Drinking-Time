import GuidedLanding from '@/features/analysis/views/GuidedLanding';
import AuthEntryPanel from '@/features/auth/views/AuthEntryPanel';
import {
  getOrCreateLocalEmotionGuestId,
  normalizeEmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from '@/features/analysis/emotionAnalysis';
import BeverageAmbience from '@/features/nayin/views/BeverageAmbience';
import WuxingParticles from '@/features/nayin/views/WuxingParticles';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

export function resolveWelcomeEntryPath(isAuthenticated: boolean) {
  return isAuthenticated ? '/editing' : '/login';
}

type WelcomePreviewPageProps = {
  autoFocusAuth?: boolean;
};

export default function WelcomePreviewPage({
  autoFocusAuth = false,
}: WelcomePreviewPageProps) {
  const [location, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const nextPath = resolveWelcomeEntryPath(isAuthenticated);
  const authSectionRef = useRef<HTMLDivElement | null>(null);
  const shouldShowAuthPanel = autoFocusAuth || !isAuthenticated;
  const guestReplyMut = trpc.emotionAnalysis.guestReply.useMutation();
  const saveGuestProfile = useCallback(
    async (input: SaveEmotionAnalysisProfileInput) => {
      const saved = await guestReplyMut.mutateAsync({
        ...input,
        guestId: getOrCreateLocalEmotionGuestId(),
      });
      return (
        normalizeEmotionAnalysisProfile(
          { ...saved, source: 'local' },
          'local'
        ) ?? undefined
      );
    },
    [guestReplyMut]
  );

  function openAuthPanel() {
    if (isAuthenticated && !autoFocusAuth) {
      setLocation(nextPath);
      return;
    }
    authSectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  useEffect(() => {
    if (!autoFocusAuth) return;
    const timer = window.setTimeout(() => {
      authSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [autoFocusAuth, isAuthenticated, location]);

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />
      <main className="relative z-10 flex flex-1 min-h-0">
        <GuidedLanding
          onSelectMaterial={openAuthPanel}
          onSelectStory={openAuthPanel}
          authPanelFirst={autoFocusAuth}
          authPanel={
            shouldShowAuthPanel ? (
              <div ref={authSectionRef} className="w-full flex justify-center">
                <AuthEntryPanel autofocus={autoFocusAuth} />
              </div>
            ) : null
          }
          hideEntryCards
          accessLayout={shouldShowAuthPanel}
          onSaveEmotionProfile={saveGuestProfile}
          emotionProfileLoading={guestReplyMut.isPending}
        />
      </main>
    </div>
  );
}
