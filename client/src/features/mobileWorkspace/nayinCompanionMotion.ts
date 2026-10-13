import type { TargetAndTransition } from "framer-motion";
import type { NayinElement } from "@/features/nayin/nayin";
import type { WuxingMood } from "@/features/nayin/views/EmotiveWuxingIcon";

/** Same journey for all companions; timing and body language belong to the drink. */
export const NAYIN_COMPANION_MOTION: Record<
  NayinElement,
  {
    lean: number;
    drift: number;
    duration: number;
    moods: readonly WuxingMood[];
  }
> = {
  metal: {
    lean: -12,
    drift: -5,
    duration: 0.72,
    moods: ["joy", "anticipation", "trust"],
  },
  wood: {
    lean: 6,
    drift: 7,
    duration: 0.95,
    moods: ["trust", "anticipation", "groundedness"],
  },
  water: {
    lean: -9,
    drift: -12,
    duration: 0.9,
    moods: ["anticipation", "surprise", "trust"],
  },
  fire: {
    lean: 12,
    drift: 5,
    duration: 0.68,
    moods: ["joy", "surprise", "anticipation"],
  },
  earth: {
    lean: -5,
    drift: 3,
    duration: 1.05,
    moods: ["groundedness", "trust", "joy"],
  },
};

export function nayinCompanionTravel(
  element: NayinElement,
  open: boolean,
  distance: number,
  reduced: boolean
): TargetAndTransition {
  const { lean, drift, duration } = NAYIN_COMPANION_MOTION[element];
  if (reduced)
    return {
      x: 0,
      y: open ? -distance : 0,
      rotate: 0,
      scale: 1,
      transition: { duration: 0 },
    };
  return {
    x: open ? [0, 0, drift, 0] : [0, -drift, 0, 0],
    y: open
      ? [0, 5, -distance - 8, -distance]
      : [-distance, -distance - 5, 5, 0],
    rotate: open ? [0, -lean / 3, lean, 0] : [0, -lean, lean / 3, 0],
    scale: open ? [1, 0.94, 1.04, 1] : [1, 1.02, 0.94, 1],
    transition: { duration, times: [0, 0.18, 0.78, 1], ease: "easeInOut" },
  };
}
