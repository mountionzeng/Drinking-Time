import { useUiText } from "@/features/uiLanguage/UiLanguage";
import {
  MobileMemoryFollowup,
  useCompanionPageContext,
  videoFollowupSource,
} from "./mobileMemoryFollowup";
import React, { useContext, useEffect, useId, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useMobileStageSwipe } from "./useMobileStageSwipe";
import { mobileStageMotion, type MobileStageStyle } from "./mobileStageMotion";
import { STORY_STAGE_ORDER } from "./mobileStageSwipe";
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
import {
  MobileImageStudio,
  type MobileArtworkSource,
} from "./MobileImageStudio";
import { MobileMemoryConversation } from "./MobileMemoryConversation";
import { MobileEditableMemories } from "./MobileEditableMemories";
import { MobileTextDraftFlow } from "./MobileTextDraftFlow";

export const MOBILE_STORY_STAGES = [
  { id: "memory", label: "回忆" },
  { id: "text", label: "文字" },
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
  const t = useUiText();

  const motionId = useId();
  const reducedMotion = useReducedMotion();
  return (
    <LayoutGroup id={motionId}>
      <nav
        aria-label={t("故事制作阶段")}
        className="mx-5 mb-4 grid shrink-0 grid-cols-3 border-b border-border/40"
      >
        {MOBILE_STORY_STAGES.map(item => {
          const active = stage === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(item.id)}
              whileTap={reducedMotion ? undefined : { scale: 0.97 }}
              className={cn(
                "relative flex min-h-16 items-center justify-center pb-2 font-serif text-lg transition-colors duration-300 motion-reduce:transition-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <motion.span
                className="pl-[0.16em] tracking-[0.16em]"
                animate={{ y: active && !reducedMotion ? -2 : 0 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.24,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {t(item.label)}
              </motion.span>
              {active ? (
                <motion.span
                  aria-hidden="true"
                  layoutId="stage-underline"
                  className="absolute bottom-0 h-[2px] w-6 rounded-full bg-primary"
                  transition={{
                    duration: reducedMotion ? 0 : 0.3,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              ) : null}
            </motion.button>
          );
        })}
      </nav>
    </LayoutGroup>
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
  motionStyle = "shiguang",
}: {
  motionStyle?: MobileStageStyle;
  userId: number;
  storyId: number;
  title: string;
  stage: MobileStoryStage;
  onStageChange: (stage: MobileStoryStage) => void;
  onBack: () => void;
  document: MobileDocumentController;
  conversation: MobileConversationController;
}) {
  const t = useUiText();

  const history = trpc.textDrafts.read.useQuery(
    { storyId },
    { enabled: stage !== "video", retry: false }
  );
  const [versionChoice, setSelectedVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [imageStudio, setImageStudio] = useState(false);
  const [memoryArtwork, setMemoryArtwork] = useState<MobileArtworkSource>();
  const editor = useMobileSyncedEditor(userId, storyId);
  const reducedMotion = useReducedMotion();
  const [direction, setDirection] = useState(1);
  const stageMotion = mobileStageMotion(motionStyle, direction);
  function changeStage(next: MobileStoryStage) {
    if (next === stage) return;
    setDirection(
      STORY_STAGE_ORDER.indexOf(next) > STORY_STAGE_ORDER.indexOf(stage)
        ? 1
        : -1
    );
    onStageChange(next);
  }
  const swipe = useMobileStageSwipe(
    stage,
    changeStage,
    (stage === "text" && editing) ||
      Boolean(editor.draft) ||
      document.state?.status === "conflict"
  );
  useEffect(() => {
    void document.retryLoad();
  }, [storyId]);
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
  const { select: selectContext } = useContext(MobileMemoryFollowup);
  const contextBody =
    selectedVersion === "current" ? document.state?.body : content?.body;
  useEffect(() => {
    if (stage !== "text") return;
    selectContext({
      storyId,
      id: `text:${selectedVersion}`,
      kind: "text",
      origin: "note",
      content: `${content?.title || title}${document.hasUnsavedChanges ? "（含未保存修改）" : ""}\n${contextBody || "当前没有可用文字。"}`,
      text: {
        content: {
          title: content?.title ?? "",
          body: contextBody ?? "",
          tags: content?.tags ?? [],
        },
        parentId: selected?.id ?? null,
        platform:
          selected?.request?.platform ?? document.state?.document?.platform,
        ...(selectedVersion === "current" && document.state?.document
          ? {
              versionId: document.state.document.versionId,
              bodyRevision: document.state.document.bodyRevision,
            }
          : {}),
      },
    });
    return () => selectContext(null);
  }, [
    stage,
    storyId,
    selectedVersion,
    contextBody,
    content?.title,
    title,
    document.hasUnsavedChanges,
    document.state?.document?.versionId,
    document.state?.document?.bodyRevision,
    selected,
    selectContext,
  ]);
  return (
    <>
      {imageStudio ? (
        <MobileImageStudio
          userId={userId}
          storyId={storyId}
          source={
            memoryArtwork ??
            (selectedVersion !== "current" && content
              ? { id: selectedVersion, content }
              : undefined)
          }
          onBack={() => {
            setImageStudio(false);
            void document.retryLoad();
          }}
        />
      ) : null}
      <section
        {...swipe}
        style={{ touchAction: "pan-y pinch-zoom" }}
        aria-label={t("{0}的故事工作区", [title])}
        className={cn(
          "h-full min-h-0 flex-col",
          imageStudio ? "hidden" : "flex"
        )}
      >
        <header className="flex shrink-0 items-center gap-2 px-3 py-2">
          <button
            type="button"
            aria-label={t("返回故事列表")}
            className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="min-w-0 truncate font-chat-brand text-xl">{title}</h1>
        </header>
        <MobileStoryStageBar stage={stage} onChange={changeStage} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <motion.div
            key={stage}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            data-stage-style={motionStyle}
            initial={reducedMotion ? false : stageMotion.initial}
            animate={stageMotion.animate}
            transition={
              reducedMotion ? { duration: 0 } : stageMotion.transition
            }
          >
            {stage === "video" ? (
              <MobileStoryVideos storyId={storyId} />
            ) : (
              <>
                {history.isError && (
                  <p
                    role="alert"
                    className="px-5 pb-2 text-sm text-muted-foreground"
                  >
                    {t("文字历史暂未读到。")}
                    <button
                      className="ml-2 underline"
                      onClick={() => void history.refetch()}
                    >
                      {t("重试")}
                    </button>
                  </p>
                )}
                {stage === "memory" ? (
                  <MobileStoryMemories
                    storyId={storyId}
                    onEdit={editor.open}
                    versions={versions}
                    conversation={conversation}
                    onMakeArtwork={card => {
                      setMemoryArtwork({
                        id: `memory:${card.id}`,
                        kind: "memory",
                        content: {
                          title: card.title,
                          body: card.content,
                          tags: [],
                        },
                      });
                      setImageStudio(true);
                    }}
                  />
                ) : (
                  <>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-5 pb-3">
                      <select
                        aria-label={t("文字版本")}
                        className={cn(selectStyle, "min-w-0 flex-1")}
                        value={selectedVersion}
                        onChange={event => {
                          setSelectedVersion(event.target.value);
                          setEditing(false);
                        }}
                      >
                        <option value="current">
                          {t("当前正文")}
                          {document.hasUnsavedChanges ? t(" · 未保存") : ""}
                        </option>
                        {[...versions].reverse().map(version => (
                          <option key={version.id} value={version.id}>
                            {t("文字稿")}
                            {version.sequence}
                            {version.adoption
                              ? t(" · 已采用")
                              : version.status === "ready"
                                ? t(" · 待采用")
                                : t(" · 未完成")}
                          </option>
                        ))}
                      </select>
                      {selectedVersion === "current" && (
                        <button
                          type="button"
                          className="min-h-11 shrink-0 px-2 text-sm text-primary"
                          onClick={() => setEditing(value => !value)}
                        >
                          {editing ? t("阅读") : t("编辑")}
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
                          {t("编辑")}
                        </button>
                      )}
                    </div>
                    {selected?.status === "ready" &&
                      !selected.adoption &&
                      content && (
                        <MobileTextDraftFlow
                          key={`${userId}:${storyId}:${selected.id}`}
                          userId={userId}
                          storyId={storyId}
                          previewVersion={selected}
                          messages={[]}
                          instruction=""
                          disabled={
                            document.hasUnsavedChanges || Boolean(editor.draft)
                          }
                        />
                      )}
                    {(content?.body ||
                      (selectedVersion === "current" &&
                        document.state?.body)) && (
                      <div className="px-5 py-2">
                        <button
                          type="button"
                          disabled={
                            document.hasUnsavedChanges || Boolean(editor.draft)
                          }
                          onClick={() => {
                            setMemoryArtwork(undefined);
                            setImageStudio(true);
                          }}
                          className="min-h-11 text-sm text-primary disabled:opacity-40"
                        >
                          {t("制作图文 · 配图、排版与分享 →")}
                        </button>
                        {document.hasUnsavedChanges ? (
                          <p className="text-xs text-muted-foreground">
                            {t("先保存文字修改，再制作图文。")}
                          </p>
                        ) : null}
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      {selectedVersion === "current" &&
                      (editing || document.state?.status === "conflict") ? (
                        <MobileDocumentView
                          controller={document}
                          storyTitle={title}
                        />
                      ) : (
                        <article
                          aria-label={t("文字稿阅读")}
                          className="h-full overflow-y-auto px-6 py-5"
                        >
                          {selectedVersion === "current" ? (
                            document.loadState === "loading" ? (
                              <p role="status">{t("正在读取正文…")}</p>
                            ) : document.state ? (
                              <>
                                {document.hasUnsavedChanges && (
                                  <p className="mb-3 text-xs text-muted-foreground">
                                    {t("有未保存修改，可在编辑中保存。")}
                                  </p>
                                )}
                                <p className={readable}>
                                  {document.state.body ||
                                    t("还没有正文，点编辑开始写。")}
                                </p>
                              </>
                            ) : (
                              <div className="text-sm leading-7 text-muted-foreground">
                                <p>
                                  {document.loadError ||
                                    t("还没有正文，点编辑开始写。")}
                                </p>
                                {document.loadState === "error" && (
                                  <button
                                    type="button"
                                    className="min-h-11 text-primary underline"
                                    onClick={() => void document.retryLoad()}
                                  >
                                    {t("重新读取正文")}
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
                                ? t("正在读取文字历史…")
                                : selected?.status === "generating"
                                  ? t("这份文字稿正在生成。")
                                  : t(
                                      "这份文字稿尚未生成成功，已有正文不受影响。"
                                    )}
                            </p>
                          )}
                        </article>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </div>
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
  onMakeArtwork,
}: {
  storyId: number;
  onEdit: (seed: MobileEditSeed) => void;
  versions: TextDraftVersion[];
  conversation: MobileConversationController;
  onMakeArtwork: (card: { id: string; title: string; content: string }) => void;
}) {
  const t = useUiText();

  const [sourceChoice, setSource] = useState<string | null>(null);
  const combinations = versions.filter(version => version.memoryCards?.length);
  const source = sourceChoice ?? "conversation";
  const cards = combinations.find(
    version => version.id === source
  )?.memoryCards;
  const { select: selectContext } = useContext(MobileMemoryFollowup);
  const cardContext = cards
    ? JSON.stringify(
        cards.map(card => ({
          id: card.id,
          content: card.content,
          origin: card.origin,
        }))
      )
    : null;
  useEffect(() => {
    if (!cardContext) return;
    selectContext({
      storyId,
      id: `combination:${source}`,
      origin: "note",
      content: `生成文字时使用的记忆（每段已标注来源，助手内容并非用户事实）：\n${cardContext}`,
    });
    return () => selectContext(null);
  }, [selectContext, storyId, source, cardContext]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      {
        <select
          aria-label={t("记忆来源")}
          className={cn(selectStyle, "mb-4 w-full")}
          value={source}
          onChange={event => setSource(event.target.value)}
        >
          <option value="conversation">{t("原始聊天 · 目录与上下文")}</option>
          <option value="current">{t("回忆存档 · 记事、修订与图文")}</option>
          {combinations.map(version => (
            <option key={version.id} value={version.id}>
              {t("文字稿")}
              {version.sequence} {t("使用的记忆 ·")}{" "}
              {version.memoryCards!.length} {t("段")}
            </option>
          ))}
        </select>
      }
      {cards && (
        <p className="mb-4 text-xs leading-6 text-muted-foreground">
          {cards
            ? t("这份文字稿使用的记忆组合，按生成时的顺序保留。")
            : t("这段故事留下的聊天；不同记忆可以组合成不同文字稿。")}
        </p>
      )}
      {source === "current" ? (
        <MobileEditableMemories
          storyId={storyId}
          onEdit={onEdit}
          onMakeArtwork={onMakeArtwork}
        />
      ) : cards ? (
        cards.map(card => (
          <article key={card.id} className="border-b border-border/60 py-4">
            <p className="mb-2 text-xs text-muted-foreground">
              {card.origin === "assistant"
                ? t("聊聊整理")
                : card.origin === "user"
                  ? t("我的原话")
                  : t("我的记事")}
            </p>
            <h2 className="mb-2 text-base">{card.title}</h2>
            <p className={readable}>{card.content}</p>
            {card.content.trim() ? (
              <button
                type="button"
                className="mt-2 min-h-11 text-sm text-primary"
                onClick={() =>
                  onMakeArtwork({ ...card, id: `${source}:${card.id}` })
                }
              >
                {t("制作图文 →")}
              </button>
            ) : null}
          </article>
        ))
      ) : (
        <MobileMemoryConversation
          storyId={storyId}
          conversation={conversation}
          onMakeArtwork={onMakeArtwork}
        />
      )}
    </div>
  );
}

export function MobileStoryVideos({ storyId }: { storyId: number }) {
  const t = useUiText();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const videos = trpc.storyAgent.storyVideoAssets.useQuery(
    { storyId },
    { retry: false }
  );
  const selected =
    videos.data?.find(v => v.id === selectedId) ?? videos.data?.[0];
  useCompanionPageContext(
    selected
      ? videoFollowupSource(storyId, selected)
      : {
          storyId,
          id: "video:empty",
          kind: "video",
          origin: "note",
          content: videos.isError
            ? "视频读取失败，内容未知。"
            : "当前没有可用视频资料。",
        }
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <p className="mb-4 text-xs leading-6 text-muted-foreground">
        {t("查看这个故事已有的视频素材。新的视频制作继续在电脑工作区完成。")}
      </p>
      {videos.isLoading ? (
        <p role="status">{t("正在读取视频…")}</p>
      ) : videos.isError ? (
        <p role="alert">
          {t("视频暂时没有读到。")}
          <button
            className="ml-2 underline"
            onClick={() => void videos.refetch()}
          >
            {t("重试")}
          </button>
        </p>
      ) : videos.data?.length ? (
        videos.data.map(video => (
          <article
            key={video.id}
            onClick={() => setSelectedId(video.id)}
            onFocus={() => setSelectedId(video.id)}
            className="border-b border-border/60 py-4"
          >
            <p className="mb-3 text-sm">
              {video.subtitle || t("视频素材 {0}", [video.id])}
              {video.isTimelineSelected ? t(" · 已用于时间线") : ""}
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
                  ? t("生成中")
                  : t("视频暂不可播放")}
              </p>
            )}
          </article>
        ))
      ) : (
        <p className="py-8 text-sm leading-7 text-muted-foreground">
          {t(
            "这个故事还没有视频素材。文字稿准备好后，可以在电脑上继续制作视频。"
          )}
        </p>
      )}
    </div>
  );
}
