import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ArtSystemCommand } from "@shared/artSystemChat";
import { artSystemChatReply } from "@shared/artSystem";
import { chatImageRefsStore } from "./chatImageRefsStore";
import { storySpineStore } from "./spine/storySpine";
import { selectionBelongsToStory } from "./selectionStoryScope";
import { newId } from "./storyAgentUtils";
import type { ChatMessage, SelectionState } from "./types";

export function useArtSystemChat() {
  const write = trpc.artSystems.write.useMutation();
  const append = trpc.storyConversation.appendTurn.useMutation();
  const utils = trpc.useUtils();
  return async (input: {
    command: ArtSystemCommand;
    instruction: string;
    storyId: number | null | undefined;
    expectedVersion: number;
    selection: SelectionState | null;
    userMessage: ChatMessage;
    nextMessages: ChatMessage[];
    isCurrent: () => boolean;
  }) => {
    const { command, storyId, selection, isCurrent } = input;
    let reply: string;
    try {
      if (!storyId || storyId <= 0) throw new Error("请先保存当前故事，再建立美术体系");
      const basket = chatImageRefsStore.getState();
      const imageId = command.imageId ?? (command.action === "confirm" &&
        selection?.sourceType === "storyboard-image" && selectionBelongsToStory(selection, storyId)
        ? selection.imageId ?? undefined : undefined);
      const result = await write.mutateAsync({ storyId, ...command, imageId,
        expectedVersion: input.expectedVersion, instruction: input.instruction,
        operationToken: crypto.randomUUID(),
        referenceImageIds: basket.storyId === storyId ? basket.refs.map(ref => ref.imageId) : [],
      });
      if (!isCurrent()) return false;
      const state = storySpineStore.getState();
      state.setArtDirection(result.direction);
      state.setServerRevision(result.revision);
      utils.artSystems.read.setData({ storyId }, result.direction);
      void utils.storyAgent.storyMaterialState.invalidate({ storyId }).catch(() => {});
      reply = artSystemChatReply(result.direction, result.version);
    } catch (error) {
      reply = `美术体系未更新：${error instanceof Error ? error.message : "请稍后重试"}。原版本保留。`;
    }
    if (!isCurrent()) return false;
    const replyMessage: ChatMessage = { id: newId("msg"), role: "assistant", content: reply, timestamp: Date.now() };
    storySpineStore.getState().setMessages([...input.nextMessages, replyMessage]);
    if (storyId && storyId > 0) {
      try {
        await append.mutateAsync({ storyId,
          userMessage: { clientMessageId: input.userMessage.id, content: input.userMessage.content,
            selection: input.userMessage.selectionQuote ? selection : null },
          assistantMessage: { clientMessageId: replyMessage.id, content: replyMessage.content },
        });
      } catch { if (isCurrent()) toast.error("美术体系结果已显示，但对话记录暂未同步"); }
    }
    return isCurrent();
  };
}
