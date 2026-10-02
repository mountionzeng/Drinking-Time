import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clipboard, Download, ImagePlus, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { installedPublishingAlbumFonts } from "@shared/publishingAlbumFonts";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";
import { IMAGE_PACK_STYLES, makeImagePack, type ImagePackOptions, type ImagePackResult, type PackAsset } from "./imagePackComposition";

type Settings = {
  title: string | null;
  coverId: number | null;
  illustrationId: number | null;
  includeCover: boolean;
  style: ImagePackOptions["style"];
  fontId: string;
  illustrationPosition: ImagePackOptions["illustrationPosition"];
};

function readSettings(key: string, coverId: number | null): Settings {
  const fallback: Settings = { title: null, coverId, illustrationId: null, includeCover: true, style: "sage", fontId: "noto-serif-sc", illustrationPosition: "above" };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      title: typeof value.title === "string" ? value.title : null,
      coverId: typeof value.coverId === "number" ? value.coverId : coverId,
      illustrationId: typeof value.illustrationId === "number" ? value.illustrationId : null,
      includeCover: typeof value.includeCover === "boolean" ? value.includeCover : true,
      style: Object.hasOwn(IMAGE_PACK_STYLES, value.style) ? value.style : "sage",
      fontId: installedPublishingAlbumFonts().some(font => font.fontId === value.fontId) ? value.fontId : "noto-serif-sc",
      illustrationPosition: value.illustrationPosition === "middle" ? "middle" : "above",
    };
  } catch { return fallback; }
}

const control = "rounded-lg border border-[var(--panel-border)] bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";

