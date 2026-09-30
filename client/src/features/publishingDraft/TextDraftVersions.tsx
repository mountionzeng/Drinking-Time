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
  CAPABILITY_GROUPS,
  type StoryCapabilityGroupId,
} from "@/features/storyAgent/views/StoryCapabilityMenu";

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
  const { publishing, publishingBuffers, messages } = useStoryAgent();
  const {
    ensureActiveStoryPersisted,
    setPublishing,
    setPublishingBuffer,
  } = useStoryAgentActions();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [direction, setDirection] = useState<StoryCapabilityGroupId | null>(
    null
  );
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
  const adopt = trpc.textDrafts.adopt.useMutation({ retry: false });
  const learning = trpc.textDrafts.setLearning.useMutation({ retry: false });
  const platform = publishing.activePlatform;
  const versions = (query.data?.versions ?? []).filter(
    v => v.request.platform === platform
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

  async function generateVersion(
    selectedDirectionId: StoryCapabilityGroupId | null = direction
  ) {
    if (lock.current || busy || blocked) return;
    lock.current = true;
    setStarting(true);
    const origin = storyId;
    try {
      const id =
        storyId && storyId > 0 ? storyId : await ensureActiveStoryPersisted();
      if (origin && origin > 0 && currentScope.current !== origin) return;
      if (!scopeMatches(id)) return;
      const history = await utils.textDrafts.read.fetch({ storyId: id });
      if (!scopeMatches(id)) return;
      const freshLatest = [...history.versions]
        .reverse()
        .find(v => v.status === "ready" && v.request.platform === platform);
      const buffer =
        publishingBuffers?.[
          publishingDraftBufferKey(
            id,
            platform,
            publishing.activeVersionId ?? "v1"
          )
        ];
      const { basis, parentId } = resolveTextDraftBasis({
        selected,
        latest: freshLatest,
        edited,
        buffer: buffer?.content,
        published: publishing.drafts[platform]?.content,
      });
      const selectedDirection = CAPABILITY_GROUPS.find(
        option => option.id === selectedDirectionId
      );
      const instruction = [
        selectedDirection
          ? `本次创作方向：${selectedDirection.label}。${selectedDirection.description}`
          : "",
        input.trim(),
      ]
        .filter(Boolean)
        .join("\n");
      const result = await generate.mutateAsync({
        storyId: id,
        operationToken: crypto.randomUUID(),
        expectedRevision: history.revision,
        platform,
        parentId,
        basis: basis?.body.trim() ? basis : null,
        messages: messages
          .filter(m => m.role === "user" || m.role === "assistant")
          .map(m => ({ id: m.id, role: m.role, content: m.content })),
        instruction,
        source,
      });
      utils.textDrafts.read.setData({ storyId: id }, result);
      if (!alive.current || !scopeMatches(id)) return;
      const next = result.versions.at(-1);
      if (next) {
        setSelectedId(next.id);
        setEdited(next.generated ?? null);
        setFeedback("");
        if (next.status === "ready" && next.generated) {
          setPublishingBuffer(
            id,
            platform,
            next.generated,
            publishing.activeVersionId ?? "v1"
          );
        }
      }
      setDirectionOpen(false);
      setDirection(null);
      if (next?.status === "ready")
        toast.success("新版本已生成，正在右侧显示完整正文");
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
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="min-w-0 text-[10px] leading-4 text-muted-foreground">
          继续补充，准备好再生成。
        </p>
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
          {busy ? "正在处理…" : "生成新版本"}
        </button>
      </div>
      {versions.at(-1)?.status === "unknown" && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          上一轮结果未确认。再次生成会发起新的请求。
        </p>
      )}
      {query.isError && (
        <button
          type="button"
          className="mt-1 text-xs text-destructive"
          onClick={() => void query.refetch()}
        >
          文字历史读取失败，点击重试
        </button>
      )}
      <Dialog open={directionOpen} onOpenChange={setDirectionOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>这次想怎样讲？</DialogTitle>
            <DialogDescription>
              只影响这一次新版本，不会改变这篇故事原有的用途。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {CAPABILITY_GROUPS.map(option => {
              const Icon = option.icon;
              const selected = direction === option.id;
              return (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => setDirection(option.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${
                    selected
                      ? "border-[var(--nayin-accent)] bg-[var(--nayin-glow)]"
                      : "border-[var(--panel-border)] hover:bg-muted/50"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--nayin-glow)] text-[var(--nayin-accent)]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setDirection(null);
                void generateVersion(null);
              }}
              disabled={busy}
            >
              不指定方向，直接生成
            </button>
            <button
              type="button"
              className={`${buttonClass} border-[var(--nayin-accent)] bg-[var(--nayin-accent)] text-background hover:bg-[var(--nayin-accent)]`}
              onClick={() => void generateVersion()}
              disabled={busy || direction === null}
            >
              生成这一版
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
              文字版本 · {PUBLISHING_PLATFORM_REGISTRY[platform].label}
            </DialogTitle>
            <DialogDescription>
              旧稿与新增对话生成新稿。查看不等于采用；采用后的文字才参与偏好学习。
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs">
            本次提供的文字来源
            <select
              className="ml-2 rounded border bg-background p-2"
              value={source}
              onChange={e => setSource(e.target.value as typeof source)}
            >
              <option value="unknown">不确定／混合素材</option>
              <option value="own">我自己写的</option>
              <option value="reference">仅供参考的资料</option>
              <option value="liked">我喜欢的范文</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-2" aria-label="文字历史">
            {versions.map(version => (
              <button
                type="button"
                key={version.id}
                className={buttonClass}
                aria-pressed={selectedId === version.id}
                disabled={adopt.isPending}
                onClick={() => selectVersion(version)}
              >
                文字 {version.sequence}
                {version.adoption
                  ? " · 已采用"
                  : version.status === "ready"
                    ? " · 待查看"
                    : version.status === "generating"
                      ? " · 生成中"
                      : " · 未完成"}
              </button>
            ))}
          </div>
          {!versions.length && (
            <p className="text-sm text-muted-foreground">
              还没有独立文字版本，关闭面板后点击“生成新版本”。
            </p>
          )}
          {selected?.error && (
            <p role="alert" className="text-sm text-destructive">
              {selected.error}
            </p>
          )}
          {selected && edited && (
            <>
              <p className="text-xs text-muted-foreground">
                {selected.request.parentId
                  ? `基于文字 ${versions.find(v => v.id === selected.request.parentId)?.sequence ?? "历史版本"}`
                  : "首次整理"}{" "}
                · 新增或修改对话 {selected.conversationDelta.length} 条
              </p>
              <details className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--panel-border)" }}>
                <summary className="cursor-pointer font-medium">
                  本次改动
                </summary>
                {selected.conversationDelta.length ? (
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    {selected.conversationDelta.map(message => (
                      <p key={message.id} className="whitespace-pre-wrap leading-5">
                        <span className="font-medium text-foreground">
                          {message.role === "assistant" ? "助手整理：" : "你的补充："}
                        </span>
                        {message.content}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-muted-foreground">
                    这版没有新增聊天内容，沿用上一版材料重新整理。
                  </p>
                )}
              </details>
              <label className="text-xs">
                标题
                <input
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={edited.title}
                  readOnly={busy || Boolean(selected.adoption)}
                  onChange={e =>
                    setEdited({ ...edited, title: e.target.value })
                  }
                />
              </label>
              <label className="text-xs">
                正文
                <textarea
                  className="mt-1 min-h-64 w-full rounded border bg-background p-3 text-sm leading-7"
                  value={edited.body}
                  readOnly={busy || Boolean(selected.adoption)}
                  onChange={e => setEdited({ ...edited, body: e.target.value })}
                />
              </label>
              <label className="text-xs">
                这次哪些写法更合你意？（可选）
                <input
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={feedback}
                  maxLength={2000}
                  readOnly={busy || Boolean(selected.adoption)}
                  placeholder="例如：保留短句，比喻少一点；只针对这篇"
                  onChange={e => setFeedback(e.target.value)}
                />
              </label>
              <details className="text-xs text-muted-foreground">
                <summary>本次表达参考</summary>
                <p className="mt-2">
                  原有表达：{selected.observation?.originalExpression}
                </p>
                <p>采用反馈：{selected.observation?.adoptionLearning}</p>
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
                  采用这一版
                </button>
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
                  ? "不再用于文风参考"
                  : "恢复用于文风参考"}
              </button>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
