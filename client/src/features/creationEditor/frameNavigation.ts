/** Plain arrows navigate the preview; modified arrows remain clip-edit shortcuts. */
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
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"], [role="combobox"]'
    )
  );
}
export const PAUSED_FRAME_SHORTCUT_EVENT = "dt:paused-frame-reference";