export function PublishingImagePack({
  scope, storyId, versionId, hasAlbum, title, body, assets: coverAssets, adoptedCoverId,
  onOpenCoverStudio, coverBusy, advancedEditor, advancedOpen, onAdvancedOpenChange,
}: {
  scope: string;
  storyId: number;
  versionId: string;
  hasAlbum: boolean;
  title: string;
  body: string;
  assets: PackAsset[];
  adoptedCoverId: number | null;
  onOpenCoverStudio(): void;
  coverBusy: boolean;
  advancedEditor?: ReactNode;
  advancedOpen?: boolean;
  onAdvancedOpenChange?(open: boolean): void;
}) {
  const key = `publishing-image-pack:${scope}`;
  const [settings, setSettings] = useState(() => readSettings(key, adoptedCoverId));
  const albumQuery = trpc.publishingDraft.readAlbum.useQuery(
    { storyId, versionId }, { enabled: hasAlbum && storyId > 0, retry: false },
  );
  const assets = useMemo(() => {
    const all = new Map(coverAssets.map(asset => [asset.id, asset]));
    const warnings = new Map<number, string>();
    for (const page of albumQuery.data?.album?.pages ?? []) {
      for (const round of page.backgroundRounds) {
        for (const id of round.assetIds) if (round.qualityCheckUnavailable) warnings.set(id, "质检未完成");
        for (const id of round.qualityFlaggedAssetIds) warnings.set(id, "疑似含字");
      }
    }
    for (const asset of albumQuery.data?.assets ?? []) {
      if (!all.has(asset.id)) all.set(asset.id, { ...asset, label: `画册底图 ${asset.id}`, warning: warnings.get(asset.id) });
    }
    return Array.from(all.values());
  }, [coverAssets, albumQuery.data]);
  const cover = assets.find(asset => asset.id === settings.coverId);
  const illustration = assets.find(asset => asset.id === settings.illustrationId);
  const options: ImagePackOptions = {
    ...settings, title: settings.title ?? title, body,
    coverUrl: cover?.imageUrl, illustrationUrl: illustration?.imageUrl,
  };
  const signature = JSON.stringify(options);
  const [output, setOutput] = useState<{ signature: string; pages: (ImagePackResult & { url: string })[] } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const previewUrls = useRef<string[]>([]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const stale = output !== null && output.signature !== signature;
  const selected = output?.pages[selectedPage];
  const ready = Boolean(selected && !stale && !progress);
  const needsCover = settings.includeCover && !cover;
  const missingIllustration = settings.illustrationId != null && !illustration;

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Preview remains usable when storage is unavailable. */ }
  }, [key, settings]);
  useEffect(() => () => {
    request.current?.abort();
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setProgress(null);
    setError("");
  }, [signature]);

  function update(patch: Partial<Settings>) { setSettings(value => ({ ...value, ...patch })); }
  async function make() {
    if (request.current || needsCover || missingIllustration) return;
    const controller = new AbortController();
    request.current = controller;
    setProgress("准备字体与排版…");
    setError("");
    try {
      const pages = await makeImagePack(options, (done, total) => setProgress(`制作图片 ${done}/${total}`), controller.signal);
      if (controller.signal.aborted || currentSignature.current !== signature) return;
      const prepared = pages.map(page => ({ ...page, url: URL.createObjectURL(page.blob) }));
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current = prepared.map(page => page.url);
      setOutput({ signature, pages: prepared });
      setSelectedPage(0);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "制作失败，请重试");
    } finally {
      if (request.current === controller) { request.current = null; setProgress(null); }
    }
  }
  async function copy() {
    if (!ready || !selected) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("此浏览器不支持复制图片，请下载当前图片");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": selected.blob })]);
      toast.success("当前图片已复制，可以粘贴发送");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "复制失败，请下载图片"); }
  }
  async function share() {
    if (!ready || !output) return;
    const files = output.pages.map(page => new File([page.blob], page.filename, { type: "image/png" }));
    try {
      if (!navigator.canShare?.({ files })) throw new Error("此浏览器不支持直接分享整套图片，请下载后发布");
      await navigator.share({ files });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) toast.error(cause instanceof Error ? cause.message : "分享未完成，请下载后发布");
    }
  }

  return (
    <section className="mt-7 rounded-xl border border-[var(--panel-border)]" aria-label="文章图片制作">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 py-3">
        <div>
          <h2 className="font-chat-brand text-lg">把文章做成图片</h2>
          <p className="mt-1 text-xs text-muted-foreground" role="status">已有图片 {assets.length} 张 · {output ? `已制作 ${output.pages.length} 张${stale ? "（待更新）" : ""}` : "封面、插图、正文，共用一套样式"}</p>
        </div>
        <button type="button" onClick={onOpenCoverStudio} disabled={coverBusy} className={control}><ImagePlus className="mr-1 inline h-3.5 w-3.5" />生成 / 修改配图</button>
      </header>
      <div className="space-y-4 p-4">
        {assets.length ? (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">点选一张作为这套图片的封面</p>
            <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="已有图片">
              {assets.map(asset => (
                <button type="button" key={asset.id} aria-label={`选为封面：${asset.label}`} aria-pressed={settings.coverId === asset.id}
                  onClick={() => update({ coverId: asset.id, includeCover: true })}
                  className={`relative w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${settings.coverId === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`}>
                  <img src={asset.imageUrl} alt={asset.label} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  <span className="block truncate bg-[var(--nayin-surface)] px-1 py-1 text-[10px]">{settings.coverId === asset.id ? "封面 · " : ""}{asset.label}</span>
                  {asset.warning ? <span className="block bg-amber-50 p-1 text-[10px] text-amber-800">{asset.warning}</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : <p className="rounded-lg bg-[var(--nayin-surface)] p-3 text-xs leading-6 text-muted-foreground">还没有配图。可以先制作纯文字图片，或点击“生成 / 修改配图”制作封面与插图。</p>}
        {albumQuery.error ? <p className="text-xs text-destructive">画册图片读取失败，请刷新后重试。封面候选仍可使用。</p> : null}
        {cover?.warning || illustration?.warning ? <p className="text-xs text-amber-700">所选配图：{[cover?.warning, illustration?.warning].filter(Boolean).join("、")}，发送前请检查画面。</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs">封面文字
            <input aria-label="封面文字" value={options.title} onChange={event => update({ title: event.target.value })} maxLength={200} className={control} placeholder="默认使用文章标题，也可以自己填写" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">正文插图
            <select aria-label="正文插图" value={settings.illustrationId ?? ""} onChange={event => update({ illustrationId: event.target.value ? Number(event.target.value) : null })} className={control}>
              <option value="">不插入配图</option>
              {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">整套配色
            <select aria-label="整套配色" value={settings.style} onChange={event => update({ style: event.target.value as Settings["style"] })} className={control}>
              {Object.entries(IMAGE_PACK_STYLES).map(([id, style]) => <option key={id} value={id}>{style.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs">整套字体
            <select aria-label="整套字体" value={settings.fontId} onChange={event => update({ fontId: event.target.value })} className={control}>
              {installedPublishingAlbumFonts().map(font => <option key={font.fontId} value={font.fontId}>{font.nameZh}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.includeCover} onChange={event => update({ includeCover: event.target.checked })} />包含封面</label>
          {settings.illustrationId != null ? <label className="flex items-center gap-2">插图位置
            <select aria-label="插图位置" value={settings.illustrationPosition} onChange={event => update({ illustrationPosition: event.target.value as Settings["illustrationPosition"] })} className={control}>
              <option value="above">正文开头</option><option value="middle">正文中间页</option>
            </select>
          </label> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void make()} disabled={Boolean(progress) || !body.trim() || needsCover || missingIllustration}
            className={control} style={{ background: "var(--nayin-accent)", color: "var(--background)" }}>
            {progress ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}{progress ?? (stale ? "更新整套图片" : "制作图片")}
          </button>
          <p className="text-[11px] leading-5 text-muted-foreground" role="status">{needsCover ? "先点选封面图片；或取消包含封面，制作正文图。" : missingIllustration ? "所选插图已不可用，请重新选择。" : "使用已有图片免费排版 · 3:4 · 最多 9 张 · 不会重新购买图片"}</p>
        </div>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        {output ? (
          <div className="border-t border-[var(--panel-border)] pt-4">
            <p className="mb-3 text-xs text-muted-foreground">{stale ? "文字或设置已变化，请更新图片后发送。" : "图片已做好，预览与下载一致。选择一页即可复制。"}</p>
            <div className="flex gap-2 overflow-x-auto pb-3" aria-label="成品图片列表">
              {output.pages.map((page, index) => <button key={page.url} type="button" onClick={() => setSelectedPage(index)} aria-pressed={selectedPage === index} aria-label={`预览第 ${index + 1} 张：${page.label}`}
                className={`w-24 shrink-0 rounded-md border-2 p-1 ${selectedPage === index ? "border-[var(--nayin-accent)]" : "border-transparent"}`}>
                <img src={page.url} alt={`第 ${index + 1} 张 ${page.label}`} className="aspect-[3/4] w-full rounded" />
                <span className="text-[10px]">{index + 1} · {page.label}</span>
              </button>)}
            </div>
            {selected ? <img src={selected.url} alt={`当前预览：${selected.label}`} className="mx-auto mb-4 w-full max-w-sm rounded-lg border border-[var(--panel-border)]" /> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!ready} onClick={() => { for (const page of output.pages) downloadPublishingAlbumBlob(page.blob, page.filename); }} className={control}><Download className="mr-1 inline h-3.5 w-3.5" />下载整套</button>
              <button type="button" disabled={!ready} onClick={() => void copy()} className={control}><Clipboard className="mr-1 inline h-3.5 w-3.5" />复制当前图片</button>
              <button type="button" disabled={!ready} onClick={() => void share()} className={control}><Share2 className="mr-1 inline h-3.5 w-3.5" />分享</button>
              {selected ? <a href={ready ? selected.url : undefined} download={selected.filename} aria-disabled={!ready} className={control}>下载当前图片</a> : null}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">整套下载若被浏览器拦截，可逐张下载。支持系统分享的浏览器可以直接发送。排版设置保存在此浏览器；刷新后需重新制作图片。</p>
          </div>
        ) : null}
        {advancedEditor ? <details open={advancedOpen} onToggle={event => onAdvancedOpenChange?.(event.currentTarget.open)} className="border-t border-[var(--panel-border)] pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">已有画册 · 逐页精细排版</summary>{advancedOpen ? advancedEditor : null}</details> : null}
      </div>
    </section>
  );
}
