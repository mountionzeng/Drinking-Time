/**
 * MobileWelcomePage — 手机端欢迎页。
 * 继承桌面端 /welcome 的视觉与氛围（饮品氛围 + 五行粒子 + 引导落地页），
 * 只保留「聊一个故事」入口，点击进入手机端聊天（/m）。
 */
import { useLocation } from 'wouter';
import GuidedLanding from '@/features/analysis/views/GuidedLanding';
import BeverageAmbience from '@/features/nayin/views/BeverageAmbience';
import WuxingParticles from '@/features/nayin/views/WuxingParticles';

export default function MobileWelcomePage() {
  const [, setLocation] = useLocation();

  const enterChat = () => {
    try {
      localStorage.setItem('dt:m:welcomed', '1');
    } catch {
      /* localStorage 不可用时忽略，仍可进入 */
    }
    setLocation('/m');
  };

  return (
    <div className="h-dvh flex flex-col bg-background relative">
      <BeverageAmbience />
      <WuxingParticles />
      <main className="relative z-10 flex flex-1 min-h-0">
        <GuidedLanding storyOnly onSelectMaterial={enterChat} onSelectStory={enterChat} />
      </main>
    </div>
  );
}
