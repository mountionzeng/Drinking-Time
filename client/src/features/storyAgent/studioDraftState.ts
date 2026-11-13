import { useEffect, useRef } from "react";
import { storySpineStore } from "./spine/storySpine";

// Passive editor status, never document contents. Entries vanish with their editor.
const states = new Map<
  string,
  { accountId: number | null; storyId: number; epoch: number; pending: boolean }
>();
export function hasPendingStudioDraft(
  accountId: number | null,
  storyId: number | null,
  epoch: number
) {
  return [...states.values()].some(
    s =>
      s.accountId === accountId &&
      s.storyId === storyId &&
      s.epoch === epoch &&
      s.pending
  );
}
export function useStudioDraftState(storyId: number | null, pending: boolean) {
  const id = useRef<string>(crypto.randomUUID());
  const state = storySpineStore.getState();
  useEffect(() => {
    if (storyId && storyId > 0)
      states.set(id.current, {
        accountId: state.accountId,
        storyId,
        epoch: state.storyScopeEpoch,
        pending,
      });
    return () => {
      states.delete(id.current);
    };
  }, [storyId, pending, state.accountId, state.storyScopeEpoch]);
}
