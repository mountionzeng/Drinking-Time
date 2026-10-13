export type BirdPose =
  | "normal"
  | "blink"
  | "smile"
  | "curious"
  | "turn"
  | "hello"
  | "wave"
  | "front";
export const BIRD_POSES: Record<
  BirdPose,
  { sheet: "expressions" | "wave"; x: string; y: string }
> = {
  normal: { sheet: "expressions", x: "0%", y: "0%" },
  blink: { sheet: "expressions", x: "100%", y: "0%" },
  smile: { sheet: "expressions", x: "0%", y: "100%" },
  curious: { sheet: "expressions", x: "100%", y: "100%" },
  turn: { sheet: "wave", x: "0%", y: "0%" },
  hello: { sheet: "wave", x: "100%", y: "0%" },
  wave: { sheet: "wave", x: "0%", y: "100%" },
  front: { sheet: "wave", x: "100%", y: "100%" },
};
export const BIRD_GESTURES: readonly (readonly (readonly [
  number,
  BirdPose,
])[])[] = [
  [
    [0, "normal"],
    [230, "blink"],
    [360, "normal"],
    [600, "blink"],
    [740, "normal"],
    [1300, "turn"],
  ],
  [
    [0, "normal"],
    [250, "smile"],
    [1500, "normal"],
    [1900, "turn"],
  ],
  [
    [0, "normal"],
    [300, "curious"],
    [1600, "normal"],
    [2000, "turn"],
  ],
  [
    [0, "turn"],
    [280, "hello"],
    [580, "wave"],
    [850, "hello"],
    [1100, "wave"],
    [1450, "hello"],
    [1750, "turn"],
  ],
  [
    [0, "turn"],
    [350, "front"],
    [2000, "turn"],
  ],
  [
    [0, "normal"],
    [400, "blink"],
    [2000, "normal"],
    [2300, "turn"],
  ],
];
/** Small expressions dominate; waving and turning are occasional. */
export function nextBirdGesture(
  previous: number,
  random = Math.random
): number {
  const weighted = [0, 0, 1, 1, 2, 3, 4, 5].filter(value => value !== previous);
  return weighted[
    Math.min(
      weighted.length - 1,
      Math.floor(Math.max(0, random()) * weighted.length)
    )
  ];
}
