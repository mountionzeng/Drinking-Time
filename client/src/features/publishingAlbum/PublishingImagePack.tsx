import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { ArtworkShareDialog } from "./ArtworkShareDialog";
import { ArchiveArtworkButton } from "./ArchiveArtworkButton";
import { SharedLayoutBar } from "./SharedLayoutBar";
import { ChapterWorkspace } from "./ChapterWorkspace";
import type { ChapterEdit } from "./useChapters";
import {
  buildSharedLayoutPackage,
  sharedLayoutAssets,
  sharedLayoutSettings,
  type SharedLayoutStored,
} from "./sharedLayoutClient";
import { formatComputeQuote } from "@shared/computeMoney";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, ImagePlus, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { installedPublishingAlbumFonts } from "@shared/publishingAlbumFonts";
import { downloadPublishingAlbumBlob } from "./publishingAlbumExport";
import { ImagePackCopyDialog } from "./ImagePackCopyDialog";
import { imagePackCopyText } from "./imagePackCopy";
import {
  IMAGE_PACK_STYLES,
  makeImagePack,
  type ImagePackOptions,
  type ImagePackResult,
  type PackAsset,
} from "./imagePackComposition";
import {
  drawPaperMaterial,
  IMAGE_PACK_TEXTURES,
  readImagePackPalettes,
  type ImagePackPalette,
  type ImagePackTexture,
} from "./imagePackMaterial";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { ImageCandidatePreview } from "./ImageCandidatePreview";
import { storyLibraryImages, readStoryLocalImages } from "./storyImageLibrary";
import type { StudioCreateRequest } from "../publishingDraft/StudioCreateMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ImagePackModuleEditor,
  type ImagePackModuleEditorHandle,
} from "./ImagePackModuleEditor";
import { makeModulePack } from "./imagePackModuleRenderer";
import {
  moduleStorageKey,
  readModuleDocument,
  type ModuleDocument,
} from "./imagePackModules";
import { useLocalPackImages } from "./useLocalPackImages";
import {
  imagePackParagraphs,
  readIllustrationPlacements,
  resolveIllustrationOffset,
  type IllustrationPlacement,
} from "./imagePackIllustrations";

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
  try {
    return normalizeSettings(
      JSON.parse(localStorage.getItem(key) ?? "null"),
      coverId
    );
  } catch {
    return normalizeSettings(null, coverId);
  }
}

/** Validate saved or shared quick-layout settings against what this device supports. */
function normalizeSettings(value: any, coverId: number | null): Settings {
  const fallback: Settings = {
    title: null,
    coverId,
    illustrations: [],
    bodyTextureId: null,
    includeCover: true,
    style: "sage",
    fontId: "noto-serif-sc",
    texture: "paper",
    textureSeed: 0,
    materialBatch: 0,
  };
  try {
    if (!value || typeof value !== "object") return fallback;
    return {
      title: typeof value.title === "string" ? value.title : null,
      coverId: typeof value.coverId === "number" ? value.coverId : coverId,
      illustrations: readIllustrationPlacements(value),
      bodyTextureId:
        typeof value.bodyTextureId === "number" ? value.bodyTextureId : null,
      includeCover:
        typeof value.includeCover === "boolean" ? value.includeCover : true,
      style: Object.hasOwn(IMAGE_PACK_STYLES, value.style)
        ? value.style
        : "sage",
      fontId: installedPublishingAlbumFonts().some(
        font => font.fontId === value.fontId
      )
        ? value.fontId
        : "noto-serif-sc",
      texture: Object.hasOwn(IMAGE_PACK_TEXTURES, value.texture)
        ? value.texture
        : "paper",
      textureSeed:
        Number.isSafeInteger(value.textureSeed) && value.textureSeed >= 0
          ? value.textureSeed
          : 0,
      materialBatch:
        Number.isSafeInteger(value.materialBatch) && value.materialBatch >= 0
          ? value.materialBatch
          : 0,
    };
  } catch {
    return fallback;
  }
}

const control =
  "rounded-lg border border-[var(--panel-border)] bg-transparent px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40";

function GenerationWait({ startedAt }: { startedAt: number }) {
  const t = useUiText();

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return (
    <p className="text-xs leading-6 text-muted-foreground" role="status">
      <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
      {t("正在生成配图 · 已等待 {0} 分 {1} 秒", [
        Math.floor(seconds / 60),
        seconds % 60,
      ])}
    </p>
  );
}

function MaterialSwatch({
  palette,
  texture,
  seed,
}: {
  palette: ImagePackPalette;
  texture: ImagePackTexture;
  seed: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (context) drawPaperMaterial(context, 300, 400, palette, texture, seed);
  }, [palette, texture, seed]);
  return (
    <canvas
      ref={ref}
      width={300}
      height={400}
      aria-hidden="true"
      className="aspect-[3/4] w-full rounded"
    />
  );
}

export function PublishingImagePack(props: React.ComponentProps<typeof PublishingImagePackCanvas>) {
  const enabled = trpc.chapters.enabled.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [chaptersMounted, setChaptersMounted] = useState(false);
  if (!enabled.data?.enabled || props.storyId <= 0) return <PublishingImagePackCanvas {...props} />;
  return <section className="space-y-3">
    <nav aria-label="平台稿与章节" className="flex gap-2 text-sm">
      <button className="rounded px-3 py-2 focus-visible:ring-2" aria-pressed={!chaptersOpen} onClick={() => setChaptersOpen(false)}>平台图稿</button>
      <button className="rounded px-3 py-2 focus-visible:ring-2" aria-pressed={chaptersOpen} onClick={() => { setChaptersMounted(true); setChaptersOpen(true); }}>章节排版</button>
    </nav>
    <div hidden={chaptersOpen}><PublishingImagePackCanvas {...props} active={(props.active ?? true) && !chaptersOpen} /></div>
    {chaptersMounted && <div hidden={!chaptersOpen}><ChapterWorkspace key={props.storyId} {...props} active={(props.active ?? true) && chaptersOpen} render={chapterProps => <PublishingImagePackCanvas key={chapterProps.scope} {...chapterProps} />} /></div>}
  </section>;
}

