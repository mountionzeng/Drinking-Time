import { toast } from "sonner";
import { importLegacyStoryDraft } from "./legacyStoryRecovery";
import { storySpineStore } from "./spine/storySpine";

/** Called after the recovery view obtains explicit ownership confirmation. */
export function restoreLegacyDraftToCurrentAccount(key: string, userId: number, projectId: number | null): boolean {
  const current = storySpineStore.getState();
  if (!projectId || current.accountId !== userId || current.saveStatus === "saving" || current.saveStatus === "error" || current.isReplying || current.isGeneratingScript) {
    toast.error("请等当前故事保存完成后再导入");
    return false;
  }
  try {
    importLegacyStoryDraft({ storage: window.localStorage, sourceKey: key, userId, projectId, confirmed: true });
    current.bindAccountScope(null);
    storySpineStore.getState().bindAccountScope(userId);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "无法导入旧草稿，原内容已保留");
    return false;
  }
}
