import { useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { storySpineStore, useStorySpine } from "./spine/storySpine";

/** Both title inputs share one ordered save queue scoped to the signed-in account. */
export function useStoryRename() {
  const storyRenameMut = trpc.storyAgent.storyRename.useMutation();
  const utils = trpc.useUtils();
  const setStoryTitle = useStorySpine(state => state.setStoryTitle);
  const setStoryList = useStorySpine(state => state.setStoryList);
  const titleRenameQueue = useRef<Promise<void>>(Promise.resolve());
  const renameStory = useCallback(
    async (storyId: number | null, title: string) => {
      const nextTitle = title.trim().slice(0, 255);
      if (!nextTitle) throw new Error("故事名称不能为空");

      const origin = storySpineStore.getState();
      const owner = origin.accountId;
      const saveTitle = async () => {
        if (storySpineStore.getState().accountId !== owner) throw new Error("账号已切换，请重新打开故事后改名");

        if (storyId == null || storyId <= 0) {
          if (storySpineStore.getState().storyScopeEpoch !== origin.storyScopeEpoch)
            throw new Error("故事已切换，请在当前故事重新改名");
          setStoryTitle(nextTitle);
          return;
        }

        const result = await storyRenameMut.mutateAsync({
          id: storyId,
          title: nextTitle,
        });
        if (result.status !== "ok") throw new Error(result.error);

        const current = storySpineStore.getState();
        if (current.accountId !== owner) return;
        if (
          current.activeStoryId === storyId ||
          current.remoteStoryId === storyId
        ) {
          setStoryTitle(nextTitle);
        }
        setStoryList(items =>
          items.map(item =>
            item.id === storyId
              ? { ...item, title: nextTitle, updatedAt: new Date() }
              : item
          )
        );
        await Promise.allSettled([
          utils.storyAgent.storyGet.invalidate({ id: storyId }),
          utils.storyAgent.storyList.invalidate(),
        ]);
      };
      // Both title editors use this action. A slower earlier response must not
      // overwrite the later name, and a failed request must not block the next.
      const task = titleRenameQueue.current.catch(() => {}).then(saveTitle);
      titleRenameQueue.current = task;
      await task;
    },
    [setStoryList, setStoryTitle, storyRenameMut, utils.storyAgent]
  );
  return renameStory;
}
