import type { Dispatch, SetStateAction } from "react";
import type { SelectionState, ChatMessage } from "./types";
import { consumeSubmittedSelection } from "./selectionLifecycle";

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
}) {
  const finalMessages = [...input.nextMessages, input.reply];
  input.setMessages(finalMessages);
  input.setActiveSelection(current =>
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
