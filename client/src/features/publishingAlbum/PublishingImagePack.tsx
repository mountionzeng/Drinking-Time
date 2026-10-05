import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clipboard, Download, ImagePlus, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { installedPublishingAlbumFonts } from "@shared/publishingAlbumFonts";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";
import { IMAGE_PACK_STYLES, makeImagePack, type ImagePackOptions, type ImagePackResult, type PackAsset } from "./imagePackComposition";
import { drawPaperMaterial, IMAGE_PACK_TEXTURES, readCoverPalette, type ImagePackPalette, type ImagePackTexture } from "./imagePackMaterial";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { ImageCandidatePreview } from "./ImageCandidatePreview";
import { imagePackParagraphs, readIllustrationPlacements, resolveIllustrationOffset, type IllustrationPlacement } from "./imagePackIllustrations";

type Settings = {
  title: string | null;
  coverId: number | null;
  illustrations: IllustrationPlacement[];
  bodyTextureId: number | null;
  includeCover: boolean;
  style: ImagePackOptions["style"];
  fontId: string;
  texture: ImagePackTexture;
  textureSeed: number;
  materialBatch: number;
};

function readSettings(key: string, coverId: number | null): Settings {
  const fallback: Settings = { title: null, coverId, illustrations: [], bodyTextureId: null, includeCover: true, style: "sage", fontId: "noto-serif-sc", texture: "paper", textureSeed: 0, materialBatch: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      title: typeof value.title === "string" ? value.title : null,
      coverId: typeof value.coverId === "number" ? value.coverId : coverId,
      illustrations: readIllustrationPlacements(value),
      bodyTextureId: typeof value.bodyTextureId === "number" ? value.bodyTextureId : null,
      includeCover: typeof value.includeCover === "boolean" ? value.includeCover : true,
      style: Object.hasOwn(IMAGE_PACK_STYLES, value.style) ? value.style : "sage",
      fontId: installedPublishingAlbumFonts().some(font => font.fontId === value.fontId) ? value.fontId : "noto-serif-sc",
      texture: Object.hasOwn(IMAGE_PACK_TEXTURES, value.texture) ? value.texture : "paper",
      textureSeed: Number.isSafeInteger(value.textureSeed) && value.textureSeed >= 0 ? value.textureSeed : 0,
      materialBatch: Number.isSafeInteger(value.materialBatch) && value.materialBatch >= 0 ? value.materialBatch : 0,
    };
  } catch { return fallback; }
}

const control = "rounded-lg border border-[var(--panel-border)] bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";

function GenerationWait({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return <p className="text-xs leading-6 text-muted-foreground" role="status">
    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />正在生成配图 · 已等待 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒
  </p>;
}

function MaterialSwatch({ palette, texture, seed }: { palette: ImagePackPalette; texture: ImagePackTexture; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawPaperMaterial(context, 300, 400, palette, texture, seed);
  }, [palette, texture, seed]);
  return <canvas ref={ref} width={300} height={400} aria-hidden="true" className="aspect-[3/4] w-full rounded" />;
}

