import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { TextDraftVersion } from "@shared/textDraftHistory";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  MobileDocumentView,
  type MobileDocumentController,
} from "./MobileDocumentView";
import type { MobileConversationController } from "./MobileChatView";
import {
  MobileSyncedEditor,
  useMobileSyncedEditor,
  type MobileEditSeed,
} from "./MobileSyncedEditor";
import { MobileEditableMemories } from "./MobileEditableMemories";

export const MOBILE_STORY_STAGES = [
  { id: "memory", label: "记忆" },
  { id: "text", label: "文字稿" },
  { id: "video", label: "视频" },
] as const;
export type MobileStoryStage = (typeof MOBILE_STORY_STAGES)[number]["id"];

export function MobileStoryStageBar({
  stage,
  onChange,
}: {
  stage: MobileStoryStage;
  onChange: (stage: MobileStoryStage) => void;
}) {
  return (
    <nav
      aria-label="故事制作阶段"
      className="flex shrink-0 items-center px-5 pb-3"
    >
      {MOBILE_STORY_STAGES.map((item, index) => (
        <React.Fragment key={item.id}>
          {index > 0 && (
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          )}
          <button
            type="button"
            aria-pressed={stage === item.id}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              stage === item.id
                ? "font-medium text-primary"
                : "text-muted-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full border border-current",
                stage === item.id && "bg-current"
              )}
            />
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

const selectStyle =
  "min-h-11 max-w-full rounded-lg border border-border bg-background px-3 text-sm";
const readable =
  "whitespace-pre-wrap break-words font-serif text-base leading-[2] text-foreground";

export function MobileStoryWorkspace({
  userId,
  storyId,
  title,
  stage,
  onStageChange,
  onBack,
  document,
  conversation,
}: {
  userId: number;
  storyId: number;
  title: string;
  stage: MobileStoryStage;
  onStageChange: (stage: MobileStoryStage) => void;
  onBack: () => void;
  document: MobileDocumentController;
  conversation: MobileConversationController;
}) {
  const history = trpc.textDrafts.read.useQuery(
    { storyId },
    { enabled: stage !== "video", retry: false }
  );
  const [versionChoice, setSelectedVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editor = useMobileSyncedEditor(userId, storyId);
  useEffect(() => { void document.retryLoad(); }, [storyId]);
  const versions = history.data?.versions ?? [];
  const selectedVersion =
    document.state?.status === "conflict"
      ? "current"
      : (versionChoice ??
        (document.state
          ? "current"
          : ([...versions]
              .reverse()
              .find(version => version.adoption?.content || version.generated)
              ?.id ?? "current")));
  const selected = versions.find(version => version.id === selectedVersion);
  const content = selected?.adoption?.content ?? selected?.generated;
  return (
    <>
      <section
        aria-label={`${title}的故事工作区`}
        className="flex h-full min-h-0 flex-col"
      >
        <header className="flex shrink-0 items-center gap-2 px-3 py-2">
          <button
            type="button"
            aria-label="返回故事列表"
            className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="min-w-0 truncate font-chat-brand text-xl">{title}</h1>
        </header>
        <MobileStoryStageBar stage={stage} onChange={onStageChange} />
        {stage === "video" ? (
          <MobileStoryVideos storyId={storyId} />
        ) : (
          <>
            {history.isError && (
              <p
                role="alert"
                className="px-5 pb-2 text-sm text-muted-foreground"
              >
                文字历史暂未读到。
                <button
                  className="ml-2 underline"
                  onClick={() => void history.refetch()}
                >
                  重试
                </button>
              </p>
            )}
            {stage === "memory" ? (
              <MobileStoryMemories
                storyId={storyId}
                onEdit={editor.open}
                versions={versions}
                conversation={conversation}
              />
            ) : (
              <>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 pb-3">
                  <select
                    aria-label="文字版本"
                    className={cn(selectStyle, "min-w-0 flex-1")}
                    value={selectedVersion}
                    onChange={event => {
                      setSelectedVersion(event.target.value);
                      setEditing(false);
                    }}
                  >
                    <option value="current">
                      当前正文{document.hasUnsavedChanges ? " · 未保存" : ""}
                    </option>
                    {[...versions].reverse().map(version => (
                      <option key={version.id} value={version.id}>
                        文字稿 {version.sequence}
                        {version.adoption
                          ? " · 已采用"
                          : version.status === "ready"
                            ? " · 待采用"
                            : " · 未完成"}
                      </option>
                    ))}
                  </select>
                  {selectedVersion === "current" && (
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-sm text-primary"
                      onClick={() => setEditing(value => !value)}
                    >
                      {editing ? "阅读" : "编辑"}
                    </button>
                  )}
                  {selectedVersion !== "current" && content && (
                    <button
                      type="button"
                      className="min-h-11 shrink-0 px-2 text-sm text-primary"
                      onClick={() =>
                        editor.open({
                          kind: "text",
                          id: selectedVersion,
                          title: content.title,
                          content: content.body,
                          tags: content.tags,
                        })
                      }
                    >
                      编辑
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  {selectedVersion === "current" &&
                  (editing || document.state?.status === "conflict") ? (
                    <MobileDocumentView
                      controller={document}
                      storyTitle={title}
                    />
                  ) : (
                    <article
                      aria-label="文字稿阅读"
                      className="h-full overflow-y-auto px-6 py-5"
                    >
                      {selectedVersion === "current" ? (
                        document.loadState === "loading" ? (
                          <p role="status">正在读取正文…</p>
                        ) : document.state ? (
                          <>
                            {document.hasUnsavedChanges && (
                              <p className="mb-3 text-xs text-muted-foreground">
                                有未保存修改，可在编辑中保存。
                              </p>
                            )}
                            <p className={readable}>
                              {document.state.body ||
                                "还没有正文，点编辑开始写。"}
                            </p>
                          </>
                        ) : (
                          <div className="text-sm leading-7 text-muted-foreground">
                            <p>
                              {document.loadError ||
                                "还没有正文，点编辑开始写。"}
                            </p>
                            {document.loadState === "error" && (
                              <button
                                type="button"
                                className="min-h-11 text-primary underline"
                                onClick={() => void document.retryLoad()}
                              >
                                重新读取正文
                              </button>
                            )}
                          </div>
                        )
                      ) : content ? (
                        <>
                          <h2 className="mb-5 font-chat-brand text-2xl">
                            {content.title}
                          </h2>
                          <p className={readable}>{content.body}</p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {history.isLoading
                            ? "正在读取文字历史…"
                            : selected?.status === "generating"
                              ? "这份文字稿正在生成。"
                              : "这份文字稿尚未生成成功，已有正文不受影响。"}
                        </p>
                      )}
                    </article>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>
      <MobileSyncedEditor
        storyId={storyId}
        editor={editor}
        onTextSaved={setSelectedVersion}
      />
    </>
  );
}

function MobileStoryMemories({
  storyId,
  onEdit,
  versions,
  conversation,
}: {
  storyId: number;
  onEdit: (seed: MobileEditSeed) => void;
  versions: TextDraftVersion[];
  conversation: MobileConversationController;
}) {
  const [sourceChoice, setSource] = useState<string | null>(null);
  const combinations = versions.filter(version => version.memoryCards?.length);
  const source = sourceChoice ?? "current";
  const cards = combinations.find(
    version => version.id === source
  )?.memoryCards;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      {combinations.length > 0 && (
        <select
          aria-label="记忆来源"
          className={cn(selectStyle, "mb-4 w-full")}
          value={source}
          onChange={event => setSource(event.target.value)}
        >
          <option value="current">当前记忆 · 可编辑</option>
          <option value="conversation">这个故事的聊天记录</option>
          {combinations.map(version => (
            <option key={version.id} value={version.id}>
              文字稿 {version.sequence} 使用的记忆 ·{" "}
              {version.memoryCards!.length} 段
            </option>
          ))}
        </select>
      )}
      {source !== "current" && (
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          {cards
            ? "这份文字稿使用的记忆组合，按生成时的顺序保留。"
            : "这段故事留下的聊天；不同记忆可以组合成不同文字稿。"}
        </p>
      )}
      {source === "current" ? (
        <MobileEditableMemories storyId={storyId} onEdit={onEdit} />
      ) : cards ? (
        cards.map(card => (
          <article key={card.id} className="border-b border-border/60 py-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {card.origin === "assistant"
                ? "聊聊整理"
                : card.origin === "user"
                  ? "我的原话"
                  : "我的记事"}
            </p>
            <h2 className="mb-2 text-base">{card.title}</h2>
            <p className={readable}>{card.content}</p>
          </article>
        ))
      ) : (
        <>
          {conversation.historyState === "loading" && (
            <p role="status">正在读取记忆…</p>
          )}
          {conversation.historyState === "error" && (
            <p role="alert">
              暂时读不到记忆。
              <button
                className="ml-2 underline"
                onClick={() => void conversation.reloadHistory()}
              >
                重试
              </button>
            </p>
          )}
          {conversation.historyState === "empty" && (
            <p className="py-8 text-sm text-muted-foreground">
              还没有聊天记录。随时可以到“聊聊”记下一段。
            </p>
          )}
          {conversation.messages.map(message => (
            <article
              key={message.id}
              className="border-b border-border/60 py-4"
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {message.role === "user" ? "我的原话" : "聊聊整理"}
              </p>
              <p className={readable}>{message.content}</p>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

function MobileStoryVideos({ storyId }: { storyId: number }) {
  const videos = trpc.storyAgent.storyVideoAssets.useQuery(
    { storyId },
    { retry: false }
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <p className="mb-4 text-xs leading-6 text-muted-foreground">
        查看这个故事已有的视频素材。新的视频制作继续在电脑工作区完成。
      </p>
      {videos.isLoading ? (
        <p role="status">正在读取视频…</p>
      ) : videos.isError ? (
        <p role="alert">
          视频暂时没有读到。
          <button
            className="ml-2 underline"
            onClick={() => void videos.refetch()}
          >
            重试
          </button>
        </p>
      ) : videos.data?.length ? (
        videos.data.map(video => (
          <article key={video.id} className="border-b border-border/60 py-4">
            <p className="mb-3 text-sm">
              {video.subtitle || `视频素材 ${video.id}`}
              {video.isTimelineSelected ? " · 已用于时间线" : ""}
            </p>
            {video.status === "available" && video.videoUrl ? (
              <video
                className="max-h-[50dvh] w-full rounded-xl bg-black"
                controls
                playsInline
                preload="none"
                src={video.videoUrl}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {video.status === "submitted" || video.status === "processing"
                  ? "生成中"
                  : "视频暂不可播放"}
              </p>
            )}
          </article>
        ))
      ) : (
        <p className="py-8 text-sm leading-7 text-muted-foreground">
          这个故事还没有视频素材。文字稿准备好后，可以在电脑上继续制作视频。
        </p>
      )}
    </div>
  );
}
