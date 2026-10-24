import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { layoutModuleLabel } from "@shared/layoutModuleContext";
import { LayoutMemoryDetails } from "@/features/publishingAlbum/LayoutMemoryDetails";
import { MobileChatContents } from "./MobileChatContents";
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
  const [error, setError] = useState<string | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [actionLocked, setActionLocked] = useState(false);
  const [versionLocked, setVersionLocked] = useState(false);
  const busy =
    conversation.isSubmitting ||
    conversation.recoveryTurns.some(t => t.status !== "synced");
  useEffect(() => {
    onLocked(
      busy ||
        actionLocked ||
        versionLocked ||
        contentsOpen ||
        voiceBusy ||
        Boolean(draft.trim())
    );
    onActionLocked?.(
      actionLocked || versionLocked || contentsOpen || voiceBusy
    );
  }, [
    busy,
    actionLocked,
    versionLocked,
    contentsOpen,
    voiceBusy,
    draft,
    onLocked,
    onActionLocked,
  ]);
  const sending = useRef(false);
  const writing = source.kind === "text" && Boolean(source.text);
  const visibleMessages = conversation.messages;
  const controller = {
    ...conversation,
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
  if (contentsOpen)
    return (
      <MobileChatContents
        userId={userId}
        storyId={source.storyId}
        conversation={conversation}
        onClose={() => setContentsOpen(false)}
        onQuote={selected => {
          onTextSaved?.(selected);
          setContentsOpen(false);
        }}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col" data-writing-chat={writing}>
      {writing ? (
        <article
          aria-label={t("当前文章")}
          className="min-h-0 flex-[1.2] overflow-y-auto overscroll-contain border-b border-border px-5 pb-5"
        >
          <h2 className="mb-4 font-serif text-xl leading-relaxed">
            {source.text!.content.title || source.title}
          </h2>
          <p className="whitespace-pre-wrap break-words font-serif text-base leading-8">
            {source.text!.content.body}
          </p>
        </article>
      ) : source.kind === "story" ? (
        <p className="px-5 pb-2 font-serif text-lg">
          {source.title || "这个故事"}
        </p>
      ) : (
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
      )}
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
          storyTitle={source.title || "这个故事"}
          onVoiceBusyChange={setVoiceBusy}
          greeting={
            source.kind === "story"
              ? "我在呢，接着聊这个故事吧。"
              : source.kind === "layout"
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
      <div className={writing ? "relative shrink-0" : "contents"}>
        {writing && (
          <button
            type="button"
            aria-label={t("更多操作")}
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen(value => !value)}
            className="mx-auto flex min-h-8 w-11 items-center justify-center text-lg leading-none text-muted-foreground"
          >
            ···
          </button>
        )}
        <div
          hidden={writing && !toolsOpen}
          className={
            writing
              ? "absolute bottom-full inset-x-2 z-20 max-h-[45dvh] overflow-y-auto rounded-xl border border-border bg-background py-2 shadow-lg"
              : "contents"
          }
        >
          {source.kind !== "layout" && (
            <MobileTextDraftFlow
              key={`${userId}:${source.storyId}`}
              userId={userId}
              storyId={source.storyId}
              source={source.kind === "story" ? undefined : source}
              messages={conversation.messages.map(({ id, role, content }) => ({
                id,
                role,
                content,
              }))}
              instruction={draft}
              disabled={busy || actionLocked || voiceBusy}
              onLocked={setVersionLocked}
              onTextSaved={onTextSaved}
            />
          )}
          <button
            type="button"
            disabled={busy || actionLocked || versionLocked || voiceBusy}
            className="mx-4 min-h-11 shrink-0 border-t border-border/40 text-left text-xs text-primary disabled:opacity-40"
            onClick={() => setContentsOpen(true)}
          >
            对话内容 · 目录、记事与文章来源
          </button>
          <MobileCompanionActions
            storyId={source.storyId}
            source={source}
            draft={draft}
            setDraft={setDraft}
            messages={visibleMessages}
            disabled={busy || versionLocked || voiceBusy}
            onLocked={locked => {
              setActionLocked(locked);
              onActionLocked?.(locked);
            }}
            onNewStory={onNewStory}
          />
        </div>
      </div>
      {source.kind === "layout" ? (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          先讨论建议，回到排版里修改。
        </p>
      ) : (
        source.kind !== "text" &&
        source.kind !== "story" && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground">
            {t("新想法连同来源引用追加到这个故事，原回忆保留。")}
          </p>
        )
      )}
    </div>
  );
}
