export type MobileStageStyle =
  | "shiguang"
  | "metal"
  | "wood"
  | "water"
  | "fire"
  | "earth";

// A brief page gesture, using the same direction for taps and horizontal swipes.
export function mobileStageMotion(style: MobileStageStyle, direction: number) {
  const d = direction < 0 ? -1 : 1;
  const profiles = {
    shiguang: { x: d * 20, rotateY: d * 5, opacity: 0.65 },
    metal: { x: d * 12, scale: 0.985, opacity: 0.55 },
    wood: { x: d * 16, rotate: d * 0.6, opacity: 0.65 },
    water: { x: d * 22, skewX: d * 1.2, opacity: 0.65 },
    fire: { x: d * 14, y: 5, opacity: 0.55 },
    earth: { x: d * 12, y: -3, scale: 0.99, opacity: 0.7 },
  };
  return {
    initial: profiles[style],
    animate: {
      x: 0,
      y: 0,
      rotate: 0,
      rotateY: 0,
      skewX: 0,
      scale: 1,
      opacity: 1,
    },
    transition: {
      duration: style === "water" ? 0.24 : style === "fire" ? 0.18 : 0.22,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  };
}
