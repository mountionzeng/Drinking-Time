/**
 * MobileTabBar — 底部 tab 栏（聊天 / 故事版）
 * props-in, UI-out，不直接调用 tRPC。
 */
import { useLocation } from "wouter";
import type { MobileTab } from "../types";

const TABS: Array<{ key: MobileTab; label: string; path: string }> = [
  { key: "chat", label: "聊天", path: "/m" },
  { key: "storyboard", label: "故事版", path: "/m/storyboard" },
];

export default function MobileTabBar() {
  const [location, setLocation] = useLocation();

  // 根据当前路由判断激活的 tab
  const activeTab: MobileTab =
    location === "/m/storyboard" ? "storyboard" : "chat";

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t bg-white/95 backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => setLocation(tab.path)}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors ${
              isActive
                ? "text-amber-700 border-t-2 border-amber-700"
                : "text-gray-400"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
