/**
 * MobileTabBar — 底部 tab 栏（聊天 / 故事版）
 * props-in, UI-out，不直接调用 tRPC。
 */
import { BookOpen, MessageCircle } from "lucide-react";
import { useLocation } from "wouter";
import type { MobileTab } from "../types";

const TABS: Array<{
  key: MobileTab;
  label: string;
  subLabel: string;
  path: string;
  icon: typeof MessageCircle;
}> = [
  { key: "chat", label: "小酌", subLabel: "CHAT", path: "/m", icon: MessageCircle },
  {
    key: "storyboard",
    label: "故事版",
    subLabel: "BOARD",
    path: "/m/storyboard",
    icon: BookOpen,
  },
];

export default function MobileTabBar() {
  const [location, setLocation] = useLocation();

  // 根据当前路由判断激活的 tab
  const activeTab: MobileTab =
    location === "/m/storyboard" ? "storyboard" : "chat";

  return (
    <nav
      className="dtm-tabbar"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="移动端导航"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setLocation(tab.path)}
            className={`dtm-tab-item ${isActive ? "dtm-tab-item--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="dtm-tab-icon">
              <Icon size={18} />
            </span>
            <span className="dtm-tab-label">
              <span className="dtm-tab-label-main">{tab.label}</span>
              <span className="dtm-tab-label-sub">{tab.subLabel}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
