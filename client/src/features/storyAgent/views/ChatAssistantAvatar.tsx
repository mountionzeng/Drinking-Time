/** Desktop-only companion peeking over the edge of a reply. */
import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import EmotiveWuxingIcon, {
  resolveEmotionMood,
  type WuxingMood,
} from "@/features/nayin/views/EmotiveWuxingIcon";
import type { NayinElement } from "@/features/nayin/nayin";
import type { VisualThemeMode } from "@/features/nayin/visualTheme";
import {
  BIRD_POSES,
  type BirdPose,
} from "@/features/mobileWorkspace/xiaoyiGestures";
import "./desktopCompanion.css";

export const CHAT_AVATAR_SIZE = 52;

type Props = {
  visualTheme: VisualThemeMode;
  element: NayinElement;
  emotion?: string | null;
  mood?: WuxingMood;
  animated?: boolean;
};
const BIRD_MOODS: Partial<Record<WuxingMood, BirdPose>> = {
  thinking: "curious",
  trust: "front",
  joy: "smile",
  anticipation: "hello",
  surprise: "curious",
  sadness: "blink",
  groundedness: "front",
};

export default function ChatAssistantAvatar({
  visualTheme,
  element,
  emotion,
  mood,
  animated = false,
}: Props) {
  const reduced = useReducedMotion();
  const [idleMood, setIdleMood] = useState<WuxingMood>("neutral");
  const resolved = mood ?? resolveEmotionMood(emotion);
  useEffect(() => {
    setIdleMood("neutral");
    if (!animated || reduced || resolved !== "neutral") return;
    let timer: ReturnType<typeof setTimeout>;
    let reset: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (!document.hidden) {
            setIdleMood(Math.random() < 0.5 ? "trust" : "anticipation");
            reset = setTimeout(() => setIdleMood("neutral"), 2200);
          }
          schedule();
        },
        9000 + Math.random() * 6000
      );
    };
    schedule();
    return () => {
      clearTimeout(timer);
      clearTimeout(reset);
    };
  }, [animated, reduced, resolved]);
  const expression = resolved === "neutral" ? idleMood : resolved;
  const frame = BIRD_POSES[BIRD_MOODS[expression] ?? "turn"];
  return (
    <span
      className="desktop-companion-peek"
      data-testid="chat-assistant-avatar"
      data-theme={visualTheme}
      data-mood={expression}
      data-animated={animated && !reduced}
      aria-hidden="true"
    >
      <span className="desktop-companion-character">
        {visualTheme === "shiguang" ? (
          <span
            className="desktop-companion-bird"
            style={{
              backgroundImage: `url('/shiguang/companion/${frame.sheet}.webp')`,
              backgroundPosition: `${frame.x} ${frame.y}`,
            }}
          />
        ) : (
          <EmotiveWuxingIcon
            element={element}
            size={CHAT_AVATAR_SIZE}
            mood={expression}
            animated={false}
            showLegs={false}
            faceScale={0.9}
            faceSpacing={1.08}
          />
        )}
      </span>
    </span>
  );
}
