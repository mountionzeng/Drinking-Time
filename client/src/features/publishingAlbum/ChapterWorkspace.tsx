import { sameWritingStyle } from "@shared/bookWritingStyle";
import type { ChapterWritingDraft } from "./chapterWritingDraft";
import { storyLibraryImages } from "./storyImageLibrary";
import { BookImageGenerator } from "./BookImageGenerator";
import { ChapterWriting, type ChapterWritingHandle } from "./ChapterWriting";
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
import { ChapterComparison } from "./ChapterComparison";

const button =
  "rounded-lg border border-[var(--panel-border)] px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";
const field = `${button} bg-transparent text-sm`;
type Props = ComponentProps<typeof PublishingImagePackCanvas>;
import { deliveryImportAttempt, forgetDeliveryImportAttempt, deliveryCandidateMap, rememberDeliveryCandidate, forgetDeliveryCandidate, readDeliveryImages } from "./chapterDeliveryImport";

export function chapterImageAssets(chapter: Chapter, urls: Record<string, string>): Props["assets"] {
  return Object.keys(chapter.blocks.images).map((key, index) => {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const cover = key === chapter.blocks.coverKey;
    const background = key === chapter.blocks.bodyTextureKey;
    return {
      id: -4_000_000_000_000 - hash,
      imageUrl: urls[key] ?? key,
      sourceLabel: chapter.blocks.attribution?.sourceName ? "收到的图片" : "章节图片",
      label: `${chapter.blocks.attribution?.sourceName || "章节"} · ${cover ? "封面" : background ? "底图" : "插图"} ${index + 1}`,
      ...(cover ? {} : { kind: background ? "body-texture" as const : "illustration" as const }),
    };
  });
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
  mode = "images",
  ...props
}: Props & { mode?: "text" | "images"; render(props: Props): ReactNode }) {
  const [displayMode, setDisplayMode] = useState(mode);
  const writing = useRef<ChapterWritingHandle | null>(null);
  const state = useChapters(props.storyId, latest => displayMode !== 'text' || writing.current?.releaseCleanDraft(latest) === true);
  const { active } = state;
  const [writingDraft, setWritingDraft] = useState<ChapterWritingDraft | null>(null);
  const localDraftConflict = active && writingDraft && (writingDraft.title !== active.title || writingDraft.body !== active.blocks.body || !sameWritingStyle(writingDraft.writingStyle,active.blocks.writingStyle)) && writingDraft.baseVersion !== active.version;
  const newerVersion = state.externalVersion ?? (localDraftConflict ? active?.version : null);
  const [generatedOpen, setGeneratedOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const latestLayout = useRef<ChapterEdit | null>(null);
  const comparisonCurrent = active ? { ...active,
    ...(displayMode === "text" && writingDraft ? { title: writingDraft.title, blocks: { ...active.blocks, body: writingDraft.body } } : {}),
    ...(displayMode === "images" && latestLayout.current ? { layout: latestLayout.current.layout } : {}),
  } : null;
  const utils = trpc.useUtils();
  const create = trpc.chapters.create.useMutation();
  const exportPackage = trpc.chapters.exportPackage.useMutation();
  const restore = trpc.chapters.restoreVersion.useMutation();
  const resolve = trpc.chapters.resolveCandidate.useMutation();
  const deliveryEnabled = trpc.chapterDelivery.status.useQuery(undefined, { retry: false });
  const deliveryInbox = trpc.chapterDelivery.inbox.useQuery(undefined, { enabled: deliveryEnabled.data?.enabled === true, retry: false, refetchInterval: 15000, refetchOnWindowFocus: "always", refetchOnReconnect: "always" });
  const deliveryClaimLink = trpc.chapterDelivery.createClaimLink.useMutation();
  const deliveryReturn = trpc.chapterDelivery.return.useMutation();
  const deliveryResolve = trpc.chapterDelivery.resolve.useMutation();
  const deliveryImport = trpc.chapters.importPackage.useMutation();
  const candidates = trpc.chapters.candidates.useQuery(
    { chapterId: active?.id ?? 0 },
    { enabled: Boolean(active), retry: false, refetchInterval: 15000, refetchOnWindowFocus: "always", refetchOnReconnect: "always" }
  );
  const sharingHistory = trpc.chapters.sharingHistory.useQuery(
    { chapterId: active?.id ?? 0 }, { enabled: Boolean(active), retry: false }
  );
  const versions = trpc.chapters.versions.useQuery(
    { chapterId: active?.id ?? 0 },
    { enabled: Boolean(active), retry: false }
  );
  const prepare = useRef<(() => Promise<void>) | null>(null);
  const lock = useRef(false);
  const seeded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<{
    id: number;
    current: Chapter;
  } | null>(null);
  const [claimLink, setClaimLink] = useState("");
  const changeNote = writingDraft?.changeNote ?? "";
  const [historyComparison, setHistoryComparison] = useState<{
    version: number; latest?: boolean; current: Chapter; chapter: Pick<Chapter, "title" | "blocks" | "layout">; imageUrls: Record<string, string>;
  } | null>(null);
  const [deliveryPanel, setDeliveryPanel] = useState<"send" | "inbox" | null>(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("chapterInbox") === "1" ? "inbox" : null);
  const [selectedDelivery, setSelectedDelivery] = useState<{
    deliveryId: string; kind: "send" | "return"; status: string;
    package: { packageId: string; storyTitle: string; sender: { displayName: string; changeNote?: string }; chapters: Array<{ chapterId: string; title: string; blocks: Array<{ type: string; text?: string }> }> };
    imageUrls: Record<string, string>;
  } | null>(null);
  const deliveryAttempt = useRef<{ kind: "link" | "return"; requestId: string; package: unknown; images: Array<{ assetId: string; base64: string }>; recipientContactId?: string } | null>(null);
  const change = useCallback(
    (edit: ChapterEdit) => {
      if (!active) return;
      const keys = Object.fromEntries(
        Object.entries(state.imageUrls).map(([key, url]) => [url, key])
      );
      const keyOf = (value: string | null) =>
        value ? (keys[value] ?? value) : null;
      latestLayout.current = edit;
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
        if (displayMode === "text") await writing.current?.prepare();
        else await prepare.current?.();
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
  useEffect(() => {
    if (mode === displayMode) return;
    void run(async () => { await state.refresh(); setDisplayMode(mode); });
  }, [mode, displayMode]);
  useEffect(() => { latestLayout.current = null; setWritingDraft(null); }, [active?.id, state.epoch]);
  const handledBookImage = useRef<string | null>(null);
  useEffect(() => {
    const request = props.createRequest;
    if (mode !== "text" || displayMode !== "text" || !active || !request?.warehouseImage || request.storyId !== props.storyId || handledBookImage.current === request.id) return;
    if (request.warehouseImage.role !== "illustration") {
      toast.info("书页保持原样；请从仓库选择‘作为插图’加入图片模块。");
      props.onCreateRequestHandled?.(); return;
    }
    handledBookImage.current = request.id;
    let cancelled = false;
    void utils.storyAgent.storyMaterialState.fetch({storyId:props.storyId}).then(material => {
      if (cancelled) return;
      const asset = storyLibraryImages(props.storyId,material).find(item => item.id === request.warehouseImage!.imageId);
      if (!asset) throw new Error("这张图片暂不可用，请重新打开仓库。");
      writing.current?.insertImage(asset.imageUrl);
      props.onCreateRequestHandled?.();
    }).catch(error => {if (!cancelled) {toast.error(error instanceof Error ? error.message : "插图失败"); props.onCreateRequestHandled?.();}});
    return () => { cancelled = true; };
  }, [props.createRequest?.id, mode, displayMode, active?.id, props.storyId]);
  // Seed once per mounted story. A failure is explicit and can be retried from the toolbar.
  useEffect(() => {
    if (
      state.loading ||
      state.queryError ||
      state.chapters.length ||
      seeded.current
    )
      return;
    seeded.current = true;
    void run(async () => {
      await create.mutateAsync({
        storyId: props.storyId,
        title: props.title.trim().slice(0, 200) || "第 1 章",
        body: props.body,
        draftSource: props.scope,
        containsAiText: Boolean(props.body.trim()),
      });
      await state.reloadList();
    }, false);
  }, [state.loading, state.queryError, state.chapters.length, props.coverBusy]);

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
  async function createDeliveryAttempt(kind: "link" | "return") {
    if (!active) throw new Error("请先选择一章");
    const output = await exportPackage.mutateAsync({ chapterId: active.id, changeNote: changeNote.trim() || undefined });
    if (output.droppedImages || output.missingImageBytes) throw new Error("章节图片未能完整读取，暂未发送。请重新选择缺失图片后重试");
    return { kind, requestId: crypto.randomUUID(), package: output.package, images: output.images };
  }
  async function deliverActiveChapter(kind: "link" | "return") {
    if (!active) return;
    await run(async () => {
      let attempt = deliveryAttempt.current;
      if (!attempt || attempt.kind !== kind) {
        attempt = await createDeliveryAttempt(kind);
        deliveryAttempt.current = attempt;
      }
      const payload = { package: attempt.package, requestId: attempt.requestId };
      const result = kind === "link"
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
          toast.success("故事链接已复制");
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
      const images = await readDeliveryImages(fresh.imageUrls);
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
  const pending =
    candidates.data?.candidates.filter(
      candidate => candidate.status === "pending"
    ) ?? [];
  const candidate = pending.find(item => item.id === comparison?.id);
  useEffect(() => { setComparison(null); setHistoryComparison(null); setGeneratedOpen(false); }, [active?.id]);
  useEffect(() => {
    for (const item of candidates.data?.candidates ?? []) {
      if (item.status === "pending") continue;
      const deliveryId = deliveryCandidateMap()[item.packageId];
      if (!deliveryId) continue;
      void deliveryResolve.mutateAsync({ deliveryId, status: item.status === "adopted" ? "adopted" : "declined" })
        .then(async () => { forgetDeliveryCandidate(item.packageId); await deliveryInbox.refetch(); await sharingHistory.refetch(); })
        .catch(() => toast.error("章节已处理，收件箱状态稍后重试同步"));
    }
  }, [candidates.data?.candidates]);
  async function openLatestComparison() {
    await run(async () => {
      if (!active) return;
      const fresh = await utils.client.chapters.get.query({ chapterId: active.id });
      setHistoryComparison({ ...fresh, version: fresh.chapter.version, latest: true, current: active });
      setComparison(null); setGeneratedOpen(false); setHistoryOpen(false);
    }, false);
  }
  const editorControls = (
    <>
      <nav
        aria-label="章节栏"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] pb-3"
      >
        {active && mode === "text" && <BookImageGenerator {...props} title={writingDraft?.title ?? active.title} body={writingDraft?.body ?? active.blocks.body} />}
        {active && <button className={button} aria-expanded={historyOpen} onClick={() => { setHistoryOpen(!historyOpen); void versions.refetch(); void sharingHistory.refetch(); }}>版本{newerVersion ? ' · 有更新' : ''}</button>}
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
      {active && (
        <>
          {newerVersion && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--nayin-accent)]/10 p-3 text-sm">
            <span>{state.externalVersion ? `这个故事已在其他页面更新到版本 ${newerVersion}，要接收吗？` : '本机草稿与已保存版本不同，要查看并接收吗？'} 当前文字会保留。</span>
            <button className={button} disabled={busy} onClick={() => void openLatestComparison()}>查看并接收</button>
          </div>}
          {pending.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>{pending.map(item => item.senderName).filter((name, index, all) => all.indexOf(name) === index).join('、')} 发来了 {pending.length} 个新版本，是否接收？</span>
            <button className={button} onClick={() => setHistoryOpen(true)}>查看更新</button>
          </div>}
          {deliveryInbox.data?.some(row => row.status === 'pending') && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>收件箱有 {deliveryInbox.data.filter(row => row.status === 'pending').length} 份待接收稿件{deliveryInbox.data.some(row => row.status === 'pending' && row.kind === 'return') ? '，包含别人发回的修改' : ''}。</span>
            <button className={button} onClick={() => setDeliveryPanel('inbox')}>查看来稿</button>
          </div>}
          {historyOpen && <section aria-label="版本列表" className="space-y-3 border-y py-3">
            <p className="text-xs">当前版本 {active.version} · {active.blocks.attribution?.editorName || '未记录编辑者'}。选择版本只打开对比，不会替换正在写的内容。</p>
            {newerVersion && <button className={button} disabled={busy} onClick={() => void openLatestComparison()}>最新已保存版本 {newerVersion} · 打开对比</button>}
            {props.body.trim() && props.body !== active.blocks.body && <button className={button} onClick={() => {
              setGeneratedOpen(true); setHistoryComparison(null); setComparison(null); setHistoryOpen(false);
            }}>生成的文字 · 打开对比</button>}
            {pending.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{item.senderName} 发来的版本 · {new Date(item.createdAt).toLocaleString()} · {item.title}</span>
              {item.blocks.attribution?.changeNote && <p className="w-full">{item.blocks.attribution.changeNote}</p>}
              <button className={button} disabled={busy} onClick={() => {
                setComparison({ id: item.id, current: active }); setHistoryComparison(null); setGeneratedOpen(false); setHistoryOpen(false);
              }}>打开对比</button>
              <button className={button} disabled={busy} onClick={() => void run(async () => {
                await resolve.mutateAsync({ candidateId: item.id, status: 'dismissed' }); await candidates.refetch();
              }, false)}>删除这条</button>
            </div>)}
            {versions.isPending && <p className="text-xs">正在读取版本…</p>}
            {versions.error && <p role="alert" className="text-xs">版本暂未读到，请关闭后重新打开。</p>}
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {versions.data?.map(version => <li key={version.version} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm">
                <span>{version.attribution?.editorName || '未记录编辑者'} · {new Date(version.createdAt).toLocaleString()} · 版本 {version.version}</span>
                {version.attribution?.changeNote && <p className="w-full">{version.attribution.changeNote}</p>}
                <button className={button} disabled={busy} onClick={() => void run(async () => {
                  const old = await utils.chapters.version.fetch({ chapterId: active.id, version: version.version });
                  setHistoryComparison({ ...old, version: version.version, current: active });
                  setGeneratedOpen(false); setComparison(null); setHistoryOpen(false);
                }, false)}>打开对比</button>
              </li>)}
            </ul>
            {!versions.isPending && !versions.error && !versions.data?.length && <p className="text-xs text-muted-foreground">还没有已保存的旧版本。</p>}
            <details>
              <summary className="cursor-pointer text-xs">分享记录</summary>
              {active.blocks.attribution?.sourceName && <p className="text-xs">来源署名：{active.blocks.attribution.sourceName}</p>}
              {sharingHistory.isPending && <p className="text-xs">正在读取分享记录…</p>}
              {sharingHistory.error && <p role="alert" className="text-xs">分享记录暂未读到，请重新打开版本。</p>}
              <ul className="space-y-2 py-2 text-xs">{sharingHistory.data?.map(item => <li key={item.id}>
                {item.direction === 'sent' ? `你 → ${item.recipientName}` : `${item.senderName} → 你`} · {({pending:'等待接收',kept:'已留下',appended:'已加入',adopted:'已采用',declined:'已谢绝',expired:'已过期'} as Record<string,string>)[item.status] || item.status} · {new Date(item.createdAt).toLocaleString()}
              </li>)}</ul>
              <p className="text-xs text-muted-foreground">显示你参与的最近200条收发记录；未接受的修改不会替换当前版本。</p>
            </details>
          </section>}
          {(generatedOpen || historyComparison || candidate) && <section aria-label="版本对照操作" className="space-y-2 border-y py-3">
            <p className="text-xs text-muted-foreground">左边是所选版本，右边是当前稿。红色删除线是旧稿中删掉的文字，红色下划线是当前稿新增的文字。可以复制旧稿文字，粘贴到右边继续编辑。</p>
            {displayMode !== 'text' && <ChapterComparison mode={generatedOpen ? 'text' : 'images'} current={comparisonCurrent!}
              candidate={generatedOpen ? { ...active, title: props.title, blocks: { ...active.blocks, body: props.body } } : historyComparison?.chapter ?? candidate!}
              currentUrls={state.imageUrls} candidateUrls={historyComparison?.imageUrls ?? candidates.data?.imageUrls ?? {}}
              candidateLabel={generatedOpen ? '生成的文字' : historyComparison ? `版本 ${historyComparison.version}` : '收到的版本'} />}
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={busy} onClick={() => void run(async () => {
                if (generatedOpen) {
                  await state.saveText({ title: props.title.slice(0, 200) || active.title, body: props.body });
                } else if (historyComparison) {
                  if (!historyComparison.latest || state.version() > historyComparison.version) {
                    await restore.mutateAsync({ chapterId: active.id, version: historyComparison.version, expectedVersion: state.version() });
                    await state.refresh();
                  } else {
                    await state.acceptLatest(historyComparison.version);
                  }
                } else if (candidate) {
                  await resolve.mutateAsync({ candidateId: candidate.id, status: 'adopted', expectedVersion: state.version() });
                  await state.refresh(); await candidates.refetch();
                }
                await versions.refetch(); setGeneratedOpen(false); setHistoryComparison(null); setComparison(null);
              })}>采用所选版本（保留当前稿）</button>
              {displayMode === 'text' && historyComparison?.latest && <button className={button} disabled={busy} onClick={()=>void run(async()=>{
                await versions.refetch();setHistoryComparison(null);
              })}>保留我的修改</button>}
              <button className={button} onClick={() => { setGeneratedOpen(false); setHistoryComparison(null); setComparison(null); }}>结束对比</button>
            </div>
          </section>}
        </>)}
    </>
  );
  return (
    <div className="space-y-3" aria-label="故事章节">
      {(displayMode === "text" || !active) && editorControls}
      {active && (<>
          <div hidden={displayMode !== "text"}>
            {displayMode === "text" && <ChapterWriting key={`${active.id}:${state.epoch}`} chapter={active}
              scope={`${props.accountId ?? "current"}:${props.storyId}`} handle={writing}
              save={draft => state.saveText(draft, (state.externalVersion || localDraftConflict) && historyComparison?.latest ? historyComparison.version : undefined)} onChange={setWritingDraft} disabled={busy}
              reviewedVersion={historyComparison?.latest ? historyComparison.version : undefined}
              comparison={generatedOpen ? { body: props.body, title: props.title, label: '生成的文字' }
                : historyComparison ? { body: historyComparison.chapter.blocks.body, title: historyComparison.chapter.title, label: `版本 ${historyComparison.version}`, editorName: historyComparison.chapter.blocks.attribution?.editorName, note: historyComparison.chapter.blocks.attribution?.changeNote }
                : candidate ? { body: candidate.blocks.body, title: candidate.title, label: '收到的版本', editorName: candidate.senderName, note: candidate.blocks.attribution?.changeNote } : undefined} />}
          </div>
          {displayMode === "images" && render({
            ...props,
            layoutHeader: <div className="space-y-3 pb-3">{editorControls}</div>,
            scope: `chapter:${props.accountId ?? "current"}:${props.storyId}:${active.id}:v${active.version}:${state.epoch}`,
            title: active.title,
            body: active.blocks.body,
            assets: [...props.assets, ...chapterImageAssets(active, state.imageUrls)],
            hasAlbum: false,
            adoptedCoverId:
              !active.layout &&
              active.blocks.draftMirror?.source === props.scope
                ? props.adoptedCoverId
                : null,
            onGenerateCover: props.onGenerateCover
              ? (instruction, selectedText) => props.onGenerateCover!(instruction, selectedText || active.blocks.body)
              : undefined,
            onGenerateIllustration: props.onGenerateIllustration
              ? (coverId, instruction, selectedText) => props.onGenerateIllustration!(coverId, instruction, selectedText || active.blocks.body)
              : undefined,
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
            setDeliveryPanel("send"); setSelectedDelivery(null);
            void deliverActiveChapter("link");
          }}>生成故事链接</button>
          {active?.blocks.lineage?.parentPackageId && (
            <button className={button} disabled={busy} onClick={() => setDeliveryPanel("send")}>发回修改稿</button>
          )}
          <button className={button} disabled={busy} onClick={() => {
            setDeliveryPanel("inbox"); setSelectedDelivery(null);
            void deliveryInbox.refetch();
          }}>收件箱{deliveryInbox.data?.length ? `（${deliveryInbox.data.filter(row => row.status === "pending").length}）` : ""}</button>
        </div>
      )}
      {deliveryPanel === "send" && (
        <section className="space-y-2 rounded-xl border p-3" aria-label="投递章节">
          <p className="text-sm">链接包含当前故事的文字与图片，打开后可接收。</p>

          {active?.blocks.lineage?.parentPackageId && <button className={button} disabled={busy} onClick={() => void deliverActiveChapter("return")}>发回原作者</button>}
          <button className={button} onClick={() => { setDeliveryPanel(null); deliveryAttempt.current = null; }}>关闭</button>
          {claimLink && <div role="status" className="space-y-2 rounded-lg bg-[var(--panel-bg)] p-3">
            <p className="text-sm">故事链接已准备好</p>
            <label className="block text-xs">故事链接
              <input className={`${field} mt-1 w-full`} readOnly value={claimLink} onFocus={event => event.currentTarget.select()} />
            </label>
            <button className={button} onClick={() => { void navigator.clipboard.writeText(claimLink).then(() => toast.success("链接已复制")).catch(() => toast.error("请选中上方链接复制")); }}>复制领取链接</button>
            <p className="text-xs">在拾光小程序打开书稿，点「更多 → 接收网页故事」，粘贴链接后接收。链接只能由一个账号领取。</p>
          </div>}

        </section>
      )}
      {deliveryPanel === "inbox" && (
        <section className="space-y-3 rounded-xl border p-3" aria-label="章节投递收件箱">
          <div className="flex items-center justify-between"><h3 className="text-sm font-medium">章节投递收件箱</h3><button className={button} onClick={() => void deliveryInbox.refetch()}>刷新</button></div>
          {deliveryInbox.isPending && <p role="status" className="text-xs">正在读取收件箱…</p>}
          {deliveryInbox.error && <p role="alert" className="text-xs">收件箱暂时无法读取，请重试。</p>}
          {!deliveryInbox.isPending && !deliveryInbox.data?.some(row => row.status === "pending") && <p className="text-xs text-muted-foreground">没有等待接收的章节。</p>}
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
              {selectedDelivery.package.sender.changeNote && <p className="text-sm">{selectedDelivery.package.sender.changeNote}</p>}
              <p className="max-h-72 overflow-auto whitespace-pre-wrap text-sm">{selectedDelivery.package.chapters[0]?.blocks.filter(block => block.type === "text").map(block => block.text).join("\n")}</p>
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
              })}>删除这条</button>
            </div>
          )}
          <button className={button} onClick={() => { setDeliveryPanel(null); setSelectedDelivery(null); }}>关闭收件箱</button>
        </section>
      )}
    </div>
  );
}
