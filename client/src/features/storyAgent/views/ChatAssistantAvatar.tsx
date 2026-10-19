/** Desktop companion: original Shiguang logo or expressive Nayin cup. */
import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { NAYIN_COMPANION_MOTION } from "@/features/mobileWorkspace/nayinCompanionMotion";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import type { WuxingMood } from "@/features/nayin/views/EmotiveWuxingIcon";
import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import "./desktopCompanion.css";

export const CHAT_AVATAR_SIZE = 38;
type Props = {
  awake?: boolean;
  activity?: "idle" | "reading" | "thinking" | "generating";
  visualTheme: VisualThemeMode;
  element: NayinElement;
  mood?: WuxingMood;
  animated?: boolean;
  notificationKey?: string;
};
export default function ChatAssistantAvatar({
  visualTheme, element, mood, awake = false, animated = false, notificationKey, activity = "idle",
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
      data-activity={activity} data-notifying={notifying && !reduced} data-theme={visualTheme}
      data-mood={mood ?? "neutral"} data-animated={animated && !reduced} aria-hidden="true">
      <span className="desktop-companion-character">
        {visualTheme === "shiguang" ? (
          <img src="/shiguang/nav-materials-v2.png" alt="" width={CHAT_AVATAR_SIZE}
            height={CHAT_AVATAR_SIZE} className="h-full w-full object-contain" />
        ) : (
          <EmotiveWuxingIcon element={element} size={64} plain={!awake} awake={awake}
            faceScale={1 / Math.SQRT2} faceSpacing={1.35} showLegs={false}
            mood={mood ?? NAYIN_COMPANION_MOTION[element].moods[0]} animated={(animated || awake) && !reduced} />
        )}
      </span>
    </span>
  );
}
