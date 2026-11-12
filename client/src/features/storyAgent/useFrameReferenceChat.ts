import { trpc } from "@/lib/trpc";
import { isFrameReferenceChat } from "@shared/chatFrameReference";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { storySpineStore } from "./spine/storySpine";

export function useFrameReferenceChat() {
  const capture = trpc.creationAgent.chatFrameReferences.useMutation();
  const utils = trpc.useUtils();
  const { language } = useUiLanguage();
  return async (storyId: number, instruction: string, selection?: { stableShotId?: string | null }) => {
    if (!isFrameReferenceChat(instruction)) return null;
    const scope = storySpineStore.getState();
    try {
      const result = await capture.mutateAsync({ storyId, instruction, stableShotId: selection?.stableShotId ?? undefined });
      await Promise.allSettled([
        utils.storyAgent.storyMaterialState.invalidate({ storyId }),
        utils.storyAgent.storyImages.invalidate({ storyId }),
      ]);
      const current = storySpineStore.getState();
      if (current.accountId !== scope.accountId || current.activeStoryId !== storyId || current.storyScopeEpoch !== scope.storyScopeEpoch || current.storyLoadEpoch !== scope.storyLoadEpoch)
        return { handled: true as const, reply: "参考帧已保存在原故事的仓库 / References saved in the original story" };
      const count = result.frames.length;
      const label = String(result.shotNo).padStart(2, "0");
      if (!count) return { handled: true as const, reply: `${language === "zh" ? `第 ${label} 镜尚未取得参考帧` : `Shot ${label}: no reference frames were saved`}: ${[...new Set(result.failures)].join("; ")}` };
      const reply = language === "zh"
        ? `第 ${label} 镜：已抽取 ${count}/${result.requestedCount} 张视频参考帧，保存在仓库。点图后可以继续说想改哪里。原视频和剪辑线未改动。${result.failures.length ? `\n部分抽帧失败：${[...new Set(result.failures)].join("；")}` : ""}`
        : `Shot ${label}: ${count}/${result.requestedCount} video reference frames saved to Warehouse. Select a frame and describe your changes. The video and timeline are unchanged.${result.failures.length ? `\nSome frames failed: ${[...new Set(result.failures)].join("; ")}` : ""}`;
      return { handled: true as const, reply, frameReferences: result.frames };
    } catch (error) {
      return { handled: true as const, reply: `${language === "zh" ? "参考帧未完成" : "Could not capture references"}: ${error instanceof Error ? error.message : "Please try again"}` };
    }
  };
}
