/**
 * MobilePage — 手机端入口页面。
 * 包含底部 tab 栏，根据路由切换聊天页和故事版页。
 * 包裹 MobileChatProvider 管理聊天+图片状态。
 */
import { useRoute } from "wouter";
import { MobileChatProvider } from "@/features/mobileChat/MobileChatContext";
import MobileTabBar from "@/features/mobileChat/views/MobileTabBar";

export default function MobilePage() {
  const [isStoryboard] = useRoute("/m/storyboard");

  return (
    <MobileChatProvider>
      <div className="flex h-dvh flex-col bg-stone-50">
        {/* 主内容区域（底部 tab 栏占位） */}
        <main className="flex-1 overflow-hidden pb-14">
          {isStoryboard ? (
            // 故事版页占位（U8 实现）
            <div className="flex h-full items-center justify-center text-gray-400">
              故事版（开发中）
            </div>
          ) : (
            // 聊天页占位（U5 实现）
            <div className="flex h-full items-center justify-center text-gray-400">
              聊天页（开发中）
            </div>
          )}
        </main>

        <MobileTabBar />
      </div>
    </MobileChatProvider>
  );
}
