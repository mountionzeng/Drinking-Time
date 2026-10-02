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

type Settings = {
  title: string | null;
  coverId: number | null;
  illustrationId: number | null;
  bodyTextureId: number | null;
  includeCover: boolean;
  style: ImagePackOptions["style"];
  fontId: string;
  illustrationPosition: ImagePackOptions["illustrationPosition"];
  texture: ImagePackTexture;
  textureSeed: number;
  materialBatch: number;
};

function readSettings(key: string, coverId: number | null): Settings {
  const fallback: Settings = { title: null, coverId, illustrationId: null, bodyTextureId: null, includeCover: true, style: "sage", fontId: "noto-serif-sc", illustrationPosition: "above", texture: "paper", textureSeed: 0, materialBatch: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    return {
      title: typeof value.title === "string" ? value.title : null,
      coverId: typeof value.coverId === "number" ? value.coverId : coverId,
      illustrationId: typeof value.illustrationId === "number" ? value.illustrationId : null,
      bodyTextureId: typeof value.bodyTextureId === "number" ? value.bodyTextureId : null,
      includeCover: typeof value.includeCover === "boolean" ? value.includeCover : true,
      style: Object.hasOwn(IMAGE_PACK_STYLES, value.style) ? value.style : "sage",
      fontId: installedPublishingAlbumFonts().some(font => font.fontId === value.fontId) ? value.fontId : "noto-serif-sc",
      illustrationPosition: value.illustrationPosition === "middle" ? "middle" : "above",
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
    <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />正在生成配图 · 已等待 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒。
    绘图后还需下载和质检，完成后自动显示，无需重复点击。
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
  onGenerateIllustration, onGenerateCover, onGenerateTexture, illustrationCost, generationStartedAt,
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
  const illustration = assets.find(asset => asset.id === settings.illustrationId);
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
  const availableIllustrations = assets.filter(asset => asset.kind === "illustration" || asset.id === settings.illustrationId);
  const illustrations = [
    ...availableIllustrations.filter(asset => asset.parentAssetId === cover?.id),
    ...availableIllustrations.filter(asset => asset.parentAssetId !== cover?.id),
  ];
  const options = useMemo<ImagePackOptions>(() => ({
    title: settings.title ?? title, body, fontId: settings.fontId, style: settings.style,
    includeCover: settings.includeCover, illustrationPosition: settings.illustrationPosition,
    texture: settings.texture, textureSeed: settings.textureSeed,
    coverUrl: cover?.imageUrl, illustrationUrl: illustration?.imageUrl, bodyTextureUrl: bodyTexture?.imageUrl,
    palette,
  }), [settings.title, title, body, settings.fontId, settings.style, settings.includeCover, settings.illustrationPosition, settings.texture, settings.textureSeed, cover?.imageUrl, illustration?.imageUrl, bodyTexture?.imageUrl, palette]);
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
  const needsCover = settings.includeCover && !cover;
  const missingIllustration = settings.illustrationId != null && !illustration;
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
      </header>
      <div className="space-y-4 p-4">
        {generationStartedAt != null ? <GenerationWait key={generationStartedAt} startedAt={generationStartedAt} /> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs">封面 <span className="text-muted-foreground">· 点选作为整套图片的风格参考</span></p>
          <Popover open={coverSetup} onOpenChange={setCoverSetup}>
            <PopoverTrigger asChild><button type="button" disabled={coverBusy} className={control}><ImagePlus className="mr-1 inline h-3.5 w-3.5" />生成封面</button></PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
              <p className="text-sm font-medium">生成封面</p>
              <textarea aria-label="封面生成要求" value={coverInstruction} onChange={event => setCoverInstruction(event.target.value)} maxLength={1000} rows={3} className={`${control} w-full`} placeholder="想要怎样的画面？留空则根据文章生成" />
              {onGenerateCover ? <button type="button" className={control} disabled={coverBusy || illustrationCost == null} onClick={() => { setCoverSetup(false); void onGenerateCover(coverInstruction); }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button> : null}
              <button type="button" className="block text-xs text-muted-foreground underline" onClick={() => { setCoverSetup(false); onOpenCoverStudio(); }}>参考图与精细修改</button>
            </PopoverContent>
          </Popover>
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
        ) : <p className="rounded-lg bg-[var(--nayin-surface)] p-3 text-xs leading-6 text-muted-foreground">还没有配图。可以取消“包含封面”制作纯文字图片，或点击右上角“生成封面”。</p>}
        {albumQuery.error ? <p className="text-xs text-destructive">画册图片读取失败，请刷新后重试。封面候选仍可使用。</p> : null}
        {cover?.warning || illustration?.warning || bodyTexture?.warning ? <p className="text-xs text-amber-700">所选配图：{[cover?.warning, illustration?.warning, bodyTexture?.warning].filter(Boolean).join("、")}，发送前请检查画面。</p> : null}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs">横版插图 <span className="text-muted-foreground">· 16:9 · 延续所选封面的画风</span></p>
            {onGenerateIllustration ? <Popover open={illustrationSetup} onOpenChange={setIllustrationSetup}>
              <PopoverTrigger asChild><button type="button" className={control} disabled={!cover || coverBusy || !coverAssets.some(asset => asset.id === cover.id)}>生成插图</button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-sm font-medium">生成横版插图 · 16:9</p>
                <textarea aria-label="插图内容" className={`${control} w-full`} rows={3} value={illustrationInstruction} onChange={event => setIllustrationInstruction(event.target.value)} maxLength={1000} placeholder="想画什么？留空则根据文章内容生成" />
                <button type="button" className={control} disabled={!cover || coverBusy || illustrationCost == null} onClick={() => { if (cover) { setIllustrationSetup(false); void onGenerateIllustration(cover.id, illustrationInstruction); } }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button>
                <p className="text-[11px] text-muted-foreground">继承当前封面的画风；生成后选择喜欢的一张。</p>
              </PopoverContent>
            </Popover> : null}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="横版插图候选">
            <button type="button" className={`${control} aspect-video w-32 shrink-0 ${!illustration ? "border-[var(--nayin-accent)]" : ""}`} aria-pressed={!illustration} onClick={() => update({ illustrationId: null })}>不插图</button>
            {illustrations.map(asset => <ImageCandidatePreview key={asset.id} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />}><button type="button" className={`w-32 shrink-0 rounded border-2 p-1 ${illustration?.id === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用插图：${asset.label}`} aria-pressed={illustration?.id === asset.id} onClick={() => update({ illustrationId: asset.id })}>
              <img src={asset.imageUrl} alt={asset.label} className="aspect-video w-full object-contain" />
              {asset.kind !== "illustration" ? <span className="text-[10px] text-muted-foreground">保留的原配图</span> : null}
              {asset.kind === "illustration" && asset.parentAssetId !== cover?.id ? <span className="text-[10px] text-muted-foreground">来自其他封面</span> : null}
              {asset.warning ? <span className="text-[10px] text-amber-700">{asset.warning}</span> : null}
            </button></ImageCandidatePreview>)}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs">整套底图 <span className="text-muted-foreground">· {cover ? palette ? "封面与正文共用" : theme?.error ? "取色未完成" : "正在读取封面颜色…" : "选封面后自动配色"}</span></p>
            {onGenerateTexture ? <Popover open={textureSetup} onOpenChange={setTextureSetup}>
              <PopoverTrigger asChild><button type="button" className={control} disabled={!cover || coverBusy || !coverAssets.some(asset => asset.id === cover.id)}>生成底图</button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3">
                <p className="text-sm font-medium">生成花纹底图 · 3:4</p>
                <textarea aria-label="底图花纹要求" className={`${control} w-full`} rows={3} value={textureInstruction} onChange={event => setTextureInstruction(event.target.value)} maxLength={1000} placeholder="例如：细腻纸纹、淡淡水彩、稀疏植物纹样" />
                <button type="button" className={control} disabled={!cover || coverBusy || illustrationCost == null} onClick={() => { if (cover) { setTextureSetup(false); void onGenerateTexture(cover.id, textureInstruction); } }}>确认生成 4 张 · ¥{illustrationCost?.toFixed(2)}</button>
                <p className="text-[11px] text-muted-foreground">连续的无框纸纹，中间浅净。点击底图即可自动生成文字图片。</p>
              </PopoverContent>
            </Popover> : null}
          </div>
          {theme?.url === cover?.imageUrl && theme?.error ? <p role="alert" className="text-xs text-destructive">{theme.error} <button type="button" onClick={() => setThemeRetry(value => value + 1)}>重试取色</button></p> : null}
          <div className="flex gap-2 overflow-x-auto pb-2" role="group" aria-label="正文纹理">
            {assets.filter(asset => asset.kind === "body-texture").map(asset => <ImageCandidatePreview key={asset.id} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />}>
              <button type="button" className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs ${bodyTexture?.id === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用底图：${asset.label}`} aria-pressed={bodyTexture?.id === asset.id} onClick={() => { update({ bodyTextureId: asset.id }); setSelectedPage(settings.includeCover ? 1 : 0); }}>
                <img src={asset.imageUrl} alt={asset.label} className="aspect-[3/4] w-full rounded object-cover" />
                <span className="block py-1">花纹底图</span>
                {asset.warning ? <span className="text-[10px] text-amber-700">{asset.warning}</span> : null}
              </button>
            </ImageCandidatePreview>)}
            {materials.map(({texture, seed}) => <ImageCandidatePreview key={`${texture}:${seed}`} label={`${IMAGE_PACK_TEXTURES[texture]} ${seed + 1}`} preview={<MaterialSwatch palette={palette ?? IMAGE_PACK_STYLES.sage} texture={texture} seed={seed} />}><button type="button" className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs transition-colors ${settings.bodyTextureId == null && settings.texture === texture && settings.textureSeed === seed ? "border-[var(--nayin-accent)]" : "border-transparent"}`} aria-label={`选用底图：${IMAGE_PACK_TEXTURES[texture]} ${seed + 1}`} aria-pressed={settings.bodyTextureId == null && settings.texture === texture && settings.textureSeed === seed} onClick={() => { update({ texture, textureSeed: seed, bodyTextureId: null }); setSelectedPage(settings.includeCover ? 1 : 0); }}>
              <MaterialSwatch palette={palette ?? IMAGE_PACK_STYLES.sage} texture={texture} seed={seed} /><span className="block py-1">{IMAGE_PACK_TEXTURES[texture]} · {seed + 1}</span>
            </button></ImageCandidatePreview>)}
          </div>
          <button type="button" className="text-xs text-muted-foreground underline" disabled={palettePending} onClick={() => update({ materialBatch: settings.materialBatch + 1 })}>换一组免费纹理</button>
        </div>
        <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">调整标题、字体与插图位置</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs">封面文字
            <input aria-label="封面文字" value={options.title} onChange={event => update({ title: event.target.value })} maxLength={200} className={control} placeholder="默认使用文章标题，也可以自己填写" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">正文插图
            <select aria-label="正文插图" value={settings.illustrationId ?? ""} onChange={event => update({ illustrationId: event.target.value ? Number(event.target.value) : null })} className={control}>
              <option value="">不插入配图</option>
              {assets.filter(asset => asset.kind !== "body-texture").map(asset => <option key={asset.id} value={asset.id}>{asset.label}</option>)}
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
        </details>
        <p className="text-xs leading-6 text-muted-foreground" role="status">
          {progress ? <><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />{progress}</> : needsCover ? "先选一张封面，下方自动生成成品。" : missingTexture ? "所选底图已不可用，请重新选择。" : missingIllustration ? "所选插图已不可用，请重新选择。" : "选好即出图 · 免费自动排版"}
        </p>
        {error ? <p role="alert" className="text-xs text-destructive">{error} <button type="button" className="underline" onClick={() => setRenderAttempt(value => value + 1)}>重试排版</button></p> : null}
        {output ? (
          <div className="border-t border-[var(--panel-border)] pt-4">
            <h3 className="mb-2 text-sm font-medium">成品预览 · 实际导出的图片</h3>
            <p className="mb-3 text-xs text-muted-foreground">{stale ? "正在按最新选择更新，完成后即可发送。" : "图片已做好，预览与下载一致。选择一页即可复制。"}</p>
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
              <button type="button" disabled={!ready} onClick={() => void share()} className={control}><Share2 className="mr-1 inline h-3.5 w-3.5" />分享</button>
              {selected ? <a href={ready ? selected.url : undefined} download={selected.filename} aria-disabled={!ready} className={control}>下载当前图片</a> : null}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">整套下载若被浏览器拦截，可逐张下载。支持系统分享的浏览器可以直接发送。排版设置保存在此浏览器；刷新后自动恢复排版。</p>
          </div>
        ) : null}
        {advancedEditor ? <details open={advancedOpen} onToggle={event => onAdvancedOpenChange?.(event.currentTarget.open)} className="border-t border-[var(--panel-border)] pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">已有画册 · 逐页精细排版</summary>{advancedOpen ? advancedEditor : null}</details> : null}
      </div>
    </section>
  );
}
