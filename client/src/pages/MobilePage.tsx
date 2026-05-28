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
      <div className="flex h-dvh flex-col bg-stone-50">
        {/* 主内容区域（底部 tab 栏占位） */}
        <main className="flex-1 overflow-hidden pb-14">
          {isStoryboard ? (
            <MobileStoryboard />
          ) : (
            <MobileChatPage />
          )}
        </main>

        <MobileTabBar />
      </div>
    </MobileChatProvider>
  );
}
