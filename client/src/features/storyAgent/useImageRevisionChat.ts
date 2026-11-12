import { trpc } from "@/lib/trpc";
import { parseImageRevisionDecision } from "@shared/chatImageRevision";
import { storySpineStore } from "./spine/storySpine";

export function useImageRevisionChat() {
  const decide = trpc.storyAgent.decideChatImageRevision.useMutation();
  const utils = trpc.useUtils();
  return async (storyId: number, text: string) => {
    const command = parseImageRevisionDecision(text);
    if (!command) return null;
    const scope = storySpineStore.getState();
    const current = () => {
      const now = storySpineStore.getState();
      return (
        now.accountId === scope.accountId &&
        now.activeStoryId === storyId &&
        now.storyScopeEpoch === scope.storyScopeEpoch &&
        now.storyLoadEpoch === scope.storyLoadEpoch
      );
    };
    try {
      const revisions = await utils.storyAgent.chatImageRevisions.fetch({
        storyId,
      });
      if (!current())
        return {
          handled: true as const,
          reply: "已离开当前故事，尚未替换素材。",
        };
      const matches = revisions.filter(
        r =>
          !r.requestId.startsWith("image:") && !r.decision &&
          r.status === "succeeded" &&
          (command.shotNo == null || r.shotNo === command.shotNo) &&
          (command.imageId == null ||
            r.candidates.some(c => c.imageId === command.imageId))
      );
      if (matches.length !== 1)
        return {
          handled: true as const,
          reply: matches.length
            ? "有多次改图等待选择，请回复“图片 #编号替换原图”，编号显示在图片下方。"
            : "暂时没有等待选择的新图。原任务完成后会显示在这里，原素材未变。",
        };
      const revision = matches[0];
      if (
        command.kind === "replace" &&
        !command.ordinal &&
        !command.imageId &&
        revision.candidates.length > 1
      )
        return {
          handled: true as const,
          reply: `第 ${String(revision.shotNo).padStart(2, "0")} 镜有 ${revision.candidates.length} 张新图，请回复“第 ${revision.shotNo} 镜第 2 张替换原图”。`,
        };
      const candidate = command.imageId
        ? revision.candidates.find(c => c.imageId === command.imageId)
        : revision.candidates[(command.ordinal ?? 1) - 1];
      if (command.kind === "replace" && !candidate)
        return {
          handled: true as const,
          reply: "没有找到这个图片序号，请按对话里的图片编号选择。",
        };
      const decision = await decide.mutateAsync({
        storyId,
        requestId: revision.requestId,
        kind: command.kind,
        imageId: command.kind === "replace" ? candidate!.imageId : undefined,
      });
      await Promise.allSettled([
        utils.storyAgent.chatImageRevisions.invalidate({ storyId }),
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
        utils.storyAgent.storyImages.invalidate({ storyId }),
        utils.storyAgent.storyGet.invalidate({ id: storyId }),
      ]);
      if (current() && command.kind === "replace" && candidate) {
        const now = storySpineStore.getState();
        if (
          !now.activeSelection ||
          now.activeSelection.imageId === revision.sourceImageId
        )
          now.setActiveSelection({
            sourceType: "storyboard-image",
            sourceId: String(candidate.imageId),
            storyId,
            stableShotId: revision.stableShotId,
            shotNo: revision.shotNo,
            imageId: candidate.imageId,
            selectedText: `第 ${String(revision.shotNo).padStart(2, "0")} 镜 · 图片 #${candidate.imageId}`,
            fullText: "对话采用的新图",
            objectVersion: `image:${candidate.imageId}`,
            materialStatus: "current-image",
          });
      }
      return {
        handled: true as const,
        reply: `第 ${String(revision.shotNo).padStart(2, "0")} 镜：${command.kind === "keep" ? "已保留原素材，新图仍可在对话和仓库查看。" : decision.referenceOnly ? "已确认新的参考帧，原图和新版都保存在仓库。视频与剪辑线保持不变，尚未生成视频。" : "已用新图替换原素材的位置和首尾帧引用，时间、图层不变，旧图保留在仓库。"}`,
      };
    } catch (error) {
      return {
        handled: true as const,
        reply: `这次选择未完成：${error instanceof Error ? error.message : "请稍后再试"}。新图已保留，无需重新生成。`,
      };
    }
  };
}
