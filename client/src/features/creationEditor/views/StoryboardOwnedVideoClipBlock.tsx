import type { StoryTimelineVisualClip } from "@shared/storyMaterial";
import { visualObjectRefKey, type VisualObjectRef } from "@shared/visualObject";
import {
  frameToPx,
  msToPx,
  type TimelineViewport,
} from "@shared/timelineViewport";
import {
  storyboardEditFilmstripFrameUrls,
  storyboardOwnedClipNudgeBase,
} from "../storyboardEditRow";
import { storyboardVisualClipArrowMove } from "../storyboardVisualObjectInteraction";
import { STORYBOARD_VIDEO_CLIP_DRAG_MIME } from "../storyboardVisualDragProtocol";
import { StoryboardEditFilmstrip } from "./StoryboardEditFilmstrip";
import type {
  StoryboardBoardTimeline,
  StoryboardEditShot,
  VisualObjectMenuState,
} from "./StoryboardVisualLayerRow";

export function StoryboardOwnedVideoClipBlock({
  shot,
  clip,
  visualLayer,
  viewport,
  timeline,
  selectedVisualObject,
  onSelectVisualObject,
  onNudgeVisualClip,
  onOpenObjectMenu,
}: {
  shot: StoryboardEditShot;
  clip: StoryTimelineVisualClip;
  visualLayer: number;
  viewport: TimelineViewport;
  timeline: StoryboardBoardTimeline;
  selectedVisualObject: VisualObjectRef | null;
  onSelectVisualObject: (object: VisualObjectRef, target: HTMLElement) => void;
  onNudgeVisualClip: (input: {
    clipId: string;
    startVisualLayer: number;
    deltaVisualLayers: number;
    startFrame: number;
    deltaFrames: number;
  }) => void;
  onOpenObjectMenu: (menu: VisualObjectMenuState) => void;
}) {
  const object = {
    type: "owned-video-clip",
    clipId: clip.id,
    ownerStableShotId: shot.stableShotId,
  } as const;
  const nudgeBase = storyboardOwnedClipNudgeBase({
    ownerStartFrame: shot.timing.startFrame,
    clip,
  });
  const startFrame = nudgeBase.startFrame;
  const leftPx = frameToPx(viewport, startFrame);
  const widthPx = Math.max(1, msToPx(viewport, clip.durationMs));
  const openMenu = (target: HTMLElement, clientX: number, clientY: number) => {
    onSelectVisualObject(object, target);
    onOpenObjectMenu({ object, clientX, clientY });
  };
  return (
    <button
      type="button"
      className="absolute bottom-1 top-1 z-[18] touch-none cursor-grab overflow-hidden rounded-sm border border-sky-400/70 bg-sky-500/45 text-left text-[8px] outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: leftPx, width: widthPx }}
      data-testid={`storyboard-owned-video-clip-${visualLayer + 1}-${clip.id}`}
      data-visual-object-type="owned-video-clip"
      data-visual-object-id={clip.id}
      data-visual-clip-move-target="true"
      aria-selected={
        selectedVisualObject?.type === "owned-video-clip" &&
        visualObjectRefKey(selectedVisualObject) === visualObjectRefKey(object)
      }
      aria-label={`${clip.label}，视频片段，视觉层 ${visualLayer + 1}`}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+F10 ContextMenu"
      draggable={Boolean(timeline.onMoveVisualClip)}
      onPointerDown={event => {
        // Keep native drag eligible; only stop the host shot gesture.
        event.stopPropagation();
        onSelectVisualObject(object, event.currentTarget);
      }}
      onDragStart={event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          STORYBOARD_VIDEO_CLIP_DRAG_MIME,
          JSON.stringify({ clipId: clip.id, sourceVisualLayer: visualLayer })
        );
      }}
      onClick={event => {
        event.stopPropagation();
        timeline.onTogglePlay(false);
        onSelectVisualObject(object, event.currentTarget);
      }}
      onContextMenu={event => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(event.currentTarget, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if (
          storyboardVisualClipArrowMove({
            event,
            onMove: (deltaFrames, deltaVisualLayers) => {
              onNudgeVisualClip({
                clipId: nudgeBase.clipId,
                startVisualLayer: nudgeBase.startVisualLayer,
                deltaVisualLayers,
                startFrame,
                deltaFrames,
              });
            },
          })
        )
          return;
        if (
          !(
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        openMenu(
          event.currentTarget,
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
      }}
    >
      <StoryboardEditFilmstrip
        frameUrls={storyboardEditFilmstripFrameUrls({
          source: {
            takeId: clip.takeId,
            rangeId: clip.rangeId,
            sourceStartSec: clip.sourceStartSec,
            sourceEndSec: clip.sourceEndSec,
            reverse: clip.effects?.reverse,
          },
          durationMs: clip.durationMs,
        })}
        posterUrl={null}
        testId={`storyboard-owned-video-filmstrip-${clip.id}`}
      />
      <span className="relative block truncate px-1">{clip.label}</span>
    </button>
  );
}
