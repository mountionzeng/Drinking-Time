import { useLayoutEffect, useRef, type RefObject } from "react";
import type { TimelineViewport } from "@shared/timelineViewport";
import { storyboardZoomForScale, storyboardZoomViewport } from "./StoryboardTimelineRuler";
import { bindStoryboardViewportGestures, type StoryboardGestureTarget } from "./storyboardViewportGestures";

/** Coalesce pinch input into one React render per frame, then restore its time anchor. */
export function useStoryboardViewportGestures(input: {
  scroller: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  scope: number | null | undefined;
  blocked: boolean;
  viewport: TimelineViewport;
  availableWidth: number;
  headerWidth: number;
  onZoom: (zoom: number) => void;
  onInteraction: () => void;
}) {
  const live = useRef(input);
  live.current = input;
  const pending = useRef<StoryboardGestureTarget | null>(null);
  const animation = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target || !input.scroller.current || Math.abs(target.scale - input.viewport.scale) > 1e-6) return;
    input.scroller.current.scrollLeft = target.scrollLeft;
    pending.current = null;
  }, [input.viewport.scale, input.enabled]);
  useLayoutEffect(() => {
    const element = input.scroller.current;
    if (!input.enabled || !element) return;
    const dispose = bindStoryboardViewportGestures(element, {
      headerWidth: input.headerWidth,
      blocked: () => live.current.blocked,
      onInteraction: () => live.current.onInteraction(),
      read: () => ({ ...live.current.viewport, availableWidth: live.current.availableWidth,
        scrollLeft: element.scrollLeft, ...pending.current }),
      change: target => {
        if (!pending.current && Math.abs(target.scale - live.current.viewport.scale) < 1e-6) {
          element.scrollLeft = target.scrollLeft;
          return;
        }
        pending.current = target;
        if (animation.current != null) return;
        animation.current = window.requestAnimationFrame(() => {
          animation.current = null;
          const next = pending.current;
          if (!next) return;
          const {viewport, availableWidth} = live.current;
          const zoom = storyboardZoomForScale(viewport.totalMs, availableWidth, next.scale);
          const actual = storyboardZoomViewport(viewport.totalMs, availableWidth, zoom);
          pending.current = { ...next, scale: actual.scale };
          // Returning to the same scale before React commits must still apply the pan.
          if (Math.abs(actual.scale - viewport.scale) < 1e-6) {
            element.scrollLeft = next.scrollLeft;
            pending.current = null;
          }
          live.current.onZoom(zoom);
        });
      },
    });
    return () => {
      dispose();
      if (animation.current != null) window.cancelAnimationFrame(animation.current);
      animation.current = null;
      pending.current = null;
    };
  }, [input.enabled, input.scroller, input.headerWidth, input.scope]);
}
