import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { MobileCompanionActions } from "./MobileCompanionActions";
import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MobileChatView } from "./MobileChatView";
import { useMobileConversation } from "./useMobileConversation";
import {
  memoryFollowupMessage,
  companionSourceLabel,
  type MemoryFollowupSource,
} from "./mobileMemoryFollowup";

export function MobileMemoryFollowupChat({
  userId,
  source,
  onLocked,
  onActionLocked,
  onThinkingChange,
  draft,
  setDraft,
  baseline,
}: {
  draft: string;
  setDraft: (draft: string) => void;
  baseline: React.MutableRefObject<Set<string> | null>;
  userId: number;
  source: MemoryFollowupSource;
  onLocked: (locked: boolean) => void;
  onActionLocked?: (locked: boolean) => void;
  onThinkingChange?: (thinking: boolean) => void;
}) {
  const t = useUiText();

  const conversation = useMobileConversation({
    userId,
    storyId: source.storyId,
  });
  const utils = trpc.useUtils();
  useEffect(() => {
    onThinkingChange?.(conversation.isSubmitting);
    return () => onThinkingChange?.(false);
  }, [conversation.isSubmitting, onThinkingChange]);
  if (
    baseline.current === null &&
    (conversation.historyState === "loaded" ||
      conversation.historyState === "empty")
  )
    baseline.current = new Set(
      conversation.messages.filter(m => m.source === "server").map(m => m.id)
    );
  const [error, setError] = useState<string | null>(null);
  const [actionLocked, setActionLocked] = useState(false);
  const busy =
    conversation.isSubmitting ||
    conversation.recoveryTurns.some(t => t.status !== "synced");
  useEffect(() => {
    onLocked(busy || actionLocked || Boolean(draft.trim()));
  }, [busy, actionLocked, draft, onLocked]);
  const sending = useRef(false);
  const visibleMessages = conversation.messages.filter(
    m =>
      m.source === "recovery" ||
      (baseline.current !== null && !baseline.current.has(m.id))
  );
  const controller = {
    ...conversation,
    historyState:
      conversation.historyState === "loaded" && !visibleMessages.length
        ? ("empty" as const)
        : conversation.historyState,
    messages: visibleMessages,
    submit: async (text: string) => {
      if (sending.current) return null;
      sending.current = true;
      setError(null);
      try {
        const result = await conversation.submit(
          memoryFollowupMessage(source, text)
        );
        if (result?.status === "synced") {
          void utils.memoryWarehouse.forStory.invalidate({
            storyId: source.storyId,
          });
          void utils.memoryWarehouse.list.invalidate();
        }
        if (!result) setDraft(text);
        return result;
      } catch {
        setDraft(text);
        setError("暂未发送，新想法已保留。");
        return null;
      } finally {
        sending.current = false;
      }
    },
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <details className="mx-4 mb-2 max-h-28 shrink-0 overflow-y-auto rounded-xl bg-muted/50 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-primary">
          {t("接着这段{0}聊", [t(companionSourceLabel(source))])}
        </summary>
        <p className="mt-2 whitespace-pre-wrap leading-6">{source.content}</p>
      </details>
      {error && (
        <p role="alert" className="px-4 text-sm">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <MobileChatView
          controller={controller}
          storyTitle={t("{0}的新想法", [t(companionSourceLabel(source))])}
          greeting={t("看到这段{0}，你又想到了什么？", [
            t(companionSourceLabel(source)),
          ])}
          composerDisabled={actionLocked}
          draftValue={draft}
          onDraftChange={setDraft}
        />
      </div>
      <MobileCompanionActions
        storyId={source.storyId}
        source={source}
        draft={draft}
        setDraft={setDraft}
        messages={visibleMessages}
        disabled={busy}
        onLocked={locked => {
          setActionLocked(locked);
          onActionLocked?.(locked);
        }}
      />
      <p className="px-4 py-2 text-[11px] text-muted-foreground">
        {t("新想法连同来源引用追加到这个故事，原回忆保留。")}
      </p>
    </div>
  );
}
