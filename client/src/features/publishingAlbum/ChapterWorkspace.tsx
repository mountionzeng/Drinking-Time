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
const DELIVERY_CANDIDATES_KEY = "chapterDelivery.candidateMap.v1";
const DELIVERY_IMPORTS_KEY = "chapterDelivery.importAttempts.v1";
type DeliveryImportAttempt = { requestId: string; mode: "keep" | "append"; storyId: number | null };
function deliveryImportAttempts(): Record<string, DeliveryImportAttempt> {
  try { const value = JSON.parse(localStorage.getItem(DELIVERY_IMPORTS_KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}
function deliveryImportAttempt(deliveryId: string, mode: DeliveryImportAttempt["mode"], storyId: number | null) {
  const attempts = deliveryImportAttempts();
  const old = attempts[deliveryId];
  if (old && old.mode === mode && old.storyId === storyId) return old;
  const next = { requestId: crypto.randomUUID(), mode, storyId };
  attempts[deliveryId] = next;
  localStorage.setItem(DELIVERY_IMPORTS_KEY, JSON.stringify(attempts));
  return next;
}
function forgetDeliveryImportAttempt(deliveryId: string) {
  const attempts = deliveryImportAttempts(); delete attempts[deliveryId];
  localStorage.setItem(DELIVERY_IMPORTS_KEY, JSON.stringify(attempts));
}
function deliveryCandidateMap(): Record<string, string> {
  try { const value = JSON.parse(localStorage.getItem(DELIVERY_CANDIDATES_KEY) || "{}"); return value && typeof value === "object" ? value : {}; }
  catch { return {}; }
}
function rememberDeliveryCandidate(packageId: string, deliveryId: string) {
  localStorage.setItem(DELIVERY_CANDIDATES_KEY, JSON.stringify({ ...deliveryCandidateMap(), [packageId]: deliveryId }));
}
function forgetDeliveryCandidate(packageId: string) {
  const value = deliveryCandidateMap(); delete value[packageId]; localStorage.setItem(DELIVERY_CANDIDATES_KEY, JSON.stringify(value));
}

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
  const deliveryEnabled = trpc.chapterDelivery.status.useQuery(undefined, { retry: false });
  const deliveryContacts = trpc.chapterDelivery.contacts.useQuery(undefined, { enabled: deliveryEnabled.data?.enabled === true, retry: false });
  const deliveryInbox = trpc.chapterDelivery.inbox.useQuery(undefined, { enabled: deliveryEnabled.data?.enabled === true, retry: false });
  const deliverySend = trpc.chapterDelivery.send.useMutation();
  const deliveryClaimLink = trpc.chapterDelivery.createClaimLink.useMutation();
  const deliveryReturn = trpc.chapterDelivery.return.useMutation();
  const deliveryResolve = trpc.chapterDelivery.resolve.useMutation();
  const deliveryImport = trpc.chapters.importPackage.useMutation();
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
  const [claimLink, setClaimLink] = useState("");
  const [deliveryPanel, setDeliveryPanel] = useState<"send" | "inbox" | null>(null);
  const [deliveryRecipient, setDeliveryRecipient] = useState("");
  const [selectedDelivery, setSelectedDelivery] = useState<{
    deliveryId: string; kind: "send" | "return"; status: string;
    package: { packageId: string; storyTitle: string; sender: { displayName: string }; chapters: Array<{ chapterId: string; title: string; blocks: Array<{ type: string; text?: string }> }> };
    imageUrls: Record<string, string>;
  } | null>(null);
  const deliveryAttempt = useRef<{ kind: "send" | "link" | "return"; requestId: string; package: unknown; images: Array<{ assetId: string; base64: string }>; recipientContactId?: string } | null>(null);
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
  function decodedBase64(value: string) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  async function uploadDeliveryAssets(result: { uploadTickets: Array<{ assetId: string; path: string; token: string; mime: string }> }, images: Array<{ assetId: string; base64: string }>) {
    const byId = new Map(images.map(image => [image.assetId, image.base64]));
    for (const ticket of result.uploadTickets) {
      const base64 = byId.get(ticket.assetId);
      if (!base64) throw new Error("图片清单不完整，请重新打包这一章");
      const url = new URL(ticket.path, window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/chapter-delivery/media/") || url.search)
        throw new Error("图片上传地址无效");
      const response = await fetch(url, { method: "PUT", redirect: "error", headers: {
        authorization: `Bearer ${ticket.token}`, "content-type": ticket.mime,
      }, body: decodedBase64(base64) });
      if (!response.ok) throw new Error("图片上传没有完成，请重试");
    }
  }
  async function createDeliveryAttempt(kind: "send" | "link" | "return") {
    if (!active) throw new Error("请先选择一章");
    const output = await exportPackage.mutateAsync({ chapterId: active.id });
    if (output.droppedImages || output.missingImageBytes) throw new Error("章节图片未能完整读取，暂未发送。请重新选择缺失图片后重试");
    return { kind, requestId: crypto.randomUUID(), package: output.package, images: output.images };
  }
  async function deliverActiveChapter(kind: "send" | "link" | "return") {
    if (!active) return;
    await run(async () => {
      let attempt = deliveryAttempt.current;
      if (!attempt || attempt.kind !== kind || (kind === "send" && attempt.recipientContactId !== deliveryRecipient)) {
        attempt = { ...(await createDeliveryAttempt(kind)), ...(kind === "send" ? { recipientContactId: deliveryRecipient } : {}) };
        deliveryAttempt.current = attempt;
      }
      const payload = { package: attempt.package, requestId: attempt.requestId };
      const result = kind === "send"
        ? await deliverySend.mutateAsync({ ...payload, recipientContactId: attempt.recipientContactId! })
        : kind === "link"
          ? await deliveryClaimLink.mutateAsync(payload)
          : await deliveryReturn.mutateAsync(payload);
      await uploadDeliveryAssets(result, attempt.images);
      await deliveryInbox.refetch();
      if (kind === "link" && "claimUrl" in result && result.claimUrl) {
        const claimUrl = new URL(String(result.claimUrl), window.location.origin);
        if (claimUrl.origin !== window.location.origin || !/^\/chapter\/claim\/[A-Za-z0-9_-]{43}$/.test(claimUrl.pathname))
          throw new Error("领取链接地址无效");
        setClaimLink(claimUrl.href);
        try {
          await navigator.clipboard.writeText(claimUrl.href);
          toast.success("领取链接已复制，可到微信小程序接收");
        } catch { toast.success("领取链接已生成，请复制下方链接"); }
      } else toast.success("章节已发送");
      deliveryAttempt.current = null;
    });
  }
  async function loadDelivery(deliveryId: string) {
    const result = await utils.chapterDelivery.read.fetch({ deliveryId });
    setSelectedDelivery({ ...result, deliveryId, kind: result.delivery.kind, status: result.delivery.status });
  }
  async function importDelivery(mode: "keep" | "append") {
    if (!selectedDelivery) return;
    await run(async () => {
      const deliveryId = selectedDelivery.deliveryId;
      const currentStoryId = mode === "append" ? props.storyId : null;
      const attempt = deliveryImportAttempt(deliveryId, mode, currentStoryId);
      // Refresh short-lived media capabilities before retries. The import
      // request id and destination stay fixed until both import and resolution
      // have a durable receipt.
      const fresh = await utils.chapterDelivery.read.fetch({ deliveryId });
      setSelectedDelivery({ ...fresh, deliveryId, kind: fresh.delivery.kind, status: fresh.delivery.status });
      const images: Array<{ assetId: string; base64: string }> = [];
      for (const [assetId, url] of Object.entries(fresh.imageUrls)) {
        const target = new URL(url, window.location.origin);
        if (target.origin !== window.location.origin || !target.pathname.startsWith("/api/chapter-delivery/media/download/"))
          throw new Error("图片读取地址无效");
        const response = await fetch(target, { credentials: "same-origin", redirect: "error" });
        if (!response.ok) throw new Error("章节图片读取失败，请重试");
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        images.push({ assetId, base64: btoa(binary) });
      }
      const result = await deliveryImport.mutateAsync({
        requestId: attempt.requestId, mode, storyId: currentStoryId ?? undefined,
        package: fresh.package, images,
      });
      if (result.outcome === "candidate") {
        rememberDeliveryCandidate(fresh.package.packageId, deliveryId);
        forgetDeliveryImportAttempt(deliveryId);
      } else {
        await deliveryResolve.mutateAsync({ deliveryId, status: result.outcome === "append" ? "appended" : "kept" });
        forgetDeliveryImportAttempt(deliveryId);
      }
      setSelectedDelivery(null); setDeliveryPanel(null);
      await deliveryInbox.refetch();
      if (result.storyId === props.storyId) {
        await state.reloadList();
        if (result.chapterId) { await state.open(result.chapterId); await utils.chapters.candidates.invalidate({ chapterId: result.chapterId }); }
      }
      toast.success(result.outcome === "candidate" ? "已生成回发候选，请对照后采用" : "章节已导入");
    });
  }
  const selectedIndex = state.chapters.findIndex(
    chapter => chapter.id === active?.id
  );
  const pending =
    candidates.data?.candidates.filter(
      candidate => candidate.status === "pending"
    ) ?? [];
  const candidate = pending.find(item => item.id === comparison?.id);
  useEffect(() => {
    for (const item of candidates.data?.candidates ?? []) {
      if (item.status === "pending") continue;
      const deliveryId = deliveryCandidateMap()[item.packageId];
      if (!deliveryId) continue;
      void deliveryResolve.mutateAsync({ deliveryId, status: item.status === "adopted" ? "adopted" : "declined" })
        .then(() => forgetDeliveryCandidate(item.packageId))
        .catch(() => toast.error("章节已处理，收件箱状态稍后重试同步"));
    }
  }, [candidates.data?.candidates]);
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
            onChange={event => {
              const chapterId = Number(event.target.value);
              void run(() => state.open(chapterId));
            }}
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
                await versions.refetch();
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
      {deliveryEnabled.data?.enabled && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--panel-border)] pt-3" aria-label="章节投递">
          <button className={button} disabled={busy || !active} onClick={() => {
            setDeliveryPanel("send");
            setDeliveryRecipient(deliveryContacts.data?.[0]?.contactId ?? "");
            setSelectedDelivery(null);
          }}>发送到微信 / 亲友</button>
          {active?.blocks.lineage?.parentPackageId && (
            <button className={button} disabled={busy} onClick={() => void deliverActiveChapter("return")}>发回修改稿</button>
          )}
          <button className={button} disabled={busy} onClick={() => {
            setDeliveryPanel("inbox"); setSelectedDelivery(null);
            void deliveryInbox.refetch();
          }}>收件箱{deliveryInbox.data?.length ? `（${deliveryInbox.data.filter(row => row.status === "pending").length}）` : ""}</button>
        </div>
      )}
      {deliveryPanel === "send" && (
        <section className="space-y-2 rounded-xl border p-3" aria-label="投递章节">
          <p className="text-sm">发送当前章节的文字与图片，接收后保留为独立版本。</p>
          <label className="block space-y-1 text-xs">收件人
            <select className={`${field} w-full`} value={deliveryRecipient} onChange={event => setDeliveryRecipient(event.target.value)}>
              {(deliveryContacts.data ?? []).map(contact => <option key={contact.contactId} value={contact.contactId}>{contact.displayName}</option>)}
            </select>
          </label>
          <button className={button} disabled={busy || !deliveryRecipient} onClick={() => void deliverActiveChapter("send")}>发送给这位亲友</button>{" "}
          <button className={button} disabled={busy} onClick={() => void deliverActiveChapter("link")}>生成微信领取链接</button>{" "}
          <button className={button} onClick={() => { setDeliveryPanel(null); deliveryAttempt.current = null; }}>关闭</button>
          {claimLink && <div role="status" className="space-y-2 rounded-lg bg-[var(--panel-bg)] p-3">
            <p className="text-sm">领取链接已准备好</p>
            <label className="block text-xs">微信领取链接
              <input className={`${field} mt-1 w-full`} readOnly value={claimLink} onFocus={event => event.currentTarget.select()} />
            </label>
            <button className={button} onClick={() => { void navigator.clipboard.writeText(claimLink).then(() => toast.success("链接已复制")).catch(() => toast.error("请选中上方链接复制")); }}>复制领取链接</button>
            <p className="text-xs">在拾光小程序打开书稿，点「更多 → 接收网页故事」，粘贴链接后接收。链接只能由一个账号领取。</p>
          </div>}
          {!deliveryContacts.data?.length && <p role="status" className="text-xs text-muted-foreground">目前没有可投递的已连接联系人。</p>}
        </section>
      )}
      {deliveryPanel === "inbox" && (
        <section className="space-y-3 rounded-xl border p-3" aria-label="章节投递收件箱">
          <div className="flex items-center justify-between"><h3 className="text-sm font-medium">章节投递收件箱</h3><button className={button} onClick={() => void deliveryInbox.refetch()}>刷新</button></div>
          {deliveryInbox.isPending && <p role="status" className="text-xs">正在读取收件箱…</p>}
          {deliveryInbox.error && <p role="alert" className="text-xs">收件箱暂时无法读取，请重试。</p>}
          {!deliveryInbox.isPending && !(deliveryInbox.data?.length) && <p className="text-xs text-muted-foreground">收件箱里还没有章节。</p>}
          <ul className="space-y-2">
            {(deliveryInbox.data ?? []).filter(row => row.status === "pending").map(row => (
              <li key={row.deliveryId} className="flex items-center justify-between gap-2 text-xs">
                <span>{row.kind === "return" ? "发回的修改稿" : "收到的章节"} · {new Date(row.createdAt).toLocaleDateString()}</span>
                <button className={button} disabled={busy} onClick={() => {
                  void loadDelivery(row.deliveryId).catch(() => toast.error("章节内容暂时无法读取，请重试"));
                }}>查看</button>
              </li>
            ))}
          </ul>
          {selectedDelivery && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm">{selectedDelivery.package.sender.displayName} 发来的「{selectedDelivery.package.chapters[0]?.title || selectedDelivery.package.storyTitle}」</p>
              {selectedDelivery.kind === "return" ? (
                <>
                  <p className="text-xs text-muted-foreground">先与原章节对照，确认采用后才生成新版本；旧版本会保留。</p>
                  <button className={button} disabled={busy} onClick={() => void importDelivery("append")}>与原章节对照</button>{" "}
                </>
              ) : (
                <>
                  <button className={button} disabled={busy} onClick={() => void importDelivery("keep")}>留下成新故事</button>{" "}
                  <button className={button} disabled={busy} onClick={() => void importDelivery("append")}>加入当前故事末尾</button>{" "}
                </>
              )}
              <button className={button} disabled={busy} onClick={() => void run(async () => {
                await deliveryResolve.mutateAsync({ deliveryId: selectedDelivery.deliveryId, status: "declined" });
                setSelectedDelivery(null); await deliveryInbox.refetch();
              })}>拒绝</button>
            </div>
          )}
          <button className={button} onClick={() => { setDeliveryPanel(null); setSelectedDelivery(null); }}>关闭收件箱</button>
        </section>
      )}
    </div>
  );
}
