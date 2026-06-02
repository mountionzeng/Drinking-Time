/**
 * MobilePage — 手机端入口页面。
 * 包含底部 tab 栏，根据路由切换聊天页和故事版页。
 * 包裹 MobileChatProvider 管理聊天+图片状态。
 */
import { useRoute, Redirect } from "wouter";
import { MobileChatProvider } from "@/features/mobileChat/MobileChatContext";
import MobileTabBar from "@/features/mobileChat/views/MobileTabBar";
import MobileChatPage from "@/features/mobileChat/views/MobileChatPage";
import MobileStoryboard from "@/features/mobileChat/views/MobileStoryboard";
import BeverageAmbience from "@/features/nayin/views/BeverageAmbience";
import WuxingParticles from "@/features/nayin/views/WuxingParticles";
import "@/features/mobileChat/mobile-redesign.css";

export default function MobilePage() {
  const [isStoryboard] = useRoute("/m/storyboard");

  // 首次进入手机端 → 先看欢迎页（继承桌面欢迎体验），看过后直接进聊天
  const welcomed =
    typeof window !== "undefined" &&
    localStorage.getItem("dt:m:welcomed") === "1";
  if (!welcomed && !isStoryboard) {
    return <Redirect to="/m/welcome" />;
  }

  return (
    <MobileChatProvider>
      {/* 居中壳：手机下铺满；iPad/大屏下 .dtm-app 锁成居中列，两侧露出饮品氛围 */}
      <div className="dtm-shell">
        <BeverageAmbience />
        <WuxingParticles />
        <div className="dtm-app">
          {/* 主内容区域（底部 tab 栏占位） */}
          <main className="dtm-main">
            {isStoryboard ? (
              <MobileStoryboard />
            ) : (
              <MobileChatPage />
            )}
          </main>

          <MobileTabBar />
        </div>
      </div>
    </MobileChatProvider>
  );
}