export function PublishingImagePack({
  scope, storyId, versionId, hasAlbum, title, body, assets: coverAssets, adoptedCoverId,
  onOpenCoverStudio, coverBusy, advancedEditor, advancedOpen, onAdvancedOpenChange,
  onGenerateIllustration, onGenerateCover, onGenerateTexture, illustrationCost, generationStartedAt, generationError,
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
  generationError?: string;
  advancedEditor?: ReactNode;
  advancedOpen?: boolean;
  onAdvancedOpenChange?(open: boolean): void;
  onGenerateIllustration?(coverId: number, instruction: string): Promise<void>;
  onGenerateCover?(instruction: string): Promise<void>;
  onGenerateTexture?(coverId: number, instruction: string): Promise<void>;
  illustrationCost?: number;
  generationStartedAt?: number;
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
  const selectedIllustrations = settings.illustrations.map(placement => assets.find(asset => asset.id === placement.assetId));
  const paragraphs = useMemo(() => imagePackParagraphs(body), [body]);
  const bodyTexture = assets.find(asset => asset.id === settings.bodyTextureId && asset.kind === "body-texture");
  const [theme, setTheme] = useState<{ url: string; palette?: ImagePackPalette; error?: string } | null>(null);
  const [themeRetry, setThemeRetry] = useState(0);
  const [illustrationSetup, setIllustrationSetup] = useState(false);
  const [illustrationInstruction, setIllustrationInstruction] = useState("");
  const [textureSetup, setTextureSetup] = useState(false);
  const [textureInstruction, setTextureInstruction] = useState("");
  const [coverSetup, setCoverSetup] = useState(false);
  const [coverInstruction, setCoverInstruction] = useState("");
  const materials = Object.keys(IMAGE_PACK_TEXTURES).flatMap(texture => [0, 1].map(variant => ({ texture: texture as ImagePackTexture, seed: settings.materialBatch * 2 + variant })));
  if (!materials.some(item => item.texture === settings.texture && item.seed === settings.textureSeed)) materials.unshift({ texture: settings.texture, seed: settings.textureSeed });
  useEffect(() => {
    if (!cover) return;
    const controller = new AbortController();
    const url = cover.imageUrl;
    setTheme({ url });
    void readCoverPalette(url, controller.signal).then(palette => {
      if (!controller.signal.aborted) setTheme({ url, palette });
    }).catch(cause => {
      if (!controller.signal.aborted) setTheme({ url, error: cause instanceof Error ? cause.message : "封面取色失败" });
    });
    return () => controller.abort();
  }, [cover?.imageUrl, themeRetry]);
  const palette = theme?.url === cover?.imageUrl ? theme?.palette : undefined;
  const palettePending = Boolean(cover && !palette);
  // Keep every paid illustration available when the user changes covers.
  // Partition in O(n), placing the current cover's candidates first.
  const availableIllustrations = assets.filter(asset => asset.kind === "illustration" || settings.illustrations.some(placement => placement.assetId === asset.id));
  const illustrations = [
    ...availableIllustrations.filter(asset => asset.parentAssetId === cover?.id),
    ...availableIllustrations.filter(asset => asset.parentAssetId !== cover?.id),
  ];
  const options = useMemo<ImagePackOptions>(() => ({
    title: settings.title ?? title, body, fontId: settings.fontId, style: settings.style,
    includeCover: settings.includeCover,
    texture: settings.texture, textureSeed: settings.textureSeed,
    coverUrl: cover?.imageUrl, bodyTextureUrl: bodyTexture?.imageUrl,
    illustrations: settings.illustrations.map(placement => ({ after: placement.after, imageUrl: assets.find(asset => asset.id === placement.assetId)?.imageUrl ?? "" })),
    palette,
  }), [settings.title, title, body, settings.fontId, settings.style, settings.includeCover, settings.illustrations, settings.texture, settings.textureSeed, cover?.imageUrl, assets, bodyTexture?.imageUrl, palette]);
  const signature = JSON.stringify(options);
  const [output, setOutput] = useState<{ signature: string; pages: (ImagePackResult & { url: string })[] } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [error, setError] = useState("");
  const [renderAttempt, setRenderAttempt] = useState(0);
  const previewUrls = useRef<string[]>([]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const stale = output !== null && output.signature !== signature;
  const selected = output?.pages[selectedPage];
  const ready = Boolean(selected && !stale && !progress);
  const shareFiles = useMemo(() => output?.pages.map(page =>
    new File([page.blob], page.filename, { type: "image/png" })
  ) ?? [], [output]);
  const canShareImages = typeof navigator !== "undefined" &&
    typeof navigator.share === "function" && shareFiles.length > 0 &&
    Boolean(navigator.canShare?.({ files: shareFiles }));
  const needsCover = settings.includeCover && !cover;
  const missingIllustration = selectedIllustrations.some(asset => !asset);
  const missingTexture = settings.bodyTextureId != null && !bodyTexture;

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Preview remains usable when storage is unavailable. */ }
  }, [key, settings]);
  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    setError("");
    setProgress(null);
    if (!options.body.trim() || needsCover || missingIllustration || missingTexture || palettePending) return;
    const controller = new AbortController();
    setProgress("正在更新图片…");
    // Coalesce typing and quick candidate changes before starting PNG work.
    const timer = window.setTimeout(() => {
      void makeImagePack(options, (done, total) => {
        if (!controller.signal.aborted) setProgress(`排版 ${done}/${total}`);
      }, controller.signal).then(pages => {
        if (controller.signal.aborted || currentSignature.current !== signature) return;
        const prepared = pages.map(page => ({ ...page, url: URL.createObjectURL(page.blob) }));
        for (const url of previewUrls.current) URL.revokeObjectURL(url);
        previewUrls.current = prepared.map(page => page.url);
        setOutput({ signature, pages: prepared });
        setSelectedPage(index => Math.min(index, pages.length - 1));
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "排版失败，请重试");
      }).finally(() => {
        if (!controller.signal.aborted) setProgress(null);
      });
    }, 500);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [options, signature, needsCover, missingIllustration, missingTexture, palettePending, renderAttempt]);

  function update(patch: Partial<Settings>) { setSettings(value => ({ ...value, ...patch })); }
  function toggleIllustration(assetId: number) {
    setSettings(value => ({ ...value, illustrations: value.illustrations.some(item => item.assetId === assetId)
      ? value.illustrations.filter(item => item.assetId !== assetId)
      : [...value.illustrations, { assetId, after: null }] }));
  }
  function addIllustration(assetId: number) {
    setSettings(value => value.illustrations.some(item => item.assetId === assetId) ? value
      : { ...value, illustrations: [...value.illustrations, { assetId, after: null }] });
  }
  function illustrationControls(asset: PackAsset, placement: IllustrationPlacement | undefined) {
    if (!placement) return <button type="button" className={`${control} w-full`} onClick={() => addIllustration(asset.id)}>插入正文</button>;
    const offset = resolveIllustrationOffset(paragraphs, placement.after);
    const position = offset === null ? "missing" : offset === 0 ? "start" : String(offset);
    return <div className="space-y-2" role="group" aria-label={`插图位置：${asset.label}`}>
      <label className="block space-y-1 text-xs">
        <span>插入位置</span>
        <select aria-label={`插入位置：${asset.label}`} className={`${control} w-full min-w-0 truncate`} value={position}
          onChange={event => {
            const after = event.target.value === "start" ? null : paragraphs.find(paragraph => String(paragraph.end) === event.target.value)?.anchor;
            if (after !== undefined) setSettings(value => ({ ...value, illustrations: value.illustrations.map(item => item.assetId === asset.id ? { ...item, after } : item) }));
          }}>
          {offset === null ? <option value="missing" disabled>请重新选择位置</option> : null}
          <option value="start">正文开头（默认）</option>
          {paragraphs.map(paragraph => <option key={paragraph.end} value={paragraph.end}>{paragraph.label.length > 70 ? `${paragraph.label.slice(0, 70)}…` : paragraph.label}</option>)}
        </select>
      </label>
      {offset === null ? <p className="text-[11px] text-destructive" role="alert">原位置无法定位，请重新选择段落。{placement.after?.text ? `原文：${placement.after.text.slice(0, 40)}` : ""}</p> : null}
      <button type="button" className="text-xs text-muted-foreground underline" aria-label={`移除插图：${asset.label}`} onClick={() => toggleIllustration(asset.id)}>移除插图</button>
    </div>;
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
    try {
      if (!canShareImages) return;
      await navigator.share({ files: shareFiles });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError")) toast.error(cause instanceof Error ? cause.message : "分享未完成，请下载后发布");
    }
  }

  return (
    <section className="mt-7 rounded-xl border border-[var(--panel-border)]" aria-label="文章图片制作">
      {generationError && !coverBusy ? <p role="alert" className="px-4 pt-3 text-xs text-destructive">{generationError}</p> : null}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--panel-border)] px-4 py-3">
        <div>
          <h2 className="font-chat-brand text-lg">把文章做成图片</h2>
          <p className="mt-1 text-xs text-muted-foreground" role="status">已有图片 {assets.length} 张{output ? ` · 成品 ${output.pages.length} 张${stale ? "（待更新）" : ""}` : ""}</p>
        </div>
      </header>
      <div className="space-y-4 p-4">
        {generationStartedAt != null ? <GenerationWait key={generationStartedAt} startedAt={generationStartedAt} /> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs">封面</p>
          <div className="flex items-center gap-2">
          <button type="button" disabled={coverBusy} className={control} onClick={onOpenCoverStudio}>编辑封面</button>
          <Popover open={coverSetup} onOpenChange={setCoverSetup}>
            <PopoverTrigger asChild><button type="button" disabled={coverBusy} className={control}><ImagePlus className="mr-1 inline h-3.5 w-3.5" />生成封面</button></PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <p className="text-sm font-medium">生成封面</p>
              <textarea aria-label="封面生成要求" value={coverInstruction} onChange={event => setCoverInstruction(event.target.value)} maxLength={1000} rows={3} className={`${control} w-full`} placeholder="想要怎样的画面？留空则根据文章生成" />
              {onGenerateCover ? <button type="button" className={control} disabled={coverBusy || illustrationCost == null} onClick={() => { setCoverSetup(false); void onGenerateCover(coverInstruction); }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button> : null}
            </PopoverContent>
          </Popover>
          </div>
        </div>
        {assets.length ? (
            <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="已有图片">
              {assets.filter(asset => !asset.kind).map(asset => (
                <ImageCandidatePreview key={asset.id} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />}>
                <button type="button" aria-label={`选为封面：${asset.label}`} aria-pressed={settings.coverId === asset.id}
                  onClick={() => { update({ coverId: asset.id, includeCover: true }); setIllustrationSetup(false); }}
                  className={`relative w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${settings.coverId === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`}>
                  <img src={asset.imageUrl} alt={asset.label} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  <span className="block truncate bg-[var(--nayin-surface)] px-1 py-1 text-[10px]">{settings.coverId === asset.id ? "封面 · " : ""}{asset.label}</span>
                  {asset.warning ? <span className="block bg-amber-50 p-1 text-[10px] text-amber-800">{asset.warning}</span> : null}
                </button>
                </ImageCandidatePreview>
              ))}
            </div>
        ) : <p className="rounded-lg bg-[var(--nayin-surface)] p-3 text-xs leading-6 text-muted-foreground">暂无配图</p>}
        {albumQuery.error ? <p className="text-xs text-destructive">画册图片读取失败，请刷新后重试。封面候选仍可使用。</p> : null}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs">正文插图（可多选）</p>
            {onGenerateIllustration ? <Popover open={illustrationSetup} onOpenChange={setIllustrationSetup}>
              <PopoverTrigger asChild><button type="button" className={control} disabled={!cover || coverBusy || !coverAssets.some(asset => asset.id === cover.id)}>生成插图</button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-sm font-medium">生成横版插图 · 16:9</p>
                <textarea aria-label="插图内容" className={`${control} w-full`} rows={3} value={illustrationInstruction} onChange={event => setIllustrationInstruction(event.target.value)} maxLength={1000} placeholder="想画什么？留空则根据文章内容生成" />
                <button type="button" className={control} disabled={!cover || coverBusy || illustrationCost == null} onClick={() => { if (cover) { setIllustrationSetup(false); void onGenerateIllustration(cover.id, illustrationInstruction); } }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button>
              </PopoverContent>
            </Popover> : null}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="横版插图候选">
            {illustrations.map(asset => {
              const placement = settings.illustrations.find(item => item.assetId === asset.id);
              const needsPosition = placement && resolveIllustrationOffset(paragraphs, placement.after) === null;
              return <ImageCandidatePreview key={asset.id} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />} controls={illustrationControls(asset, placement)}><button type="button" className={`w-32 shrink-0 rounded border-2 p-1 focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${placement ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用插图：${asset.label}`} aria-pressed={Boolean(placement)} onClick={() => addIllustration(asset.id)}>
              <img src={asset.imageUrl} alt={asset.label} className="aspect-video w-full object-contain" />
              {placement ? <span className={`block text-[10px] ${needsPosition ? "text-destructive" : ""}`}>{needsPosition ? "请重新定位" : "已插入"}</span> : null}
              {asset.kind !== "illustration" ? <span className="text-[10px] text-muted-foreground">保留的原配图</span> : null}
              {asset.kind === "illustration" && asset.parentAssetId !== cover?.id ? <span className="text-[10px] text-muted-foreground">来自其他封面</span> : null}
              {asset.warning ? <span className="text-[10px] text-amber-700">{asset.warning}</span> : null}
            </button></ImageCandidatePreview>;
            })}
          </div>
          {settings.illustrations.filter(placement => !assets.some(asset => asset.id === placement.assetId)).map(placement => <p key={placement.assetId} role="alert" className="text-xs text-destructive">
            插图 {placement.assetId} 不可用。<button type="button" className="underline" aria-label={`移除插图：${placement.assetId}`} onClick={() => toggleIllustration(placement.assetId)}>移除插图</button>
          </p>)}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs">整套底图{cover && !palette ? <span className="text-muted-foreground"> · {theme?.error ? "取色未完成" : "取色中…"}</span> : null}</p>
            {onGenerateTexture ? <Popover open={textureSetup} onOpenChange={setTextureSetup}>
              <PopoverTrigger asChild><button type="button" className={control} disabled={!cover || coverBusy || !coverAssets.some(asset => asset.id === cover.id)}>生成底图</button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-sm font-medium">生成花纹底图 · 3:4</p>
                <textarea aria-label="底图花纹要求" className={`${control} w-full`} rows={3} value={textureInstruction} onChange={event => setTextureInstruction(event.target.value)} maxLength={1000} placeholder="例如：细腻纸纹、淡淡水彩、稀疏植物纹样" />
                <button type="button" className={control} disabled={!cover || coverBusy || illustrationCost == null} onClick={() => { if (cover) { setTextureSetup(false); void onGenerateTexture(cover.id, textureInstruction); } }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button>
              </PopoverContent>
            </Popover> : null}
          </div>
          {theme?.url === cover?.imageUrl && theme?.error ? <p role="alert" className="text-xs text-destructive">{theme.error} <button type="button" onClick={() => setThemeRetry(value => value + 1)}>重试取色</button></p> : null}
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="正文纹理">
            {assets.filter(asset => asset.kind === "body-texture").map(asset => <ImageCandidatePreview key={asset.id} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />}>
              <button type="button" className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs ${bodyTexture?.id === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用底图：${asset.label}`} aria-pressed={bodyTexture?.id === asset.id} onClick={() => { update({ bodyTextureId: asset.id }); setSelectedPage(settings.includeCover ? 1 : 0); }}>
                <img src={asset.imageUrl} alt={asset.label} className="aspect-[3/4] w-full rounded object-cover" />
                {asset.warning ? <span className="text-[10px] text-amber-700">{asset.warning}</span> : null}
              </button>
            </ImageCandidatePreview>)}
            {materials.map(({texture, seed}) => <ImageCandidatePreview key={`${texture}:${seed}`} label={`${IMAGE_PACK_TEXTURES[texture]} ${seed + 1}`} preview={<MaterialSwatch palette={palette ?? IMAGE_PACK_STYLES.sage} texture={texture} seed={seed} />}><button type="button" className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs transition-colors ${settings.bodyTextureId == null && settings.texture === texture && settings.textureSeed === seed ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用底图：${IMAGE_PACK_TEXTURES[texture]} ${seed + 1}`} aria-pressed={settings.bodyTextureId == null && settings.texture === texture && settings.textureSeed === seed} onClick={() => { update({ texture, textureSeed: seed, bodyTextureId: null }); setSelectedPage(settings.includeCover ? 1 : 0); }}>
              <MaterialSwatch palette={palette ?? IMAGE_PACK_STYLES.sage} texture={texture} seed={seed} /><span className="block py-1">{IMAGE_PACK_TEXTURES[texture]} · {seed + 1}</span>
            </button></ImageCandidatePreview>)}
          </div>
          <button type="button" className="text-xs text-muted-foreground underline" disabled={palettePending} onClick={() => update({ materialBatch: settings.materialBatch + 1 })}>换一组免费纹理</button>
        </div>
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">排版设置</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs">封面文字
            <input aria-label="封面文字" value={options.title} onChange={event => update({ title: event.target.value })} maxLength={200} className={control} placeholder="默认使用文章标题，也可以自己填写" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">用已有图片作插图
            <select aria-label="添加已有图片作插图" value="" onChange={event => { if (event.target.value) addIllustration(Number(event.target.value)); }} className={control}>
              <option value="">选择图片添加</option>
              {assets.filter(asset => asset.kind !== "body-texture" && !settings.illustrations.some(item => item.assetId === asset.id)).map(asset => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
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
          <span className="text-muted-foreground">设置仅存本机</span>
        </div>
        </details>
        {progress || needsCover || missingTexture || missingIllustration ? <p className="text-xs leading-6 text-muted-foreground" role="status">
          {progress ? <><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{progress}</> : needsCover ? "请选择封面，或在排版设置中取消封面。" : missingTexture ? "底图不可用，请重选。" : "插图不可用，请重选。"}
        </p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => setRenderAttempt(value => value + 1)}>重试排版</button></p> : null}
        {output ? (
          <div className="border-t border-[var(--panel-border)] pt-4">
            <h3 className="mb-2 text-sm font-medium">成品预览</h3>
            {stale ? <p className="mb-3 text-xs text-muted-foreground">正在更新…</p> : null}
            <div className="flex gap-2 overflow-x-auto pb-3" aria-label="成品图片列表">
              {output.pages.map((page, index) => <ImageCandidatePreview key={page.url} label={`成品 ${index + 1} · ${page.label}`} preview={<img src={page.url} alt={page.label} />}><button type="button" onClick={() => setSelectedPage(index)} aria-pressed={selectedPage === index} aria-label={`预览第 ${index + 1} 张：${page.label}`}
                className={`w-24 shrink-0 rounded-md border-2 p-1 ${selectedPage === index ? "border-[var(--nayin-accent)]" : "border-transparent"}`}>
                <img src={page.url} alt={`第 ${index + 1} 张 ${page.label}`} className="aspect-[3/4] w-full rounded" />
                <span className="text-[10px]">{index + 1} · {page.label}</span>
              </button></ImageCandidatePreview>)}
            </div>
            {selected ? <img src={selected.url} alt={`当前预览：${selected.label}`} className="mx-auto mb-4 w-full max-w-sm rounded-lg border border-[var(--panel-border)]" /> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!ready} onClick={() => { for (const page of output.pages) downloadPublishingAlbumBlob(page.blob, page.filename); }} className={control}><Download className="mr-1 inline h-3.5 w-3.5" />下载整套</button>
              <button type="button" disabled={!ready} onClick={() => void copy()} className={control}><Clipboard className="mr-1 inline h-3.5 w-3.5" />复制当前图片</button>
              {canShareImages ? <button type="button" disabled={!ready} onClick={() => void share()} className={control}><Share2 className="mr-1 inline h-3.5 w-3.5" />分享图片</button> : null}
              {selected ? <a href={ready ? selected.url : undefined} download={selected.filename} aria-disabled={!ready} className={control}>下载当前图片</a> : null}
            </div>
          </div>
        ) : null}
        {advancedEditor ? <details open={advancedOpen} onToggle={event => onAdvancedOpenChange?.(event.currentTarget.open)} className="border-t border-[var(--panel-border)] pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">逐页编辑画册</summary>{advancedOpen ? advancedEditor : null}</details> : null}
      </div>
    </section>
  );
}
