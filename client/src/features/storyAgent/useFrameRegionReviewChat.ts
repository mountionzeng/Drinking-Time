import { trpc } from "@/lib/trpc";
import { isFrameReferenceChat } from "@shared/chatFrameReference";
import { isFrameRegionChat, latestFrameRegionReview } from "@shared/frameRegionReview";
import { storySpineStore } from "./spine/storySpine";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";

export function useFrameRegionReviewChat() {
  const turn = trpc.creationAgent.frameReview.turn.useMutation();
  const utils = trpc.useUtils();
  const { language } = useUiLanguage();
  return async (storyId: number, instruction: string, selection?: { stableShotId?: string | null; imageId?: number | null }) => {
    const scope = storySpineStore.getState();
    let review;
    try { review = latestFrameRegionReview(scope.messages, storyId, instruction, selection?.stableShotId); }
    catch (error) { if (!isFrameReferenceChat(instruction)) return null; return { handled: true as const, reply: String(error) }; }
    if (!isFrameRegionChat(instruction, review)) return null;
    try {
      const result = await turn.mutateAsync({ storyId, instruction, language,
        stableShotId: isFrameReferenceChat(instruction) ? selection?.stableShotId ?? undefined : review?.stableShotId,
        imageId: selection?.imageId ?? undefined,
        ...(!isFrameReferenceChat(instruction) && review ? { reviewId: review.id, expectedRevision: review.revision } : {}),
      });
      await Promise.allSettled([utils.storyAgent.storyMaterialState.invalidate({ storyId }), utils.storyAgent.storyImages.invalidate({ storyId })]);
      const current = storySpineStore.getState();
      if (current.accountId !== scope.accountId || current.activeStoryId !== storyId || current.storyScopeEpoch !== scope.storyScopeEpoch || current.storyLoadEpoch !== scope.storyLoadEpoch)
        return { handled: true as const, reply: language === "en" ? "Review saved in the original story." : "范围记录已保存在原故事。" };
      return result;
    } catch (error) {
      return { handled: true as const, reply: `${language === "en" ? "This step did not complete" : "这一步尚未完成"}：${error instanceof Error ? error.message : String(error)}` };
    }
  };
}
