import React, { useContext, useState } from "react";
import {
  MobileMemoryFollowup,
  type MemoryFollowupSource,
} from "./mobileMemoryFollowup";
import { trpc } from "@/lib/trpc";
import { MobileStoryMemories } from "./MobileStoryMemories";
import {
  MobileSyncedEditor,
  useMobileSyncedEditor,
} from "./MobileSyncedEditor";
import {
  MobileImageStudio,
  type MobileArtworkSource,
} from "./MobileImageStudio";
import type { MobileConversationController } from "./MobileChatView";

/** 原故事回忆页的内容工具，仍使用同一聊天、记事和文字来源快照。 */
export function MobileChatContents({
  userId,
  storyId,
  conversation,
  onClose,
  onQuote,
}: {
  userId: number;
  storyId: number;
  conversation: MobileConversationController;
  onClose: () => void;
  onQuote: (source: MemoryFollowupSource) => void;
}) {
  const history = trpc.textDrafts.read.useQuery({ storyId }, { retry: false });
  const editor = useMobileSyncedEditor(userId, storyId);
  const [artwork, setArtwork] = useState<MobileArtworkSource>();
  const context = useContext(MobileMemoryFollowup);
  const [selected, setSelected] = useState<MemoryFollowupSource | null>(null);
  return (
    <MobileMemoryFollowup.Provider
      value={{ ...context, source: selected, select: setSelected }}
    >
      <section
        aria-label="对话内容工具"
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex shrink-0 items-center justify-between px-5 pb-2">
          <h2 className="font-serif text-lg">
            {artwork ? "制作图文" : "对话里的内容"}
          </h2>
          <button
            className="min-h-11 text-sm text-primary"
            disabled={Boolean(editor.draft)}
            onClick={() => (artwork ? setArtwork(undefined) : onClose())}
          >
            {artwork ? "返回内容" : "返回对话"}
          </button>
        </header>
        {artwork ? (
          <MobileImageStudio
            embedded
            userId={userId}
            storyId={storyId}
            source={artwork}
            onBack={() => setArtwork(undefined)}
          />
        ) : (
          <>
            {history.isError && (
              <p role="alert" className="px-5 text-sm">
                文章来源未读到。
                <button
                  className="min-h-11 underline"
                  onClick={() => void history.refetch()}
                >
                  重试
                </button>
              </p>
            )}
            <MobileStoryMemories
              storyId={storyId}
              versions={history.data?.versions ?? []}
              conversation={conversation}
              onEdit={editor.open}
              onMakeArtwork={card =>
                setArtwork({
                  id: `memory:${card.id}`,
                  kind: "memory",
                  content: { title: card.title, body: card.content, tags: [] },
                })
              }
            />
          </>
        )}
        <MobileSyncedEditor
          storyId={storyId}
          editor={editor}
          onTextSaved={() => {}}
        />
        {!artwork && selected && (
          <button
            type="button"
            className="mx-5 min-h-11 shrink-0 border-t border-border/40 text-sm text-primary"
            disabled={Boolean(editor.draft)}
            onClick={() => onQuote(selected)}
          >
            引用选中内容，接着聊
          </button>
        )}
      </section>
    </MobileMemoryFollowup.Provider>
  );
}
