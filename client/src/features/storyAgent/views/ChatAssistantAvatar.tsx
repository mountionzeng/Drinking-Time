/** One desktop composer companion, using the same artwork as mobile. */
import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { LiaoliaoMascot } from "@/features/mobileWorkspace/LiaoliaoMascot";
import type { WuxingMood } from "@/features/nayin/views/EmotiveWuxingIcon";
import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import "./desktopCompanion.css";

export const CHAT_AVATAR_SIZE = 38;
type Props = {
  visualTheme: VisualThemeMode;
  element: NayinElement;
  mood?: WuxingMood;
  animated?: boolean;
  notificationKey?: string;
};
export default function ChatAssistantAvatar({
  visualTheme, element, mood, animated = false, notificationKey,
}: Props) {
  const reduced = useReducedMotion();
  const previousNotification = useRef(notificationKey);
  const [notifying, setNotifying] = useState(false);
  useEffect(() => {
    const changed = Boolean(notificationKey && previousNotification.current !== notificationKey);
    previousNotification.current = notificationKey;
    setNotifying(changed && !reduced);
    if (!changed || reduced) return;
    const timer = setTimeout(() => setNotifying(false), 1200);
    return () => clearTimeout(timer);
  }, [notificationKey, reduced]);
  return (
    <span className="desktop-companion-peek" data-testid="chat-assistant-avatar"
      data-notifying={notifying && !reduced} data-theme={visualTheme}
      data-mood={mood ?? "neutral"} data-animated={animated && !reduced} aria-hidden="true">
      <span className="desktop-companion-character">
        <LiaoliaoMascot visualTheme={visualTheme} element={element} size={CHAT_AVATAR_SIZE} />
      </span>
    </span>
  );
}
