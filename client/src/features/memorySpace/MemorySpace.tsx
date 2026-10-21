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
import { MemoryBookCover } from "./MemoryBookPreview";
import "./memorySpace.css";

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
}: {
  onOpenStory: (id: number) => void;
  onOpenNotes: () => void;
}) {
  const accountId = useStorySpine(s => s.accountId);
  return (
    <MemorySpaceContent
      key={accountId ?? "guest"}
      accountId={accountId}
      onOpenStory={onOpenStory}
      onOpenNotes={onOpenNotes}
    />
  );
}
function MemorySpaceContent({
  accountId,
  onOpenStory,
  onOpenNotes,
}: {
  accountId: number | null;
  onOpenStory: (id: number) => void;
  onOpenNotes: () => void;
}) {
  const [tab, setTab] = useState<"stories" | "people">("stories");
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
    <section className="memory-space" aria-label="回忆书架与人物">
      <header className="memory-space-heading">
        <div>
          <p className="memory-space-eyebrow">留在这里的时光</p>
          <h1>回忆</h1>
        </div>
        <button className="memory-link" onClick={onOpenNotes}>
          记事工具
        </button>
      </header>
      <nav className="memory-tabs" aria-label="回忆分类">
        <button
          aria-pressed={tab === "stories"}
          onClick={() => setTab("stories")}
        >
          <BookOpen size={18} />
          故事
        </button>
        <button
          aria-pressed={tab === "people"}
          onClick={() => setTab("people")}
        >
          <Users size={18} />人
        </button>
      </nav>
      {error && (
        <p className="memory-error" role="alert">
          {error}
        </p>
      )}
      {query.isError && (
        <p className="memory-error" role="alert">
          暂时无法读取回忆。
          <button onClick={() => void query.refetch()}>重新加载</button>
        </p>
      )}
      {!data && query.isLoading && <p role="status">正在打开回忆…</p>}
      {data && (
        <fieldset className="memory-controls" disabled={change.isPending}>
          {tab === "stories" ? (
            <>
              <div className="memory-toolbar">
                <input
                  aria-label="搜索故事"
                  placeholder="找一本故事…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <button
                  className="memory-button"
                  onClick={() => setOrganizing(!organizing)}
                >
                  {organizing ? <Check size={15} /> : <Pencil size={15} />}
                  {organizing ? "整理好了" : "整理书架"}
                </button>
              </div>
              <div className="memory-view-bar">
                <div className="memory-view-intro">
                  <span>我的藏书</span>
                  <small>{data.books.length} 本故事，慢慢收藏</small>
                </div>
                <div
                  className="memory-view-options"
                  role="group"
                  aria-label="书本默认摆放方式"
                >
                  {(
                    [
                      ["horizontal", "横向书脊"],
                      ["vertical", "纵向书脊"],
                      ["album", "画册"],
                    ] as const
                  ).map(([view, label]) => (
                    <button
                      key={view}
                      aria-pressed={(data.shelfView ?? "vertical") === view}
                      onClick={() => void act({ kind: "setShelfView", view })}
                    >
                      <span
                        aria-hidden="true"
                        className={`memory-view-icon memory-view-icon--${view}`}
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
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
                    书架层名称
                    <input
                      autoFocus
                      maxLength={80}
                      required
                      value={shelfName}
                      onChange={e => setShelfName(e.target.value)}
                    />
                  </label>
                  <div>
                    <button className="memory-button" type="submit">
                      保存
                    </button>
                    <button
                      className="memory-link"
                      type="button"
                      onClick={() => setAddingShelf(false)}
                    >
                      取消
                    </button>
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
                  加一层书架
                </button>
              )}
              <div
                className="memory-shelves"
                data-view={data.shelfView ?? "vertical"}
                data-organizing={organizing}
              >
                {data.shelves.map((shelf, index) => (
                  <Shelf
                    key={shelf.id}
                    name={shelf.name}
                    books={booksOnShelf(data, shelf.id)}
                    search={search}
                    organizing={organizing}
                    data={data}
                    shelfId={shelf.id}
                    onRead={setStoryId}
                    act={act}
                  >
                    {organizing && (
                      <div className="memory-shelf-actions">
                        <button
                          aria-label={`上移${shelf.name}`}
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
                          aria-label={`下移${shelf.name}`}
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
                          改名
                        </button>
                        <button
                          onClick={() =>
                            void act({ kind: "removeShelf", id: shelf.id })
                          }
                        >
                          移除层
                        </button>
                      </div>
                    )}
                  </Shelf>
                ))}
                <Shelf
                  name={data.shelves.length ? "未分层" : "我的故事"}
                  books={booksOnShelf(data, null)}
                  search={search}
                  organizing={organizing}
                  data={data}
                  shelfId={null}
                  onRead={setStoryId}
                  act={act}
                />
              </div>
              {organizing && (
                <p className="memory-hint">
                  移除书架层后，故事会回到未分层。故事内容不会删除。
                </p>
              )}
            </>
          ) : (
            <People data={data} act={act} onRead={setStoryId} />
          )}
        </fieldset>
      )}
    </section>
  );
}
function Shelf({
  name,
  books,
  search,
  organizing,
  shelfId,
  data,
  onRead,
  act,
  children,
}: {
  name: string;
  books: Space["books"];
  search: string;
  organizing: boolean;
  shelfId: string | null;
  data: Space;
  onRead: (id: number) => void;
  act: (op: MemorySpaceOperation) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const visible = books.filter(book =>
    book.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <section className="memory-shelf" aria-label={name}>
      <header>
        <h2>
          {name}
          <span>{books.length} 本</span>
        </h2>
        {children}
      </header>
      <div className="memory-book-row">
        {Array.from({ length: Math.ceil(visible.length / 3) }, (_, group) => (
          <div className="memory-book-stack" key={group}>
            {visible.slice(group * 3, group * 3 + 3).map(book => {
              const i = books.findIndex(b => b.id === book.id);
              return (
                <article
                  key={book.id}
                  className="memory-book-item"
                  data-binding={book.id % 5}
                  data-book-view={book.view ?? data.shelfView ?? "vertical"}
                >
                  <MemoryBookCover
                    book={book}
                    onRead={() => onRead(book.id)}
                    onViewChange={view =>
                      void act({ kind: "setBookView", storyId: book.id, view })
                    }
                  />
                  {organizing && (
                    <div className="memory-book-arrange">
                      <select
                        aria-label={`移动${book.title}到书架层`}
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
                        <option value="">未分层</option>
                        {data.shelves.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      {shelfId && (
                        <div>
                          <button
                            aria-label={`前移${book.title}`}
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
                            aria-label={`后移${book.title}`}
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
            {search ? "这一层没有找到这本故事。" : "故事会在这里慢慢积成一排。"}
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
        <p>一起留下故事的人</p>
        <button className="memory-button" onClick={() => showPersonForm()}>
          <Plus size={16} />
          添加人物
        </button>
      </div>
      <p className="memory-hint">
        已接受分享和参与共创的人会出现在这里。尚未接受邀请的人，可以自己记下来。
      </p>
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
            称呼
            <input
              required
              maxLength={80}
              value={personForm.name}
              onChange={e =>
                setPersonForm({ ...personForm, name: e.target.value })
              }
            />
          </label>
          <label>
            备注
            <textarea
              maxLength={500}
              placeholder="例如：已邀请，等她有空一起写"
              value={personForm.note}
              onChange={e =>
                setPersonForm({ ...personForm, note: e.target.value })
              }
            />
          </label>
          <div>
            <button className="memory-button" type="submit">
              保存人物
            </button>
            <button
              className="memory-link"
              type="button"
              onClick={() => setPersonForm(null)}
            >
              取消
            </button>
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
                  ? `${new Set(p.stories.map(s => s.id)).size} 篇相关故事`
                  : "我记录的人物"}
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {!data.people.length && (
        <p className="memory-empty">
          还没有人物。邀请朋友一起写故事，或先记下一位你在意的人。
        </p>
      )}
      {person && (
        <section className="memory-person-detail">
          <header>
            <h2>{person.name}</h2>
            <button
              className="memory-link"
              onClick={() => showPersonForm(person)}
            >
              编辑称呼与备注
            </button>
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
              移除人物及关系
            </button>
          )}
          <h3>邀请与共同创作</h3>
          {person.stories.map(s => (
            <div className="memory-person-story" key={`${s.id}:${s.role}`}>
              <span>
                {s.role === "accepted"
                  ? "接受了我的故事分享"
                  : s.role === "invitedMe"
                    ? "我接受了对方的故事分享"
                    : "参与编辑"}
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
                    .join("、") || "我"}
                  也参与了这篇故事
                </small>
              )}
            </div>
          ))}
          {!person.stories.length && (
            <p className="memory-hint">暂时没有可确认的邀请或共创记录。</p>
          )}
        </section>
      )}
      {data.people.length > 0 && (
        <section className="memory-relations">
          <h2>我标注的关系</h2>
          <p className="memory-hint">这些备注只对你可见。</p>
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
                编辑
              </button>
              <button
                aria-label={`删除${personName(r.from)}与${personName(r.to)}的${r.label}关系`}
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
                  {key === "from" ? "从谁" : "到谁"}
                  <select
                    required
                    value={relation[key]}
                    onChange={e =>
                      setRelation({ ...relation, [key]: e.target.value })
                    }
                  >
                    <option value="" disabled>
                      选择人物
                    </option>
                    <option value="self">我</option>
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
              关系
              <input
                required
                maxLength={80}
                value={relation.label}
                placeholder="家人、朋友，或自己的称呼"
                onChange={e =>
                  setRelation({ ...relation, label: e.target.value })
                }
              />
            </label>
            <button className="memory-button" type="submit">
              {relationId ? "保存关系" : "添加关系"}
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
  const query = trpc.memorySpace.book.useQuery(
    { storyId },
    { retry: false, refetchOnWindowFocus: true }
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
      aria-label="故事阅读"
    >
      <button className="memory-link" onClick={onBack}>
        <ArrowLeft size={16} />
        回到书架
      </button>
      {query.isLoading && <p role="status">正在翻开故事…</p>}
      {query.isError && (
        <p className="memory-error" role="alert">
          暂时无法打开故事。
          <button onClick={() => void query.refetch()}>重试</button>
        </p>
      )}
      {data && (
        <>
          <header>
            <p className="memory-space-eyebrow">故事里的时光</p>
            <h1>{data.title}</h1>
            <button
              className="memory-button"
              onClick={() => onOpenStory(storyId)}
            >
              进入故事编辑
            </button>
          </header>
          {data.versions.length > 0 && (
            <label className="memory-version-label">
              阅读版本
              <select
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
              这篇故事还没有成文，可以进入故事接着聊。
            </p>
          )}
          <section className="memory-contributors">
            <h2>参与编辑的人</h2>
            <p className="memory-hint">我 · 故事作者</p>
            {data.participants.map((p, i) => (
              <div key={i}>
                <strong>{p.name}</strong>
                <span>
                  {p.kind === "text" ? "文字" : "排版"} · {p.status}
                </span>
                <time>{date(p.at)}</time>
              </div>
            ))}
            {!data.participants.length && (
              <p className="memory-hint">还没有朋友提交的编辑记录。</p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
