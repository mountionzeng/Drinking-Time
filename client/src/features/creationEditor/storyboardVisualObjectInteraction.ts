import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Routes frame/layer keyboard nudges without coupling clip blocks to a row. */
export function storyboardVisualClipArrowMove(input: {
  event: ReactKeyboardEvent<HTMLElement>;
  onMove: (deltaFrames: number, deltaVisualLayers: number) => void;
}) {
  const { event } = input;
  if (
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight" &&
    event.key !== "ArrowUp" &&
    event.key !== "ArrowDown"
  ) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const step = event.shiftKey ? 15 : 1;
    input.onMove(event.key === "ArrowLeft" ? -step : step, 0);
  } else {
    input.onMove(0, event.key === "ArrowUp" ? 1 : -1);
  }
  return true;
}
