import { trpc } from "@/lib/trpc";
import { warehouseFileChatIds } from "@shared/warehouseFiles";
import { storySpineStore } from "./spine/storySpine";
export function useWarehouseFileChat() {
  const inspect = trpc.creationAgent.inspectWarehouseFiles.useMutation();
  return async (storyId: number, instruction: string) => {
    const fileIds = warehouseFileChatIds(instruction);
    if (!fileIds.length) return null;
    const scope = storySpineStore.getState();
    try {
      const reply = await inspect.mutateAsync({
        storyId,
        fileIds,
        instruction,
      });
      const now = storySpineStore.getState();
      if (
        now.accountId !== scope.accountId ||
        now.activeStoryId !== storyId ||
        now.storyScopeEpoch !== scope.storyScopeEpoch ||
        now.storyLoadEpoch !== scope.storyLoadEpoch
      )
        return {
          handled: true as const,
          reply:
            "文件读取属于原故事 / File inspection belongs to the original story",
        };
      return { handled: true as const, reply };
    } catch (error) {
      return {
        handled: true as const,
        reply: `文件读取未完成，已入库的原文件仍保留 / File inspection incomplete; saved originals are retained: ${error instanceof Error ? error.message : "请稍后重试"}`,
      };
    }
  };
}
