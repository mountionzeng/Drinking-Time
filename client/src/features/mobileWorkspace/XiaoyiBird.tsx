import React, { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { MOOD_MOTION } from "@/features/nayin/views/EmotiveWuxingIcon";
import type { CompanionAttention } from "./companionAttention";
import {
  BIRD_GESTURES,
  BIRD_POSES,
  nextBirdGesture,
  type BirdPose,
} from "./xiaoyiGestures";

const BIRD_ATTENTION_MOTION = {
  listening: {
    ...MOOD_MOTION.trust,
    transition: { ...MOOD_MOTION.trust.transition, duration: 3.6 },
  },
  thinking: {
    ...MOOD_MOTION.thinking,
    transition: { ...MOOD_MOTION.thinking.transition, duration: 4.2 },
  },
};

export function XiaoyiBird({
  active,
  attention = "idle",
}: {
  active: boolean;
  attention?: CompanionAttention;
}) {
  const reduced = useReducedMotion();
  const [pose, setPose] = useState<BirdPose>("turn");
  const [gesture, setGesture] = useState<number | null>(null);
  useEffect(() => {
    setPose("turn");
    setGesture(null);
    if (!active || reduced) return;
    let previous = -1;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const schedule = (greet = false) => {
      timers.push(
        setTimeout(
          () => {
            if (document.hidden) return;
            const index = greet ? 3 : nextBirdGesture(previous);
            previous = index;
            setGesture(index);
            for (const [delay, frame] of BIRD_GESTURES[index])
              timers.push(setTimeout(() => setPose(frame), delay));
            timers.push(
              setTimeout(() => {
                setGesture(null);
                schedule();
              }, 2500)
            );
          },
          greet ? 350 : 6500 + Math.random() * 6500
        )
      );
    };
    const visibility = () => {
      clear();
      setPose("turn");
      setGesture(null);
      if (!document.hidden) schedule(true);
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, reduced]);
  const frame =
    BIRD_POSES[
      attention === "thinking"
        ? "curious"
        : attention === "listening"
          ? "front"
          : pose
    ];
  return (
    <motion.span
      initial={false}
      animate={
        !reduced && attention !== "idle"
          ? BIRD_ATTENTION_MOTION[attention]
          : { rotate: 0, transition: { duration: 0 } }
      }
      aria-hidden="true"
      className="xiaoyi-bird"
      data-attention={attention}
      data-gesture={attention === "idle" ? (gesture ?? "") : ""}
      style={{
        backgroundImage: `url('/shiguang/companion/${frame.sheet}.webp')`,
        backgroundPosition: `${frame.x} ${frame.y}`,
      }}
    />
  );
}
