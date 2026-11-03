import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Users,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  storySpineStore,
  useStorySpine,
} from "@/features/storyAgent/spine/storySpine";
import {
  booksOnShelf,
  type MemorySpaceOperation,
  type MemorySpace as Space,
  type MemoryPerson,
} from "@shared/memorySpace";
import { mixedBookViews } from "./bookArrangement";
import { MemoryBookCover } from "./MemoryBookPreview";
import "./memorySpace.css";
import { useMobileBookGesture } from "./useMobileBookGesture";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { isPersistedStoryId } from "@shared/persistedStoryId";

const date = (time: number | null) =>
  time
    ? new Date(time).toLocaleString("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "时间未记录";
export function MemorySpace({
  onOpenStory,
  onOpenNotes,
  initialTab = "stories",
  mobileGestures = false,
  initialTrashOpen = false,
}: {
  onOpenStory: (id: number) => void;
  onOpenNotes: () => void;
  initialTab?: "stories" | "people";
  mobileGestures?: boolean;
  initialTrashOpen?: boolean;
}) {
  const accountId = useStorySpine(s => s.accountId);
  return (
    <MemorySpaceContent
      key={accountId ?? "guest"}
      accountId={accountId}
      onOpenStory={onOpenStory}
      onOpenNotes={onOpenNotes}
      initialTab={initialTab}
      mobileGestures={mobileGestures}
      initialTrashOpen={initialTrashOpen}
    />
  );
}
function MemorySpaceContent({
  accountId,
  onOpenStory,
  onOpenNotes,
  initialTab = "stories",
  mobileGestures = false,
  initialTrashOpen = false,
}: {
  accountId: number | null;
  onOpenStory: (id: number) => void;
  onOpenNotes: () => void;
  initialTab?: "stories" | "people";
  mobileGestures?: boolean;
  initialTrashOpen?: boolean;
}) {
  const _ui = useDesktopUiText();
  const [tab, setTab] = useState<"stories" | "people">(initialTab);
  const [organizing, setOrganizing] = useState(false);
  const [search, setSearch] = useState("");
  const [storyId, setStoryId] = useState<number | null>(null);
  const [shelfName, setShelfName] = useState("");
  const [editingShelf, setEditingShelf] = useState<string | null>(null);
  const [addingShelf, setAddingShelf] = useState(false);
  const [newShelfId, setNewShelfId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const query = trpc.memorySpace.list.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });
  const change = trpc.memorySpace.change.useMutation();
  const lock = useRef(false);
  async function act(operation: MemorySpaceOperation) {
    if (
      !query.data ||
      lock.current ||
      storySpineStore.getState().accountId !== accountId
    )
      return false;
    lock.current = true;
    setError("");
    try {
      await change.mutateAsync({ revision: query.data.revision, operation });
      await utils.memorySpace.list.invalidate();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
      await utils.memorySpace.list.invalidate();
      return false;
    } finally {
      lock.current = false;
    }
  }
  const [placementId, setPlacementId] = useState<number | null>(null);
  const [trashCandidate, setTrashCandidate] = useState<{ id: number; title: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(initialTrashOpen);
  const trashList = trpc.memorySpace.trashList.useQuery(undefined, { enabled: trashOpen });
  const trashMutation = trpc.memorySpace.trash.useMutation();
  const restoreMutation = trpc.memorySpace.restore.useMutation();
  async function refreshAfterTrash() {
    const results = await Promise.allSettled([
      utils.memorySpace.list.invalidate(),
      utils.memorySpace.trashList.invalidate(),
      utils.storyAgent.storyList.invalidate(),
      utils.storyAgent.accountImages.invalidate(),
    ]);
    if (results.some(result => result.status === "rejected"))
      setError("操作已完成，但列表刷新失败，请刷新页面查看。");
  }
  const desktopDrag = useRef<{
    id: number;
    view: "vertical" | "horizontal" | "album";
  } | null>(null);
  const [desktopDropShelf, setDesktopDropShelf] = useState<string | null>(null);
  const gesture = useMobileBookGesture({
    enabled: mobileGestures && tab === "stories" && storyId === null,
    blocked: change.isPending || Boolean(search),
    revision: query.data?.revision,
    onArrange: setPlacementId,
    onDrop: op => {
      void act(op);
    },
  });
  if (storyId !== null)
    return (
      <MemoryReader
        storyId={storyId}
        onBack={() => setStoryId(null)}
        onOpenStory={onOpenStory}
      />
    );
  const data = query.data;
  return (
    <section
      ref={gesture.root}
      onClickCapture={gesture.onClickCapture}
      onDragStart={e => {
        if (mobileGestures || organizing || search || change.isPending) return;
        const item = (e.target as Element).closest<HTMLElement>(
          ".memory-book-item[draggable=true]"
        );
        if (!item) return;
        desktopDrag.current = {
          id: Number(item.dataset.storyId),
          view: item.dataset.bookView as "vertical" | "horizontal" | "album",
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(desktopDrag.current.id));
      }}
      onDragOver={e => {
        if (!desktopDrag.current) return;
        const shelf = (e.target as Element).closest<HTMLElement>("[data-drop-shelf]");
        if (!shelf || !e.currentTarget.contains(shelf)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDesktopDropShelf(shelf.dataset.dropShelf ?? null);
      }}
      onDrop={e => {
        const dragged = desktopDrag.current;
        const shelf = (e.target as Element).closest<HTMLElement>("[data-drop-shelf]");
        desktopDrag.current = null;
        setDesktopDropShelf(null);
        if (!dragged || !shelf || !e.currentTarget.contains(shelf)) return;
        e.preventDefault();
        const target = shelf.dataset.dropShelf;
        if (!target) return;
        const item = (e.target as Element).closest<HTMLElement>("[data-story-id]");
        const items = Array.from(shelf.querySelectorAll<HTMLElement>("[data-story-id]"));
        let beforeStoryId: number | null = null;
        if (target !== "default" && item && items.includes(item)) {
          const rect = item.getBoundingClientRect();
          const before = item.dataset.bookView === "horizontal"
            ? e.clientY < rect.top + rect.height / 2
            : e.clientX < rect.left + rect.width / 2;
          const next = before ? item : items[items.indexOf(item) + 1];
          beforeStoryId = next ? Number(next.dataset.storyId) : null;
        }
        if (beforeStoryId === dragged.id) return;
        void act({
          kind: "moveBook",
          storyId: dragged.id,
          shelfId: target === "default" ? null : target,
          beforeStoryId,
          view: dragged.view,
        });
      }}
      onDragEnd={() => {
        desktopDrag.current = null;
        setDesktopDropShelf(null);
      }}
      className="memory-space"
      aria-label={_ui("回忆书架与人物")}
      data-mobile-gestures={mobileGestures}
      data-held-book={gesture.held?.id}
    >
      {gesture.held && (
        <div
          className="memory-drag-ghost"
          role="status"
          style={{
            left: `clamp(116px, ${gesture.held.x}px, calc(100vw - 116px))`,
            top: gesture.held.y,
          }}
        >
          {gesture.held.title}
          <small>
            {gesture.held.dragging ? _ui("松手放在这里") : _ui("拖动换位置 · 松手调摆放")}
          </small>
        </div>
      )}
      {!mobileGestures && (
        <>
          <header className="memory-space-heading">
            <div>
              <p className="memory-space-eyebrow">{_ui("留在这里的时光")}</p>
              <h1>{_ui("回忆")}</h1>
            </div>
            <button className="memory-link" onClick={onOpenNotes}>
              {_ui("记事工具")}</button>
          </header>
          <nav className="memory-tabs" aria-label={_ui("回忆分类")}>
            <button
              aria-pressed={tab === "stories"}
              onClick={() => setTab("stories")}
            >
              <BookOpen size={18} />
              {_ui("故事")}</button>
            <button
              aria-pressed={tab === "people"}
              onClick={() => setTab("people")}
            >
              <Users size={18} />{_ui("人")}</button>
          </nav>
        </>
      )}
      {error && (
        <p className="memory-error" role="alert">
          {error}
        </p>
      )}
      {query.isError && (
        <p className="memory-error" role="alert">
          {_ui("暂时无法读取回忆。")}<button onClick={() => void query.refetch()}>{_ui("重新加载")}</button>
        </p>
      )}
      {!data && query.isLoading && <p role="status">{_ui("正在打开回忆…")}</p>}
      {data && (
        <fieldset className="memory-controls" disabled={change.isPending}>
          {tab === "stories" ? (
            <>
              {!mobileGestures && (
                <>
                  <div className="memory-toolbar">
                    <input
                      aria-label={_ui("搜索故事")}
                      placeholder={_ui("找一本故事…")}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                    {!mobileGestures && (
                      <button
                        className="memory-button"
                        onClick={() => setOrganizing(!organizing)}
                      >
                        {organizing ? (
                          <Check size={15} />
                        ) : (
                          <Pencil size={15} />
                        )}
                        {organizing ? _ui("整理好了") : _ui("整理书架")}
                      </button>
                    )}
                  </div>
                  <div className="memory-view-bar">
                    <div className="memory-view-intro">
                      <span>{_ui("我的藏书")}</span>
                      <small>
                        {data.books.length} {_ui("本故事 · 横放、竖放、封面朝外，同架收藏")}</small>
                    </div>
                  </div>
                </>
              )}
              {mobileGestures && (
                <p className="memory-hint">
                  {search
                    ? _ui("清空搜索后，可长按拖动书本")
                    : _ui("长按拖动换位置，松手调整摆放；拖到“加一层书架”另放一层。")}
                </p>
              )}
              {!mobileGestures && !organizing && (
                <p className="memory-hint">
                  {search
                    ? _ui("清空搜索后可拖动书本。")
                    : _ui("拖动书本到另一层书架；也可点“整理书架”选择位置。")}
                </p>
              )}
              <button type="button" className="memory-trash-link" onClick={() => setTrashOpen(true)}>
                {_ui("回收站")}</button>
              {addingShelf ? (
                <form
                  className="memory-form"
                  onSubmit={async e => {
                    e.preventDefault();
                    if (
                      await act(
                        editingShelf
                          ? {
                              kind: "renameShelf",
                              id: editingShelf,
                              name: shelfName,
                            }
                          : {
                              kind: "addShelf",
                              id: newShelfId,
                              name: shelfName,
                            }
                      )
                    ) {
                      setAddingShelf(false);
                      setShelfName("");
                      setEditingShelf(null);
                    }
                  }}
                >
                  <label>
                    {_ui("书架层名称")}<input
                      autoFocus
                      maxLength={80}
                      required
                      value={shelfName}
                      onChange={e => setShelfName(e.target.value)}
                    />
                  </label>
                  <div>
                    <button className="memory-button" type="submit">
                      {_ui("保存")}</button>
                    <button
                      className="memory-link"
                      type="button"
                      onClick={() => setAddingShelf(false)}
                    >
                      {_ui("取消")}</button>
                  </div>
                </form>
              ) : (
                <button
                  className="memory-add-shelf"
                  onClick={() => {
                    setEditingShelf(null);
                    setNewShelfId(crypto.randomUUID());
                    setShelfName("");
                    setAddingShelf(true);
                  }}
                >
                  <Plus size={18} />
                  {_ui("加一层书架")}</button>
              )}
              <div
                className="memory-shelves"
                data-view="mixed"
                data-organizing={organizing}
              >
                {data.shelves.map((shelf, index) => (
                  <Shelf
                    key={shelf.id}
                    name={shelf.name}
                    books={booksOnShelf(data, shelf.id)}
                    search={search}
                    organizing={organizing}
                    desktopDragEnabled={!mobileGestures && !organizing && !search && !change.isPending}
                    desktopDropShelf={desktopDropShelf}
                    placementId={placementId}
                    onPlacementChange={setPlacementId}
                    onTrash={book => { setPlacementId(null); setTrashCandidate(book); }}
                    data={data}
                    shelfId={shelf.id}
                    onRead={id => {
                      setPlacementId(null);
                      setStoryId(id);
                    }}
                    act={act}
                  >
                    <div className="memory-shelf-header-actions">
                    <button
                      className="memory-remove-shelf"
                      aria-label={_ui("撤销书架{0}", [shelf.name])}
                      title={_ui("撤销后书会回到默认书架，故事不会删除")}
                      onClick={() => {
                        const views = Object.fromEntries(
                          mixedBookViews(booksOnShelf(data, shelf.id))
                        );
                        void act({ kind: "removeShelf", id: shelf.id, views });
                      }}
                    >
                      {_ui("撤销书架")}</button>
                    {(organizing || mobileGestures) && (
                      <details
                        className="memory-shelf-menu"
                        open={mobileGestures ? undefined : true}
                      >
                        <summary aria-label={_ui("管理{0}", [shelf.name])}>···</summary>
                        <div className="memory-shelf-actions">
                          <button
                            aria-label={_ui("上移{0}", [shelf.name])}
                            disabled={index === 0}
                            onClick={() =>
                              void act({
                                kind: "moveShelf",
                                id: shelf.id,
                                direction: "up",
                              })
                            }
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            aria-label={_ui("下移{0}", [shelf.name])}
                            disabled={index === data.shelves.length - 1}
                            onClick={() =>
                              void act({
                                kind: "moveShelf",
                                id: shelf.id,
                                direction: "down",
                              })
                            }
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingShelf(shelf.id);
                              setShelfName(shelf.name);
                              setAddingShelf(true);
                            }}
                          >
                            {_ui("改名")}</button>
                        </div>
                      </details>
                    )}
                    </div>
                  </Shelf>
                ))}
                <Shelf
                  name={data.shelves.length ? _ui("未分层") : _ui("我的故事")}
                  books={booksOnShelf(data, null)}
                  search={search}
                  organizing={organizing}
                  desktopDragEnabled={!mobileGestures && !organizing && !search && !change.isPending}
                  desktopDropShelf={desktopDropShelf}
                  data={data}
                  placementId={placementId}
                  onPlacementChange={setPlacementId}
                  onTrash={book => { setPlacementId(null); setTrashCandidate(book); }}
                  shelfId={null}
                  onRead={id => {
                    setPlacementId(null);
                    setStoryId(id);
                  }}
                  act={act}
                />
              </div>
              {organizing && (
                <p className="memory-hint">
                  {_ui("移除书架层后，故事会回到未分层。故事内容不会删除。")}</p>
              )}
            </>
          ) : (
            <People
              data={data}
              act={act}
              onRead={id => {
                setPlacementId(null);
                setStoryId(id);
              }}
            />
          )}
        </fieldset>
      )}
      <Dialog open={trashCandidate !== null} onOpenChange={open => { if (!open && !trashMutation.isPending) setTrashCandidate(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{_ui("把故事放入回收站？")}</DialogTitle>
            <DialogDescription>
              “{trashCandidate?.title}{_ui("”会从故事列表和书架移走，可以在回收站恢复。未保存的修改不会进入回收站，已有的分享链接可能仍可访问。")}</DialogDescription>
          </DialogHeader>
          {trashMutation.error && <p className="memory-error" role="alert">{trashMutation.error.message}</p>}
          <div className="memory-trash-dialog-actions">
            <button type="button" className="memory-button" disabled={trashMutation.isPending} onClick={() => setTrashCandidate(null)}>{_ui("取消")}</button>
            <button type="button" className="memory-button" disabled={trashMutation.isPending} onClick={async () => {
              if (!trashCandidate) return;
              const id = trashCandidate.id;
              try {
                await trashMutation.mutateAsync({ storyId: id });
                window.dispatchEvent(new CustomEvent("dt:story-trashed", { detail: { storyId: id } }));
                await refreshAfterTrash();
                setTrashCandidate(null);
              } catch { /* The mutation error remains visible in the dialog. */ }
            }}>{trashMutation.isPending ? _ui("正在移入…") : _ui("移入回收站")}</button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="sm:max-w-md max-h-[80dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{_ui("回收站")}</DialogTitle><DialogDescription>{_ui("故事可恢复到原来的书架；如果书架已撤销，会回到默认书架。")}</DialogDescription></DialogHeader>
          {trashList.isLoading && <p>{_ui("正在读取…")}</p>}
          {trashList.isError && <p className="memory-error" role="alert">{_ui("读取失败，请关闭后重试。")}</p>}
          {trashList.data?.length === 0 && <p>{_ui("回收站是空的。")}</p>}
          {trashList.data?.map(book => <div className="memory-trash-row" key={book.id}>
            <span>{book.title || _ui("未命名故事")}</span>
            <button type="button" className="memory-button" disabled={restoreMutation.isPending} onClick={async () => {
              try { await restoreMutation.mutateAsync({ storyId: book.id }); await refreshAfterTrash(); window.dispatchEvent(new CustomEvent("dt:story-restored", { detail: { storyId: book.id } })); }
              catch { /* The mutation error remains visible below. */ }
            }}>{_ui("恢复")}</button>
          </div>)}
          {restoreMutation.error && <p className="memory-error" role="alert">{restoreMutation.error.message}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function Shelf({
  name,
  books,
  search,
  organizing,
  desktopDragEnabled,
  desktopDropShelf,
  shelfId,
  data,
  onRead,
  act,
  children,
  placementId,
  onPlacementChange,
  onTrash,
}: {
  placementId: number | null;
  onPlacementChange: (id: number | null) => void;
  onTrash: (book: { id: number; title: string }) => void;
  name: string;
  books: Space["books"];
  search: string;
  organizing: boolean;
  desktopDragEnabled: boolean;
  desktopDropShelf: string | null;
  shelfId: string | null;
  data: Space;
  onRead: (id: number) => void;
  act: (op: MemorySpaceOperation) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const _ui = useDesktopUiText();
  const views = mixedBookViews(books);
  const visible = books.filter(book =>
    book.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  // Consecutive horizontal books share a stack; every other book keeps its own footprint.
  const groups: (typeof visible)[] = [];
  for (const book of visible) {
    const horizontal = views.get(book.id) === "horizontal";
    const previous = groups.at(-1);
    if (
      horizontal &&
      previous &&
      previous.length < 3 &&
      views.get(previous[0].id) === "horizontal"
    )
      previous.push(book);
    else groups.push([book]);
  }
  return (
    <section
      className="memory-shelf"
      aria-label={name}
      data-drop-shelf={shelfId ?? "default"}
      data-drop-target={desktopDropShelf === (shelfId ?? "default") || undefined}
    >
      <header>
        <h2>
          {name}
          <span>{books.length} {_ui("本")}</span>
        </h2>
        {children}
      </header>
      <div className="memory-book-row">
        {groups.map(group => (
          <div
            className="memory-book-stack"
            key={group[0].id}
            data-stack-view={views.get(group[0].id)}
          >
            {group.map(book => {
              const i = books.findIndex(b => b.id === book.id);
              return (
                <article
                  key={book.id}
                  className="memory-book-item"
                  data-story-id={book.id}
                  data-story-title={book.title}
                  data-binding={book.id % 5}
                  data-book-view={views.get(book.id)}
                  draggable={desktopDragEnabled}
                >
                  <MemoryBookCover
                    book={book}
                    placementOpen={placementId === book.id}
                    onPlacementOpenChange={open =>
                      onPlacementChange(open ? book.id : null)
                    }
                    onRead={() => onRead(book.id)}
                    onTrash={() => onTrash(book)}
                    onViewChange={view =>
                      void act({ kind: "setBookView", storyId: book.id, view })
                    }
                  />
                  {organizing && (
                    <div className="memory-book-arrange">
                      <select
                        aria-label={_ui("移动{0}到书架层", [book.title])}
                        value={shelfId ?? ""}
                        onChange={e =>
                          void act({
                            kind: "moveBook",
                            storyId: book.id,
                            shelfId: e.target.value || null,
                            beforeStoryId: null,
                          })
                        }
                      >
                        <option value="">{_ui("未分层")}</option>
                        {data.shelves.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {shelfId && (
                        <div>
                          <button
                            aria-label={_ui("前移{0}", [book.title])}
                            disabled={i === 0}
                            onClick={() =>
                              void act({
                                kind: "moveBook",
                                storyId: book.id,
                                shelfId,
                                beforeStoryId: books[i - 1].id,
                              })
                            }
                          >
                            <ArrowLeft size={16} />
                          </button>
                          <button
                            aria-label={_ui("后移{0}", [book.title])}
                            disabled={i === books.length - 1}
                            onClick={() =>
                              void act({
                                kind: "moveBook",
                                storyId: book.id,
                                shelfId,
                                beforeStoryId: books[i + 2]?.id ?? null,
                              })
                            }
                          >
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ))}
        {!visible.length && (
          <p className="memory-empty">
            {search ? _ui("这一层没有找到这本故事。") : _ui("故事会在这里慢慢积成一排。")}
          </p>
        )}
      </div>
    </section>
  );
}
function People({
  data,
  act,
  onRead,
}: {
  data: Space;
  act: (op: MemorySpaceOperation) => Promise<boolean>;
  onRead: (id: number) => void;
}) {
  const _ui = useDesktopUiText();
  const [selected, setSelected] = useState<string | null>(null);
  const [personForm, setPersonForm] = useState<{
    id: string;
    name: string;
    note: string;
  } | null>(null);
  const [relation, setRelation] = useState({
    from: "self",
    to: "",
    label: "朋友",
  });
  const [relationId, setRelationId] = useState<string | null>(null);
  const [newRelationId, setNewRelationId] = useState(() => crypto.randomUUID());
  const person = data.people.find(p => p.id === selected);
  const personName = (id: string) =>
    id === "self" ? "我" : (data.people.find(p => p.id === id)?.name ?? "人物");
  const showPersonForm = (p?: MemoryPerson) =>
    setPersonForm(
      p
        ? { id: p.id, name: p.name, note: p.note }
        : { id: crypto.randomUUID(), name: "", note: "" }
    );
  return (
    <div className="memory-people">
      <div className="memory-toolbar">
        <p>{_ui("一起留下故事的人")}</p>
        <button className="memory-button" onClick={() => showPersonForm()}>
          <Plus size={16} />
          {_ui("添加人物")}</button>
      </div>
      <p className="memory-hint">
        {_ui("已接受分享和参与共创的人会出现在这里。尚未接受邀请的人，可以自己记下来。")}</p>
      {personForm && (
        <form
          className="memory-form"
          onSubmit={async e => {
            e.preventDefault();
            if (await act({ kind: "savePerson", ...personForm })) {
              setSelected(personForm.id);
              setPersonForm(null);
            }
          }}
        >
          <label>
            {_ui("称呼")}<input
              required
              maxLength={80}
              value={personForm.name}
              onChange={e =>
                setPersonForm({ ...personForm, name: e.target.value })
              }
            />
          </label>
          <label>
            {_ui("备注")}<textarea
              maxLength={500}
              placeholder={_ui("例如：已邀请，等她有空一起写")}
              value={personForm.note}
              onChange={e =>
                setPersonForm({ ...personForm, note: e.target.value })
              }
            />
          </label>
          <div>
            <button className="memory-button" type="submit">
              {_ui("保存人物")}</button>
            <button
              className="memory-link"
              type="button"
              onClick={() => setPersonForm(null)}
            >
              {_ui("取消")}</button>
          </div>
        </form>
      )}
      <div className="memory-person-list">
        {data.people.map(p => (
          <button
            key={p.id}
            className="memory-person"
            aria-pressed={p.id === selected}
            onClick={() => {
              setSelected(p.id);
              setRelation({ from: "self", to: p.id, label: "朋友" });
            }}
          >
            <span className="memory-person-initial">{p.name.slice(0, 1)}</span>
            <span>
              <strong>{p.name}</strong>
              <small>
                {p.connected
                  ? _ui("{0} 篇相关故事", [new Set(p.stories.map(s => s.id)).size])
                  : _ui("我记录的人物")}
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {!data.people.length && (
        <p className="memory-empty">
          {_ui("还没有人物。邀请朋友一起写故事，或先记下一位你在意的人。")}</p>
      )}
      {person && (
        <section className="memory-person-detail">
          <header>
            <h2>{person.name}</h2>
            <button
              className="memory-link"
              onClick={() => showPersonForm(person)}
            >
              {_ui("编辑称呼与备注")}</button>
          </header>
          {person.note && <p className="memory-note">{person.note}</p>}
          {!person.connected && (
            <button
              className="memory-link"
              onClick={async () => {
                if (await act({ kind: "removePerson", id: person.id }))
                  setSelected(null);
              }}
            >
              {_ui("移除人物及关系")}</button>
          )}
          <h3>{_ui("邀请与共同创作")}</h3>
          {person.stories.map(s => (
            <div className="memory-person-story" key={`${s.id}:${s.role}`}>
              <span>
                {s.role === "accepted"
                  ? _ui("接受了我的故事分享")
                  : s.role === "invitedMe"
                    ? _ui("我接受了对方的故事分享")
                    : _ui("参与编辑")}
              </span>
              <button onClick={() => onRead(s.id)}>《{s.title}》</button>
              {s.role === "contributed" && (
                <small>
                  {data.people
                    .filter(
                      p =>
                        p.id !== person.id &&
                        p.stories.some(
                          other =>
                            other.id === s.id && other.role === "contributed"
                        )
                    )
                    .map(p => p.name)
                    .join("、") || _ui("我")}
                  {_ui("也参与了这篇故事")}</small>
              )}
            </div>
          ))}
          {!person.stories.length && (
            <p className="memory-hint">{_ui("暂时没有可确认的邀请或共创记录。")}</p>
          )}
        </section>
      )}
      {data.people.length > 0 && (
        <section className="memory-relations">
          <h2>{_ui("我标注的关系")}</h2>
          <p className="memory-hint">{_ui("这些备注只对你可见。")}</p>
          {data.relationships.map(r => (
            <div className="memory-relation" key={r.id}>
              <span>
                {personName(r.from)} <span aria-hidden="true">→</span>{" "}
                {personName(r.to)}
                <strong>{r.label}</strong>
              </span>
              <button
                className="memory-link"
                onClick={() => {
                  setRelation({ from: r.from, to: r.to, label: r.label });
                  setRelationId(r.id);
                }}
              >
                {_ui("编辑")}</button>
              <button
                aria-label={_ui("删除{0}与{1}的{2}关系", [personName(r.from), personName(r.to), r.label])}
                onClick={() => void act({ kind: "removeRelation", id: r.id })}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <form
            className="memory-form"
            onSubmit={async e => {
              e.preventDefault();
              if (
                await act({
                  kind: "saveRelation",
                  id: relationId ?? newRelationId,
                  ...relation,
                })
              ) {
                setRelationId(null);
                setNewRelationId(crypto.randomUUID());
                setRelation({ from: "self", to: "", label: "朋友" });
              }
            }}
          >
            <div className="memory-relation-fields">
              {(["from", "to"] as const).map(key => (
                <label key={key}>
                  {key === "from" ? _ui("从谁") : _ui("到谁")}
                  <select
                    required
                    value={relation[key]}
                    onChange={e =>
                      setRelation({ ...relation, [key]: e.target.value })
                    }
                  >
                    <option value="" disabled>
                      {_ui("选择人物")}</option>
                    <option value="self">{_ui("我")}</option>
                    {data.people.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              {_ui("关系")}<input
                required
                maxLength={80}
                value={relation.label}
                placeholder={_ui("家人、朋友，或自己的称呼")}
                onChange={e =>
                  setRelation({ ...relation, label: e.target.value })
                }
              />
            </label>
            <button className="memory-button" type="submit">
              {relationId ? _ui("保存关系") : _ui("添加关系")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
function MemoryReader({
  storyId,
  onBack,
  onOpenStory,
}: {
  storyId: number;
  onBack: () => void;
  onOpenStory: (id: number) => void;
}) {
  const _ui = useDesktopUiText();
  const query = trpc.memorySpace.book.useQuery(
    { storyId },
    { enabled: isPersistedStoryId(storyId), retry: false, refetchOnWindowFocus: true }
  );
  const [versionId, setVersionId] = useState("");
  const seen = trpc.memorySpace.seen.useMutation();
  const utils = trpc.useUtils();
  const marked = useRef("");
  const readingRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    readingRoot.current?.scrollIntoView({ block: "start" });
  }, [storyId]);
  const fingerprint = query.data?.fingerprint;
  useEffect(() => {
    if (!fingerprint || marked.current === fingerprint) return;
    marked.current = fingerprint;
    void seen
      .mutateAsync({ storyId, fingerprint })
      .then(() => utils.memorySpace.list.invalidate())
      .catch(() => {
        marked.current = "";
      });
  }, [fingerprint, storyId]);
  const data = query.data;
  const version =
    data?.versions.find(v => v.id === versionId) ?? data?.versions[0];
  return (
    <section
      ref={readingRoot}
      className="memory-space memory-reading"
      aria-label={_ui("故事阅读")}
    >
      <button className="memory-link" onClick={onBack}>
        <ArrowLeft size={16} />
        {_ui("回到书架")}</button>
      {query.isLoading && <p role="status">{_ui("正在翻开故事…")}</p>}
      {query.isError && (
        <p className="memory-error" role="alert">
          {_ui("暂时无法打开故事。")}<button onClick={() => void query.refetch()}>{_ui("重试")}</button>
        </p>
      )}
      {data && (
        <>
          <header>
            <p className="memory-space-eyebrow">{_ui("故事里的时光")}</p>
            <h1>{data.title}</h1>
            <button
              className="memory-button"
              onClick={() => onOpenStory(storyId)}
            >
              {_ui("进入故事编辑")}</button>
          </header>
          {data.versions.length > 0 && (
            <label className="memory-version-label">
              {_ui("阅读版本")}<select
                value={version?.id}
                onChange={e => setVersionId(e.target.value)}
              >
                {data.versions.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.author ? ` · ${v.author}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {version ? (
            <article className="memory-reading-paper">
              <p className="memory-hint">
                {version.author ? `${version.author} · ` : ""}
                {date(version.updatedAt)}
              </p>
              {version.title && version.title !== data.title && (
                <h2>{version.title}</h2>
              )}
              <div className="memory-reading-body">{version.body}</div>
            </article>
          ) : (
            <p className="memory-empty">
              {_ui("这篇故事还没有成文，可以进入故事接着聊。")}</p>
          )}
          <section className="memory-contributors">
            <h2>{_ui("参与编辑的人")}</h2>
            <p className="memory-hint">{_ui("我 · 故事作者")}</p>
            {data.participants.map((p, i) => (
              <div key={i}>
                <strong>{p.name}</strong>
                <span>
                  {p.kind === "text" ? _ui("文字") : _ui("排版")} · {p.status}
                </span>
                <time>{date(p.at)}</time>
              </div>
            ))}
            {!data.participants.length && (
              <p className="memory-hint">{_ui("还没有朋友提交的编辑记录。")}</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
