import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useStoryAgent,
  useStoryAgentActions,
} from "@/features/storyAgent/StoryAgentContext";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import {
  publishingDraftBufferKey,
  PUBLISHING_PLATFORM_REGISTRY,
} from "@shared/publishingDraft";
import type {
  TextDraftContent,
  TextDraftVersion,
} from "@shared/textDraftHistory";
import { resolveTextDraftBasis } from "./textDraftBasis";
import {
  getPublishingEditorContent,
  publishingContentEquals,
} from "./publishingDraftViewModel";
import { useDesktopWritingSession } from "@/features/writingCompanion/desktopWritingSession";
import { ARTICLE_NATURES, ARTICLE_FORMS, ARTICLE_LENGTHS, DEFAULT_ARTICLE_OPTIONS,
  articleGenerationInstruction, type ArticleGenerationOptions } from "./articleGenerationOptions";

const buttonClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:cursor-not-allowed disabled:opacity-45";
const compactButtonClass =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--panel-border)] px-2 text-[11px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:cursor-not-allowed disabled:opacity-45";

export function TextDraftVersions({
  storyId,
  input,
  blocked,
}: {
  storyId: number | null;
  input: string;
  blocked: boolean;
}) {
  const _ui = useDesktopUiText();
  const { publishing, publishingBuffers } = useStoryAgent();
  const { ensureActiveStoryPersisted, setPublishing, setPublishingBuffer } =
    useStoryAgentActions();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [articleOptions, setArticleOptions] = useState<ArticleGenerationOptions>(DEFAULT_ARTICLE_OPTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edited, setEdited] = useState<TextDraftContent | null>(null);
  const [feedback, setFeedback] = useState("");
  const [source, setSource] = useState<
    "unknown" | "own" | "reference" | "liked"
  >("unknown");
  const [starting, setStarting] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const currentScope = useRef(storyId);
  currentScope.current = storyId;
  const query = trpc.textDrafts.read.useQuery(
    { storyId: storyId ?? 0 },
    {
      enabled: Boolean(storyId && storyId > 0),
      retry: false,
      refetchInterval: query =>
        query.state.data?.versions.some(v => v.status === "generating")
          ? 2500
          : false,
    }
  );
  const generate = trpc.textDrafts.generate.useMutation({ retry: false });
  const sourceQuery = trpc.textSourceLineage.impact.useQuery(
    { storyId: storyId ?? 0 },
    { enabled: open && Boolean(storyId && storyId > 0), retry: false }
  );
  const currentSource = sourceQuery.data?.current;
  const adopt = trpc.textDrafts.adopt.useMutation({ retry: false });
  const learning = trpc.textDrafts.setLearning.useMutation({ retry: false });
  const platform = publishing.activePlatform;
  const versions = (query.data?.versions ?? []).filter(
    v => v.request.platform === platform
  );
  const visibleDraft = getPublishingEditorContent({
    state: publishing, buffers: publishingBuffers, storyId: storyId ?? -1,
    platform, versionId: publishing.activeVersionId ?? "v1",
  });
  const writingSource = useDesktopWritingSession(state => state.session);
  const spine = storySpineStore.getState();
  const currentWriting = writingSource?.storyId === storyId &&
    writingSource.accountId === spine.accountId && writingSource.epoch === spine.storyScopeEpoch
    ? writingSource : null;
  const hasExistingText = versions.length > 0 || Boolean(
    (currentWriting?.snapshot.draft ?? visibleDraft?.body)?.trim()
  );
  const selected = versions.find(v => v.id === selectedId);
  const latest = [...versions].reverse().find(v => v.status === "ready");
  const busy =
    starting ||
    generate.isPending ||
    adopt.isPending ||
    learning.isPending ||
    versions.some(v => v.status === "generating");
  const scopeMatches = (id: number) => {
    const state = storySpineStore.getState();
    return (
      ((state.remoteStoryId ?? state.activeStoryId) === id ||
        state.activeStoryId === id) &&
      state.publishing.activePlatform === platform
    );
  };

  useEffect(() => {
    const openHistory = (event: Event) => {
      const requestedId =
        event instanceof CustomEvent &&
        event.detail &&
        typeof event.detail.versionId === "string"
          ? event.detail.versionId
          : null;
      const requested = requestedId
        ? versions.find(version => version.id === requestedId)
        : latest;
      if (requested) {
        setSelectedId(requested.id);
        setEdited(requested.adoption?.content ?? requested.generated ?? null);
        setFeedback(requested.adoption?.feedback ?? "");
      }
      setOpen(true);
    };
    window.addEventListener("dt:open-text-version-history", openHistory);
    return () =>
      window.removeEventListener("dt:open-text-version-history", openHistory);
  }, [latest, versions]);

  function selectVersion(version: TextDraftVersion) {
    if (
      edited &&
      selected &&
      JSON.stringify(edited) !==
        JSON.stringify(selected.adoption?.content ?? selected.generated) &&
      !window.confirm("当前修改尚未采用。切换版本会放弃这些修改，继续吗？")
    )
      return;
    setSelectedId(version.id);
    setEdited(version.adoption?.content ?? version.generated ?? null);
    setFeedback(version.adoption?.feedback ?? "");
  }

  async function generateVersion() {
    if (lock.current || busy || blocked) return;
    lock.current = true;
    setStarting(true);
    const origin = storyId;
    try {
      const id =
        storyId && storyId > 0 ? storyId : await ensureActiveStoryPersisted();
      if (origin && origin > 0 && currentScope.current !== origin) return;
      if (!scopeMatches(id)) return;
      const requestScope = storySpineStore.getState();
      const requestVersionId = requestScope.publishing.activeVersionId ?? "v1";
      const requestStillCurrent = () => {
        const current = storySpineStore.getState();
        return (
          alive.current &&
          scopeMatches(id) &&
          current.accountId === requestScope.accountId &&
          current.storyScopeEpoch === requestScope.storyScopeEpoch &&
          current.storyLoadEpoch === requestScope.storyLoadEpoch &&
          (current.publishing.activeVersionId ?? "v1") === requestVersionId
        );
      };
      const history = await utils.textDrafts.read.fetch({ storyId: id });
      if (!requestStillCurrent()) return;
      const fresh = storySpineStore.getState();
      const freshLatest = [...history.versions]
        .reverse()
        .find(v => v.status === "ready" && v.request.platform === platform);
      const buffer =
        fresh.publishingBuffers?.[
          publishingDraftBufferKey(id, platform, requestVersionId)
        ];
      const visibleContent = getPublishingEditorContent({
        state: fresh.publishing,
        buffers: fresh.publishingBuffers,
        storyId: id,
        platform,
        versionId: requestVersionId,
      });
      const sourceRef = fresh.publishing.versions?.find(
        version => version.versionId === requestVersionId
      )?.textSource;
      const visibleParentId =
        buffer?.textDraftVersionId ??
        (sourceRef && "textDraftId" in sourceRef
          ? sourceRef.textDraftId
          : null);
      const writing = useDesktopWritingSession.getState().session;
      const writingSnapshot =
        writing?.storyId === id &&
        writing.accountId === fresh.accountId &&
        writing.epoch === fresh.storyScopeEpoch
          ? writing.getSnapshot()
          : null;
      const { basis, parentId } = resolveTextDraftBasis({
        writingBody: writingSnapshot?.draft,
        selected,
        latest: freshLatest,
        edited,
        buffer: buffer?.content,
        published: fresh.publishing.drafts[platform]?.content,
        visible: visibleContent
          ? { content: visibleContent, parentId: visibleParentId }
          : undefined,
      });
      const selection =
        writingSnapshot?.draft === basis?.body
          ? writingSnapshot?.selection
          : undefined;
      const instruction = articleGenerationInstruction(articleOptions, input);
      const result = await generate.mutateAsync({
        storyId: id,
        operationToken: crypto.randomUUID(),
        expectedRevision: history.revision,
        platform,
        parentId,
        basis: basis?.body.trim() ? basis : null,
        ...(selection ? { selection } : {}),
        messages: fresh.messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({ id: m.id, role: m.role, content: m.content })),
        instruction,
        source,
      });
      utils.textDrafts.read.setData({ storyId: id }, result);
      if (!requestStillCurrent()) return;
      const next = result.versions.at(-1);
      if (next) {
        setSelectedId(next.id);
        setEdited(next.generated ?? null);
        setFeedback("");
        if (next.status === "ready" && next.generated) {
          const current = storySpineStore.getState();
          const nowVisible = getPublishingEditorContent({
            state: current.publishing,
            buffers: current.publishingBuffers,
            storyId: id,
            platform,
            versionId: requestVersionId,
          });
          const currentWriting = useDesktopWritingSession.getState().session;
          const currentSnapshot = currentWriting?.id === writing?.id ? currentWriting?.getSnapshot() : null;
          const writingUnchanged = !writingSnapshot || Boolean(
            currentSnapshot?.scope === writingSnapshot.scope && currentSnapshot.draft === writingSnapshot.draft
          );
          if (
            writingUnchanged && (nowVisible === visibleContent ||
            (nowVisible &&
              visibleContent &&
              publishingContentEquals(nowVisible, visibleContent)))
          ) {
            if (writing?.applyGenerated && writingSnapshot) {
              try { await writing.applyGenerated(next.generated.body, writingSnapshot); }
              catch (cause) {
                setDirectionOpen(false);
                setOpen(true);
                throw new Error(`文稿已生成并保留，写入书稿未完成：${cause instanceof Error ? cause.message : "请从文字历史查看"}`);
              }
            } else {
            setPublishingBuffer(
              id,
              platform,
              next.generated,
              requestVersionId,
              next.id,
              "generated"
            );
            window.dispatchEvent(new Event("dt:show-generated-text"));
            }
          } else {
            toast.info("新版本已生成，可从文字历史查看；你刚才的编辑仍保留。");
          }
        }
      }
      setDirectionOpen(false);
      if (next?.status === "ready") toast.success("文稿已生成");
      else if (next?.error) toast.error(next.error);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "生成未完成，旧稿与聊天内容已保留"
      );
      if (storyId && storyId > 0)
        void utils.textDrafts.read.invalidate({ storyId });
    } finally {
      lock.current = false;
      setStarting(false);
    }
  }

  async function toggleLearning() {
    if (!storyId || !query.data || !selected) return;
    const enabled =
      selected.adoption?.learningEnabled ??
      selected.originalLearningEnabled !== false;
    try {
      const result = await learning.mutateAsync({
        storyId,
        versionId: selected.id,
        expectedRevision: query.data.revision,
        enabled: !enabled,
      });
      utils.textDrafts.read.setData({ storyId }, result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "设置未保存");
    }
  }

  async function adoptVersion() {
    if (!storyId || !selected || !edited || busy || !query.data) return;
    const id = storyId;
    const buffer =
      publishingBuffers?.[
        publishingDraftBufferKey(
          id,
          platform,
          publishing.activeVersionId ?? "v1"
        )
      ];
    if (buffer && JSON.stringify(buffer.content) !== JSON.stringify(edited)) {
      toast.error("发布区还有未保存的修改，请先保存或处理后再采用");
      return;
    }
    try {
      const result = await adopt.mutateAsync({
        storyId: id,
        versionId: selected.id,
        expectedRevision: query.data.revision,
        expectedPublishingRevision: publishing.revision,
        content: edited,
        feedback,
      });
      utils.textDrafts.read.setData({ storyId: id }, result.history);
      if (!alive.current || !scopeMatches(id)) return;
      if (
        storySpineStore.getState().publishing.revision <=
        result.publishing.revision
      )
        setPublishing(result.publishing);
      await utils.publishingDraft.read.invalidate({ storyId: id });
      toast.success("已采用到发布正文，并记录你的最终文字");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "采用失败，请刷新后重试"
      );
    }
  }

  return (
    <>
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          className={`${compactButtonClass} text-[var(--nayin-accent)]`}
          onClick={() => setDirectionOpen(true)}
          disabled={blocked || busy || query.isError}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          {busy ? _ui("正在处理…") : hasExistingText ? _ui("生成新版本") : _ui("生成文章")}
        </button>
      </div>
      {versions.at(-1)?.error && (
        <p role="status" className="mt-1 text-[10px] text-muted-foreground">
          {versions.at(-1)?.error}
        </p>
      )}
      {query.isError && (
        <button
          type="button"
          className="mt-1 text-xs text-destructive"
          onClick={() => void query.refetch()}
        >
          {_ui("文字历史读取失败，点击重试")}</button>
      )}
      <Dialog open={directionOpen} onOpenChange={setDirectionOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {hasExistingText ? _ui("生成新版本") : _ui("生成文章")}
            </DialogTitle>
            <DialogDescription>
              {hasExistingText
                ? _ui("为当前故事生成新的文字版本，旧版本会保留。")
                : _ui("把当前故事的内容整理成第一篇文章。")}
              {_ui("生成依据：当前书稿（如有）和本故事的聊天内容。")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">{_ui("内容性质")}<select aria-label={_ui("内容性质")} className="min-h-10 rounded-md border bg-background px-3" value={articleOptions.nature}
                onChange={event => setArticleOptions(previous => ({ ...previous, nature: event.target.value as ArticleGenerationOptions["nature"] }))}>
                {Object.entries(ARTICLE_NATURES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">{_ui("文章形式")}<select aria-label={_ui("文章形式")} className="min-h-10 min-w-0 rounded-md border bg-background px-2" value={articleOptions.form}
                  onChange={event => setArticleOptions(previous => ({ ...previous, form: event.target.value as ArticleGenerationOptions["form"] }))}>
                  {Object.entries(ARTICLE_FORMS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">{_ui("篇幅")}<select aria-label={_ui("篇幅")} className="min-h-10 min-w-0 rounded-md border bg-background px-2" value={articleOptions.length}
                  onChange={event => setArticleOptions(previous => ({ ...previous, length: event.target.value as ArticleGenerationOptions["length"] }))}>
                  {Object.entries(ARTICLE_LENGTHS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">{_ui("补充要求（选填）")}<textarea aria-label={_ui("文章补充要求")} rows={3} maxLength={2000} className="rounded-md border bg-background p-3" placeholder={_ui("写给谁看、希望的语气、哪些内容要保留……")}
                value={articleOptions.requirements} onChange={event => setArticleOptions(previous => ({ ...previous, requirements: event.target.value }))} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={`${buttonClass} border-[var(--nayin-accent)] bg-[var(--nayin-accent)] text-background hover:bg-[var(--nayin-accent)]`}
              onClick={() => void generateVersion()}
              disabled={busy || blocked || query.isError}
            >
              {busy ? _ui("正在生成…") : hasExistingText ? _ui("生成新版本") : _ui("生成文章")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (
            !next &&
            edited &&
            selected &&
            JSON.stringify(edited) !==
              JSON.stringify(
                selected.adoption?.content ?? selected.generated
              ) &&
            !window.confirm(
              "修改尚未采用，关闭后仍暂存在此面板；刷新会丢失。现在关闭吗？"
            )
          )
            return;
          setOpen(next);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {_ui("文字版本 ·")}{" "}{PUBLISHING_PLATFORM_REGISTRY[platform].label}
            </DialogTitle>
            <DialogDescription>
              {_ui("采用后才会更新正文并用于文风学习。")}</DialogDescription>
          </DialogHeader>
          <label className="text-xs">
            {_ui("本次提供的文字来源")}<select
              className="ml-2 rounded border bg-background p-2"
              value={source}
              onChange={e => setSource(e.target.value as typeof source)}
            >
              <option value="unknown">{_ui("不确定／混合素材")}</option>
              <option value="own">{_ui("我自己写的")}</option>
              <option value="reference">{_ui("仅供参考的资料")}</option>
              <option value="liked">{_ui("我喜欢的范文")}</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2" aria-label={_ui("文字历史")}>
            {versions.map(version => (
              <button
                type="button"
                key={version.id}
                className={buttonClass}
                aria-pressed={selectedId === version.id}
                disabled={adopt.isPending}
                onClick={() => selectVersion(version)}
              >
                {_ui("文字")}{" "}{version.sequence}{version.contribution ? _ui(" · 和{0}一起改的", [version.contribution.authorName]) : ""}
                {currentSource &&
                "textDraftId" in currentSource &&
                currentSource.textDraftId === version.id
                  ? _ui(" · 当前来源")
                  : ""}
                {version.adoption
                  ? _ui(" · 已采用")
                  : version.status === "ready"
                    ? _ui(" · 待查看")
                    : version.status === "generating"
                      ? _ui(" · 生成中")
                      : _ui(" · 未完成")}
              </button>
            ))}
          </div>
          {!versions.length && (
            <p className="text-sm text-muted-foreground">{_ui("暂无文字版本")}</p>
          )}
          {selected?.error && (
            <p role="alert" className="text-sm text-destructive">
              {selected.error}
            </p>
          )}
          {selected && edited && (
            <>
              <p className="text-xs text-muted-foreground">
                {selected.memoryCards?.length
                  ? _ui("使用 {0} 张记忆卡片", [selected.memoryCards.length])
                  : selected.request.parentId
                    ? _ui("基于文字 {0}", [versions.find(v => v.id === selected.request.parentId)?.sequence ?? _ui("历史版本")])
                    : _ui("首次整理")}{" "}
                {_ui("· 新增或修改对话")}{" "}{selected.conversationDelta.length} {_ui("条")}</p>
              {selected.memoryCards?.length ? (
                <details className="rounded-md border px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    {_ui("本次使用的记忆")}</summary>
                  <ol className="mt-2 space-y-3">
                    {selected.memoryCards.map((card, index) => (
                      <li key={card.id}>
                        <p className="font-medium">
                          {index + 1}. {card.title} ·{" "}
                          {card.kind === "conversation"
                            ? _ui("聊天记忆")
                            : card.kind === "thought"
                              ? _ui("一个思绪")
                              : _ui("一件事")}
                          {card.origin === "assistant" ? _ui(" · 助手整理") : ""}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap leading-5 text-muted-foreground">
                          {card.content}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              <details
                className="rounded-md border px-3 py-2 text-xs"
                style={{ borderColor: "var(--panel-border)" }}
              >
                <summary className="cursor-pointer font-medium">
                  {_ui("本次改动")}</summary>
                {selected.conversationDelta.length ? (
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    {selected.conversationDelta.map(message => (
                      <p
                        key={message.id}
                        className="whitespace-pre-wrap leading-5"
                      >
                        <span className="font-medium text-foreground">
                          {message.role === "assistant"
                            ? _ui("助手整理：")
                            : _ui("你的补充：")}
                        </span>
                        {message.content}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">
                    {_ui("这版没有新增聊天内容，沿用上一版材料重新整理。")}</p>
                )}
              </details>
              <label className="text-xs">
                {_ui("标题")}<input
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={edited.title}
                  readOnly={busy || Boolean(selected.adoption)}
                  onChange={e =>
                    setEdited({ ...edited, title: e.target.value })
                  }
                />
              </label>
              <label className="text-xs">
                {_ui("正文")}<textarea
                  className="mt-1 min-h-64 w-full rounded border bg-background p-3 text-sm leading-7"
                  value={edited.body}
                  readOnly={busy || Boolean(selected.adoption)}
                  onChange={e => setEdited({ ...edited, body: e.target.value })}
                />
              </label>
              <label className="text-xs">
                {_ui("这次哪些写法更合你意？（可选）")}<input
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={feedback}
                  maxLength={2000}
                  readOnly={busy || Boolean(selected.adoption)}
                  placeholder={_ui("例如：保留短句，比喻少一点；只针对这篇")}
                  onChange={e => setFeedback(e.target.value)}
                />
              </label>
              <details className="text-xs text-muted-foreground">
                <summary>{_ui("本次表达参考")}</summary>
                <p className="mt-2">
                  {_ui("原有表达：")}{selected.observation?.originalExpression}
                </p>
                <p>{_ui("采用反馈：")}{selected.observation?.adoptionLearning}</p>
                {selected.observation?.choices.map(choice => (
                  <p key={choice.id}>{choice.reason}</p>
                ))}
              </details>
              {!selected.adoption && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !edited.body.trim()}
                  onClick={() => void adoptVersion()}
                >
                  {_ui("采用这一版")}</button>
              )}
            </>
          )}
          {selected &&
            (selected.adoption ||
              selected.request.source === "own" ||
              selected.request.source === "liked") && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => void toggleLearning()}
              >
                {(selected.adoption?.learningEnabled ??
                selected.originalLearningEnabled !== false)
                  ? _ui("不再用于文风参考")
                  : _ui("恢复用于文风参考")}
              </button>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