export function PublishingImagePackCanvas({
  chapterSession,
  scope,
  storyId,
  versionId,
  hasAlbum,
  title,
  body,
  assets: coverAssets,
  adoptedCoverId,
  onOpenCoverStudio,
  coverBusy,
  generationBlockedReason,
  onSaveDraft,
  savingDraft = false,
  advancedEditor,
  advancedOpen,
  onAdvancedOpenChange,
  onGenerateIllustration,
  onGenerateCover,
  onGenerateTexture,
  illustrationCost,
  generationStartedAt,
  generationError,
  onIllustrationsChange,
  mobile = false,
  initialMobileStep = "preview",
  onPrepareGeneration,
  shareEpoch = 0,
  contentKind = "article",
  sharePlatform = "xiaohongshu",
  active = true,
  accountId,
  createRequest,
  onCreateRequestHandled,
}: {
  chapterSession?: {
    initial: ModuleDocument | null;
    legacyScope?: string;
    imageOptions?: Pick<ImagePackOptions, "coverUrl" | "bodyTextureUrl" | "illustrations">;
    settings: ChapterEdit["settings"];
    change(edit: ChapterEdit): void;
    prepare: React.MutableRefObject<(() => Promise<void>) | null>;
  };
  createRequest?: StudioCreateRequest | null;
  onCreateRequestHandled?: () => void;
  accountId?: number | null;
  active?: boolean;
  sharePlatform?: import("@shared/sharePermissions").SharedWork["platform"];
  contentKind?: "article" | "memory";
  mobile?: boolean;
  initialMobileStep?: "preview" | "images" | "layout";
  onPrepareGeneration?: () => void;
  shareEpoch?: number;
  scope: string;
  storyId: number;
  versionId: string;
  hasAlbum: boolean;
  title: string;
  body: string;
  assets: PackAsset[];
  adoptedCoverId: number | null;
  onOpenCoverStudio?(): void;
  coverBusy: boolean;
  generationBlockedReason?: string | null;
  onSaveDraft?(): Promise<void>;
  savingDraft?: boolean;
  generationError?: string;
  advancedEditor?: ReactNode;
  advancedOpen?: boolean;
  onAdvancedOpenChange?(open: boolean): void;
  onGenerateIllustration?(coverId: number, instruction: string, selectedText?: string): Promise<void>;
  onGenerateCover?(instruction: string, selectedText?: string): Promise<void>;
  onGenerateTexture?(coverId: number, instruction: string): Promise<void>;
  illustrationCost?: number;
  generationStartedAt?: number;
  onIllustrationsChange?(placements: IllustrationPlacement[]): void;
}) {
  const t = useUiText();

  const key = `publishing-image-pack:${scope}`;
  const localImages = useLocalPackImages(scope);
  const [desktopSection, setDesktopSection] = useState<"images" | "layout">(
    "images"
  );
  const [storyGenerate, setStoryGenerate] = useState(false);
  const [addImageOpen, setAddImageOpen] = useState(false);
  const [insertRequest, setInsertRequest] = useState<{ id: string; asset: PackAsset } | null>(null);
  const liveBasis = useRef<string | null>(null);
  const [liveDocument, setLiveDocument] = useState<ModuleDocument | null>(null);
  const [layoutGenerate, setLayoutGenerate] = useState(false);
  const [layoutSelectedText, setLayoutSelectedText] = useState("");
  const [layoutInstruction, setLayoutInstruction] = useState("");
  const libraryUpload = useRef<HTMLInputElement>(null);
  const moduleEditor = useRef<ImagePackModuleEditorHandle>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);
  // Whether this device already had quick-layout settings when the editor opened.
  const [hadSettings] = useState(() => {
    try {
      return localStorage.getItem(key) != null;
    } catch {
      return true;
    }
  });
  const [settings, setSettings] = useState(() => {
    const value = chapterSession?.settings
      ? normalizeSettings(chapterSession.settings, adoptedCoverId)
      : readSettings(chapterSession?.legacyScope ? `publishing-image-pack:${chapterSession.legacyScope}` : key, adoptedCoverId);
    if (adoptedCoverId == null && !chapterSession?.legacyScope) {
      try {
        if (!localStorage.getItem(key)) value.includeCover = false;
      } catch {
        value.includeCover = false;
      }
    }
    // A mirrored text chapter can inherit default settings without an actual
    // cover. Do not block every image insertion on that nonexistent cover.
    if (chapterSession && value.coverId == null && !chapterSession.imageOptions?.coverUrl)
      value.includeCover = false;
    if (chapterSession?.imageOptions?.coverUrl) value.includeCover = true;
    return value;
  });
  const [mobileStep, setMobileStep] = useState<"preview" | "images" | "layout">(
    initialMobileStep
  );
  useEffect(() => {
    onIllustrationsChange?.(settings.illustrations);
  }, [onIllustrationsChange, settings.illustrations]);
  const albumQuery = trpc.publishingDraft.readAlbum.useQuery(
    { storyId, versionId },
    { enabled: hasAlbum && storyId > 0, retry: false }
  );
  // Layouts (and their pictures) shared with this story by the author or a friend.
  const layoutQuery = trpc.artworkShare.layout.useQuery(
    { storyId },
    { enabled: storyId > 0, retry: false, refetchOnWindowFocus: false }
  );
  const sharedAssets = useMemo(
    () => sharedLayoutAssets(layoutQuery.data),
    [layoutQuery.data]
  );
  const materialQuery = trpc.storyAgent.storyMaterialState.useQuery(
    { storyId },
    { enabled: storyId > 0 && active, retry: false, refetchOnWindowFocus: true }
  );
  const storyAssets = useMemo(() => storyLibraryImages(storyId, materialQuery.data), [storyId, materialQuery.data]);
  const assets = useMemo(() => {
    const all = new Map(coverAssets.map(asset => [asset.id, asset]));
    const warnings = new Map<number, string>();
    for (const page of albumQuery.data?.album?.pages ?? []) {
      for (const round of page.backgroundRounds) {
        for (const id of round.assetIds)
          if (round.qualityCheckUnavailable) warnings.set(id, "质检未完成");
        for (const id of round.qualityFlaggedAssetIds)
          warnings.set(id, "疑似含字");
      }
    }
    for (const asset of albumQuery.data?.assets ?? []) {
      if (!all.has(asset.id))
        all.set(asset.id, {
          ...asset,
          label: `画册底图 ${asset.id}`,
          warning: warnings.get(asset.id),
        });
    }
    for (const asset of sharedAssets)
      if (!all.has(asset.id)) all.set(asset.id, asset);
    for (const asset of storyAssets)
      if (!all.has(asset.id)) all.set(asset.id, asset);
    return Array.from(all.values());
  }, [coverAssets, albumQuery.data, sharedAssets, storyAssets]);
  const layoutAssets = useMemo(() => {
    const all = new Map(assets.map(asset => [asset.id, asset]));
    if (typeof localStorage !== "undefined") {
      for (const asset of readStoryLocalImages(storyId, localStorage, accountId)) all.set(asset.id, asset);
    }
    for (const asset of localImages.images) all.set(asset.id, asset);
    return [...all.values()];
  }, [assets, localImages.images, storyId, accountId]);
  const cover = assets.find(asset => asset.id === settings.coverId);
  const referenceCovers = coverAssets.filter(asset => !asset.kind);
  const generationCover = referenceCovers.find(asset => asset.id === cover?.id);
  const selectedIllustrations = settings.illustrations.map(placement =>
    assets.find(asset => asset.id === placement.assetId)
  );
  const paragraphs = useMemo(() => imagePackParagraphs(body), [body]);
  const bodyTexture = assets.find(
    asset =>
      asset.id === settings.bodyTextureId && asset.kind === "body-texture"
  );
  const [theme, setTheme] = useState<{
    source: string;
    palette?: ImagePackPalette;
    paperPalette?: ImagePackPalette;
    error?: string;
  } | null>(null);
  const colorSource = JSON.stringify({
    coverUrl: cover?.imageUrl,
    illustrationUrls: [
      ...new Set(
        selectedIllustrations.flatMap(asset => (asset ? [asset.imageUrl] : []))
      ),
    ],
  });
  const hasColorSource = Boolean(cover || selectedIllustrations.some(Boolean));
  const [themeRetry, setThemeRetry] = useState(0);
  const [illustrationSetup, setIllustrationSetup] = useState(false);
  const [illustrationInstruction, setIllustrationInstruction] = useState("");
  const [textureSetup, setTextureSetup] = useState(false);
  const [textureInstruction, setTextureInstruction] = useState("");
  const [coverSetup, setCoverSetup] = useState(false);
  const [coverInstruction, setCoverInstruction] = useState("");
  useEffect(() => {
    if (!createRequest || createRequest.storyId !== storyId) return;
    if (createRequest.kind === "layout") {
      setDesktopSection("layout");
      if (mobile) setMobileStep("layout");
      onCreateRequestHandled?.();
      return;
    }
    if (createRequest.kind !== "image") return;
    setDesktopSection("images");
    if (mobile) setMobileStep("images");
    setCoverInstruction(createRequest.instruction.slice(0, 1000));
    setStoryGenerate(true);
    onCreateRequestHandled?.();
  }, [createRequest, storyId, mobile, onCreateRequestHandled]);
  const materials = Object.keys(IMAGE_PACK_TEXTURES).flatMap(texture =>
    [0, 1].map(variant => ({
      texture: texture as ImagePackTexture,
      seed: settings.materialBatch * 2 + variant,
    }))
  );
  if (
    !materials.some(
      item =>
        item.texture === settings.texture && item.seed === settings.textureSeed
    )
  )
    materials.unshift({
      texture: settings.texture,
      seed: settings.textureSeed,
    });
  useEffect(() => {
    if (!hasColorSource) return;
    const controller = new AbortController();
    const { coverUrl, illustrationUrls } = JSON.parse(colorSource);
    setTheme({ source: colorSource });
    void readImagePackPalettes(coverUrl, illustrationUrls, controller.signal)
      .then(colors => {
        if (!controller.signal.aborted)
          setTheme({ source: colorSource, ...colors });
      })
      .catch(cause => {
        if (!controller.signal.aborted)
          setTheme({
            source: colorSource,
            error: cause instanceof Error ? cause.message : "图片取色失败",
          });
      });
    return () => controller.abort();
  }, [colorSource, hasColorSource, themeRetry]);
  const currentTheme = theme?.source === colorSource ? theme : null;
  const palette = currentTheme?.palette;
  const paperPalette = currentTheme?.paperPalette;
  const palettePending = hasColorSource && !paperPalette;
  // Keep every paid illustration available when the user changes covers.
  // Partition in O(n), placing the current cover's candidates first.
  const availableIllustrations = assets.filter(
    asset =>
      asset.kind === "illustration" ||
      settings.illustrations.some(placement => placement.assetId === asset.id)
  );
  const illustrations = [
    ...availableIllustrations.filter(
      asset => asset.parentAssetId === cover?.id
    ),
    ...availableIllustrations.filter(
      asset => asset.parentAssetId !== cover?.id
    ),
  ];
  const options = useMemo<ImagePackOptions>(
    () => ({
      ...(chapterSession ? { fitOverflowText: true } : {}),
      title: settings.title ?? title,
      body,
      fontId: settings.fontId,
      style: settings.style,
      includeCover: settings.includeCover,
      texture: settings.texture,
      textureSeed: settings.textureSeed,
      coverUrl: cover?.imageUrl ?? chapterSession?.imageOptions?.coverUrl,
      bodyTextureUrl: bodyTexture?.imageUrl ?? chapterSession?.imageOptions?.bodyTextureUrl,
      illustrations: settings.illustrations.length ? settings.illustrations.map(placement => ({
        after: placement.after,
        imageUrl:
          assets.find(asset => asset.id === placement.assetId)?.imageUrl ?? "",
      })) : chapterSession?.imageOptions?.illustrations ?? [],
      palette,
      paperPalette: bodyTexture ? undefined : paperPalette,
    }),
    [
      settings.title,
      title,
      body,
      settings.fontId,
      settings.style,
      settings.includeCover,
      settings.illustrations,
      settings.texture,
      settings.textureSeed,
      cover?.imageUrl,
      assets,
      bodyTexture?.imageUrl,
      palette,
      paperPalette,
      chapterSession?.imageOptions,
      Boolean(chapterSession),
    ]
  );
  const basis = JSON.stringify(options);
  const storedModules = useMemo(() => {
    try {
      const storageKey = moduleStorageKey(scope, basis);
      const availableUrls = layoutAssets.map(asset => asset.imageUrl);
      return (
        readModuleDocument(
          localStorage.getItem(`${storageKey}:draft`),
          JSON.parse(basis),
          availableUrls
        ) ??
        readModuleDocument(
          localStorage.getItem(storageKey),
          JSON.parse(basis),
          availableUrls
        ) ?? (chapterSession?.legacyScope ? readModuleDocument(localStorage.getItem(`${moduleStorageKey(chapterSession.legacyScope, basis)}:draft`) ?? localStorage.getItem(moduleStorageKey(chapterSession.legacyScope, basis)), JSON.parse(basis), availableUrls) : null)
      );
    } catch {
      return null;
    }
  }, [scope, basis, layoutAssets]);
  const [moduleOverride, setModuleOverride] = useState<{
    basis: string;
    document: ModuleDocument;
  } | null>(null);
  const blankDocument = useMemo<ModuleDocument>(() => ({
    version: 1, flowVersion: 1, pages: [{ label: "第 1 页", modules: [] }],
  }), []);
  const modules =
    (moduleOverride?.basis === basis ? moduleOverride.document : chapterSession?.initial ?? storedModules) ??
    (!body.trim() ? blankDocument : null);
  function chapterEdit(layout: ModuleDocument | null): ChapterEdit {
    return { layout, settings: { fontId: settings.fontId, style: settings.style, texture: settings.texture, textureSeed: settings.textureSeed },
      media: { coverKey: options.includeCover ? options.coverUrl ?? null : null, bodyTextureKey: options.bodyTextureUrl ?? null,
        illustrations: (options.illustrations ?? []).map(item => ({ key: item.imageUrl, after: item.after })) } };
  }
  useEffect(() => {
    if (chapterSession && liveDocument && liveBasis.current === basis)
      chapterSession.change(chapterEdit(liveDocument));
  }, [liveDocument, settings.fontId, settings.style, settings.texture, settings.textureSeed, options.coverUrl, options.bodyTextureUrl, options.illustrations, chapterSession?.change]);
  useEffect(() => {
    if (!chapterSession) return;
    chapterSession.prepare.current = async () => {
      const prepared = await moduleEditor.current?.prepare();
      if (moduleEditor.current && !prepared) throw new Error("请完成当前文字编辑后再切换章节");
      if (prepared) return;
      const layout = liveDocument ?? modules;
      chapterSession.change(chapterEdit(layout));
    };
    return () => { chapterSession.prepare.current = null; };
  });
  const usedImages = new Set((liveDocument ?? modules)?.pages.flatMap(page =>
    page.modules.flatMap(module => module.kind === "image" ? [module.imageUrl] : [])
  ) ?? []);
  for (const placement of settings.illustrations) {
    const asset = assets.find(item => item.id === placement.assetId);
    if (asset) usedImages.add(asset.imageUrl);
  }
  if (settings.includeCover && cover) usedImages.add(cover.imageUrl);
  function useImageInLayout(asset: PackAsset) {
    if (asset.warning === "原文件缺失") return;
    if (needsCover || missingTexture || missingIllustration) {
      toast.error("当前排版有不可用的封面、底图或插图，请先在下方设置中重新选择。");
      return;
    }
    setInsertRequest({ id: crypto.randomUUID(), asset });
    setDesktopSection("layout");
    if (mobile) setMobileStep("layout");
  }
  const [moduleSession, setModuleSession] = useState<{
    basis: string;
    options: ImagePackOptions;
    initial: ModuleDocument | null;
  } | null>(null);
  const signature = JSON.stringify({ options, modules });
  const currentBasis = useRef(basis);
  currentBasis.current = basis;
  const [output, setOutput] = useState<{
    signature: string;
    pages: (ImagePackResult & { url: string })[];
  } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [error, setError] = useState("");
  const [renderAttempt, setRenderAttempt] = useState(0);
  const previewUrls = useRef<string[]>([]);
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const stale = output !== null && output.signature !== signature;
  const selected = output?.pages[selectedPage];
  const ready = Boolean(
    selected &&
      !stale &&
      !progress &&
      !preparingPreview &&
      (!moduleSession || (mobile && mobileStep === "preview"))
  );
  const shareFiles = useMemo(
    () =>
      output?.pages.map(
        page => new File([page.blob], page.filename, { type: "image/png" })
      ) ?? [],
    [output]
  );
  const canShareImages =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    shareFiles.length > 0 &&
    Boolean(navigator.canShare?.({ files: shareFiles }));
  const needsCover = settings.includeCover && !cover && !chapterSession?.imageOptions?.coverUrl;
  const missingIllustration = selectedIllustrations.some(asset => !asset);
  const missingTexture = settings.bodyTextureId != null && !bodyTexture;

  useEffect(() => {
    if (
      (mobile ? mobileStep === "layout" : desktopSection === "layout") &&
      !materialQuery.isLoading &&
      !moduleSession &&
      output &&
      !stale &&
      !progress
    )
      setModuleSession({ basis, options: JSON.parse(basis), initial: modules });
  }, [
    mobile,
    materialQuery.isLoading,
    mobileStep,
    desktopSection,
    moduleSession,
    output,
    stale,
    progress,
    basis,
    modules,
  ]);
  useEffect(() => {
    if (error && insertRequest) setInsertRequest(null);
  }, [error, insertRequest]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      /* Preview remains usable when storage is unavailable. */
    }
  }, [key, settings]);
  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
    },
    []
  );
  useEffect(() => {
    setError("");
    setProgress(null);
    // Equivalent assets from a background refetch must not restart rendering
    // and unmount the share dialog. Render only when actual inputs change.
    const { options: renderOptions, modules: renderModules } = JSON.parse(
      signature
    ) as { options: ImagePackOptions; modules: ModuleDocument | null };
    if (output?.signature === signature) return;
    if (
      needsCover ||
      missingIllustration ||
      missingTexture ||
      palettePending
    )
      return;
    const controller = new AbortController();
    setProgress("正在更新图片…");
    // Coalesce typing and quick candidate changes before starting PNG work.
    const timer = window.setTimeout(() => {
      void (
        renderModules
          ? makeModulePack(renderOptions, renderModules, controller.signal)
          : makeImagePack(
              renderOptions,
              (done, total) => {
                if (!controller.signal.aborted)
                  setProgress(`排版 ${done}/${total}`);
              },
              controller.signal
            )
      )
        .then(pages => {
          if (
            controller.signal.aborted ||
            currentSignature.current !== signature
          )
            return;
          const prepared = pages.map(page => ({
            ...page,
            url: URL.createObjectURL(page.blob),
          }));
          for (const url of previewUrls.current) URL.revokeObjectURL(url);
          previewUrls.current = prepared.map(page => page.url);
          setOutput({ signature, pages: prepared });
          setSelectedPage(index => Math.min(index, pages.length - 1));
        })
        .catch(cause => {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error ? cause.message : "排版失败，请重试"
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setProgress(null);
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    signature,
    needsCover,
    missingIllustration,
    missingTexture,
    palettePending,
    renderAttempt,
  ]);

  function update(patch: Partial<Settings>) {
    setSettings(value => ({ ...value, ...patch }));
  }

  // Hand-placed modules of an applied shared layout wait until its settings,
  // pictures and derived paper colors resolve, then save under the new basis.
  const [pendingLayoutModules, setPendingLayoutModules] =
    useState<ModuleDocument | null>(null);
  const paletteSettled =
    !hasColorSource ||
    Boolean(currentTheme?.paperPalette || currentTheme?.error);
  useEffect(() => {
    if (!pendingLayoutModules || !paletteSettled) return;
    const urls = new Set(layoutAssets.map(asset => asset.imageUrl));
    if (
      pendingLayoutModules.pages.some(page =>
        page.modules.some(
          module => module.kind === "image" && !urls.has(module.imageUrl)
        )
      )
    )
      return;
    setPendingLayoutModules(null);
    const document = readModuleDocument(
      JSON.stringify(pendingLayoutModules),
      JSON.parse(basis),
      [...urls]
    );
    if (!document) {
      toast.error(t("这套排版的手动摆放无法套用，已改用自动排版"));
      return;
    }
    try {
      const storageKey = moduleStorageKey(scope, basis);
      localStorage.removeItem(`${storageKey}:draft`);
      localStorage.setItem(storageKey, JSON.stringify(document));
    } catch {
      /* The applied layout still shows for this session. */
    }
    setModuleOverride({ basis, document });
  }, [pendingLayoutModules, paletteSettled, layoutAssets, basis, scope, t]);

  /** Apply a whole shared layout page set; returns an undo. */
  function applySharedLayout(layout: SharedLayoutStored) {
    const previous = settings;
    const previousOverride = moduleOverride;
    setSettings(value => ({
      ...normalizeSettings(
        { ...value, ...sharedLayoutSettings(layout) },
        adoptedCoverId
      ),
      materialBatch: value.materialBatch,
    }));
    setPendingLayoutModules(layout.modules);
    setModuleOverride(null);
    setModuleSession(null);
    return () => {
      setPendingLayoutModules(null);
      setModuleOverride(previousOverride);
      setModuleSession(null);
      setSettings(previous);
    };
  }
  // A friend's copy opens with the author's layout once, unless this device
  // already has its own layout settings.
  const seededLayout = useRef(hadSettings);
  useEffect(() => {
    const inherited = layoutQuery.data?.inherited;
    if (seededLayout.current || !inherited) return;
    seededLayout.current = true;
    applySharedLayout(inherited);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutQuery.data]);

  function buildLayoutPackage() {
    return buildSharedLayoutPackage({
      settings: {
        title: settings.title?.slice(0, 200) ?? null,
        style: settings.style,
        fontId: settings.fontId,
        texture: settings.texture,
        textureSeed: settings.textureSeed,
        includeCover: settings.includeCover,
      },
      coverUrl: cover?.imageUrl ?? chapterSession?.imageOptions?.coverUrl,
      bodyTextureUrl: bodyTexture?.imageUrl ?? chapterSession?.imageOptions?.bodyTextureUrl,
      illustrations: settings.illustrations.flatMap(placement => {
        const asset = assets.find(item => item.id === placement.assetId);
        return asset ? [{ imageUrl: asset.imageUrl, after: placement.after }] : [];
      }),
      modules,
    });
  }
  async function changeMobileStep(step: "preview" | "images" | "layout") {
    if (preparingPreview) return;
    if (step === "preview" && moduleSession && moduleSession.basis === basis) {
      setPreparingPreview(true);
      try {
        if (!(await moduleEditor.current?.prepare())) {
          setMobileStep("layout");
          return;
        }
      } finally {
        setPreparingPreview(false);
      }
    }
    setMobileStep(step);
  }
  function referenceCoverPicker() {
    return referenceCovers.length ? (
      <div className="space-y-2">
        <p className="text-xs">{t("选择参考封面")}</p>
        <div
          className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto"
          role="group"
          aria-label={t("参考封面")}
        >
          {referenceCovers.map(asset => (
            <button
              key={asset.id}
              type="button"
              disabled={coverBusy}
              aria-label={t("参考封面：{0}", [asset.label])}
              onClick={() => update({ coverId: asset.id })}
              className="min-w-0 rounded-md border border-[var(--panel-border)] p-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] disabled:opacity-40"
            >
              <img
                src={asset.imageUrl}
                alt=""
                className="aspect-[3/4] w-full rounded object-cover"
              />
              <span className="block truncate">{asset.label}</span>
              {asset.warning ? (
                <span className="text-[10px] text-amber-700">
                  {asset.warning}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    ) : (
      <button
        type="button"
        className={control}
        disabled={coverBusy}
        onClick={() => {
          setIllustrationSetup(false);
          setTextureSetup(false);
          setCoverSetup(true);
        }}
      >
        {t("先生成封面")}
      </button>
    );
  }
  function toggleIllustration(assetId: number) {
    setSettings(value => ({
      ...value,
      illustrations: value.illustrations.some(item => item.assetId === assetId)
        ? value.illustrations.filter(item => item.assetId !== assetId)
        : [...value.illustrations, { assetId, after: null }],
    }));
  }
  function addIllustration(assetId: number) {
    setSettings(value =>
      value.illustrations.some(item => item.assetId === assetId)
        ? value
        : {
            ...value,
            illustrations: [...value.illustrations, { assetId, after: null }],
          }
    );
  }
  function illustrationControls(
    asset: PackAsset,
    placement: IllustrationPlacement | undefined
  ) {
    if (!placement)
      return (
        <button
          type="button"
          className={`${control} w-full`}
          onClick={() => addIllustration(asset.id)}
        >
          {t("插入正文")}
        </button>
      );
    const offset = resolveIllustrationOffset(paragraphs, placement.after);
    const position =
      offset === null ? "missing" : offset === 0 ? "start" : String(offset);
    return (
      <div
        className="space-y-2"
        role="group"
        aria-label={t("插图位置：{0}", [asset.label])}
      >
        <label className="block space-y-1 text-xs">
          <span>{t("插入位置")}</span>
          <select
            aria-label={t("插入位置：{0}", [asset.label])}
            className={`${control} w-full min-w-0 truncate`}
            value={position}
            onChange={event => {
              const after =
                event.target.value === "start"
                  ? null
                  : paragraphs.find(
                      paragraph => String(paragraph.end) === event.target.value
                    )?.anchor;
              if (after !== undefined)
                setSettings(value => ({
                  ...value,
                  illustrations: value.illustrations.map(item =>
                    item.assetId === asset.id ? { ...item, after } : item
                  ),
                }));
            }}
          >
            {offset === null ? (
              <option value="missing" disabled>
                {t("请重新选择位置")}
              </option>
            ) : null}
            <option value="start">{t("正文开头（默认）")}</option>
            {paragraphs.map(paragraph => (
              <option key={paragraph.end} value={paragraph.end}>
                {paragraph.label.length > 70
                  ? `${paragraph.label.slice(0, 70)}…`
                  : paragraph.label}
              </option>
            ))}
          </select>
        </label>
        {offset === null ? (
          <p className="text-[11px] text-destructive" role="alert">
            {t("原位置无法定位，请重新选择段落。")}
            {placement.after?.text
              ? t("原文：{0}", [placement.after.text.slice(0, 40)])
              : ""}
          </p>
        ) : null}
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          aria-label={t("移除插图：{0}", [asset.label])}
          onClick={() => toggleIllustration(asset.id)}
        >
          {t("移除插图")}
        </button>
      </div>
    );
  }
  async function share() {
    if (!ready || !output) return;
    try {
      if (!canShareImages) return;
      await navigator.share({ files: shareFiles });
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        toast.error(
          cause instanceof Error ? cause.message : "分享未完成，请下载后发布"
        );
    }
  }

  return (
    <section
      className={mobile ? "mobile-image-pack" : "w-full"}
      aria-label={t("文章图片制作")}
    >
      {generationError && !coverBusy ? (
        <p role="alert" className="px-4 pt-3 text-xs text-destructive">
          {generationError}
        </p>
      ) : null}
      {!mobile && (
        <SharedLayoutBar
          storyId={storyId}
          candidates={layoutQuery.data?.candidates ?? []}
          canShareBack={ready}
          onApply={applySharedLayout}
          buildPackage={buildLayoutPackage}
        />
      )}
      <header
        className={`flex flex-wrap items-center justify-between gap-3 py-3 ${mobile ? "px-4" : ""}`}
      >
        <div>
          {!mobile && (
            <h2 className="font-chat-brand text-lg">这个故事的图片</h2>
          )}
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            {t("已有图片 {0} 张", [layoutAssets.length])}
            {output && mobile && mobileStep === "preview"
              ? t(" · 成品 {0} 张{1}", [
                  output.pages.length,
                  stale ? t("（待更新）") : "",
                ])
              : ""}
          </p>
        </div>
        {mobile ? (
          mobileStep === "images" && (
            <Popover open={addImageOpen} onOpenChange={setAddImageOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={control}>
                  {t("添加图片")}
                </button>
              </PopoverTrigger>
              <PopoverContent
                aria-label={t("添加图片方式")}
                align="end"
                className="w-44 p-1"
              >
                <button
                  className="min-h-11 w-full rounded-md px-3 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setAddImageOpen(false);
                    libraryUpload.current?.click();
                  }}
                >
                  {t("上传图片")}
                </button>
                <button
                  className="min-h-11 w-full rounded-md px-3 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setAddImageOpen(false);
                    if (onPrepareGeneration) onPrepareGeneration();
                    else setStoryGenerate(true);
                  }}
                >
                  {t("根据文字生成")}
                </button>
              </PopoverContent>
            </Popover>
          )
        ) : (
          <button
            type="button"
            className={control}
            onClick={() => {
              setDesktopSection("images");
              if (mobile) setMobileStep("images");
              setStoryGenerate(true);
            }}
          >
            <ImagePlus className="mr-1 inline h-3.5 w-3.5" />
            生成图片
          </button>
        )}
      </header>
      <Dialog open={storyGenerate} onOpenChange={setStoryGenerate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>基于当前文案生成图片</DialogTitle>
            <DialogDescription>生成后放入本故事的图片列表，选好再加入排版。</DialogDescription>
          </DialogHeader>
          <textarea aria-label="图片生成要求" value={coverInstruction} onChange={event => setCoverInstruction(event.target.value)}
            rows={4} maxLength={1000} placeholder="想要怎样的画面？也可以在聊天框里补充要求。" className={control} />
          {generationBlockedReason || coverBusy || !onGenerateCover || !body.trim() || illustrationCost == null ? <p role="status" className="text-xs text-muted-foreground">
            {generationBlockedReason || (!body.trim()
              ? "先写好并保存文案，即可根据文案生成图片；已有图片可以直接排版。"
              : coverBusy ? "当前操作正在处理，完成后即可继续。"
              : !onGenerateCover ? "请先在文字区确认要使用的文案。"
              : "正在获取生成费用，请稍后再试。")}
          </p> : null}
          {onSaveDraft || savingDraft ? <button type="button" className={control} disabled={savingDraft || !onSaveDraft}
            onClick={() => void onSaveDraft?.()}>
            {savingDraft ? "正在保存文案…" : "保存文案，继续"}
          </button> : <button type="button" className={control} disabled={coverBusy || !onGenerateCover || !body.trim() || Boolean(generationBlockedReason) || illustrationCost == null}
            onClick={() => { setStoryGenerate(false); void onGenerateCover?.(coverInstruction); }}>
            确认生成 4 张{illustrationCost != null ? ` · ${formatComputeQuote(illustrationCost)}` : ""}
          </button>}
        </DialogContent>
      </Dialog>
      {!mobile && (
        <nav
          aria-label="图像与排版"
          className="mb-3 flex items-center gap-6 border-b border-[var(--panel-border)]"
        >
          {(
            [
              ["images", "图片素材"],
              ["layout", "排版"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={desktopSection === id}
              onClick={() => setDesktopSection(id)}
              className={`pb-2 text-sm ${desktopSection === id ? "border-b-2 border-[var(--nayin-accent)] text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {mobile ? (
        <nav
          aria-label={t("图文制作步骤")}
          className="grid grid-cols-3 border-b border-border px-3"
        >
          {(
            [
              ["images", t("图库")],
              ["layout", t("排版")],
              ["preview", t("成品")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mobileStep === id}
              disabled={preparingPreview}
              onClick={() => void changeMobileStep(id)}
              className={`min-h-12 text-sm ${mobileStep === id ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={mobile ? "space-y-4 p-4" : "space-y-4"}>
        {localImages.warning && (
          <p role="status" className="text-xs text-amber-700">
            {localImages.warning}
          </p>
        )}
        {generationStartedAt != null ? (
          <GenerationWait
            key={generationStartedAt}
            startedAt={generationStartedAt}
          />
        ) : null}
        <div
          hidden={
            mobile ? mobileStep !== "images" : desktopSection !== "images"
          }
          className="space-y-4"
        >
          {!mobile && <p className="text-xs text-muted-foreground">上传和生成的故事图片集中在这里，加入排版后仍会保留。</p>}
          {materialQuery.isError && <p role="alert" className="text-xs text-destructive">
            故事图片读取失败，当前版本图片仍可使用。
            <button type="button" className="ml-2 underline" onClick={() => void materialQuery.refetch()}>重试</button>
          </p>}
          {
            <div className="flex items-center gap-3">
              {!mobile && <><button
                type="button"
                className={control}
                onClick={() => libraryUpload.current?.click()}
              >
                上传图片
              </button>
              <span className="text-xs text-muted-foreground">
                生成或上传图片，再到排版里组合。
              </span></>}
              <input
                ref={libraryUpload}
                aria-label="上传图像素材"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async event => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  for (const file of files) {
                    try {
                      await localImages.upload(file);
                    } catch (cause) {
                      toast.error(`${file.name}：${cause instanceof Error ? cause.message : "上传失败"}`);
                    }
                  }
                }}
              />
            </div>
          }
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-label="故事图片素材库">
            {layoutAssets.map(asset => (
              <article key={asset.id} className="min-w-0">
                <ImageCandidatePreview touchOnly={mobile} label={asset.label} preview={<img src={asset.imageUrl} alt={asset.label} />}>
                  <button type="button" aria-label={`预览：${asset.label}`} className="w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]">
                    <img src={asset.imageUrl} alt={asset.label} loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-muted/40 object-contain" />
                  </button>
                </ImageCandidatePreview>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px]">{asset.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{usedImages.has(asset.imageUrl) ? "已用于排版" : asset.id < 0 ? "本机上传" : "未用于排版"}</span>
                </div>
                {asset.warning && <p className="mt-1 text-[10px] text-amber-700">{asset.warning}</p>}
                <button type="button" disabled={asset.warning === "原文件缺失" || Boolean(insertRequest)}
                  onClick={() => useImageInLayout(asset)} className={`${control} mt-2 w-full`} aria-label={`加入排版：${asset.label}`}>加入排版</button>
              </article>
            ))}
          </div>
          {!layoutAssets.length && <p className="py-6 text-center text-sm text-muted-foreground">{materialQuery.isLoading ? "正在整理故事图片…" : "还没有图片，上传素材或根据文案生成一组。"}</p>}
          <details>
            <summary className="cursor-pointer py-3 text-xs text-muted-foreground">封面、插图和底图设置</summary>
            <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs">{t("封面")}</p>
            <div className="flex items-center gap-2">
              {onOpenCoverStudio ? (
                <button
                  type="button"
                  disabled={coverBusy}
                  className={control}
                  onClick={onOpenCoverStudio}
                >
                  {t("编辑封面")}
                </button>
              ) : null}
              {contentKind !== "memory" ? (
                <Popover open={coverSetup} onOpenChange={setCoverSetup}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={coverBusy}
                      className={control}
                    >
                      <ImagePlus className="mr-1 inline h-3.5 w-3.5" />
                      {t("生成封面")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className={`w-80 max-w-[calc(100vw-2rem)] space-y-3 ${mobile ? "[&_textarea]:text-base [&_button]:min-h-11" : ""}`}
                  >
                    <p className="text-sm font-medium">{t("生成封面")}</p>
                    <textarea
                      aria-label={t("封面生成要求")}
                      value={coverInstruction}
                      onChange={event =>
                        setCoverInstruction(event.target.value)
                      }
                      maxLength={1000}
                      rows={3}
                      className={`${control} w-full`}
                      placeholder={t("想要怎样的画面？留空则根据文章生成")}
                    />
                    {onGenerateCover ? (
                      <button
                        type="button"
                        className={control}
                        disabled={coverBusy || illustrationCost == null}
                        onClick={() => {
                          setCoverSetup(false);
                          void onGenerateCover(coverInstruction);
                        }}
                      >
                        {t("确认生成 4 张 ·")}{" "}
                        {illustrationCost == null
                          ? ""
                          : formatComputeQuote(illustrationCost)}
                      </button>
                    ) : null}
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          </div>
          {assets.length ? (
            <div
              className="flex gap-2 overflow-x-auto pb-2"
              role="group"
              aria-label={t("已有图片")}
            >
              {assets
                .filter(asset => !asset.kind)
                .map(asset => (
                  <ImageCandidatePreview
                    touchOnly={mobile}
                    key={asset.id}
                    label={asset.label}
                    preview={<img src={asset.imageUrl} alt={asset.label} />}
                  >
                    <button
                      type="button"
                      aria-label={t("选为封面：{0}", [asset.label])}
                      aria-pressed={settings.coverId === asset.id}
                      onClick={() => {
                        update({ coverId: asset.id, includeCover: true });
                        setIllustrationSetup(false);
                      }}
                      className={`relative w-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${settings.coverId === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                    >
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        loading="lazy"
                        className="aspect-[3/4] w-full object-cover"
                      />
                      <span className="block truncate bg-[var(--nayin-surface)] px-1 py-1 text-[10px]">
                        {settings.coverId === asset.id ? t("封面 · ") : ""}
                        {asset.label}
                      </span>
                      {asset.warning ? (
                        <span className="block bg-amber-50 p-1 text-[10px] text-amber-800">
                          {asset.warning}
                        </span>
                      ) : null}
                    </button>
                  </ImageCandidatePreview>
                ))}
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--nayin-surface)] p-3 text-xs leading-6 text-muted-foreground">
              {t("暂无配图")}
            </p>
          )}
          {albumQuery.error ? (
            <p className="text-xs text-destructive">
              {t("画册图片读取失败，请刷新后重试。封面候选仍可使用。")}
            </p>
          ) : null}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs">{t("正文插图（可多选）")}</p>
              {onGenerateIllustration ? (
                <Popover
                  open={illustrationSetup}
                  onOpenChange={setIllustrationSetup}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={control}
                      disabled={coverBusy}
                    >
                      {t("生成插图")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    aria-label={t("生成插图")}
                    align="end"
                    className={`w-80 max-w-[calc(100vw-2rem)] space-y-3 ${mobile ? "[&_textarea]:text-base [&_button]:min-h-11" : ""}`}
                  >
                    <p className="text-sm font-medium">
                      {t("生成横版插图 · 16:9")}
                    </p>
                    {generationCover ? (
                      <>
                        <textarea
                          aria-label={t("插图内容")}
                          className={`${control} w-full`}
                          rows={3}
                          value={illustrationInstruction}
                          onChange={event =>
                            setIllustrationInstruction(event.target.value)
                          }
                          maxLength={1000}
                          placeholder={t("想画什么？留空则根据文章内容生成")}
                        />
                        <button
                          type="button"
                          className={control}
                          disabled={coverBusy || illustrationCost == null}
                          onClick={() => {
                            setIllustrationSetup(false);
                            void onGenerateIllustration(
                              generationCover.id,
                              illustrationInstruction
                            );
                          }}
                        >
                          {t("确认生成 4 张 ·")}{" "}
                          {illustrationCost == null
                            ? ""
                            : formatComputeQuote(illustrationCost)}
                        </button>
                      </>
                    ) : (
                      referenceCoverPicker()
                    )}
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            <div
              className="flex gap-2 overflow-x-auto pb-2"
              role="group"
              aria-label={t("横版插图候选")}
            >
              {illustrations.map(asset => {
                const placement = settings.illustrations.find(
                  item => item.assetId === asset.id
                );
                const needsPosition =
                  placement &&
                  resolveIllustrationOffset(paragraphs, placement.after) ===
                    null;
                return (
                  <ImageCandidatePreview
                    touchOnly={mobile}
                    key={asset.id}
                    label={asset.label}
                    preview={<img src={asset.imageUrl} alt={asset.label} />}
                    controls={illustrationControls(asset, placement)}
                  >
                    <button
                      type="button"
                      className={`w-32 shrink-0 rounded border-2 p-1 focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${placement ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                      aria-label={t("选用插图：{0}", [asset.label])}
                      aria-pressed={Boolean(placement)}
                      onClick={() => addIllustration(asset.id)}
                    >
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="aspect-video w-full object-contain"
                      />
                      {placement ? (
                        <span
                          className={`block text-[10px] ${needsPosition ? "text-destructive" : ""}`}
                        >
                          {needsPosition ? t("请重新定位") : t("已插入")}
                        </span>
                      ) : null}
                      {asset.kind !== "illustration" ? (
                        <span className="text-[10px] text-muted-foreground">
                          {t("保留的原配图")}
                        </span>
                      ) : null}
                      {asset.kind === "illustration" &&
                      asset.parentAssetId !== cover?.id ? (
                        <span className="text-[10px] text-muted-foreground">
                          {t("来自其他封面")}
                        </span>
                      ) : null}
                      {asset.warning ? (
                        <span className="text-[10px] text-amber-700">
                          {asset.warning}
                        </span>
                      ) : null}
                    </button>
                  </ImageCandidatePreview>
                );
              })}
            </div>
            {settings.illustrations
              .filter(
                placement =>
                  !assets.some(asset => asset.id === placement.assetId)
              )
              .map(placement => (
                <p
                  key={placement.assetId}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {t("插图")}
                  {placement.assetId} {t("不可用。")}
                  <button
                    type="button"
                    className="underline"
                    aria-label={t("移除插图：{0}", [placement.assetId])}
                    onClick={() => toggleIllustration(placement.assetId)}
                  >
                    {t("移除插图")}
                  </button>
                </p>
              ))}
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs">
                {t("整套底图")}
                {cover && !palette ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {theme?.error ? t("取色未完成") : t("取色中…")}
                  </span>
                ) : null}
              </p>
              {onGenerateTexture ? (
                <Popover open={textureSetup} onOpenChange={setTextureSetup}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={control}
                      disabled={coverBusy}
                    >
                      {t("生成底图")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    aria-label={t("生成底图")}
                    align="end"
                    className={`w-80 max-w-[calc(100vw-2rem)] space-y-3 ${mobile ? "[&_textarea]:text-base [&_button]:min-h-11" : ""}`}
                  >
                    <p className="text-sm font-medium">
                      {t("生成花纹底图 · 3:4")}
                    </p>
                    {generationCover ? (
                      <>
                        <textarea
                          aria-label={t("底图花纹要求")}
                          className={`${control} w-full`}
                          rows={3}
                          value={textureInstruction}
                          onChange={event =>
                            setTextureInstruction(event.target.value)
                          }
                          maxLength={1000}
                          placeholder={t(
                            "例如：细腻纸纹、淡淡水彩、稀疏植物纹样"
                          )}
                        />
                        <button
                          type="button"
                          className={control}
                          disabled={coverBusy || illustrationCost == null}
                          onClick={() => {
                            setTextureSetup(false);
                            void onGenerateTexture(
                              generationCover.id,
                              textureInstruction
                            );
                          }}
                        >
                          {t("确认生成 4 张 ·")}{" "}
                          {illustrationCost == null
                            ? ""
                            : formatComputeQuote(illustrationCost)}
                        </button>
                      </>
                    ) : (
                      referenceCoverPicker()
                    )}
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("免费纹理随所选封面和插图配色")}
            </p>
            {currentTheme?.error ? (
              <p role="alert" className="text-xs text-destructive">
                {currentTheme.error}{" "}
                <button
                  type="button"
                  onClick={() => setThemeRetry(value => value + 1)}
                >
                  {t("重试取色")}
                </button>
              </p>
            ) : null}
            <div
              className="flex gap-2 overflow-x-auto pb-2"
              role="group"
              aria-label={t("正文纹理")}
            >
              {assets
                .filter(asset => asset.kind === "body-texture")
                .map(asset => (
                  <ImageCandidatePreview
                    touchOnly={mobile}
                    key={asset.id}
                    label={asset.label}
                    preview={<img src={asset.imageUrl} alt={asset.label} />}
                  >
                    <button
                      type="button"
                      className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs ${bodyTexture?.id === asset.id ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                      aria-label={t("选用底图：{0}", [asset.label])}
                      aria-pressed={bodyTexture?.id === asset.id}
                      onClick={() => {
                        update({ bodyTextureId: asset.id });
                        setSelectedPage(settings.includeCover ? 1 : 0);
                      }}
                    >
                      <img
                        src={asset.imageUrl}
                        alt={asset.label}
                        className="aspect-[3/4] w-full rounded object-cover"
                      />
                      {asset.warning ? (
                        <span className="text-[10px] text-amber-700">
                          {asset.warning}
                        </span>
                      ) : null}
                    </button>
                  </ImageCandidatePreview>
                ))}
              {materials.map(({ texture, seed }) => (
                <ImageCandidatePreview
                  touchOnly={mobile}
                  key={`${texture}:${seed}`}
                  label={`${t(IMAGE_PACK_TEXTURES[texture])} ${seed + 1}`}
                  preview={
                    <MaterialSwatch
                      palette={paperPalette ?? IMAGE_PACK_STYLES.sage}
                      texture={texture}
                      seed={seed}
                    />
                  }
                >
                  <button
                    type="button"
                    className={`w-20 shrink-0 rounded-lg border-2 p-1 text-xs transition-colors ${settings.bodyTextureId == null && settings.texture === texture && settings.textureSeed === seed ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                    aria-label={t("选用底图：{0} {1}", [
                      t(IMAGE_PACK_TEXTURES[texture]),
                      seed + 1,
                    ])}
                    aria-pressed={
                      settings.bodyTextureId == null &&
                      settings.texture === texture &&
                      settings.textureSeed === seed
                    }
                    onClick={() => {
                      update({
                        texture,
                        textureSeed: seed,
                        bodyTextureId: null,
                      });
                      setSelectedPage(settings.includeCover ? 1 : 0);
                    }}
                  >
                    <MaterialSwatch
                      palette={paperPalette ?? IMAGE_PACK_STYLES.sage}
                      texture={texture}
                      seed={seed}
                    />
                    <span className="block py-1">
                      {t(IMAGE_PACK_TEXTURES[texture])} · {seed + 1}
                    </span>
                  </button>
                </ImageCandidatePreview>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              disabled={palettePending}
              onClick={() =>
                update({ materialBatch: settings.materialBatch + 1 })
              }
            >
              {t("换一组免费纹理")}
            </button>
          </div>
            </div>
          </details>
        </div>
        <details
          hidden={
            mobile ? mobileStep !== "layout" : desktopSection !== "images"
          }
          className="text-xs"
        >
          <summary className="cursor-pointer text-muted-foreground">
            {t("排版设置")}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs">
              {t("封面文字")}
              <input
                aria-label={t("封面文字")}
                value={options.title}
                onChange={event => update({ title: event.target.value })}
                maxLength={200}
                className={control}
                placeholder={t("默认使用文章标题，也可以自己填写")}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs">
              {t("用已有图片作插图")}
              <select
                aria-label={t("添加已有图片作插图")}
                value=""
                onChange={event => {
                  if (event.target.value)
                    addIllustration(Number(event.target.value));
                }}
                className={control}
              >
                <option value="">{t("选择图片添加")}</option>
                {assets
                  .filter(
                    asset =>
                      asset.kind !== "body-texture" &&
                      !settings.illustrations.some(
                        item => item.assetId === asset.id
                      )
                  )
                  .map(asset => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs">
              {t("整套字体")}
              <select
                aria-label={t("整套字体")}
                value={settings.fontId}
                onChange={event => update({ fontId: event.target.value })}
                className={control}
              >
                {installedPublishingAlbumFonts().map(font => (
                  <option key={font.fontId} value={font.fontId}>
                    {font.nameZh}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.includeCover}
                onChange={event =>
                  update({ includeCover: event.target.checked })
                }
              />
              {t("包含封面")}
            </label>
            <span className="text-muted-foreground">{t("设置仅存本机")}</span>
          </div>
        </details>
        {progress || needsCover || missingTexture || missingIllustration ? (
          <p className="text-xs leading-6 text-muted-foreground" role="status">
            {progress ? (
              <>
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                {progress}
              </>
            ) : needsCover ? (
              t("请选择封面，或在排版设置中取消封面。")
            ) : missingTexture ? (
              t("底图不可用，请重选。")
            ) : (
              t("插图不可用，请重选。")
            )}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setRenderAttempt(value => value + 1)}
            >
              {t("重试排版")}
            </button>
          </p>
        ) : null}
        {output ? (
          <div
            hidden={
              mobile ? mobileStep === "images" : desktopSection !== "layout"
            }
            className={
              mobile ? "border-t border-[var(--panel-border)] pt-4" : ""
            }
          >
            <div
              hidden={!mobile || mobileStep !== "preview"}
              className="mb-2 flex items-center justify-between gap-2"
            >
              <h3 className="text-sm font-medium">{t("成品预览")}</h3>
            </div>
            <div hidden={mobile && mobileStep !== "layout"}>
              {moduleSession && (
                <ImagePackModuleEditor
                  insertRequest={insertRequest}
                  onInsertHandled={() => setInsertRequest(null)}
                  onDocumentChange={document => { liveBasis.current = moduleSession.basis; setLiveDocument(document); }}
                  companion={{ storyId, accountId, active: active && !advancedOpen && (mobile ? mobileStep === "layout" : desktopSection === "layout") }}
                  ref={moduleEditor}
                  mobile={mobile}
                  onPreview={() => void changeMobileStep("preview")}
                  options={moduleSession.options}
                  scope={scope}
                  initial={moduleSession.initial}
                  assets={layoutAssets}
                  onUpload={localImages.upload}
                  onGenerateSelection={text => { setLayoutSelectedText(text); setLayoutInstruction(''); setLayoutGenerate(true); }}
                  generationControls={
                    <Dialog
                      open={layoutGenerate}
                      onOpenChange={setLayoutGenerate}
                    >
                      <DialogContent
                        className={`w-72 space-y-3 ${mobile ? "[&_button]:min-h-11 [&_textarea]:text-base" : ""}`}
                      >
                        <DialogTitle>根据选中文字生成图片</DialogTitle>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-sm">{layoutSelectedText}</p>
                        <p className="text-xs text-muted-foreground">补充画面要求（可不填）</p>
                        <textarea
                          aria-label="排版配图要求"
                          value={layoutInstruction}
                          onChange={event =>
                            setLayoutInstruction(event.target.value)
                          }
                          maxLength={1000}
                          rows={3}
                          className={`${control} w-full`}
                        />
                        <button
                          type="button"
                          className={control}
                          disabled={
                            coverBusy ||
                            illustrationCost == null ||
                            !(generationCover
                              ? onGenerateIllustration
                              : onGenerateCover)
                          }
                          onClick={() => {
                            setLayoutGenerate(false);
                            void (generationCover
                              ? onGenerateIllustration?.(
                                  generationCover.id,
                                  layoutInstruction, layoutSelectedText
                                )
                              : onGenerateCover?.(layoutInstruction, layoutSelectedText));
                          }}
                        >
                          确认生成 4 张 ·{" "}
                          {illustrationCost == null
                            ? ""
                            : formatComputeQuote(illustrationCost)}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {mobile
                            ? "出图后会放进图片列表，轻点再加入成品。"
                            : "出图后会放在右侧，选中再加入成品。"}
                        </p>
                      </DialogContent>
                    </Dialog>
                  }
                  sourceChanged={moduleSession.basis !== basis}
                  onClose={() => setModuleSession(null)}
                  onApply={(document, pages, pageIndex) => {
                    if (currentBasis.current !== moduleSession.basis)
                      throw new Error(
                        "正文或选图已变化，请返回预览后重新打开；模块草稿仍保留。"
                      );
                    chapterSession?.change(chapterEdit(document));
                    try {
                      localStorage.setItem(
                        moduleStorageKey(scope, basis),
                        JSON.stringify(document)
                      );
                    } catch {
                      toast.error(
                        "浏览器无法保存排版，当前图片可下载，但刷新后无法恢复。"
                      );
                    }
                    const prepared = pages.map(page => ({
                      ...page,
                      url: URL.createObjectURL(page.blob),
                    }));
                    for (const url of previewUrls.current)
                      URL.revokeObjectURL(url);
                    previewUrls.current = prepared.map(page => page.url);
                    setModuleOverride({ basis, document });
                    setOutput({
                      signature: JSON.stringify({
                        options: moduleSession.options,
                        modules: document,
                      }),
                      pages: prepared,
                    });
                    setSelectedPage(Math.min(pageIndex, pages.length - 1));
                  }}
                />
              )}
            </div>
            {stale ? (
              <p className="mb-3 text-xs text-muted-foreground">
                {t("正在更新…")}
              </p>
            ) : null}
            <div
              hidden={mobile ? mobileStep !== "preview" : !!moduleSession}
              className={
                mobile
                  ? ""
                  : "mb-4 grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-4"
              }
            >
              <div
                className={
                  mobile
                    ? "flex gap-2 overflow-x-auto pb-3"
                    : "flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-1"
                }
                aria-label={t("成品图片列表")}
              >
                {output.pages.map((page, index) => {
                  const thumbnail = (
                    <button
                      key={page.url}
                      type="button"
                      onClick={() => setSelectedPage(index)}
                      onPointerEnter={event => {
                        if (!mobile && event.pointerType === "mouse")
                          setSelectedPage(index);
                      }}
                      onFocus={() => {
                        if (!mobile) setSelectedPage(index);
                      }}
                      aria-pressed={selectedPage === index}
                      aria-label={t("预览第 {0} 张：{1}", [
                        index + 1,
                        page.label,
                      ])}
                      className={`${mobile ? "w-24" : "w-full"} shrink-0 rounded-md border-2 p-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)] ${selectedPage === index ? "border-[var(--nayin-accent)]" : "border-transparent"}`}
                    >
                      <img
                        src={page.url}
                        alt={t("第 {0} 张 {1}", [index + 1, page.label])}
                        className="aspect-[3/4] w-full rounded"
                      />
                      <span className="text-[10px]">
                        {index + 1} · {page.label}
                      </span>
                    </button>
                  );
                  return mobile ? (
                    <ImageCandidatePreview
                      touchOnly
                      key={page.url}
                      label={t("成品 {0} · {1}", [index + 1, page.label])}
                      preview={<img src={page.url} alt={page.label} />}
                    >
                      {thumbnail}
                    </ImageCandidatePreview>
                  ) : (
                    thumbnail
                  );
                })}
              </div>
              <div className="min-w-0">
                {selected ? (
                  mobile ? (
                    <ImageCandidatePreview
                      touchOnly
                      label={t("成品 {0} · {1}", [
                        selectedPage + 1,
                        selected.label,
                      ])}
                      preview={<img src={selected.url} alt={selected.label} />}
                    >
                      <button
                        type="button"
                        aria-label={t("放大当前图片：{0}", [selected.label])}
                        className="mx-auto mb-4 block w-full max-w-sm cursor-zoom-in"
                      >
                        <img
                          src={selected.url}
                          alt={t("当前预览：{0}", [selected.label])}
                          className="w-full rounded-lg border border-[var(--panel-border)]"
                        />
                      </button>
                    </ImageCandidatePreview>
                  ) : (
                    <img
                      src={selected.url}
                      alt={t("当前预览：{0}", [selected.label])}
                      className="mx-auto mb-4 w-full max-w-sm rounded-lg border border-[var(--panel-border)]"
                    />
                  )
                ) : null}
              </div>
            </div>
            <div
              hidden={mobile ? mobileStep !== "preview" : !!moduleSession}
              className="flex flex-wrap gap-2"
            >
              {mobile && (
                <button
                  type="button"
                  className={control}
                  disabled={preparingPreview}
                  onClick={() => void changeMobileStep("layout")}
                >
                  编辑排版
                </button>
              )}
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  for (const page of output.pages)
                    downloadPublishingAlbumBlob(page.blob, page.filename);
                }}
                className={control}
              >
                <Download className="mr-1 inline h-3.5 w-3.5" />
                {t("下载整套")}
              </button>
              <ImagePackCopyDialog
                className={control}
                mobile={mobile}
                disabled={!ready}
                text={
                  modules
                    ? imagePackCopyText(modules)
                    : [options.includeCover ? options.title : "", options.body]
                        .filter(value => value.trim())
                        .join("\n\n")
                }
                currentPageIndex={selectedPage}
                loadPages={async () => output.pages}
              />
              <ArchiveArtworkButton storyId={storyId} title={options.title}
                className={control} disabled={!ready} loadPages={async () => output.pages} />
              {canShareImages ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void share()}
                  className={control}
                >
                  <Share2 className="mr-1 inline h-3.5 w-3.5" />
                  {t("分享图片")}
                </button>
              ) : null}
              {selected ? (
                <a
                  href={ready ? selected.url : undefined}
                  download={selected.filename}
                  aria-disabled={!ready}
                  className={control}
                >
                  {t("下载当前图片")}
                </a>
              ) : null}
              {ready ? (
                <ArtworkShareDialog
                  key={`${output.signature}:${shareEpoch}`}
                  loadLayout={buildLayoutPackage}
                  storyId={storyId}
                  title={options.title}
                  work={{
                    title: options.title,
                    body: options.body,
                    tags: [],
                    platform: sharePlatform,
                  }}
                  pages={output.pages}
                />
              ) : null}
            </div>
            {mobile && mobileStep === "preview" ? (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {t("长按预览图可保存到手机；也可逐张下载后发布到社交平台。")}
                {!canShareImages ? t("此浏览器暂不支持直接分享图片。") : ""}
              </p>
            ) : null}
          </div>
        ) : null}
        {advancedEditor ? (
          <details
            hidden={!mobile && desktopSection !== "images"}
            open={advancedOpen}
            onToggle={event => onAdvancedOpenChange?.(event.currentTarget.open)}
            className="border-t border-[var(--panel-border)] pt-3"
          >
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {t("逐页编辑画册")}
            </summary>
            {advancedOpen ? advancedEditor : null}
          </details>
        ) : null}
        {mobile && (
          <SharedLayoutBar
            compact
            storyId={storyId}
            candidates={layoutQuery.data?.candidates ?? []}
            canShareBack={ready}
            onApply={applySharedLayout}
            buildPackage={buildLayoutPackage}
          />
        )}
      </div>
    </section>
  );
}
