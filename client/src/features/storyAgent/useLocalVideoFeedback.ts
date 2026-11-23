import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  localNotePrefix,
  localReplyPrefix,
  startingLocalFeedback,
} from "@shared/localVideoFeedback";
import type { CreationEditorShot } from "../creationEditor/types";
import { storySpineStore } from "./spine/storySpine";
import { shotConversationSelection } from "./shotConversation";
import type { ChatMessage } from "./types";

export function useLocalVideoFeedback(
  storyId: number | null,
  accountId: number | null,
  messages: ChatMessage[]
) {
  const utils = trpc.useUtils();
  const inflight = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sameScope = () => {
    const state = storySpineStore.getState();
    return storyId &&
      accountId &&
      state.activeStoryId === storyId &&
      state.accountId === accountId
      ? state
      : undefined;
  };
  async function execute(note: ChatMessage) {
    const state = sameScope(),
      quote = note.selectionQuote;
    if (
      !state ||
      !storyId ||
      !quote?.videoTakeId ||
      !quote.stableShotId ||
      quote.storyId !== storyId
    )
      return;
    const epoch = state.storyScopeEpoch;
    const id = note.id.slice(localNotePrefix.length),
      replyId = localReplyPrefix + id;
    if (inflight.current.has(id)) return;
    inflight.current.add(id);
    try {
      const result =
        await utils.client.warehouseVideoSequence.localFeedback.mutate({
          id,
          storyId,
          takeId: quote.videoTakeId,
          stableShotId: quote.stableShotId,
          instruction: note.content,
          sentAt: note.timestamp,
        });
      const current = sameScope();
      if (current?.storyScopeEpoch !== epoch) return;
      current.setMessages(rows =>
        rows.map(row =>
          row.id === replyId
            ? {
                ...row,
                content: result.text,
                selectionQuote: {
                  ...quote,
                  objectVersion: result.takeId
                    ? "local-feedback-ready"
                    : "local-feedback-help",
                  videoTakeId: result.takeId ?? quote.videoTakeId,
                },
              }
            : row
        )
      );
      if (result.takeId)
        await Promise.allSettled([
          utils.storyAgent.storyMaterialState.invalidate({ storyId }),
          utils.creationAgent.warehouseFiles.invalidate({ storyId }),
        ]);
    } catch {
      if (sameScope()?.storyScopeEpoch === epoch)
        setErrors(previous => ({
          ...previous,
          [replyId]: "暂时没有收到结果。可以用原反馈重新连接。",
        }));
    } finally {
      inflight.current.delete(id);
    }
  }
  function submit(
    shot: CreationEditorShot,
    takeId: number,
    instruction: string
  ) {
    const state = sameScope(),
      text = instruction.trim();
    if (
      !state ||
      !storyId ||
      !text ||
      text.length > 4000 ||
      !shot.videoTakes?.some(t => t.id === takeId && t.status === "available")
    )
      return false;
    const id = crypto.randomUUID(),
      at = Date.now();
    const selectionQuote = {
      ...shotConversationSelection(storyId, shot),
      sourceType: "animatic-video" as const,
      videoTakeId: takeId,
    };
    const note: ChatMessage = {
      id: localNotePrefix + id,
      role: "user",
      content: text,
      selectionQuote,
      timestamp: at,
    };
    state.setMessages(rows => [
      ...rows,
      note,
      {
        id: localReplyPrefix + id,
        role: "assistant",
        content: startingLocalFeedback(text),
        selectionQuote: {
          ...selectionQuote,
          objectVersion: "local-feedback-pending",
        },
        timestamp: at + 1,
      },
    ]);
    void execute(note);
    return true;
  }
  const run = useRef(execute);
  run.current = execute;
  useEffect(() => {
    const notes = new Map(
      messages
        .filter(m => m.id.startsWith(localNotePrefix))
        .map(m => [m.id.slice(localNotePrefix.length), m])
    );
    for (const reply of messages) {
      if (
        !reply.id.startsWith(localReplyPrefix) ||
        errors[reply.id] ||
        reply.selectionQuote?.storyId !== storyId
      )
        continue;
      const note = notes.get(reply.id.slice(localReplyPrefix.length));
      if (
        note &&
        (reply.selectionQuote?.objectVersion === "local-feedback-pending" ||
          reply.content === startingLocalFeedback(note.content))
      )
        void run.current(note);
    }
  }, [messages, errors, storyId, accountId]);
  return {
    submit,
    errors,
    retry: (id: string) =>
      setErrors(old => {
        const next = { ...old };
        delete next[id];
        return next;
      }),
  };
}
