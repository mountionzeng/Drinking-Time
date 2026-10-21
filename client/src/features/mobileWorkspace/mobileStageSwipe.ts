export const STORY_STAGE_ORDER = ["text", "image", "video"] as const;
export type StoryStage = (typeof STORY_STAGE_ORDER)[number];

export function isHorizontalStageSwipe(
  dx: number,
  dy: number,
  elapsedMs: number
): boolean {
  return (
    elapsedMs >= 0 &&
    elapsedMs <= 700 &&
    Math.abs(dx) >= 48 &&
    Math.abs(dx) >= Math.abs(dy) * 1.8
  );
}

export function swipedStoryStage(
  stage: StoryStage,
  dx: number,
  dy: number,
  elapsedMs: number
): StoryStage {
  if (!isHorizontalStageSwipe(dx, dy, elapsedMs)) return stage;
  const index = STORY_STAGE_ORDER.indexOf(stage) + (dx < 0 ? 1 : -1);
  return STORY_STAGE_ORDER[index] ?? stage;
}

export function canStartStageSwipe(
  target: Element,
  clientX: number,
  viewportWidth: number
): boolean {
  // Leave system back gestures, text editing, media controls and nested scrollers alone.
  return (
    clientX > 24 &&
    clientX < viewportWidth - 24 &&
    !target.closest(
      'input, textarea, select, video, audio, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-stage-swipe="ignore"]'
    )
  );
}
