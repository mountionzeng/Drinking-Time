import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { layoutModuleLabel } from "@shared/layoutModuleContext";
import { LayoutMemoryDetails } from "@/features/publishingAlbum/LayoutMemoryDetails";
import { MobileCompanionActions } from "./MobileCompanionActions";
import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MobileChatView } from "./MobileChatView";
import { MobileTextDraftFlow } from "./MobileTextDraftFlow";
import { useMobileConversation } from "./useMobileConversation";
import {
  memoryFollowupMessage,
  companionSourceLabel,
  mobileWritingContext,
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
  onTextSaved,
  onNewStory,
}: {
  draft: string;
  setDraft: (draft: string) => void;
  baseline: React.MutableRefObject<Set<string> | null>;
  userId: number;
  source: MemoryFollowupSource;
  onLocked: (locked: boolean) => void;
  onActionLocked?: (locked: boolean) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onTextSaved?: (source: MemoryFollowupSource) => void;
  onNewStory?: () => void;
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
  const [versionLocked, setVersionLocked] = useState(false);
  const busy =
    conversation.isSubmitting ||
    conversation.recoveryTurns.some(t => t.status !== "synced");
  useEffect(() => {
    onLocked(busy || actionLocked || versionLocked || Boolean(draft.trim()));
    onActionLocked?.(actionLocked || versionLocked);
  }, [busy, actionLocked, versionLocked, draft, onLocked, onActionLocked]);
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
        const writing = mobileWritingContext(source);
        const result = writing
          ? await conversation.submit(text, writing)
          : await conversation.submit(memoryFollowupMessage(source, text));
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
          {source.module
            ? `已选中：${layoutModuleLabel(source.module)}`
            : source.kind === "text"
              ? t(
                  source.text?.selection
                    ? "正在讨论选中的文字"
                    : "正在讨论当前文字"
                )
              : t("接着这段{0}聊", [t(companionSourceLabel(source))])}
        </summary>
        <p className="mt-2 whitespace-pre-wrap leading-6">{source.content}</p>
        {source.module && (
          <p className="mt-1 text-xs text-muted-foreground">
            {source.module.pagePreview
              ? "会结合当前页画面给建议"
              : "画面暂不可用，可先讨论文字和位置"}
          </p>
        )}
      </details>
      {source.layoutMemory && source.layoutMemory.total > 0 && (
        <div className="mx-4 mb-2 shrink-0">
          <LayoutMemoryDetails
            memory={source.layoutMemory}
            accountId={userId}
            onClear={() =>
              onTextSaved?.({
                ...source,
                layoutMemory: { ...source.layoutMemory!, total: 0, recent: [] },
              })
            }
          />
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 text-sm">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <MobileChatView
          controller={controller}
          storyTitle={t("{0}的新想法", [t(companionSourceLabel(source))])}
          greeting={
            source.kind === "layout"
              ? source.module
                ? "这块想怎么改？可以问我怎么改更好。"
                : "我记着这次的排版调整，想接着聊哪里？"
              : source.kind === "text"
                ? t("这篇文字想怎么改？我先给你一个提议。")
                : t("看到这段{0}，你又想到了什么？", [
                    t(companionSourceLabel(source)),
                  ])
          }
          composerDisabled={actionLocked || versionLocked}
          draftValue={draft}
          onDraftChange={setDraft}
        />
      </div>
      {source.kind !== "layout" && (
        <MobileTextDraftFlow
          key={`${userId}:${source.storyId}`}
          userId={userId}
          storyId={source.storyId}
          source={source}
          messages={conversation.messages.map(({ id, role, content }) => ({
            id,
            role,
            content,
          }))}
          instruction={draft}
          disabled={busy || actionLocked}
          onLocked={setVersionLocked}
          onTextSaved={onTextSaved}
        />
      )}
      <MobileCompanionActions
        storyId={source.storyId}
        source={source}
        draft={draft}
        setDraft={setDraft}
        messages={visibleMessages}
        disabled={busy || versionLocked}
        onLocked={locked => {
          setActionLocked(locked);
          onActionLocked?.(locked);
        }}
        onNewStory={onNewStory}
      />
      {source.kind === "layout" ? (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          先讨论建议，回到排版里修改。
        </p>
      ) : (
        source.kind !== "text" && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground">
            {t("新想法连同来源引用追加到这个故事，原回忆保留。")}
          </p>
        )
      )}
    </div>
  );
}
