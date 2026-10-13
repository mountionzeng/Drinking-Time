import React, { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { NayinElement } from "@/features/nayin/nayin";
import EmotiveWuxingIcon from "@/features/nayin/views/EmotiveWuxingIcon";
import { NAYIN_COMPANION_MOTION } from "./nayinCompanionMotion";

/** Only the mobile launcher moves; shared logos and chat avatars stay unchanged. */
export function NayinCompanion({
  element,
  active,
}: {
  element: NayinElement;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const [gesture, setGesture] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let previous = -1;
    const schedule = () => {
      timer = setTimeout(
        () => {
          // Choose either of the other two poses; avoid consecutive repeats.
          const next =
            previous < 0
              ? Math.floor(Math.random() * 3)
              : (previous + 1 + Math.floor(Math.random() * 2)) % 3;
          previous = next;
          setGesture(next);
          timer = setTimeout(() => {
            setGesture(null);
            schedule();
          }, 2400);
        },
        6500 + Math.random() * 6500
      );
    };
    const reset = () => {
      clearTimeout(timer);
      setGesture(null);
      if (active && !reduced && !document.hidden) schedule();
    };
    reset();
    document.addEventListener("visibilitychange", reset);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [element, active, reduced]);
  const playing = active && !reduced && gesture !== null;
  return (
    <span
      className="nayin-companion"
      data-element={element}
      data-docked={active}
      data-playing={playing}
      data-gesture={playing ? gesture : ""}
      aria-hidden="true"
    >
      <EmotiveWuxingIcon
        element={element}
        mood={
          playing ? NAYIN_COMPANION_MOTION[element].moods[gesture] : "neutral"
        }
        size={76 * Math.SQRT2}
        faceScale={1 / Math.SQRT2}
        faceSpacing={1.35}
        animated={false}
      />
    </span>
  );
}
