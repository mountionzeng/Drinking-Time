import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  BIRD_GESTURES,
  BIRD_POSES,
  nextBirdGesture,
  type BirdPose,
} from "./xiaoyiGestures";

export function XiaoyiBird({ active }: { active: boolean }) {
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
    const schedule = () => {
      timers.push(
        setTimeout(
          () => {
            if (document.hidden) return;
            const index = nextBirdGesture(previous);
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
          6500 + Math.random() * 6500
        )
      );
    };
    const visibility = () => {
      clear();
      setPose("turn");
      setGesture(null);
      if (!document.hidden) schedule();
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, reduced]);
  const frame = BIRD_POSES[pose];
  return (
    <span
      aria-hidden="true"
      className="xiaoyi-bird"
      data-gesture={gesture ?? ""}
      style={{
        backgroundImage: `url('/shiguang/companion/${frame.sheet}.webp')`,
        backgroundPosition: `${frame.x} ${frame.y}`,
      }}
    />
  );
}
