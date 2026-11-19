import { trpc } from "@/lib/trpc";
import { isFrameReferenceChat, type ChatFrameReference } from "@shared/chatFrameReference";
import { cloudShapeDecision, isFrameRegionChat, latestFrameRegionReview, regionTargets, type FrameReviewTurnOptions } from "@shared/frameRegionReview";
import { pollStoryboardImage } from "./views/pollStoryboardImage";
import { storySpineStore } from "./spine/storySpine";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef } from "react";
import { openReviewedVideo } from "./frameReviewVideoBridge";

export function useFrameRegionReviewChat() {
  const turn = trpc.creationAgent.frameReview.turn.useMutation();
  const generateCloud = trpc.creationAgent.frameReview.generateCloud.useMutation();
  const utils = trpc.useUtils();
  const { language } = useUiLanguage();
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, []);
  return async (storyId: number, instruction: string, selection?: { stableShotId?: string | null; imageId?: number | null }, sourceFrame?: ChatFrameReference, options?: FrameReviewTurnOptions) => {
    const scope = storySpineStore.getState();
    let review;
    try { review = options?.review ?? latestFrameRegionReview(scope.messages, storyId, instruction, selection?.stableShotId); }
    catch (error) { if (!isFrameReferenceChat(instruction)) return null; return { handled: true as const, reply: String(error) }; }
    if (!options?.inspectOnly && (sourceFrame ? !regionTargets(instruction).length : !isFrameRegionChat(instruction, review))) return null;
    const reuseReview = Boolean(sourceFrame && !options?.inspectOnly && review?.phase !== "cancelled" && review?.storyId === storyId &&
      review.stableShotId === sourceFrame.stableShotId && (sourceFrame.origin === "warehouse-video" || review.timelineVersion === sourceFrame.timelineVersion) &&
      review.frames.some(frame => frame.imageId === sourceFrame.imageId));
    try {
      const shape = review?.tasks.find(task=>task.target==="cloud")?.shapeQuote;
      if (!sourceFrame && !options?.inspectOnly && shape && review && cloudShapeDecision(instruction)) {
        if(selection?.imageId && ![shape.sourceImageId,review.tasks.find(t=>t.target==="cloud")?.imageId].includes(selection.imageId))
          return {handled:true as const,reply:language==="en"?"The selected image changed; return to the cloud preview before confirming.":"所选图片变了，请回到云层范围图再确认。"};
        const params={storyId,reviewId:review.id,expectedRevision:review.revision,stableShotId:review.stableShotId,requestId:shape.requestId,recoverOnly:cloudShapeDecision(instruction)==="recover",
          confirmation:{accepted:true as const,fingerprint:shape.fingerprint,estimatedCny:shape.estimatedCny}};
        const result=await generateCloud.mutateAsync(params);
        await utils.storyAgent.chatImageRevisions.invalidate({storyId});
        const controller = new AbortController();
        if (!mounted.current) controller.abort();
        controllers.current.add(controller);
        let done;
        try {
          done = result.status === "error" && result.recoveryPending
            ? await pollStoryboardImage(async () => {
                const current = storySpineStore.getState();
                if (current.accountId !== scope.accountId || current.activeStoryId !== storyId || current.storyScopeEpoch !== scope.storyScopeEpoch || current.storyLoadEpoch !== scope.storyLoadEpoch) {
                  controller.abort();
                  return { status: "error" as const, error: "Story changed" };
                }
                return generateCloud.mutateAsync({ ...params, recoverOnly: true });
              }, controller.signal)
            : result;
        } finally { controllers.current.delete(controller); }
        await Promise.allSettled([utils.storyAgent.storyMaterialState.invalidate({storyId}),utils.storyAgent.storyImages.invalidate({storyId}),utils.storyAgent.chatImageRevisions.invalidate({storyId})]);
        if(done.status!=="ok") return {handled:true as const,reply:done.status==="error"?done.error:language==="en"?"Cloud task is still being retrieved. No new purchase.":"云层任务仍在取回，原回执保留，不会重复购买。"};
        const current=storySpineStore.getState();
        if(current.accountId!==scope.accountId||current.activeStoryId!==storyId||current.storyScopeEpoch!==scope.storyScopeEpoch||current.storyLoadEpoch!==scope.storyLoadEpoch)
          return {handled:true as const,reply:language==="en"?"Cloud candidate saved in the original story.":"云层候选已保存到原故事的仓库。"};
        return {handled:true as const,frameReview:done.frameReview,reply:language==="en"?`Cloud candidate #${done.imageId} is saved in Warehouse.${done.frameReview ? " Compare it with the source below." : " Your newer editing scope is retained."} The video is unchanged.`:`云层候选 #${done.imageId} 已保存在仓库。${done.frameReview ? "下方可对比原图，请看是否合适。" : "保留你后来修改的范围。"}视频还没有替换。`};
      }
      const result = await turn.mutateAsync({ storyId, instruction, language,
        stableShotId: sourceFrame?.stableShotId ?? (isFrameReferenceChat(instruction) ? selection?.stableShotId ?? undefined : review?.stableShotId),
        sourceFrame: reuseReview ? undefined : sourceFrame,
        inspectOnly: options?.inspectOnly,
        imageId: selection?.imageId ?? undefined,
        ...((reuseReview || !sourceFrame && !isFrameReferenceChat(instruction)) && review ? { reviewId: review.id, expectedRevision: review.revision } : {}),
      });
      await Promise.allSettled([utils.storyAgent.storyMaterialState.invalidate({ storyId }), utils.storyAgent.storyImages.invalidate({ storyId })]);
      const current = storySpineStore.getState();
      if (current.accountId !== scope.accountId || current.activeStoryId !== storyId || current.storyScopeEpoch !== scope.storyScopeEpoch || current.storyLoadEpoch !== scope.storyLoadEpoch)
        return { handled: true as const, reply: language === "en" ? "Review saved in the original story." : "范围记录已保存在原故事。" };
      if ("videoPlan" in result && result.videoPlan && mounted.current) openReviewedVideo(result.videoPlan);
      return result;
    } catch (error) {
      return { handled: true as const, reply: `${language === "en" ? "This step did not complete" : "这一步尚未完成"}：${error instanceof Error ? error.message : String(error)}` };
    }
  };
}
