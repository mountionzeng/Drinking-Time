import type { ChatFrameReference, PausedFrameSnapshot, WarehouseVideoFrame } from "@shared/chatFrameReference";

/** Plain arrows step the preview when focus belongs to a navigation surface. */
export function isFrameNavigationKey(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}) {
  return (
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  );
}
export function isFrameNavigationTarget(target: Element | null) {
  return (
    Boolean(
      target?.closest(
        '[data-frame-navigation="true"], [data-playback-space="true"], [data-storyboard-visual-layer]'
      )
    ) &&
    !target?.closest(
      '[data-visual-clip-move-target="true"], input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"], [role="combobox"]'
    )
  );
}
export const PAUSED_FRAME_SHORTCUT_EVENT = "dt:paused-frame-reference";

export type FrameReferenceEvent =
  | { kind: "clear"; storyId: number }
  | { kind: "warehouse"; source: WarehouseVideoFrame; extraction?: Promise<ChatFrameReference>; editKeyframe?: true }
  | { kind: "capture"; snapshot: PausedFrameSnapshot; extraction?: Promise<ChatFrameReference>; editKeyframe?: true };

/** Both timeline entry points hand the already placed asset to chat. */
export function referenceExtractedFrame(snapshot: PausedFrameSnapshot, extraction: Promise<ChatFrameReference>) {
  window.dispatchEvent(new CustomEvent<FrameReferenceEvent>(PAUSED_FRAME_SHORTCUT_EVENT, {
    detail: { kind: "capture", snapshot, extraction },
  }));
}
