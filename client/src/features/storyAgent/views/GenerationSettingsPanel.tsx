import {
  CheckCircle2,
  Link2,
  Loader2,
  Palette,
  ScrollText,
} from "lucide-react";
import type { ArtRecipeDNA } from "@shared/artDirection";

export type NarrativeStyleChoice = {
  id: string;
  label: string;
  logline: string;
  arc: string;
  treatment: string;
  generated: boolean;
};

export type VisualStylePreset = {
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

export const FALLBACK_VISUAL_STYLES: VisualStylePreset[] = [
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

export type ArtLibraryVersionView = {
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

export function narrativeChoicesForIntent(
  purpose?: string | null
): NarrativeStyleChoice[] {
  if (purpose === "fiction") return FICTION_NARRATIVE_STYLES;
  if (purpose === "linkedin_job_search") return FALLBACK_NARRATIVE_STYLES;
  return GENERAL_NARRATIVE_STYLES;
}

export function artChoiceKey(
  source: "preset" | "library",
  id: string | number
): string {
  return `${source}:${id}`;
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

export function GenerationSettingsPanel({
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
          <span className="text-[8px] text-muted-foreground">
            生成故事版时使用
          </span>
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
                  borderColor: selected
                    ? "var(--nayin-accent)"
                    : "var(--panel-border)",
                  background: selected
                    ? "var(--nayin-glow)"
                    : "var(--panel-header)",
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
                  v{version.version.version} ·{" "}
                  {version.library.kind === "system" ? "系统" : "用户"}
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
