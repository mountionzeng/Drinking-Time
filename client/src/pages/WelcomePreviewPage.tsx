import GuidedLanding from '@/features/analysis/views/GuidedLanding';
import BeverageAmbience from '@/features/nayin/views/BeverageAmbience';
import WuxingParticles from '@/features/nayin/views/WuxingParticles';
import { useLocation } from 'wouter';

export default function WelcomePreviewPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="h-screen flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />
      <main className="relative z-10 flex flex-1 min-h-0">
        <GuidedLanding
          onSelectMaterial={() => setLocation('/analysis')}
          onSelectStory={() => setLocation('/analysis')}
        />
      </main>
    </div>
  );
}
