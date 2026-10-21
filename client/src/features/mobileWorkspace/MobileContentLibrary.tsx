import { MemorySpace } from "@/features/memorySpace/MemorySpace";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useState, useContext, useEffect } from "react";
import {
  MobileMemoryFollowup,
  videoFollowupSource,
} from "./mobileMemoryFollowup";
import { trpc } from "@/lib/trpc";
import type { MobileStorySummary } from "./MobileStoryPanel";
export type MobileLibraryStage =
  | "memory"
  | "people"
  | "warehouse"
  | "text"
  | "image"
  | "video";
import { MobileAccountImages } from "./MobileAccountImages";

const labels = {
  memory: "故事",
  people: "人",
  warehouse: "仓库",
  text: "文字",
  image: "图片",
  video: "视频",
};
const action = "min-h-11 text-sm text-primary";

export function MobileContentLibrary({
  stage,
  stories,
  onBack,
  onOpenStory,
}: {
  stage: MobileLibraryStage;
  stories: readonly MobileStorySummary[];
  onBack: () => void;
  onOpenStory: (id: number, stage?: "text" | "image" | "video") => void;
}) {
  const t = useUiText();

  const [media, setMedia] = useState<"text" | "image" | "video">("text");
  const [page, setPage] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const pageSize = 5;
  const isMemory = stage === "memory" || stage === "people";
  const contentStage = stage === "warehouse" ? media : stage;
  const openStory = (id: number) =>
    onOpenStory(
      id,
      contentStage === "image" || contentStage === "video"
        ? contentStage
        : "text"
    );
  return (
    <section
      aria-label={`${t("全部")}${t(labels[stage])}`}
      className="h-full overflow-y-auto px-5 pb-32 pt-4"
    >
      <button className={action} onClick={onBack}>
        {t("‹ 故事")}
      </button>
      {!isMemory && (
        <h1 className="my-4 font-chat-brand text-2xl">
          {stage !== "warehouse" && t("全部")}
          {t(labels[stage])}
        </h1>
      )}
      {stage === "warehouse" && (
        <nav
          aria-label={t("仓库分类")}
          className="mb-5 flex gap-8 border-b border-border"
        >
          {(["text", "image", "video"] as const).map(kind => (
            <button
              key={kind}
              aria-pressed={media === kind}
              className={`min-h-11 border-b-2 pb-2 font-chat-brand text-lg ${media === kind ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => {
                setMedia(kind);
                setShowNotes(false);
                setPage(0);
              }}
            >
              {t(labels[kind])}
            </button>
          ))}
        </nav>
      )}
      {stage === "warehouse" && media === "text" && !showNotes && (
        <button className={action} onClick={() => setShowNotes(true)}>
          {t("记事存档 ›")}
        </button>
      )}
      {isMemory || showNotes ? (
        showNotes ? (
          <>
            <button className={action} onClick={() => setShowNotes(false)}>
              {stage === "warehouse" ? t("‹ 返回文字") : t("‹ 返回故事")}
            </button>
            <AllMemories />
          </>
        ) : (
          <MemorySpace
            mobileGestures
            initialTab={stage === "people" ? "people" : "stories"}
            onOpenStory={openStory}
            onOpenNotes={() => setShowNotes(true)}
          />
        )
      ) : contentStage === "image" ? (
        <MobileAccountImages onOpenStory={openStory} />
      ) : (
        <>
          <p className="mb-4 text-xs text-muted-foreground">
            {t("按故事收在一起，点开即可阅读或播放。")}
          </p>
          {stories.slice(page * pageSize, (page + 1) * pageSize).map(story => (
            <section key={story.id} className="border-b border-border/50 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-chat-brand text-lg">{story.title}</h2>
                <button
                  className={`${action} shrink-0`}
                  onClick={() => openStory(story.id)}
                >
                  {t("进入故事 ›")}
                </button>
              </div>
              {contentStage === "text" ? (
                <StoryTexts storyId={story.id} />
              ) : (
                <StoryVideos storyId={story.id} />
              )}
            </section>
          ))}
          {!stories.length && (
            <p>
              {t("还没有")}
              {t(labels[contentStage])}。
            </p>
          )}
          <div className="mt-4 flex justify-between">
            <button
              className={action}
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              {t("上一页")}
            </button>
            <span className="self-center text-xs text-muted-foreground">
              {page + 1} / {Math.max(1, Math.ceil(stories.length / pageSize))}
            </span>
            <button
              className={action}
              disabled={(page + 1) * pageSize >= stories.length}
              onClick={() => setPage(p => p + 1)}
            >
              {t("下一页")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Readable({
  title,
  body,
  onOpen,
}: {
  title: string;
  body: string;
  onOpen?: (open: boolean) => void;
}) {
  return (
    <details
      className="py-3"
      onToggle={event => onOpen?.(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-2 text-base">{title}</summary>
      <p className="whitespace-pre-wrap break-words py-3 font-serif text-base leading-8">
        {body}
      </p>
    </details>
  );
}
function QueryError({ retry }: { retry: () => unknown }) {
  const t = useUiText();

  return (
    <p role="alert" className="py-3 text-sm">
      {t("暂时没有读到。")}
      <button className={`${action} ml-3`} onClick={() => void retry()}>
        {t("重试")}
      </button>
    </p>
  );
}
function AllMemories() {
  const t = useUiText();

  const { source, select } = useContext(MobileMemoryFollowup);
  useEffect(() => () => select(null), [select]);
  const [offset, setOffset] = useState(0);
  const query = trpc.memoryWarehouse.list.useQuery(
    { offset },
    { retry: false }
  );
  return (
    <>
      {query.isLoading ? (
        <p role="status">{t("正在读取回忆…")}</p>
      ) : query.isError ? (
        <QueryError retry={query.refetch} />
      ) : (
        <>
          {query.data?.cards.map(card => (
            <Readable
              key={card.id}
              title={card.title}
              body={card.content}
              onOpen={open => {
                if (open && card.sourceStoryId)
                  select({
                    storyId: card.sourceStoryId,
                    id: card.id,
                    content: card.content,
                    origin: card.origin,
                  });
                else if (!open && source?.id === card.id) select(null);
              }}
            />
          ))}
          {!query.data?.cards.length && (
            <p className="py-6 text-sm text-muted-foreground">
              {t("还没有收录的回忆。")}
            </p>
          )}
          <div className="flex justify-between">
            <button
              className={action}
              disabled={!offset}
              onClick={() => setOffset(n => Math.max(0, n - 50))}
            >
              {t("上一页")}
            </button>
            <button
              className={action}
              disabled={query.data?.nextOffset == null}
              onClick={() => {
                if (query.data?.nextOffset != null)
                  setOffset(query.data.nextOffset);
              }}
            >
              {t("下一页")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
function StoryTexts({ storyId }: { storyId: number }) {
  const t = useUiText();

  const { source, select } = useContext(MobileMemoryFollowup);
  useEffect(() => () => select(null), [select]);
  function opened(open: boolean, id: string, body: string) {
    if (open) {
      const version = history.data?.versions.find(v => `text:${v.id}` === id);
      const content = version?.adoption?.content ?? version?.generated;
      select({
        storyId,
        id,
        kind: "text",
        origin: "note",
        content: body,
        text: {
          content: content ?? { title: "", body, tags: [] },
          parentId: version?.id ?? null,
          platform: version?.request.platform ?? current.data?.platform,
          ...(id === "text:current" && current.data
            ? {
                versionId: current.data.versionId,
                bodyRevision: current.data.bodyRevision,
              }
            : {}),
        },
      });
    } else if (source?.id === id && source.storyId === storyId) select(null);
  }
  const history = trpc.textDrafts.read.useQuery({ storyId }, { retry: false });
  const current = trpc.publishingDraft.readBody.useQuery(
    { storyId },
    { retry: false }
  );
  const bodyUnavailable =
    current.error?.data?.code === "BAD_REQUEST" &&
    current.error.message ===
      "当前发布版本还没有可编辑正文，请先在电脑端生成发布稿";
  const versions =
    history.data?.versions.filter(v => v.adoption?.content || v.generated) ??
    [];
  return (
    <>
      {history.isLoading || current.isLoading ? (
        <p role="status">{t("正在读取文字…")}</p>
      ) : null}
      {history.isError ? <QueryError retry={history.refetch} /> : null}
      {current.isError && !bodyUnavailable ? (
        <QueryError retry={current.refetch} />
      ) : null}
      {current.data?.body && (
        <Readable
          title={t("当前正文")}
          body={current.data.body}
          onOpen={open => opened(open, "text:current", current.data!.body)}
        />
      )}
      {versions.map(v => {
        const content = v.adoption?.content ?? v.generated!;
        return (
          <Readable
            key={v.id}
            title={t("{0} · 版本 {1}", [
              content.title || t("文字"),
              v.sequence,
            ])}
            body={content.body}
            onOpen={open =>
              opened(open, `text:${v.id}`, `${content.title}\n${content.body}`)
            }
          />
        );
      })}
      {!history.isLoading &&
        !current.isLoading &&
        !history.isError &&
        (!current.isError || bodyUnavailable) &&
        !versions.length &&
        !current.data?.body && (
          <p className="text-sm text-muted-foreground">{t("还没有文字。")}</p>
        )}
    </>
  );
}
function StoryVideos({ storyId }: { storyId: number }) {
  const t = useUiText();

  const { source, select } = useContext(MobileMemoryFollowup);
  useEffect(() => () => select(null), [select]);
  const query = trpc.storyAgent.storyVideoAssets.useQuery(
    { storyId },
    { retry: false }
  );
  if (query.isLoading) return <p role="status">{t("正在读取视频…")}</p>;
  if (query.isError) return <QueryError retry={query.refetch} />;
  return (
    <>
      {query.data?.length ? (
        query.data.map(video => (
          <details
            key={video.id}
            className="py-3"
            onToggle={e => {
              if (e.currentTarget.open)
                select(videoFollowupSource(storyId, video));
              else if (
                source?.id === `video:${video.id}` &&
                source.storyId === storyId
              )
                select(null);
            }}
          >
            <summary className="cursor-pointer py-2">
              {video.subtitle || t("视频 {0}", [video.id])}
            </summary>
            {video.status === "available" && video.videoUrl ? (
              <video
                className="my-3 max-h-[50dvh] w-full rounded-xl"
                controls
                playsInline
                preload="none"
                src={video.videoUrl}
              />
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                {video.status === "submitted" || video.status === "processing"
                  ? t("生成中")
                  : t("视频暂不可播放")}
              </p>
            )}
          </details>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">{t("还没有视频。")}</p>
      )}
    </>
  );
}
