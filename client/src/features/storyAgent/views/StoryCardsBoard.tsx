/**
 * StoryCardsBoard — Reorderable list of memory cards harvested from the
 * story-guide chat. The order matters: each ordering produces a different
 * generated script.
 *
 * Sits in the TEMPLATE DRAFT slot of the analysis page.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  motion,
  AnimatePresence,
  Reorder,
  useDragControls,
} from "framer-motion";
import {
  GripVertical,
  X,
  Sparkles,
  FlaskConical,
  Loader2,
  Clapperboard,
  ImagePlus,
  Trash2,
  Star,
  Palette,
  ScrollText,
  CheckCircle2,
  ListPlus,
  Link2,
} from "lucide-react";
import {
  isFictionStoryCardConfirmed,
  useStoryAgentActions,
  type GenerationProfileArg,
  type StoryShotEditableField,
} from "@/features/storyAgent/StoryAgentContext";
import {
  useCardReferenceDockSlice,
  useStoryCardsBoardSlice,
} from "@/features/storyAgent/spine/selectors";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useStoryGeneratedImages } from "./StoryImagesStrip";
import { useNayin } from "@/features/nayin/NayinContext";
import type {
  GeneratedScript,
  StoryCard,
  StoryShot,
  VisualCanvasItem,
} from "@/features/storyAgent/types";
import {
  creationTimelineShotId,
  type CreationEditorShot,
} from "@/features/creationEditor/CreationEditorContext";
import type { ShotVideoProviderStatus } from "@shared/videoAsset";
import type { NayinElement } from "@/features/nayin/nayin";
import type { ArtRecipeDNA } from "@shared/artDirection";
import {
  buildMobileStoryboardScenes,
  parseShotNo,
  type GeneratedImageItem,
} from "@/features/mobileChat/types";
import StoryCardsGraph from "./StoryCardsGraph";
import ShotMaterialBasket from "./ShotMaterialBasket";

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: "先开瓶啤酒，跟小酌聊聊一句让你记住的话",
  wood: "泡上一壶龙井，慢慢回忆那个让你停下来的瞬间",
  water: "剥一颗椰子，把那个画面跟小酌讲讲",
  fire: "冲一泡大红袍，让小酌带你回到那一刻",
  earth: "研一杯咖啡，跟小酌聊一段你忘不掉的事",
};

type NarrativeStyleChoice = {
  id: string;
  label: string;
  logline: string;
  arc: string;
  treatment: string;
  generated: boolean;
};

type VisualStylePreset = {
  id: string;
  title: string;
  description: string;
  recipe: ArtRecipeDNA;
};

const FALLBACK_NARRATIVE_STYLES: NarrativeStyleChoice[] = [
  {
    id: "director-ad",
    label: "广告片",
    logline: "把优势压成一句清楚的价值主张",
    arc: "岗位关心什么 → 你为什么能做 → 值得联系",
    treatment: "镜头要少而准，每一幕都证明一个求职优势。",
    generated: false,
  },
  {
    id: "director-doc",
    label: "观察式",
    logline: "让事实自己说话",
    arc: "具体处境 → 做法选择 → 结果与可信度",
    treatment: "少煽情，多保留工作现场和判断过程。",
    generated: false,
  },
  {
    id: "director-poetic",
    label: "诗意版",
    logline: "把抽象能力翻译成可感知的画面",
    arc: "模糊问题 → 画面化理解 → 共同情感",
    treatment: "保留情绪，但每个画面都要能回扣岗位价值。",
    generated: false,
  },
];

const FICTION_NARRATIVE_STYLES: NarrativeStyleChoice[] = [
  {
    id: "fiction-short",
    label: "短片版",
    logline: "一句奇异设定长成 3-5 镜短片",
    arc: "世界规则 → 主角欲望 → 阻碍选择 → 余味",
    treatment: "先让规则可见，再让人物在规则里做一个选择。",
    generated: false,
  },
  {
    id: "fiction-fable",
    label: "寓言版",
    logline: "保留怪味，让故事像一个会回响的寓言",
    arc: "异常发生 → 人群反应 → 主角理解 → 留白",
    treatment: "少解释世界观，多用一两个物件把意义落住。",
    generated: false,
  },
  {
    id: "fiction-cinematic",
    label: "电影版",
    logline: "把灵感压成更强的视觉和冲突",
    arc: "定调画面 → 冲突升级 → 转折画面 → 收束",
    treatment: "画面更明确，冲突更集中，但不扩成长篇设定。",
    generated: false,
  },
];

const GENERAL_NARRATIVE_STYLES: NarrativeStyleChoice[] = [
  {
    id: "memory-restraint",
    label: "克制版",
    logline: "让日常细节自己发光",
    arc: "具体处境 → 细微变化 → 留白",
    treatment: "少解释，多保留原话、动作和空间。",
    generated: false,
  },
  {
    id: "memory-dramatic",
    label: "戏剧版",
    logline: "把愿望、阻碍和转折讲清楚",
    arc: "愿望 → 阻碍 → 转折 → 余味",
    treatment: "适度加强事件推进，但不补用户没说过的大事。",
    generated: false,
  },
  {
    id: "memory-poetic",
    label: "诗意版",
    logline: "把情绪翻译成可拍的意象",
    arc: "意象定调 → 情绪流动 → 轻轻收束",
    treatment: "更看重光线、物件和重复出现的私人痕迹。",
    generated: false,
  },
];

const FALLBACK_VISUAL_STYLES: VisualStylePreset[] = [
  {
    id: "visual-doc-real",
    title: "写实纪录",
    description: "适合强调可信证据、真实工作现场和人的判断过程。",
    recipe: {
      style: ["documentary realism", "cinematic"],
      palette: ["natural tones", "low saturation"],
      light: ["available light", "soft contrast"],
      composition: ["clear subject focus", "observational framing"],
      material: ["real workspace texture"],
      negative: ["overly staged", "fantasy lighting"],
    },
  },
  {
    id: "visual-warm-ad",
    title: "温暖广告片",
    description: "适合把优势讲得更有吸引力，强调人与结果的连接。",
    recipe: {
      style: ["premium commercial film", "human-centered"],
      palette: ["warm neutrals", "clean accent color"],
      light: ["soft key light", "golden practical light"],
      composition: ["confident hero framing", "balanced negative space"],
      material: ["polished but real texture"],
      negative: ["stock photo", "plastic skin"],
    },
  },
  {
    id: "visual-portfolio-clean",
    title: "作品集克制",
    description: "适合产品、策略、作品集场景，画面干净，让信息更清楚。",
    recipe: {
      style: ["minimal editorial", "product storytelling"],
      palette: ["off-white", "charcoal", "muted teal"],
      light: ["clean studio light", "soft shadow"],
      composition: ["structured layout", "precise framing"],
      material: ["paper", "screen", "work-in-progress artifacts"],
      negative: ["visual clutter", "heavy vignette"],
    },
  },
];

function emotionAccent(emotion: string): string {
  // Hash-derived hue from the emotion string so similar emotions cluster.
  let h = 0;
  for (let i = 0; i < emotion.length; i++)
    h = (h * 31 + emotion.charCodeAt(i)) % 360;
  return `oklch(0.92 0.04 ${h})`;
}

function latestGeneratedImageForCard(
  images: GeneratedImageItem[],
  sceneImageId: number | undefined,
  shotNo: number
): GeneratedImageItem | undefined {
  const matched = images
    .filter(
      image => image.status !== "error" && parseShotNo(image.shotNo) === shotNo
    )
    .sort((left, right) => left.id - right.id);
  if (matched.length > 0) return matched[matched.length - 1];
  return images.find(image => image.id === sceneImageId);
}

function rationaleForShot(shots: StoryShot[], shotNo: number): string | null {
  return shots.find(shot => shot.shotNo === shotNo)?.rationale?.trim() || null;
}

function generatedStatusLabel(status: GeneratedImageItem["status"]) {
  if (status === "draft") return "草稿";
  if (status === "finalizing") return "正式版生成中";
  if (status === "generating") return "生成中";
  if (status === "ready") return "已收下";
  return "异常";
}

export function latestStoryboardFrames(
  images: GeneratedImageItem[],
  shots: readonly StoryShot[] = []
) {
  const shotNoByIdentity = new Map(
    shots.flatMap(shot => {
      const identity = shot.stableShotId ?? shot.shotIdentity;
      return identity ? [[identity, shot.shotNo] as const] : [];
    })
  );
  const byShotNo = new Map<number, GeneratedImageItem>();
  for (const image of images) {
    const shotNo =
      (image.shotIdentity
        ? shotNoByIdentity.get(image.shotIdentity)
        : undefined) ?? parseShotNo(image.shotNo);
    if (!shotNo || image.status === "error" || !image.imageUrl) continue;
    const existing = byShotNo.get(shotNo);
    if (!existing || image.id > existing.id) byShotNo.set(shotNo, image);
  }
  return Array.from(byShotNo.entries())
    .sort(([left], [right]) => left - right)
    .map(([shotNo, image]) => ({ shotNo, image }));
}

function narrativeChoicesForIntent(purpose?: string | null): NarrativeStyleChoice[] {
  if (purpose === "fiction") return FICTION_NARRATIVE_STYLES;
  if (purpose === "linkedin_job_search") return FALLBACK_NARRATIVE_STYLES;
  return GENERAL_NARRATIVE_STYLES;
}

function recipeTokens(recipe: ArtRecipeDNA | undefined, limit = 5): string[] {
  if (!recipe) return [];
  return [
    ...recipe.style,
    ...recipe.palette,
    ...recipe.light,
    ...recipe.composition,
    ...recipe.material,
  ]
    .filter(Boolean)
    .slice(0, limit);
}

type ArtLibraryVersionView = {
  library: {
    id: number;
    kind: "system" | "user";
    name: string;
    description: string | null;
  };
  version: {
    id: number;
    version: number;
    source: string | null;
  };
  items: Array<{
    dimension: string;
    content: string;
    negativeContent: string | null;
  }>;
};

function artChoiceKey(source: "preset" | "library", id: string | number): string {
  return `${source}:${id}`;
}

function dimensionLabel(dimension: string): string {
  const labels: Record<string, string> = {
    visual_style: "风格",
    color_palette: "色彩",
    lighting: "光线",
    composition: "构图",
    material: "材质",
    negative_prompt: "避免",
    art_style_recipe: "配方",
  };
  return labels[dimension] ?? dimension;
}

function libraryTokens(version: ArtLibraryVersionView, limit = 4): string[] {
  return version.items
    .slice()
    .sort((left, right) => left.dimension.localeCompare(right.dimension))
    .map(item => dimensionLabel(item.dimension))
    .slice(0, limit);
}

function shortText(value: string | null | undefined, fallback: string): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}

function isRealEmotion(emotion?: string): emotion is string {
  const value = emotion?.trim();
  return Boolean(value && value !== "未标" && value !== "未标记");
}

function EmotionBridge({
  previousEmotion,
  currentEmotion,
}: {
  previousEmotion?: string;
  currentEmotion: string;
}) {
  if (
    !isRealEmotion(previousEmotion) ||
    !isRealEmotion(currentEmotion) ||
    previousEmotion === currentEmotion
  ) {
    return null;
  }

  return (
    <div
      className="flex justify-center py-1.5"
      aria-label={`情绪流动：${previousEmotion} 到 ${currentEmotion}`}
    >
      <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
        <span
          className="h-3 w-px bg-[var(--panel-border)]"
          aria-hidden="true"
        />
        <span
          className="rounded-full border px-2 py-0.5 font-mono"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--panel-header)",
            color: "var(--nayin-accent-bright)",
          }}
        >
          {previousEmotion} → {currentEmotion}
        </span>
      </div>
    </div>
  );
}

function VisualPresetButton({
  preset,
  selected,
  onSelect,
}: {
  preset: VisualStylePreset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="min-w-[150px] shrink-0 rounded-md border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
      style={{
        borderColor: selected ? "var(--nayin-accent)" : "var(--panel-border)",
        background: selected ? "var(--nayin-glow)" : "var(--background)",
      }}
    >
      <div className="text-[10px] font-semibold text-foreground">
        {preset.title}
      </div>
      <p className="mt-1 line-clamp-2 text-[8.5px] leading-relaxed text-muted-foreground">
        {preset.description}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {recipeTokens(preset.recipe, 3).map(token => (
          <span
            key={token}
            className="rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {token}
          </span>
        ))}
      </div>
    </button>
  );
}

function GenerationSettingsPanel({
  narrativeChoices,
  activeNarrativeId,
  onSelectNarrative,
  activeArtChoiceId,
  artLibraryVersions,
  currentLibraryVersionId,
  artLibraryLoading,
  artLibraryError,
  canBindArtLibrary,
  bindingLibraryVersionId,
  onSelectArtPreset,
  onSelectArtLibrary,
  onBindArtLibrary,
}: {
  narrativeChoices: NarrativeStyleChoice[];
  activeNarrativeId: string;
  onSelectNarrative: (id: string) => void;
  activeArtChoiceId: string;
  artLibraryVersions: ArtLibraryVersionView[];
  currentLibraryVersionId: number | null;
  artLibraryLoading: boolean;
  artLibraryError?: string | null;
  canBindArtLibrary: boolean;
  bindingLibraryVersionId: number | null;
  onSelectArtPreset: (preset: VisualStylePreset) => void;
  onSelectArtLibrary: (libraryVersion: ArtLibraryVersionView) => void;
  onBindArtLibrary: (libraryVersionId: number) => void;
}) {
  return (
    <div className="mb-2 grid gap-2 xl:grid-cols-2">
      <section
        className="rounded-md border p-2"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--background)",
        }}
        aria-label="剧本生成设置"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5 text-nayin-bright" />
            <span className="text-[10px] font-semibold text-foreground">
              剧本
            </span>
          </div>
          <span className="text-[8px] text-muted-foreground">生成故事版时使用</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {narrativeChoices.map(choice => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={choice.id === activeNarrativeId}
              onClick={() => onSelectNarrative(choice.id)}
              className="min-w-[150px] shrink-0 rounded-md border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
              style={{
                borderColor:
                  choice.id === activeNarrativeId
                    ? "var(--nayin-accent)"
                    : "var(--panel-border)",
                background:
                  choice.id === activeNarrativeId
                    ? "var(--nayin-glow)"
                    : "var(--panel-header)",
              }}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold text-foreground">
                  {choice.label}
                </span>
                {!choice.generated ? (
                  <span
                    className="rounded-full border px-1 py-0.5 text-[8px] text-muted-foreground"
                    style={{ borderColor: "var(--panel-border)" }}
                  >
                    预设
                  </span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 text-[8.5px] leading-relaxed text-muted-foreground">
                {choice.arc || choice.logline}
              </p>
              <p className="mt-1 line-clamp-2 text-[8px] leading-relaxed text-muted-foreground/75">
                {choice.treatment}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section
        className="rounded-md border p-2"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--background)",
        }}
        aria-label="美术生成设置"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5 text-nayin-bright" />
            <span className="text-[10px] font-semibold text-foreground">
              美术
            </span>
          </div>
          <span className="text-[8px] text-muted-foreground">
            {currentLibraryVersionId ? "已绑定库" : "预设或库"}
          </span>
        </div>

        {artLibraryError ? (
          <div className="mb-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
            {artLibraryError}
          </div>
        ) : null}

        <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {FALLBACK_VISUAL_STYLES.map(preset => (
            <VisualPresetButton
              key={preset.id}
              preset={preset}
              selected={activeArtChoiceId === artChoiceKey("preset", preset.id)}
              onSelect={() => onSelectArtPreset(preset)}
            />
          ))}

          {artLibraryLoading ? (
            <div
              className="flex min-w-[150px] shrink-0 items-center justify-center rounded-md border p-2 text-[9px] text-muted-foreground"
              style={{
                borderColor: "var(--panel-border)",
                background: "var(--panel-header)",
              }}
            >
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              读取库
            </div>
          ) : null}

          {artLibraryVersions.map(version => {
            const key = artChoiceKey("library", version.version.id);
            const selected = activeArtChoiceId === key;
            const bound = currentLibraryVersionId === version.version.id;
            const pending = bindingLibraryVersionId === version.version.id;
            return (
              <button
                key={version.version.id}
                type="button"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => {
                  onSelectArtLibrary(version);
                  if (canBindArtLibrary) onBindArtLibrary(version.version.id);
                }}
                className="min-w-[170px] shrink-0 rounded-md border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderColor: selected ? "var(--nayin-accent)" : "var(--panel-border)",
                  background: selected ? "var(--nayin-glow)" : "var(--panel-header)",
                }}
                title={
                  canBindArtLibrary
                    ? "选择并绑定到当前故事"
                    : "先用于本次生成，故事保存后可绑定"
                }
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="line-clamp-1 text-[10px] font-semibold text-foreground">
                    {version.library.name}
                  </span>
                  {pending ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                  ) : bound ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-nayin-bright" />
                  ) : (
                    <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                </div>
                <p className="mt-1 text-[8.5px] text-muted-foreground">
                  v{version.version.version} · {version.library.kind === "system" ? "系统" : "用户"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {libraryTokens(version, 4).map(token => (
                    <span
                      key={token}
                      className="rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground"
                      style={{ borderColor: "var(--panel-border)" }}
                    >
                      {token}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StoryboardShotField({
  label,
  value,
  placeholder,
  rows = 1,
  onCommit,
}: {
  label: string;
  value?: string | null;
  placeholder: string;
  rows?: number;
  onCommit?: (value: string) => void;
}) {
  const currentValue = value?.trim() ?? "";
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[8px] font-semibold text-muted-foreground">
        {label}
      </span>
      <textarea
        key={`${label}:${currentValue}`}
        defaultValue={currentValue}
        rows={rows}
        placeholder={placeholder}
        disabled={!onCommit}
        onBlur={event => {
          const next = event.currentTarget.value.trim();
          if (next !== currentValue) onCommit?.(next);
        }}
        onPointerDown={event => event.stopPropagation()}
        className="w-full resize-none rounded-md border px-2 py-1.5 text-[9px] leading-relaxed text-foreground outline-none transition focus:ring-2 focus:ring-[var(--nayin-accent)]/35 disabled:opacity-70"
        style={{
          borderColor: "var(--panel-border)",
          background: "var(--panel-header)",
        }}
      />
    </label>
  );
}

export function StoryboardReviewBoard({
  images,
  shots,
  latestScript,
  isGeneratingScript,
  selectedShotNo = null,
  onSelectShot,
  onUpdateShotField,
  creationShots = [],
  timelineShotIds = [],
  onAddShotToTimeline,
  generatingVideoShotNo = null,
  onGenerateShotVideo,
  onRefreshShotVideoStatus,
  onAdoptVideoTake,
  shotVideoProviderStatus = null,
  className = "",
}: {
  images: GeneratedImageItem[];
  shots: StoryShot[];
  latestScript: GeneratedScript | null;
  isGeneratingScript: boolean;
  selectedShotNo?: number | null;
  onSelectShot?: (shotNo: number) => void;
  onUpdateShotField?: (
    index: number,
    field: StoryShotEditableField,
    value: string
  ) => void;
  creationShots?: CreationEditorShot[];
  timelineShotIds?: string[];
  onAddShotToTimeline?: (shotNo: number, stableShotId?: string | null) => void;
  generatingVideoShotNo?: number | null;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
  }) => Promise<unknown>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  onAdoptVideoTake?: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  shotVideoProviderStatus?: ShotVideoProviderStatus | null;
  className?: string;
}) {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const frames = useMemo(
    () => latestStoryboardFrames(images, shots),
    [images, shots]
  );
  const frameByShotNo = useMemo(
    () => new Map(frames.map(({ shotNo, image }) => [shotNo, image])),
    [frames]
  );
  const creationShotByNo = useMemo(
    () => new Map(creationShots.map(shot => [shot.shotNo, shot])),
    [creationShots]
  );
  const timelineShotIdSet = useMemo(
    () => new Set(timelineShotIds),
    [timelineShotIds]
  );
  const previousCreationShotsByNo = useMemo(() => {
    const byShotNo = new Map<number, CreationEditorShot[]>();
    const previous: CreationEditorShot[] = [];
    for (const shot of creationShots) {
      byShotNo.set(shot.shotNo, [...previous]);
      previous.push(shot);
    }
    return byShotNo;
  }, [creationShots]);
  const shouldShow =
    frames.length > 0 || isGeneratingScript || shots.length > 0 || latestScript;
  useEffect(() => {
    if (selectedShotNo == null) return;
    const target = boardRef.current?.querySelector<HTMLElement>(
      `[data-storyboard-shot-no="${selectedShotNo}"]`
    );
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedShotNo]);
  if (!shouldShow) return null;

  return (
    <section
      ref={boardRef}
      className={`rounded-md border p-2 ${className}`.trim()}
      style={{
        borderColor: "var(--panel-border)",
        background: "var(--panel-header)",
      }}
      aria-label="故事版看板"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Clapperboard className="h-3.5 w-3.5 text-nayin-bright" />
          <span className="text-[10px] font-semibold text-foreground">
            故事版看板
          </span>
        </div>
        <span className="text-[9px] text-muted-foreground">
          {isGeneratingScript
            ? "生成故事版中"
            : `${shots.length} 镜 · ${frames.length} 张图`}
        </span>
      </div>

      {shots.length > 0 ? (
        <div className="grid gap-2">
          {shots.map((shot, index) => {
            const image = frameByShotNo.get(shot.shotNo);
            const creationShot = creationShotByNo.get(shot.shotNo);
            const title = shortText(
              shot.intent,
              shortText(shot.subject, "关键镜头")
            );
            const body = [shot.action, shot.dialogue]
              .filter(Boolean)
              .join(" · ");
            const selected = selectedShotNo === shot.shotNo;
            const shotTimelineId = creationShot
              ? creationTimelineShotId(creationShot)
              : (shot.stableShotId ??
                shot.shotIdentity ??
                `legacy-sh${String(shot.shotNo).padStart(2, "0")}`);
            const isOnTimeline = timelineShotIdSet.has(shotTimelineId);
            const showMaterialBasket =
              Boolean(creationShot) &&
              (selected ||
                generatingVideoShotNo === shot.shotNo ||
                (creationShot?.videoTakes?.length ?? 0) > 0);
            const commit = (field: StoryShotEditableField, value: string) => {
              onUpdateShotField?.(index, field, value);
            };
            return (
              <article
                key={`${shot.stableShotId ?? shot.shotIdentity ?? shot.shotNo}-${index}`}
                data-storyboard-shot-no={shot.shotNo}
                className="grid gap-2 rounded-md border p-2 transition sm:grid-cols-[144px_1fr]"
                style={{
                  borderColor: selected
                    ? "var(--nayin-accent)"
                    : "var(--panel-border)",
                  background: selected
                    ? "var(--nayin-glow)"
                    : "var(--background)",
                }}
                onClick={() => onSelectShot?.(shot.shotNo)}
              >
                <div
                  className="relative block overflow-hidden rounded-md border cursor-pointer"
                  style={{
                    borderColor: "var(--panel-border)",
                    background: "var(--panel-header)",
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 SH${String(shot.shotNo).padStart(2, "0")} 画面`}
                  onClick={() => {
                    if (image?.imageUrl) setPreviewImageUrl(image.imageUrl);
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && image?.imageUrl)
                      setPreviewImageUrl(image.imageUrl);
                  }}
                >
                  {image?.imageUrl ? (
                    <img
                      src={image.imageUrl}
                      alt={`SH${String(shot.shotNo).padStart(2, "0")} ${title}`}
                      className="aspect-video h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video h-full w-full items-center justify-center gap-1.5 text-[9px] text-muted-foreground">
                      {isGeneratingScript ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3 w-3" />
                      )}
                      待生成关键帧
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-background/90 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-foreground shadow-sm">
                    SH{String(shot.shotNo).padStart(2, "0")}
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground"
                        style={{ borderColor: "var(--panel-border)" }}
                      >
                        {shortText(shot.beat, "故事节点")}
                      </span>
                      {image ? (
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[8px] text-muted-foreground"
                          style={{ borderColor: "var(--panel-border)" }}
                        >
                          {generatedStatusLabel(image.status)}
                        </span>
                      ) : null}
                    </div>
                    {onAddShotToTimeline ? (
                      <button
                        type="button"
                        disabled={isOnTimeline}
                        onClick={event => {
                          event.stopPropagation();
                          onAddShotToTimeline(shot.shotNo, shotTimelineId);
                          onSelectShot?.(shot.shotNo);
                        }}
                        className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[8.5px] font-medium transition hover:border-[var(--nayin-accent)] hover:bg-[var(--nayin-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                        style={{ borderColor: "var(--panel-border)" }}
                        aria-label={
                          isOnTimeline
                            ? `SH${String(shot.shotNo).padStart(2, "0")} 已在时间轴`
                            : `把 SH${String(shot.shotNo).padStart(2, "0")} 加入时间轴`
                        }
                      >
                        {isOnTimeline ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <ListPlus className="h-3 w-3" />
                        )}
                        {isOnTimeline ? "已在时间轴" : "加入时间轴"}
                      </button>
                    ) : null}
                  </div>
                  <h4 className="mt-1 line-clamp-1 text-[11px] font-semibold text-foreground">
                    {title}
                  </h4>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {body ||
                      shot.sourceCardContent ||
                      "等待导演把这一镜拆成可拍的动作"}
                  </p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    <StoryboardShotField
                      label="镜头任务"
                      value={shot.intent || shot.subject}
                      placeholder="这一镜要让观众明白什么"
                      onCommit={value => commit("intent", value)}
                    />
                    <StoryboardShotField
                      label="画面动作"
                      value={shot.action}
                      placeholder="画面里正在发生什么"
                      onCommit={value => commit("action", value)}
                    />
                    <StoryboardShotField
                      label="字幕/旁白"
                      value={shot.dialogue}
                      placeholder="台词、字幕或画外音"
                      onCommit={value => commit("dialogue", value)}
                    />
                    <StoryboardShotField
                      label="运镜"
                      value={shot.cameraMove}
                      placeholder="推、拉、摇、移或静态"
                      onCommit={value => commit("cameraMove", value)}
                    />
                    <StoryboardShotField
                      label="声音"
                      value={shot.sound}
                      placeholder="背景音、气口或音乐进入点"
                      onCommit={value => commit("sound", value)}
                    />
                    <StoryboardShotField
                      label="接后"
                      value={shot.transitionOut}
                      placeholder="如何接到下一镜"
                      onCommit={value => commit("transitionOut", value)}
                    />
                    <div className="sm:col-span-2">
                      <StoryboardShotField
                        label="导演理由"
                        value={shot.rationale}
                        rows={2}
                        placeholder={
                          image?.prompt || "为什么这一镜能证明这个求职优势"
                        }
                        onCommit={value => commit("rationale", value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <StoryboardShotField
                        label="图生视频提示"
                        value={shot.videoPrompt}
                        rows={2}
                        placeholder="这一镜的动态变化、相机运动、开始和结束状态"
                        onCommit={value => commit("videoPrompt", value)}
                      />
                    </div>
                  </div>
                  {showMaterialBasket && creationShot ? (
                    <ShotMaterialBasket
                      shot={creationShot}
                      previousShots={
                        previousCreationShotsByNo.get(creationShot.shotNo) ?? []
                      }
                      generating={generatingVideoShotNo === creationShot.shotNo}
                      onGenerateShotVideo={onGenerateShotVideo}
                      onRefreshShotVideoStatus={onRefreshShotVideoStatus}
                      onAdoptVideoTake={onAdoptVideoTake}
                      shotVideoProviderStatus={shotVideoProviderStatus}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div
          className="flex h-20 items-center justify-center gap-2 rounded-md border border-dashed text-[10px] text-muted-foreground"
          style={{ borderColor: "var(--panel-border)" }}
        >
          {isGeneratingScript ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clapperboard className="h-3.5 w-3.5" />
          )}
          {isGeneratingScript
            ? "正在写剧本并准备关键帧草稿"
            : "还没有故事版，点“生成故事版”后会出现在这里"}
        </div>
      )}
      {previewImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewImageUrl(null)}
          onKeyDown={e => {
            if (e.key === "Escape") setPreviewImageUrl(null);
          }}
          role="presentation"
        >
          <div
            className="relative max-h-[80vh] max-w-[80vw] overflow-hidden rounded-lg bg-background shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewImageUrl}
              alt="预览"
              className="max-h-[80vh] max-w-[80vw] object-contain"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CardReferenceDock({
  cardId,
  visualItems,
  generatedImage,
  imageRationale,
  onDeleteGeneratedImage,
}: {
  cardId: string;
  visualItems: VisualCanvasItem[];
  generatedImage?: GeneratedImageItem;
  imageRationale?: string | null;
  onDeleteGeneratedImage?: (image: GeneratedImageItem) => void;
}) {
  const { isArtWorking, artDirection } = useCardReferenceDockSlice();
  const {
    addVisualReference,
    removeVisualCanvasItem,
    setCharacterReferenceByUrl,
  } = useStoryAgentActions();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const isFinalizing = generatedImage?.status === "finalizing";
  const isDraft = generatedImage?.status === "draft";
  const displayReason = imageRationale?.trim();
  // 当前主角参照 URL（跨镜头锁人物长相）——用于在照片上标星 + 切换
  const characterUrl = artDirection.references.find(
    reference => reference.role === "character"
  )?.imageUrl;

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files).find(entry =>
      entry.type.startsWith("image/")
    );
    if (!file) return;
    await addVisualReference(file, undefined, cardId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <>
      <div
        className="mt-3 rounded-md border p-2"
        onPointerDown={event => event.stopPropagation()}
        style={{
          borderColor: dragActive
            ? "var(--nayin-accent)"
            : "var(--panel-border)",
          background: "var(--background)",
        }}
        onDragEnter={event => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold text-muted-foreground">
            故事材料 {visualItems.length ? `· ${visualItems.length} 张` : ""}
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isArtWorking}
            className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {isArtWorking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ImagePlus className="h-3 w-3" />
            )}
            添加参考
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              if (event.currentTarget.files)
                void handleFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>

        {generatedImage ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setPreviewImageUrl(generatedImage.imageUrl)}
            onKeyDown={e => {
              if (e.key === "Enter")
                setPreviewImageUrl(generatedImage.imageUrl);
            }}
            className="relative mt-2 grid grid-cols-[72px_1fr] gap-2 overflow-hidden rounded-md border p-1.5 cursor-pointer"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <button
              type="button"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onDeleteGeneratedImage?.(generatedImage);
              }}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition hover:text-destructive"
              aria-label="删除已选择画面"
              title="删除这张已选择画面，并记录为不想要"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <img
              src={generatedImage.imageUrl}
              alt={generatedImage.prompt || "当前生成画面"}
              className="aspect-square w-full rounded object-cover"
            />
            {isFinalizing ? (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-sm">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                正在出正式版
              </span>
            ) : isDraft ? (
              <span className="absolute left-2 top-2 rounded-full bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-sm">
                草稿待确认
              </span>
            ) : null}
            <div className="min-w-0 self-center">
              <div className="text-[10px] font-semibold text-foreground">
                {isFinalizing ? "正式版生成中" : "当前生成画面"}
              </div>
              <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted-foreground">
                {isFinalizing
                  ? "已收下草稿，正式版完成后会自动替换到这里"
                  : displayReason ||
                    generatedImage.prompt ||
                    "从手机端同步的故事画面"}
              </p>
              {/* 把这张满意的镜头图设为主角参照——后续镜头跨场景锁这个人物 */}
              <button
                type="button"
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (generatedImage.status !== "ready") return;
                  setCharacterReferenceByUrl(
                    generatedImage.imageUrl,
                    "当前画面主角"
                  );
                }}
                disabled={generatedImage.status !== "ready"}
                className="mt-1 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor:
                    generatedImage.imageUrl === characterUrl
                      ? "var(--nayin-accent)"
                      : "var(--panel-border)",
                }}
              >
                <Star
                  className={`h-2.5 w-2.5 ${generatedImage.imageUrl === characterUrl ? "fill-amber-400 text-amber-400" : ""}`}
                />
                {generatedImage.status !== "ready"
                  ? "待正式版"
                  : generatedImage.imageUrl === characterUrl
                    ? "已设为主角"
                    : "设为主角"}
              </button>
            </div>
          </div>
        ) : null}

        {visualItems.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isArtWorking}
            className="mt-2 flex min-h-[50px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 text-center transition disabled:opacity-50"
            style={{
              borderColor: dragActive
                ? "var(--nayin-accent)"
                : "var(--panel-border)",
              background: dragActive ? "var(--nayin-glow)" : "transparent",
            }}
          >
            <ImagePlus className="h-3.5 w-3.5 text-nayin-bright" />
            <span className="text-[9px] font-medium text-muted-foreground">
              把与这一刻有关的照片拖进来
            </span>
          </button>
        ) : (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {visualItems.map(item => {
              const itemUrl = item.originalImageUrl || item.imageUrl;
              const isCharacter = !!characterUrl && itemUrl === characterUrl;
              return (
                <div
                  key={item.id}
                  className="group/reference relative h-14 w-14 shrink-0 overflow-hidden rounded-md border"
                  style={{
                    borderColor: isCharacter
                      ? "var(--nayin-accent)"
                      : "var(--panel-border)",
                  }}
                  title={
                    isCharacter ? "主角参照（跨镜头锁人物长相）" : item.title
                  }
                >
                  <img
                    src={itemUrl}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  {/* 当前主角参照：左上角星标常显 */}
                  {isCharacter && (
                    <span className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white">
                      <Star className="h-2.5 w-2.5 fill-current" />
                    </span>
                  )}
                  {/* 设为主角参照：左下角 hover 显示（单选） */}
                  <button
                    type="button"
                    onClick={() =>
                      setCharacterReferenceByUrl(itemUrl, item.title)
                    }
                    className="absolute bottom-1 left-1 flex h-5 items-center gap-0.5 rounded-full bg-background/85 px-1.5 text-[9px] font-medium text-muted-foreground opacity-0 transition hover:text-foreground group-hover/reference:opacity-100"
                    aria-label={`设为主角参照 ${item.title}`}
                  >
                    <Star className="h-2.5 w-2.5" />
                    主角
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVisualCanvasItem(item.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-muted-foreground opacity-0 transition group-hover/reference:opacity-100"
                    aria-label={`移除 ${item.title}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewImageUrl(null)}
          onKeyDown={event => {
            if (event.key === "Escape") setPreviewImageUrl(null);
          }}
          role="presentation"
        >
          <div
            className="relative max-h-[80vh] max-w-[80vw] overflow-hidden rounded-lg bg-background shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewImageUrl}
              alt="预览"
              className="max-h-[80vh] max-w-[80vw] object-contain"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function CardItem({
  card,
  index,
  previousEmotion,
  visualItems,
  generatedImage,
  imageRationale,
  onRemove,
  onCommitContent,
  onDeleteGeneratedImage,
}: {
  card: StoryCard;
  index: number;
  previousEmotion?: string;
  visualItems: VisualCanvasItem[];
  generatedImage?: GeneratedImageItem;
  imageRationale?: string | null;
  onRemove: () => void;
  onCommitContent: (content: string) => void;
  onDeleteGeneratedImage: (image: GeneratedImageItem) => void;
}) {
  const controls = useDragControls();
  const tint = emotionAccent(card.emotion);

  return (
    <Reorder.Item
      value={card}
      dragListener={false}
      dragControls={controls}
      className="select-none"
      whileDrag={{
        scale: 1.02,
        boxShadow: "0 12px 40px -12px var(--nayin-glow)",
        zIndex: 10,
      }}
    >
      <EmotionBridge
        previousEmotion={previousEmotion}
        currentEmotion={card.emotion}
      />
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="rounded-lg border p-3 group relative"
        style={{
          background: `linear-gradient(135deg, ${tint} 0%, var(--card) 70%)`,
          borderColor: "var(--panel-border)",
        }}
      >
        <div className="flex items-start gap-2">
          {/* Drag handle */}
          <button
            type="button"
            onPointerDown={e => controls.start(e)}
            className="shrink-0 mt-0.5 cursor-grab active:cursor-grabbing opacity-30 group-hover:opacity-70 transition-opacity"
            aria-label="拖拽排序"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Index badge */}
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-semibold mt-0.5"
            style={{
              background: "var(--nayin-accent)",
              color: "var(--background)",
            }}
          >
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-semibold text-foreground truncate">
                {card.title}
              </h4>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                style={{
                  background: "var(--nayin-glow)",
                  color: "var(--nayin-accent-bright)",
                }}
              >
                {card.emotion}
              </span>
            </div>
            <p
              data-selection-source={`card:${card.id}`}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="编辑卡片内容"
              tabIndex={0}
              onPointerDown={e => e.stopPropagation()}
              onKeyDown={e => {
                // Enter commits & blurs; Shift+Enter keeps newline
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              onBlur={e => {
                const next = (e.currentTarget.innerText || "").trim();
                if (next && next !== card.content) onCommitContent(next);
                else e.currentTarget.innerText = card.content;
              }}
              className="text-[11px] text-muted-foreground leading-relaxed select-text cursor-text rounded-sm outline-none -mx-1 px-1 focus:bg-foreground/[0.04] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.02] transition-colors"
            >
              {card.content}
            </p>
            {card.sensoryDetails.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {card.sensoryDetails.map((d, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                    style={{
                      background: "var(--panel-header)",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    · {d}
                  </span>
                ))}
              </div>
            )}
            <CardReferenceDock
              cardId={card.id}
              visualItems={visualItems}
              generatedImage={generatedImage}
              imageRationale={imageRationale}
              onDeleteGeneratedImage={onDeleteGeneratedImage}
            />
          </div>

          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 transition-all"
            aria-label="删除卡片"
            title="删除这张卡片"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </Reorder.Item>
  );
}

export default function StoryCardsBoard() {
  const {
    cards,
    isGeneratingScript,
    latestScript,
    storyShots,
    visualCanvasItems,
    confirmedIntent,
    pendingIntentDraft,
  } = useStoryCardsBoardSlice();
  const {
    reorderCards,
    removeCard,
    updateCardContent,
    generateScript,
    removeStoryImage,
    confirmPendingIntent,
    confirmFictionStoryCards,
  } = useStoryAgentActions();
  const { element } = useNayin();
  const [boardView, setBoardView] = useState<"graph" | "list">("graph");
  const lastOrderRef = useRef<string>("");
  const utils = trpc.useUtils();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();
  const activeStoryId = useStorySpine(state => state.activeStoryId);
  const promptProjectionQuery = trpc.promptLineage.getStoryProjection.useQuery(
    { storyId: activeStoryId ?? 0 },
    { enabled: activeStoryId != null && activeStoryId > 0 }
  );
  const artLibraryQuery = trpc.artPromptLibrary.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  const bindArtLibraryMut = trpc.artPromptLibrary.bindToStory.useMutation();
  const generatedImages = useStoryGeneratedImages();
  const [selectedNarrativeId, setSelectedNarrativeId] = useState("");
  const [selectedArtChoiceId, setSelectedArtChoiceId] = useState("");
  const [bindingLibraryVersionId, setBindingLibraryVersionId] =
    useState<number | null>(null);
  const generatedScenes = useMemo(
    () => buildMobileStoryboardScenes(cards, generatedImages),
    [cards, generatedImages]
  );
  const promptProjection =
    promptProjectionQuery.data?.mode === "lineage"
      ? promptProjectionQuery.data.projection
      : null;
  const artLibraryVersions = (artLibraryQuery.data ??
    []) as ArtLibraryVersionView[];
  const currentLibraryVersionId =
    promptProjection?.artBinding?.libraryVersionId ?? null;
  const handleDeleteGeneratedImage = useCallback(
    async (image: GeneratedImageItem) => {
      removeStoryImage(image.id);
      if (image.storyId == null) return;
      utils.storyAgent.storyGet.setData({ id: image.storyId }, current => {
        if (!current?.body || typeof current.body !== "object") return current;
        const body = current.body as Record<string, unknown>;
        const mobileImages = Array.isArray(body.mobileImages)
          ? body.mobileImages.filter(item => {
              if (!item || typeof item !== "object") return true;
              return (item as { id?: unknown }).id !== image.id;
            })
          : body.mobileImages;
        return { ...current, body: { ...body, mobileImages } };
      });
      try {
        await signalMut.mutateAsync({
          storyId: image.storyId,
          imageId: image.id,
          action: "swipe_left",
          metadata: { source: "story-cards-delete" },
        });
        void utils.storyAgent.storyImages.invalidate({
          storyId: image.storyId,
        });
        void utils.storyAgent.storyGet.invalidate({ id: image.storyId });
      } catch (error) {
        console.warn(
          "[StoryCardsBoard] record image delete signal failed:",
          error instanceof Error ? error.message : error
        );
      }
    },
    [removeStoryImage, signalMut, utils]
  );

  // Detect whether order changed since last script
  const orderChanged = useMemo(() => {
    if (!latestScript) return cards.length > 0;
    if (latestScript.cardOrder.length !== cards.length) return true;
    return cards.some((c, i) => latestScript.cardOrder[i] !== c.id);
  }, [cards, latestScript]);
  const effectiveIntent = confirmedIntent ?? pendingIntentDraft;
  const isFictionIntent = effectiveIntent?.purpose === "fiction";
  const hasPendingFictionIntent =
    !confirmedIntent && pendingIntentDraft?.purpose === "fiction";
  const hasConfirmedFictionIntent = confirmedIntent?.purpose === "fiction";
  const fictionCardsConfirmed = isFictionStoryCardConfirmed(
    confirmedIntent,
    cards
  );
  const shouldGateFictionStoryboard =
    isFictionIntent && (!hasConfirmedFictionIntent || !fictionCardsConfirmed);
  const primaryActionDisabled = isGeneratingScript || cards.length === 0;
  const narrativeChoices = useMemo(
    () => narrativeChoicesForIntent(effectiveIntent?.purpose),
    [effectiveIntent?.purpose]
  );
  const activeNarrativeId = narrativeChoices.some(
    choice => choice.id === selectedNarrativeId
  )
    ? selectedNarrativeId
    : (narrativeChoices[0]?.id ?? "");
  const defaultArtChoiceId = currentLibraryVersionId
    ? artChoiceKey("library", currentLibraryVersionId)
    : artChoiceKey("preset", FALLBACK_VISUAL_STYLES[0]?.id ?? "");
  const activeArtChoiceId =
    selectedArtChoiceId &&
    (FALLBACK_VISUAL_STYLES.some(
      preset => selectedArtChoiceId === artChoiceKey("preset", preset.id)
    ) ||
      artLibraryVersions.some(
        version => selectedArtChoiceId === artChoiceKey("library", version.version.id)
      ))
      ? selectedArtChoiceId
      : defaultArtChoiceId;
  const selectedNarrativeChoice =
    narrativeChoices.find(choice => choice.id === activeNarrativeId) ??
    narrativeChoices[0] ??
    null;
  const selectedArtPreset = FALLBACK_VISUAL_STYLES.find(
    preset => activeArtChoiceId === artChoiceKey("preset", preset.id)
  );
  const selectedArtLibrary = artLibraryVersions.find(
    version => activeArtChoiceId === artChoiceKey("library", version.version.id)
  );
  const generationProfile = useMemo<GenerationProfileArg>(
    () => ({
      scriptStyle: selectedNarrativeChoice
        ? {
            id: selectedNarrativeChoice.id,
            label: selectedNarrativeChoice.label,
            logline: selectedNarrativeChoice.logline,
            arc: selectedNarrativeChoice.arc,
            treatment: selectedNarrativeChoice.treatment,
          }
        : undefined,
      artStyle: selectedArtLibrary
        ? {
            id: artChoiceKey("library", selectedArtLibrary.version.id),
            source: "library",
            title: selectedArtLibrary.library.name,
            description: selectedArtLibrary.library.description,
            libraryVersionId: selectedArtLibrary.version.id,
            items: selectedArtLibrary.items.map(item => ({
              dimension: item.dimension,
              content: item.content,
              negativeContent: item.negativeContent,
            })),
          }
        : selectedArtPreset
          ? {
              id: selectedArtPreset.id,
              source: "preset",
              title: selectedArtPreset.title,
              description: selectedArtPreset.description,
              recipe: selectedArtPreset.recipe,
            }
          : undefined,
    }),
    [selectedArtLibrary, selectedArtPreset, selectedNarrativeChoice]
  );
  const handleBindArtLibrary = useCallback(
    async (libraryVersionId: number) => {
      if (activeStoryId == null || activeStoryId <= 0 || !promptProjection) {
        toast.error("故事保存后才能绑定美术库");
        return;
      }
      setBindingLibraryVersionId(libraryVersionId);
      try {
        const result = await bindArtLibraryMut.mutateAsync({
          storyId: activeStoryId,
          libraryVersionId,
          expectedVersion: promptProjection.state.version,
        });
        if (result.projection) {
          utils.promptLineage.getStoryProjection.setData(
            { storyId: activeStoryId },
            { mode: "lineage", projection: result.projection }
          );
        }
        setSelectedArtChoiceId(artChoiceKey("library", libraryVersionId));
        await Promise.all([
          utils.promptLineage.getStoryProjection.invalidate({
            storyId: activeStoryId,
          }),
          utils.storyAgent.storyGet.invalidate({ id: activeStoryId }),
        ]);
        toast.success("美术库已绑定到故事");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "绑定美术库失败");
      } finally {
        setBindingLibraryVersionId(null);
      }
    },
    [activeStoryId, bindArtLibraryMut, promptProjection, utils]
  );
  const handlePrimaryAction = useCallback(() => {
    if (hasPendingFictionIntent) {
      confirmPendingIntent();
      return;
    }
    if (shouldGateFictionStoryboard) {
      confirmFictionStoryCards();
      return;
    }
    void generateScript(undefined, generationProfile);
  }, [
    confirmFictionStoryCards,
    confirmPendingIntent,
    generateScript,
    generationProfile,
    hasPendingFictionIntent,
    shouldGateFictionStoryboard,
  ]);

  // Track the last order string for animation triggers (reserved for future use)
  const orderKey = cards.map(c => c.id).join("|");
  if (orderKey !== lastOrderRef.current) lastOrderRef.current = orderKey;

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Story Cards</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] opacity-60 font-mono">
          {cards.length > 0 ? (
            <>
              <Sparkles className="w-3 h-3" />
              {cards.length} cards
            </>
          ) : (
            <span>EMPTY</span>
          )}
        </span>
        {cards.length > 0 ? (
          <span
            className="ml-2 inline-flex rounded-full border p-0.5 text-[10px]"
            style={{
              borderColor: "var(--panel-border)",
              background: "var(--background)",
            }}
          >
            <button
              type="button"
              onClick={() => setBoardView("graph")}
              className="rounded-full px-2 py-0.5 transition"
              style={{
                background:
                  boardView === "graph" ? "var(--nayin-accent)" : "transparent",
                color:
                  boardView === "graph"
                    ? "var(--background)"
                    : "var(--muted-foreground)",
              }}
            >
              图谱
            </button>
            <button
              type="button"
              onClick={() => setBoardView("list")}
              className="rounded-full px-2 py-0.5 transition"
              style={{
                background:
                  boardView === "list" ? "var(--nayin-accent)" : "transparent",
                color:
                  boardView === "list"
                    ? "var(--background)"
                    : "var(--muted-foreground)",
              }}
            >
              列表
            </button>
          </span>
        ) : null}
      </div>

      <div className="monitor-panel-body flex-1 flex flex-col overflow-y-auto custom-scrollbar">
        {cards.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-[180px] flex-col items-center justify-center text-center gap-3 px-4"
          >
            <FlaskConical className="w-7 h-7 text-muted-foreground opacity-40" />
            <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
              {EMPTY_HINT[element]}
            </p>
            <p className="text-[10px] text-muted-foreground/70 max-w-[16rem]">
              小酌会在你描述出{" "}
              <span className="text-nayin-bright">
                具体场景 + 情感 + 感官细节
              </span>{" "}
              时，自动把那一刻提炼成卡片，飞到这里来。
            </p>
          </motion.div>
        ) : (
          <>
            <GenerationSettingsPanel
              narrativeChoices={narrativeChoices}
              activeNarrativeId={activeNarrativeId}
              onSelectNarrative={setSelectedNarrativeId}
              activeArtChoiceId={activeArtChoiceId}
              artLibraryVersions={artLibraryVersions}
              currentLibraryVersionId={currentLibraryVersionId}
              artLibraryLoading={
                artLibraryQuery.isLoading || artLibraryQuery.isFetching
              }
              artLibraryError={artLibraryQuery.error?.message ?? null}
              canBindArtLibrary={Boolean(activeStoryId && promptProjection)}
              bindingLibraryVersionId={bindingLibraryVersionId}
              onSelectArtPreset={preset =>
                setSelectedArtChoiceId(artChoiceKey("preset", preset.id))
              }
              onSelectArtLibrary={libraryVersion =>
                setSelectedArtChoiceId(
                  artChoiceKey("library", libraryVersion.version.id)
                )
              }
              onBindArtLibrary={libraryVersionId => {
                void handleBindArtLibrary(libraryVersionId);
              }}
            />

            {boardView === "graph" ? (
              <StoryCardsGraph
                cards={cards}
                storyShots={storyShots}
                onRemoveCard={removeCard}
                mode={isFictionIntent ? "fiction" : "default"}
              />
            ) : (
              <>
                <Reorder.Group
                  axis="y"
                  values={cards}
                  onReorder={reorderCards}
                  className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1"
                >
                  <AnimatePresence>
                    {cards.map((card, idx) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        index={idx}
                        previousEmotion={cards[idx - 1]?.emotion}
                        visualItems={visualCanvasItems.filter(
                          item => item.cardId === card.id
                        )}
                        generatedImage={latestGeneratedImageForCard(
                          generatedImages,
                          generatedScenes[idx]?.imageId,
                          idx + 1
                        )}
                        imageRationale={rationaleForShot(storyShots, idx + 1)}
                        onRemove={() => removeCard(card.id)}
                        onCommitContent={text =>
                          updateCardContent(card.id, text)
                        }
                        onDeleteGeneratedImage={handleDeleteGeneratedImage}
                      />
                    ))}
                  </AnimatePresence>
                </Reorder.Group>
              </>
            )}

            <div
              className="border-t pt-2.5 mt-2 flex flex-col gap-2"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {isFictionIntent ? (
                <div
                  className="rounded-lg border p-2 text-[11px] leading-relaxed"
                  style={{
                    borderColor: fictionCardsConfirmed
                      ? "var(--nayin-accent-dim)"
                      : "var(--panel-border)",
                    background: "var(--background)",
                  }}
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      style={{
                        color: fictionCardsConfirmed
                          ? "var(--nayin-accent)"
                          : "var(--muted-foreground)",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {hasPendingFictionIntent
                          ? "先确认创造另一个世界"
                          : fictionCardsConfirmed
                          ? "虚构故事卡已确认"
                          : "先确认虚构故事卡"}
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {hasPendingFictionIntent
                          ? "小酌已经判断这是虚构短片；确认意图后，故事卡会按世界、人物和冲突继续生长。"
                          : fictionCardsConfirmed
                          ? "现在可以生成 3-5 镜短片；如果改卡片，需要重新确认。"
                          : "确认后再进入拆镜，避免还没定故事方向就生成镜头。"}
                      </p>
                    </div>
                    {hasPendingFictionIntent ? (
                      <button
                        type="button"
                        onClick={confirmPendingIntent}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认意图
                      </button>
                    ) : !fictionCardsConfirmed ? (
                      <button
                        type="button"
                        onClick={confirmFictionStoryCards}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium"
                        style={{
                          borderColor: "var(--nayin-accent-dim)",
                          color: "var(--nayin-accent)",
                        }}
                      >
                        确认故事卡
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={handlePrimaryAction}
                disabled={primaryActionDisabled}
                className="text-xs py-2 rounded-md font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{
                  background: "var(--nayin-accent)",
                  color: "var(--background)",
                  boxShadow: "0 4px 16px -6px var(--nayin-glow)",
                }}
              >
                {isGeneratingScript ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在生成故事版…
                  </>
                ) : (
                  <>
                    <Clapperboard className="w-3.5 h-3.5" />
                    {latestScript && !orderChanged
                      ? "重新生成故事版"
                      : latestScript && orderChanged
                        ? "按新顺序生成故事版"
                        : hasPendingFictionIntent
                          ? "先确认意图"
                        : shouldGateFictionStoryboard
                          ? "确认故事卡"
                          : "生成故事版"}
                  </>
                )}
              </button>
              <p className="text-[10px] text-muted-foreground/70 text-center">
                生成剧本 · 统一提示词 · 关键镜头草稿图
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
