import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { ModuleDocument } from "@shared/sharedLayout";
import type { PublishingImagePackCanvas } from "./PublishingImagePack";
import { useChapters, type Chapter, type ChapterEdit } from "./useChapters";
import { parseChapterFile, CHAPTER_FILE_MAX_BYTES } from "./chapterFile";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";
import { ChapterComparison } from "./ChapterComparison";

const button =
  "rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";
const field = `${button} bg-transparent text-sm`;
type Props = ComponentProps<typeof PublishingImagePackCanvas>;

export function mapChapterImages(
  layout: ModuleDocument | null,
  urls: Record<string, string>
): ModuleDocument | null {
  return layout
    ? {
        ...layout,
        pages: layout.pages.map(page => ({
          ...page,
          modules: page.modules.map(module =>
            module.kind === "image"
              ? {
                  ...module,
                  imageUrl: urls[module.imageUrl] ?? module.imageUrl,
                }
              : module
          ),
        })),
      }
    : null;
}

export function ChapterWorkspace({
  render,
  ...props
}: Props & { render(props: Props): ReactNode }) {
  const state = useChapters(props.storyId);
  const { active } = state;
  const utils = trpc.useUtils();
  const create = trpc.chapters.create.useMutation();
  const save = trpc.chapters.save.useMutation();
  const remove = trpc.chapters.remove.useMutation();
  const reorder = trpc.chapters.reorder.useMutation();
  const exportPackage = trpc.chapters.exportPackage.useMutation();
  const importPackage = trpc.chapters.importPackage.useMutation();
  const restore = trpc.chapters.restoreVersion.useMutation();
  const resolve = trpc.chapters.resolveCandidate.useMutation();
  const candidates = trpc.chapters.candidates.useQuery(
    { chapterId: active?.id ?? 0 },
    { enabled: Boolean(active), retry: false }
  );
  const versions = trpc.chapters.versions.useQuery(
    { chapterId: active?.id ?? 0 },
    { enabled: Boolean(active), retry: false }
  );
  const prepare = useRef<(() => Promise<void>) | null>(null);
  const lock = useRef(false);
  const seeded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    kind: "new" | "edit";
    title: string;
    body: string;
  } | null>(null);
  const [file, setFile] = useState<
    | (ReturnType<typeof parseChapterFile> & {
        requestId: string;
        mode?: "keep" | "append";
      })
    | null
  >(null);
  const [importedStory, setImportedStory] = useState<number | null>(null);
  const [comparison, setComparison] = useState<{
    id: number;
    current: Chapter;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const change = useCallback(
    (edit: ChapterEdit) => {
      if (!active) return;
      const keys = Object.fromEntries(
        Object.entries(state.imageUrls).map(([key, url]) => [url, key])
      );
      const keyOf = (value: string | null) =>
        value ? (keys[value] ?? value) : null;
      state.change(active.id, {
        ...edit,
        layout: mapChapterImages(edit.layout, keys),
        media: edit.media
          ? {
              coverKey: keyOf(edit.media.coverKey),
              bodyTextureKey: keyOf(edit.media.bodyTextureKey),
              illustrations: edit.media.illustrations.map(item => {
                const key = keyOf(item.key)!;
                const original = active.blocks.illustrations.find(
                  image => image.key === key
                );
                return { ...original, ...item, key };
              }),
            }
          : undefined,
      });
    },
    [active, state.imageUrls, state.change]
  );
  async function run(action: () => Promise<void>, flush = true) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (flush) {
        await prepare.current?.();
        if (state.error) throw new Error(state.error);
        await state.flush();
      }
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Seed once per mounted story. A failure is explicit and can be retried from the toolbar.
  useEffect(() => {
    if (
      props.coverBusy ||
      state.loading ||
      state.queryError ||
      state.chapters.length ||
      seeded.current ||
      !props.body.trim()
    )
      return;
    seeded.current = true;
    void run(async () => {
      await create.mutateAsync({
        storyId: props.storyId,
        title: props.title.trim().slice(0, 200) || "第 1 章",
        body: props.body,
        draftSource: props.scope,
        containsAiText: true,
      });
      await state.reloadList();
    }, false);
  }, [state.loading, state.queryError, state.chapters.length, props.coverBusy]);
  // Only the explicitly marked source can update its mirror. The server checks
  // the marker again after any pending editor saves have disconnected it.
  useEffect(() => {
    if (
      props.coverBusy ||
      !active?.blocks.draftMirror ||
      active.blocks.draftMirror.source !== props.scope
    )
      return;
    const title = props.title.trim().slice(0, 200) || active.title;
    if (title === active.title && props.body === active.blocks.body) return;
    const timer = setTimeout(() => {
      void run(async () => {
        await save.mutateAsync({
          chapterId: active.id,
          expectedVersion: state.version(),
          body: props.body,
          title,
          mirrorFrom: props.scope,
        });
        await state.refresh();
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    active?.id,
    active?.blocks.draftMirror,
    props.scope,
    props.title,
    props.body,
    props.coverBusy,
  ]);

  async function move(direction: -1 | 1) {
    if (!active) return;
    const order = state.chapters.map(chapter => chapter.id);
    const from = order.indexOf(active.id);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    await reorder.mutateAsync({ storyId: props.storyId, order });
    await state.reloadList();
  }
  async function download() {
    if (!active) return;
    const output = await exportPackage.mutateAsync({ chapterId: active.id });
    const missing = output.droppedImages + output.missingImageBytes;
    if (missing)
      toast.message(`有 ${missing} 张图片无法打包，文件保留其余内容`);
    downloadPublishingAlbumBlob(
      new Blob(
        [JSON.stringify({ package: output.package, images: output.images })],
        { type: "application/json" }
      ),
      `${active.title.replace(/[\\/:*?"<>|]/g, "_")}.chapter.json`
    );
  }
  async function importFile(mode: "keep" | "append") {
    if (!file) return;
    // Once submitted, retries use the same mode, payload and requestId.
    setFile({ ...file, mode });
    const result = await importPackage.mutateAsync({
      ...file,
      mode,
      storyId: mode === "append" ? props.storyId : undefined,
    });
    setFile(null);
    if (result.missingImages)
      toast.message(`已导入；${result.missingImages} 张图片未随文件传入`);
    else
      toast.success(
        result.outcome === "candidate"
          ? "已收到发回候选，可对照后采用"
          : "章节已导入"
      );
    if (result.storyId === props.storyId) {
      await state.reloadList();
      if (result.chapterId) {
        await state.open(result.chapterId);
        await utils.chapters.candidates.invalidate({
          chapterId: result.chapterId,
        });
      }
    } else setImportedStory(result.storyId);
  }
  const selectedIndex = state.chapters.findIndex(
    chapter => chapter.id === active?.id
  );
  const pending =
    candidates.data?.candidates.filter(
      candidate => candidate.status === "pending"
    ) ?? [];
  const candidate = pending.find(item => item.id === comparison?.id);
  return (
    <div className="space-y-3" aria-label="故事章节">
      <nav
        aria-label="章节栏"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] pb-3"
      >
        <label className="text-xs">
          章节{" "}
          <select
            className={field}
            aria-label="当前章节"
            value={active?.id ?? ""}
            disabled={busy || state.loading || Boolean(editing)}
            onChange={event =>
              void run(() => state.open(Number(event.target.value)))
            }
          >
            {!active && (
              <option value="">
                {state.loading ? "正在读取…" : "暂无章节"}
              </option>
            )}
            {state.chapters.map((chapter, index) => (
              <option key={chapter.id} value={chapter.id}>
                {index + 1}. {chapter.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            setEditing({
              kind: "new",
              title: `第 ${state.chapters.length + 1} 章`,
              body: "",
            })
          }
        >
          新增章节
        </button>
        {active && (
          <>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const latest = await utils.chapters.get.fetch({
                    chapterId: active.id,
                  });
                  setEditing({
                    kind: "edit",
                    title: latest.chapter.title,
                    body: latest.chapter.blocks.body,
                  });
                })
              }
            >
              编辑章节
            </button>
            <button
              className={button}
              disabled={busy || selectedIndex <= 0}
              onClick={() => void run(() => move(-1))}
            >
              上移
            </button>
            <button
              className={button}
              disabled={busy || selectedIndex === state.chapters.length - 1}
              onClick={() => void run(() => move(1))}
            >
              下移
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `删除「${active.title}」？这一章和旧版本会一起删除。`
                  )
                )
                  void run(async () => {
                    await remove.mutateAsync({ chapterId: active.id });
                    await state.reloadList();
                  });
              }}
            >
              删除章节
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => void run(download)}
            >
              打包这一章
            </button>
          </>
        )}
        <button
          className={button}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          导入章节包
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="选择章节包文件"
          onChange={event => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (!chosen) return;
            void run(async () => {
              if (chosen.size > CHAPTER_FILE_MAX_BYTES)
                throw new Error("章节文件超过 12 MB");
              setFile({
                ...parseChapterFile(await chosen.text()),
                requestId: crypto.randomUUID(),
              });
            }, false);
          }}
        />
        <span role="status" className="text-xs text-muted-foreground">
          {busy || state.saving
            ? "正在保存…"
            : state.error
              ? "保存已暂停"
              : "按章保存"}
        </span>
      </nav>
      {(state.error || state.queryError) && (
        <p role="alert" className="text-sm text-destructive">
          {state.error || state.queryError}。本机草稿仍保留。
          <button
            className={button}
            onClick={() => {
              if (
                window.confirm(
                  "重新读取服务端版本？未保存的本机排版仍留在原缓存中。"
                )
              )
                void run(state.refresh, false);
            }}
          >
            重新读取
          </button>
        </p>
      )}
      {editing && (
        <form
          className="space-y-2"
          onSubmit={event => {
            event.preventDefault();
            void run(async () => {
              if (editing.kind === "new") {
                const chapter = await create.mutateAsync({
                  storyId: props.storyId,
                  title: editing.title,
                  body: editing.body,
                });
                await state.reloadList();
                await state.open(chapter.id);
              } else if (active) {
                await save.mutateAsync({
                  chapterId: active.id,
                  expectedVersion: state.version(),
                  title: editing.title,
                  body: editing.body,
                });
                await state.refresh();
              }
              setEditing(null);
            });
          }}
        >
          <input
            aria-label="章节标题"
            className={`${field} w-full`}
            maxLength={200}
            required
            value={editing.title}
            onChange={event =>
              setEditing({ ...editing, title: event.target.value })
            }
          />
          <textarea
            aria-label="章节正文"
            className={`${field} w-full`}
            rows={8}
            maxLength={200000}
            value={editing.body}
            onChange={event =>
              setEditing({ ...editing, body: event.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            每行一个正文块。独立改字后，这一章将不再跟随平台稿。
          </p>
          <button className={button} disabled={busy}>
            保存章节
          </button>{" "}
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            取消
          </button>
        </form>
      )}
      {file && (
        <section className="space-y-2" aria-label="导入方式">
          <p className="text-sm">
            「{file.package.storyTitle}」· {file.package.chapters.length} 章
          </p>
          <button
            className={button}
            disabled={busy || (file.mode !== undefined && file.mode !== "keep")}
            onClick={() => void run(() => importFile("keep"))}
          >
            留下成新故事
          </button>{" "}
          <button
            className={button}
            disabled={
              busy || (file.mode !== undefined && file.mode !== "append")
            }
            onClick={() => void run(() => importFile("append"))}
          >
            加入当前故事末尾
          </button>{" "}
          <button
            className={button}
            disabled={busy}
            onClick={() => setFile(null)}
          >
            取消
          </button>
          <p className="text-xs text-muted-foreground">
            自己发出的章节包及其发回版本会进入原章节的候选列表。
          </p>
        </section>
      )}
      {importedStory && (
        <p role="status" className="text-sm">
          已保存为新故事。
          <a className="underline" href={`/editing?storyId=${importedStory}`}>
            打开新故事，再进入图像与排版
          </a>
        </p>
      )}
      {active && (
        <>
          {pending.map(item => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <span>
                {item.senderName} 发回了「{item.title}」
              </span>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const latest = await utils.chapters.get.fetch({
                      chapterId: active.id,
                    });
                    setComparison({ id: item.id, current: latest.chapter });
                  })
                }
              >
                对照文字与排版
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await resolve.mutateAsync({
                      candidateId: item.id,
                      status: "dismissed",
                    });
                    await candidates.refetch();
                  })
                }
              >
                忽略
              </button>
            </div>
          ))}
          {candidate && (
            <section aria-label="发回候选对照" className="space-y-2">
              <ChapterComparison
                current={comparison!.current}
                candidate={candidate}
                currentUrls={state.imageUrls}
                candidateUrls={candidates.data?.imageUrls ?? {}}
              />
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await resolve.mutateAsync({
                      candidateId: candidate.id,
                      status: "adopted",
                      expectedVersion: comparison!.current.version,
                    });
                    await state.refresh();
                    await candidates.refetch();
                    await versions.refetch();
                    setComparison(null);
                  })
                }
              >
                采用这个版本
              </button>{" "}
              <button className={button} onClick={() => setComparison(null)}>
                收起
              </button>
            </section>
          )}
          {!!versions.data?.length && (
            <details>
              <summary className="cursor-pointer text-xs">
                找回旧版本（最近 {versions.data.length} 版）
              </summary>
              <ul className="space-y-2 py-2">
                {versions.data.map(version => (
                  <li key={version.version} className="flex gap-2 text-xs">
                    <span>
                      版本 {version.version} · {version.title}
                    </span>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `恢复版本 ${version.version}？当前版本也会保留。`
                          )
                        )
                          void run(async () => {
                            await restore.mutateAsync({
                              chapterId: active.id,
                              version: version.version,
                              expectedVersion: state.version(),
                            });
                            await state.refresh();
                            await versions.refetch();
                          });
                      }}
                    >
                      恢复
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {render({
            ...props,
            scope: `chapter:${props.accountId ?? "current"}:${props.storyId}:${active.id}:v${active.version}:${state.epoch}`,
            title: active.title,
            body: active.blocks.body,
            hasAlbum: false,
            adoptedCoverId:
              !active.layout &&
              active.blocks.draftMirror?.source === props.scope
                ? props.adoptedCoverId
                : null,
            onGenerateCover: undefined,
            onGenerateIllustration: undefined,
            onGenerateTexture: undefined,
            onIllustrationsChange: undefined,
            onOpenCoverStudio: undefined,
            advancedEditor: undefined,
            advancedOpen: false,
            chapterSession: {
              initial: mapChapterImages(active.layout, state.imageUrls),
              settings: active.blocks.settings,
              change,
              prepare,
              legacyScope:
                !active.layout &&
                active.blocks.draftMirror?.source === props.scope
                  ? props.scope
                  : undefined,
              imageOptions: {
                coverUrl: active.blocks.coverKey
                  ? (state.imageUrls[active.blocks.coverKey] ??
                    active.blocks.coverKey)
                  : undefined,
                bodyTextureUrl: active.blocks.bodyTextureKey
                  ? (state.imageUrls[active.blocks.bodyTextureKey] ??
                    active.blocks.bodyTextureKey)
                  : undefined,
                illustrations: active.blocks.illustrations.map(item => ({
                  after: item.after,
                  imageUrl: state.imageUrls[item.key] ?? item.key,
                })),
              },
            },
          } as Props)}
        </>
      )}
    </div>
  );
}
