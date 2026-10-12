import { useRef, type PointerEvent, type MouseEvent } from "react";
import {
  canStartStageSwipe,
  isHorizontalStageSwipe,
  swipedStoryStage,
  type StoryStage,
} from "./mobileStageSwipe";

export function useMobileStageSwipe(
  stage: StoryStage,
  onChange: (stage: StoryStage) => void,
  disabled: boolean
) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    stage: StoryStage;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      gesture.current = null;
      if (
        disabled ||
        !event.isPrimary ||
        event.pointerType === "mouse" ||
        !(event.target instanceof Element)
      )
        return;
      if (
        !canStartStageSwipe(event.target, event.clientX, window.innerWidth) ||
        window.getSelection()?.toString()
      )
        return;
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
        stage,
      };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start || event.pointerId !== start.id) return;
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      // Once the user starts reading vertically, never reinterpret that gesture as a page change.
      if (dy > 10 && dy > dx) gesture.current = null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (
        !start ||
        disabled ||
        start.stage !== stage ||
        start.id !== event.pointerId ||
        window.getSelection()?.toString()
      )
        return;
      const dx = event.clientX - start.x,
        dy = event.clientY - start.y,
        elapsed = event.timeStamp - start.time;
      if (isHorizontalStageSwipe(dx, dy, elapsed))
        suppressClickUntil.current = Date.now() + 500;
      const next = swipedStoryStage(stage, dx, dy, elapsed);
      if (next !== stage) {
        onChange(next);
      }
    },
    onPointerCancel() {
      gesture.current = null;
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // A swipe that began on a memory card must not also open the card underneath.
      if (Date.now() < suppressClickUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
