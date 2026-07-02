import GuidedLanding from '@/features/analysis/views/GuidedLanding';
import BeverageAmbience from '@/features/nayin/views/BeverageAmbience';
import WuxingParticles from '@/features/nayin/views/WuxingParticles';
import { useAuth } from '@/_core/hooks/useAuth';
import { ArrowRight, LogIn } from 'lucide-react';
import { useLocation } from 'wouter';

export function resolveWelcomeEntryPath(isAuthenticated: boolean) {
  return isAuthenticated ? '/analysis' : '/login';
}

export default function WelcomePreviewPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  const nextPath = resolveWelcomeEntryPath(isAuthenticated);
  const quickActionLabel = isAuthenticated ? '进入工作台' : '去登录';
  const QuickActionIcon = isAuthenticated ? ArrowRight : LogIn;

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />
      <div className="relative z-10 flex justify-end px-4 pt-4 sm:px-6 sm:pt-6">
        <button
          type="button"
          onClick={() => setLocation(nextPath)}
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium text-foreground transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            background: 'color-mix(in oklab, var(--background) 72%, transparent)',
            borderColor: 'var(--nayin-border)',
            boxShadow: '0 10px 30px -18px var(--nayin-glow)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <QuickActionIcon className="h-3.5 w-3.5" />
          {quickActionLabel}
        </button>
      </div>
      <main className="relative z-10 flex flex-1 min-h-0">
        <GuidedLanding
          onSelectMaterial={() => setLocation(nextPath)}
          onSelectStory={() => setLocation(nextPath)}
        />
      </main>
    </div>
  );
}
