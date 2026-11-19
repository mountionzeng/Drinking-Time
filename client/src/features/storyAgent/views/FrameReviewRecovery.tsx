import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { storySpineStore } from "../spine/storySpine";
import { missingFrameReviewMessages, withoutDuplicateFrameReviewRecovery } from "../frameReviewRecovery";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

/** Reloading while local analysis runs must not strand a saved result outside chat. */
export function FrameReviewRecovery({ storyId, busy }: { storyId: number | null; busy: boolean }) {
  const { language } = useUiLanguage();
  const scope = storySpineStore.getState();
  const history = trpc.creationAgent.frameReview.history.useQuery({ storyId: storyId ?? 0 }, {
    enabled: Boolean(storyId && storyId > 0 && !busy), refetchInterval: busy ? false : 15_000,
  });
  useEffect(() => {
    if (busy || !storyId || !history.data) return;
    const current = storySpineStore.getState();
    if (current.activeStoryId !== storyId || current.accountId !== scope.accountId || current.storyScopeEpoch !== scope.storyScopeEpoch || current.isReplying) return;
    current.setMessages(messages => {
      const unique = withoutDuplicateFrameReviewRecovery(messages);
      const missing = missingFrameReviewMessages(unique, history.data, storyId, language);
      return missing.length ? [...unique, ...missing] : unique;
    });
  }, [busy, storyId, history.data, language, scope.accountId, scope.storyScopeEpoch]);
  return null;
}
