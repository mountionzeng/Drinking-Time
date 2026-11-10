export const SHOT_CHAT_FOCUS_EVENT = "dt:focus-shot-chat";
export function focusShotChat(storyId: number, stableShotId: string) {
  window.dispatchEvent(
    new CustomEvent(SHOT_CHAT_FOCUS_EVENT, {
      detail: { storyId, stableShotId },
    })
  );
}
