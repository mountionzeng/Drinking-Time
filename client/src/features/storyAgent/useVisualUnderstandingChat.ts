import { withMediaChatSession, askMediaChatConfirmation } from "./mediaChatSession";
import { formatComputeQuote } from "@shared/computeMoney";
import { trpc } from "@/lib/trpc";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import { parseVisualUnderstandingChat, visualBriefReply } from "@shared/visualEditUnderstanding";

export function useVisualUnderstandingChat() {
  const inspect = trpc.storyAgent.visualUnderstanding.inspect.useMutation();
  const preferences = trpc.storyAgent.visualUnderstanding.preferences.useMutation();
  const utils = trpc.useUtils();
  const { language } = useUiLanguage();
  return async (storyId: number, instruction: string, selection?: { imageId?: number | null; stableShotId?: string | null }) => {
    const command = parseVisualUnderstandingChat(instruction);
    if (!command) return null;
    const owner = { storyId, stableShotId: selection?.stableShotId ?? undefined };
    const zh = language === "zh";
    try {
      if (command.kind !== "inspect") {
        const rows = await preferences.mutateAsync({ ...owner, action: command.kind, scope: command.scope, text: command.kind === "save" ? command.text : undefined });
        const label = command.scope === "user" ? (zh ? "我的" : "Personal") : command.scope === "shot" ? (zh ? "本镜头" : "Shot") : (zh ? "本作品" : "Story");
        return { handled: true as const, reply: command.kind === "forget" ? (zh ? `已忘记${label}美术偏好，作品和修改记录保留。` : `${label} visual preferences forgotten. Media and edit history are preserved.`)
          : `${label}${zh ? "美术偏好" : " visual preferences"}：${rows.map(r => r.text).join("；") || (zh ? "尚未设置" : "None saved")}${command.kind === "save" ? (zh ? "\n已记住。只用于你要求的修改；这次的明确要求始终优先。可直接说“查看美术偏好”或“忘记美术偏好”，加“我的”可管理个人偏好。" : "\nSaved. Current instructions always take priority. Say ‘show my visual preferences’ or ‘forget my visual preferences’ to manage personal preferences.") : ""}` };
      }
      const imageId = command.imageId ?? selection?.imageId ?? undefined;
      if (/修改记录|image edit history/i.test(instruction)) {
        const history = await utils.storyAgent.visualUnderstanding.history.fetch({ ...owner, imageId });
        return { handled: true as const, reply: history.length ? history.slice(-8).map(b => `${new Date(b.createdAt).toLocaleString()} · #${b.imageId}\n${b.instruction}\n${visualBriefReply(b, language)}`).join("\n\n") : (zh ? "当前范围还没有看图修改记录。" : "No image edit briefs in this scope yet.") };
      }
      if (!imageId) return { handled: true as const, reply: zh ? "点选一张现有图片，我会读取它，再区分要改和要保留的内容。" : "Select an existing image so I can inspect it and separate changes from things to preserve." };
      return await withMediaChatSession(storyId, async () => {
        const quote = await utils.storyAgent.visualUnderstanding.quote.fetch({ ...owner, imageId, instruction, language });
        const accepted = quote.cached || await askMediaChatConfirmation({ storyId, kind: "cost", text: zh
          ? `读取图片 #${imageId} 并整理修改要求，预计最多 ${formatComputeQuote(quote.estimatedCny)}。回复“确认”继续或“取消”。`
          : `Inspect image #${imageId}: up to ${formatComputeQuote(quote.estimatedCny)}. Reply “confirm” or “cancel”.` });
        if (!accepted) return { handled: true as const, reply: zh ? "已取消，尚未读图。" : "Cancelled without inspecting the image." };
        const result = await inspect.mutateAsync({ ...owner, imageId, instruction, language, costConfirmation: { accepted: true, ...quote } });
        return { handled: true as const, reply: result.reply };
      });
    } catch (error) {
      return { handled: true as const, reply: error instanceof Error ? error.message : (zh ? "暂时无法读取或保存，请稍后再试。" : "Could not read or save. Please try again.") };
    }
  };
}
