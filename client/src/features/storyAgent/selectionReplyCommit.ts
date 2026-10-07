import type { Dispatch, SetStateAction } from "react";
import type { SelectionState, ChatMessage } from "./types";
import { consumeSubmittedSelection } from "./selectionLifecycle";
import type { StoryboardImageRerenderResult } from "./StoryAgentContext";

export function selectionUserMessage(id: string, content: string, selection: SelectionState): ChatMessage {
  return { id, role: "user", content, timestamp: Date.now(), selectionQuote: selectionQuoteFrom(selection) };
}

export function imageRevisionReply(id: string, storyId: number | null, selection: SelectionState, revision: StoryboardImageRerenderResult): ChatMessage {
  return {
    id, role: "assistant", timestamp: Date.now(), content: revision.message,
    imageRevision: revision.status === "success" && revision.imageId && revision.imageUrl && storyId != null && selection.stableShotId && selection.shotNo
      ? { storyId, stableShotId: selection.stableShotId, shotNo: selection.shotNo, imageId: revision.imageId, imageUrl: revision.imageUrl }
      : undefined,
  };
}

export async function commitImageRevisionReply(input: {
  isCurrent: boolean;
  reply: ChatMessage;
  revision: StoryboardImageRerenderResult;
  commit: (reply: ChatMessage, warning: string, retainSelection: boolean) => Promise<unknown>;
}) {
  if (!input.isCurrent) return;
  await input.commit(input.reply, "[storyConversation] persist image revision failed:", input.revision.status !== "success");
}

export function selectionQuoteFrom(selection: SelectionState) {
  const { sourceType, sourceId, selectedText, objectVersion, contentFingerprint,
    storyId, stableShotId, shotNo, imageId, videoTakeId, rangeId } = selection;
  return { sourceType, sourceId, selectedText, objectVersion, contentFingerprint,
    selection: selection.selection, confirmedImageRegion: selection.confirmedImageRegion,
    storyId, stableShotId, shotNo, imageId, videoTakeId, rangeId };
}

export async function commitSelectionReply(input: {
  nextMessages: ChatMessage[];
  reply: ChatMessage;
  selection: SelectionState;
  userMessage: ChatMessage;
  storyId: number | null;
  setMessages: (messages: ChatMessage[]) => void;
  setActiveSelection: Dispatch<SetStateAction<SelectionState | null>>;
  appendTurn: (payload: {
    storyId: number;
    userMessage: { clientMessageId: string; content: string; selection: SelectionState };
    assistantMessage: { clientMessageId: string; content: string; candidateRevisionId: number | null };
  }) => Promise<unknown>;
  archive: (messages: ChatMessage[]) => Promise<unknown>;
  persistWarning: string;
  retainSelection?: boolean;
}) {
  const finalMessages = [...input.nextMessages, input.reply];
  input.setMessages(finalMessages);
  if (!input.retainSelection) input.setActiveSelection(current =>
    consumeSubmittedSelection(current, input.selection)
  );
  if (input.storyId != null) {
    try {
      await input.appendTurn({
        storyId: input.storyId,
        userMessage: {
          clientMessageId: input.userMessage.id,
          content: input.userMessage.content,
          selection: input.selection,
        },
        assistantMessage: {
          clientMessageId: input.reply.id,
          content: input.reply.content,
          candidateRevisionId: input.reply.promptCandidate?.revisionId ?? null,
        },
      });
    } catch (error) {
      console.warn(input.persistWarning, error);
    }
  }
  await input.archive(finalMessages);
}
