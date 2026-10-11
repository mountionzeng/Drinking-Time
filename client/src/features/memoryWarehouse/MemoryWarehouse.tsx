import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Loader2,
  Plus,
  X,
} from "lucide-react";
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
import { storySpineStore, useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { memorySelectionKey, setMemorySelection, useMemorySelection } from "./memorySelectionStore";
import type { MemoryCardInput } from "@shared/memoryWarehouse";
import {
  OPEN_MEMORY_WAREHOUSE,
  SAVE_MEMORY_CARD,
  type MemoryCardSeed,
} from "./memoryWarehouseEvents";

const button =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--panel-border)] px-2.5 py-1.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40 disabled:cursor-not-allowed";
const field =
  "w-full rounded-md border border-[var(--panel-border)] bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]";
type SelectedCard = Pick<MemoryCardInput, "id" | "title">;

export default function MemoryWarehouse({
  onOpenWriting,
}: {
  onOpenWriting: () => void;
}) {
  const {
    publishing,
    activeStoryId,
    publishingBuffers,
    isReplying,
    saveStatus,
  } = useStoryAgent();
  const { ensureActiveStoryPersisted, createNewStory } = useStoryAgentActions();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MemoryCardInput | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [offset, setOffset] = useState(0);
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const accountId = useStorySpine(state => state.accountId);
  const [selected, setSelected] = useMemorySelection(memorySelectionKey(accountId, activeStoryId));
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState<"new" | "current">("new");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<{
    storyId: number;
    versionId: string;
    title: string;
    body: string;
  } | null>(null);
  const saveLock = useRef(false);
  const generationLock = useRef(false);
  const alive = useRef(true);
  const query = trpc.memoryWarehouse.list.useQuery(
    { offset, archived },
    { enabled: open, retry: false, refetchInterval: open ? 5000 : false }
  );
  const save = trpc.memoryWarehouse.save.useMutation({ retry: false });
  const archive = trpc.memoryWarehouse.archive.useMutation({ retry: false });
  const generate = trpc.memoryWarehouse.compose.useMutation({ retry: false });
  const sync = trpc.memoryWarehouse.sync.useMutation({ retry: false });
  const syncRef = useRef(sync.mutateAsync);
  syncRef.current = sync.mutateAsync;
  const busy = starting || generate.isPending;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSyncing(true);
    setSyncError(false);
    void (async () => {
      try {
        let afterId: number | null = 0;
        while (afterId !== null && !cancelled) {
          const result: { nextAfterId: number | null } = await syncRef.current({
            afterId,
          });
          afterId = result.nextAfterId;
        }
        if (!cancelled) await Promise.all([utils.memoryWarehouse.list.invalidate({ archived: false }), utils.memoryWarehouse.list.invalidate({ archived: true })]);
      } catch {
        if (!cancelled) setSyncError(true);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, syncAttempt, utils]);

  useEffect(() => {
    alive.current = true;
    const show = () => {
      setOpen(true);
    };
    const remember = (event: Event) => {
      const seed = (event as CustomEvent<MemoryCardSeed>).detail;
      if (draftRef.current) toast.info("请先保存或取消正在整理的卡片");
      else
        setDraft({
          id: crypto.randomUUID(),
          title: "",
          kind: "event",
          ...seed,
        });
      setOpen(true);
    };
    window.addEventListener(OPEN_MEMORY_WAREHOUSE, show);
    window.addEventListener(SAVE_MEMORY_CARD, remember);
    return () => {
      alive.current = false;
      window.removeEventListener(OPEN_MEMORY_WAREHOUSE, show);
      window.removeEventListener(SAVE_MEMORY_CARD, remember);
    };
  }, []);

  async function saveCard() {
    if (!draft || saveLock.current) return;
    saveLock.current = true;
    try {
      await save.mutateAsync(draft);
      setDraft(null);
      setOffset(0);
      setArchived(false);
      setSearch("");
      await Promise.all([utils.memoryWarehouse.list.invalidate({ archived: false }), utils.memoryWarehouse.list.invalidate({ archived: true })]);
      toast.success("已存入记忆仓库");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "保存失败，内容仍保留"
      );
    } finally {
      saveLock.current = false;
    }
  }

  async function setArchive(id: string, value: boolean) {
    try {
      await archive.mutateAsync({ id, archived: value });
      setSelected(cards => cards.filter(card => card.id !== id));
      await Promise.all([utils.memoryWarehouse.list.invalidate({ archived: false }), utils.memoryWarehouse.list.invalidate({ archived: true })]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function generateArticle() {
    if (generationLock.current || !selected.length) return;
    generationLock.current = true;
    setStarting(true);
    setResult(null);
    let platform = publishing.activePlatform;
    try {
      if (target === "new") {
        if (isReplying || saveStatus === "saving" || saveStatus === "error")
          throw new Error("请等当前聊天保存完成后再组合新故事");
        if (
          Object.values(publishingBuffers).some(
            buffer => buffer.storyId === activeStoryId
          )
        )
          throw new Error("当前文章还有未应用的修改，请先处理后再组合新故事");
        const origin = storySpineStore.getState().activeStoryId;
        if (origin === -1) {
          const savedId = await ensureActiveStoryPersisted();
          if (storySpineStore.getState().activeStoryId !== savedId) return;
        }
        createNewStory();
        setMemorySelection(memorySelectionKey(accountId, -1), selected);
        storySpineStore
          .getState()
          .setStoryTitle(`记忆组合 · ${selected[0].title}`.slice(0, 80));
        platform = storySpineStore.getState().publishing.activePlatform;
        onOpenWriting();
      }
      const id = await ensureActiveStoryPersisted();
      const matches = () => {
        const current = storySpineStore.getState();
        return (
          alive.current &&
          (current.remoteStoryId ?? current.activeStoryId) === id &&
          current.publishing.activePlatform === platform
        );
      };
      if (!matches()) return;
      setMemorySelection(memorySelectionKey(storySpineStore.getState().accountId, id), selected);
      const history = await utils.textDrafts.read.fetch({ storyId: id });
      if (!matches()) return;
      const operationToken = crypto.randomUUID();
      const response = await generate.mutateAsync({
        storyId: id,
        operationToken,
        expectedRevision: history.revision,
        platform,
        instruction,
        memoryCardIds: selected.map(card => card.id),
      });
      utils.textDrafts.read.setData({ storyId: id }, response);
      const version = response.versions.find(
        item => item.id === operationToken
      );
      if (!matches()) {
        toast.info("生成记录已保存到原故事的文字历史");
        return;
      }
      if (version?.status === "ready" && version.generated) {
        setResult({ storyId: id, versionId: version.id, ...version.generated });
        toast.success("文章已生成，查看后可选择采用");
      } else toast.error(version?.error ?? "生成尚未完成，请查看文字历史");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "生成未完成，请查看文字历史后再试"
      );
    } finally {
      generationLock.current = false;
      if (alive.current) setStarting(false);
    }
  }

  function toggle(card: SelectedCard) {
    setSelected(cards =>
      cards.some(item => item.id === card.id)
        ? cards.filter(item => item.id !== card.id)
        : cards.length < 20
          ? [...cards, { id: card.id, title: card.title }]
          : cards
    );
  }
  function move(index: number, step: number) {
    setSelected(cards => {
      const copy = [...cards];
      [copy[index], copy[index + step]] = [copy[index + step], copy[index]];
      return copy;
    });
  }
  const cards =
    query.data?.cards.filter(card =>
      `${card.title}\n${card.content}`.includes(search.trim())
    ) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!save.isPending) setOpen(value);
      }}
    >
      <DialogContent
        id="writing-memory-warehouse"
        className="block max-h-[88vh] space-y-4 overflow-y-auto sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            记忆仓库
          </DialogTitle>
          <DialogDescription>
            随便聊的内容都会成为记忆。选取不同片段，自由组合成不同的故事。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              className={button}
              aria-pressed={!archived}
              onClick={() => {
                setArchived(false);
                setOffset(0);
              }}
            >
              全部记忆
            </button>
            <button
              className={button}
              aria-pressed={archived}
              onClick={() => {
                setArchived(true);
                setOffset(0);
              }}
            >
              已归档
            </button>
          </div>
          <button
            className={button}
            disabled={Boolean(draft) || busy}
            onClick={() =>
              setDraft({
                id: crypto.randomUUID(),
                title: "",
                content: "",
                kind: "event",
                origin: "note",
                sourceStoryId: null,
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            记一张卡片
          </button>
        </div>
        {syncing && (
          <p role="status" className="text-xs text-muted-foreground">
            正在收录聊天记忆，包括以前聊过的内容…
          </p>
        )}
        {syncError && (
          <p role="alert" className="text-xs text-destructive">
            部分聊天还未收录，原聊天仍保留。
            <button
              className={button}
              onClick={() => setSyncAttempt(value => value + 1)}
            >
              重新收录
            </button>
          </p>
        )}
        {draft && (
          <section
            aria-label="整理记忆卡片"
            className="space-y-3 rounded-lg border border-[var(--nayin-accent)] bg-[var(--nayin-glow)] p-4"
          >
            <h3 className="text-sm font-medium">存为记忆卡片</h3>
            <label className="block text-xs">
              标题
              <input
                className={`${field} mt-1`}
                aria-label="记忆标题"
                maxLength={120}
                value={draft.title}
                disabled={save.isPending}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                placeholder="给这段记忆起个名字"
              />
            </label>
            <label className="block text-xs">
              类型
              <select
                className={`${field} mt-1`}
                value={draft.kind}
                disabled={save.isPending}
                onChange={e =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as "event" | "thought",
                  })
                }
              >
                <option value="event">一件事</option>
                <option value="thought">一个思绪</option>
              </select>
            </label>
            <label className="block text-xs">
              内容
              <textarea
                className={`${field} mt-1 min-h-32`}
                aria-label="记忆内容"
                maxLength={12000}
                value={draft.content}
                disabled={save.isPending}
                onChange={e => setDraft({ ...draft, content: e.target.value })}
                placeholder="随便写，记下你想留住的片段…"
              />
            </label>
            {draft.origin === "assistant" && (
              <p className="text-xs text-muted-foreground">
                这张卡片来自助手整理，请核对内容；保存后仍保留来源标记。
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                className={button}
                disabled={save.isPending}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <button
                className={`${button} bg-[var(--nayin-accent)] text-background`}
                disabled={
                  save.isPending ||
                  !draft.title.trim() ||
                  !draft.content.trim() ||
                  draft.content.length > 12000
                }
                onClick={() => void saveCard()}
              >
                {save.isPending ? "保存中…" : "保存记忆卡片"}
              </button>
            </div>
          </section>
        )}
        <div className="grid min-h-0 gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <section aria-label="记忆卡片列表" className="max-h-[48vh] min-w-0 space-y-3 overflow-y-auto pr-1 md:max-h-[60vh]">
            <input
              className={field}
              aria-label="筛选本页记忆"
              placeholder="筛选本页记忆…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {query.isLoading && (
              <p role="status" className="text-sm text-muted-foreground">
                正在打开记忆仓库…
              </p>
            )}
            {query.isError && (
              <div role="alert" className="text-sm text-destructive">
                记忆读取失败。
                <button className={button} onClick={() => void query.refetch()}>
                  重试
                </button>
              </div>
            )}
            {!query.isLoading && !query.isError && cards.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {search
                  ? "本页没有匹配的记忆"
                  : archived
                    ? "没有已归档的卡片"
                    : syncing
                      ? "正在整理已有聊天…"
                      : "还没有聊天记忆。随便聊聊，内容会自动出现在这里。"}
              </p>
            )}
            {cards.map(card => {
              const position = selected.findIndex(item => item.id === card.id);
              return (
                <article
                  key={card.id}
                  className={`rounded-lg border p-3 transition-colors ${position >= 0 ? "border-[var(--nayin-accent)] bg-[var(--nayin-glow)]" : "border-[var(--panel-border)]"}`}
                >
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                    {!archived && (
                      <input
                        type="checkbox"
                        className="mt-1 accent-[var(--nayin-accent)]"
                        checked={position >= 0}
                        disabled={
                          busy || (position < 0 && selected.length >= 20)
                        }
                        onChange={() => toggle(card)}
                      />
                    )}
                    <span>{card.title}</span>
                  </label>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {card.kind === "conversation"
                      ? "聊天记忆"
                      : card.kind === "event"
                        ? "一件事"
                        : "一个思绪"}{" "}
                    ·{" "}
                    {card.origin === "assistant"
                      ? "助手整理"
                      : card.origin === "user"
                        ? "我的原话"
                        : "随手记"}{" "}
                    · {new Date(card.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                  {card.content.length > 240 ? <details className="mt-2 text-sm leading-6">
                    <summary className="cursor-pointer whitespace-pre-wrap break-words text-muted-foreground">{Array.from(card.content).slice(0, 180).join("")}… <span className="text-xs underline">展开原话</span></summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">{card.content}</p>
                  </details> : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{card.content}</p>}
                  <div className="mt-2 flex justify-end">
                    <button
                      className={button}
                      disabled={archive.isPending || busy}
                      onClick={() => void setArchive(card.id, !archived)}
                    >
                      <Archive className="h-3 w-3" />
                      {archived ? "恢复" : "归档"}
                    </button>
                  </div>
                </article>
              );
            })}
            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                className={button}
                disabled={offset === 0 || query.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                上一页
              </button>
              <span>第 {offset / 50 + 1} 页</span>
              <button
                className={button}
                disabled={query.data?.nextOffset == null || query.isFetching}
                onClick={() => setOffset(query.data!.nextOffset!)}
              >
                下一页
              </button>
            </div>
          </section>
          <section
            aria-label="组合文章"
            className="space-y-3 border-t border-[var(--panel-border)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"
          >
            <h3 className="text-sm font-medium">
              用记忆写文章{" "}
              <span className="text-xs text-muted-foreground">
                {selected.length} / 20
              </span>
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              选卡后调整顺序。同一张卡片可以用于多篇文章。
            </p>
            <ol className="space-y-2">
              {selected.map((card, index) => (
                <li key={card.id} className="flex items-center gap-1 text-xs">
                  <span className="min-w-0 flex-1 break-words">
                    {index + 1}. {card.title}
                  </span>
                  <button
                    className={button}
                    aria-label={`上移${card.title}`}
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    className={button}
                    aria-label={`下移${card.title}`}
                    disabled={index === selected.length - 1 || busy}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    className={button}
                    aria-label={`取消选择${card.title}`}
                    disabled={busy}
                    onClick={() => toggle(card)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ol>
            <label className="block text-xs">
              这次想写什么？
              <textarea
                className={`${field} mt-1 min-h-24`}
                maxLength={8000}
                disabled={busy}
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="例如：把这些片段写成一篇关于回家的文章"
              />
            </label>
            <label className="block text-xs">
              组合到
              <select
                aria-label="组合到"
                className={`${field} mt-1`}
                disabled={busy}
                value={target}
                onChange={e => setTarget(e.target.value as "new" | "current")}
              >
                <option value="new">一个新故事</option>
                <option value="current" disabled={activeStoryId == null}>
                  当前故事的新文稿
                </option>
              </select>
            </label>
            {activeStoryId == null && target === "current" ? (
              <button className={button} onClick={createNewStory}>
                新建故事，开始组合
              </button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {target === "new"
                    ? "这组记忆将组成独立的新故事；原记忆仍可用于其他故事。"
                    : "生成后存入当前故事的文字历史，查看后再采用。"}
                </p>
                <button
                  className={`${button} w-full bg-[var(--nayin-accent)] text-background`}
                  disabled={
                    !selected.length ||
                    busy ||
                    syncing ||
                    Boolean(draft) ||
                    isReplying ||
                    saveStatus === "saving"
                  }
                  onClick={() => void generateArticle()}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy
                    ? "正在组合记忆…"
                    : target === "new"
                      ? "组合成新故事"
                      : "用所选记忆生成文章"}
                </button>
              </>
            )}
          </section>
        </div>
        {result && (
          <section
            className="space-y-3 border-t border-[var(--panel-border)] pt-4"
            aria-label="记忆生成的文章"
          >
            <h3 className="text-base font-medium">
              {result.title || "新文章"}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {result.body}
            </p>
            <button
              className={button}
              disabled={activeStoryId !== result.storyId}
              onClick={() => {
                setOpen(false);
                onOpenWriting();
                window.setTimeout(
                  () =>
                    window.dispatchEvent(
                      new CustomEvent("dt:open-text-version-history", {
                        detail: { versionId: result.versionId },
                      })
                    ),
                  0
                );
              }}
            >
              查看与采用
            </button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
