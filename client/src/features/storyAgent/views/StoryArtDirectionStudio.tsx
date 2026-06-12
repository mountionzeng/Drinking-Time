import { useRef, useState, type ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImagePlus,
  Loader2,
  Lock,
  Palette,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { IMAGE_PROVIDER_LABELS, IMAGE_PROVIDER_VALUES } from '@shared/imageProvider';
import type {
  ArtCandidateVerdict,
  ArtDirectionCandidate,
  ArtRecipeDNA,
  ArtReferencePurpose,
} from '@shared/artDirection';
import {
  useStoryAgent,
  type ImageProviderSelection,
} from '@/features/storyAgent/StoryAgentContext';

const PROVIDERS: Array<{ value: ImageProviderSelection; label: string }> = [
  { value: 'default', label: '默认模型' },
  ...IMAGE_PROVIDER_VALUES.map(value => ({
    value,
    label: IMAGE_PROVIDER_LABELS[value],
  })),
];

const PURPOSE_LABEL: Record<ArtReferencePurpose, string> = {
  fact: '事实',
  aesthetic: '审美',
  both: '两者',
};

const RECIPE_FIELDS: Array<{
  key: keyof ArtRecipeDNA;
  label: string;
  placeholder: string;
}> = [
  { key: 'style', label: '笔触与媒介', placeholder: '平涂插图、水性边缘' },
  { key: 'palette', label: '色彩', placeholder: '低饱和青绿、暖灰' },
  { key: 'light', label: '光线', placeholder: '柔和侧光、自然漫射光' },
  { key: 'composition', label: '构图', placeholder: '单一主体、适度留白' },
  { key: 'material', label: '质感', placeholder: '纸纹、印刷颗粒' },
  { key: 'negative', label: '避免', placeholder: '拼贴、多格、过度戏剧化' },
];

function CandidateCard({
  candidate,
  onVerdict,
}: {
  candidate: ArtDirectionCandidate;
  onVerdict: (verdict: ArtCandidateVerdict) => void;
}) {
  const verdictLabel =
    candidate.verdict === 'liked'
      ? '已喜欢'
      : candidate.verdict === 'rejected'
        ? '已淘汰'
        : '待选择';

  return (
    <motion.article
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.72}
      onDragEnd={(_, info) => {
        if (info.offset.x > 70) onVerdict('liked');
        if (info.offset.x < -70) onVerdict('rejected');
      }}
      className="w-[236px] shrink-0 overflow-hidden rounded-md border bg-card shadow-sm sm:w-[264px]"
      style={{
        borderColor:
          candidate.verdict === 'liked'
            ? 'var(--nayin-accent)'
            : candidate.verdict === 'rejected'
              ? 'color-mix(in srgb, var(--destructive) 55%, var(--panel-border))'
              : 'var(--panel-border)',
        opacity: candidate.verdict === 'rejected' ? 0.64 : 1,
      }}
      aria-label={`${candidate.title}，${verdictLabel}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        <img
          src={candidate.imageUrl}
          alt={candidate.title}
          className="h-full w-full object-cover"
          draggable={false}
        />
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <span
            className="rounded px-1.5 py-1 text-[9px] font-semibold backdrop-blur"
            style={{
              background: 'color-mix(in srgb, var(--background) 82%, transparent)',
              color: 'var(--foreground)',
            }}
          >
            {candidate.role === 'comparison'
              ? candidate.axis || '单轴比较'
              : candidate.role === 'convergence'
                ? '收敛'
                : '完整方向'}
          </span>
        </div>
        {candidate.verdict !== 'pending' ? (
          <div
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full"
            style={{
              background:
                candidate.verdict === 'liked'
                  ? 'var(--nayin-accent)'
                  : 'var(--destructive)',
              color: 'var(--background)',
            }}
          >
            {candidate.verdict === 'liked' ? (
              <Heart className="h-3.5 w-3.5 fill-current" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
          </div>
        ) : null}
      </div>

      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-foreground">
              {candidate.title}
            </h4>
            <p className="mt-0.5 text-[9px] text-muted-foreground">
              {candidate.recipe.style.slice(0, 2).join(' · ')}
            </p>
          </div>
          <span className="shrink-0 text-[9px] font-medium text-muted-foreground">
            {verdictLabel}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              onVerdict(candidate.verdict === 'rejected' ? 'pending' : 'rejected')
            }
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-[10px] font-semibold text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label={`淘汰 ${candidate.title}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            淘汰
          </button>
          <button
            type="button"
            onClick={() =>
              onVerdict(candidate.verdict === 'liked' ? 'pending' : 'liked')
            }
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[10px] font-semibold transition"
            style={{
              background:
                candidate.verdict === 'liked'
                  ? 'var(--nayin-accent)'
                  : 'var(--nayin-glow)',
              color:
                candidate.verdict === 'liked'
                  ? 'var(--background)'
                  : 'var(--nayin-accent-bright)',
            }}
            aria-label={`喜欢 ${candidate.title}`}
          >
            <Heart
              className={`h-3.5 w-3.5 ${
                candidate.verdict === 'liked' ? 'fill-current' : ''
              }`}
            />
            喜欢
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function LoadingCandidates() {
  return (
    <div className="flex gap-3 overflow-hidden pb-1">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="w-[236px] shrink-0 overflow-hidden rounded-md border sm:w-[264px]"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StoryArtDirectionStudio() {
  const {
    artDirection,
    imageProvider,
    setImageProvider,
    isArtWorking,
    addVisualReference,
    prepareArtDirection,
    toggleArtReference,
    cycleArtReferencePurpose,
    generateArtCandidates,
    setArtCandidateVerdict,
    reviewArtRecipe,
    updateArtRecipeField,
    lockArtRecipe,
    resetArtDirection,
  } = useStoryAgent();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const candidateRailRef = useRef<HTMLDivElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const likedCount = artDirection.candidates.filter(
    candidate => candidate.verdict === 'liked',
  ).length;
  const rejectedCount = artDirection.candidates.filter(
    candidate => candidate.verdict === 'rejected',
  ).length;
  const selectedReferenceCount = artDirection.references.filter(
    reference => reference.selected,
  ).length;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setIsUploading(true);
    try {
      await addVisualReference(file);
    } finally {
      setIsUploading(false);
    }
  };

  if (artDirection.phase === 'empty') {
    return (
      <section
        className="mb-3 flex items-center justify-between gap-3 border-y px-3 py-3"
        style={{
          borderColor: 'var(--panel-border)',
          background: 'var(--panel-header)',
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{
              background: 'var(--nayin-glow)',
              color: 'var(--nayin-accent-bright)',
            }}
          >
            <Palette className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-foreground">故事美术定调</h3>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              从已有照片和故事材料里选依据，再比较六种画法
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={prepareArtDirection}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[10px] font-semibold"
          style={{
            background: 'var(--nayin-accent)',
            color: 'var(--background)',
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          开始定调
        </button>
      </section>
    );
  }

  return (
    <section
      className="mb-3 border-y py-3"
      style={{
        borderColor: 'var(--panel-border)',
        background: 'var(--panel-header)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-nayin-bright" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-foreground">故事美术定调</h3>
              {artDirection.phase === 'locked' ? (
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{
                    background: 'var(--nayin-glow)',
                    color: 'var(--nayin-accent-bright)',
                  }}
                >
                  已锁定 v{artDirection.recipe?.version ?? 1}
                </span>
              ) : (
                <span className="text-[9px] font-mono text-muted-foreground">
                  ROUND {Math.max(1, artDirection.round)}
                </span>
              )}
            </div>
            <p className="mt-0.5 line-clamp-1 max-w-[32rem] text-[9px] text-muted-foreground">
              同一瞬间：{artDirection.targetContent}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={imageProvider}
            onChange={event =>
              setImageProvider(event.target.value as ImageProviderSelection)
            }
            disabled={isArtWorking}
            className="h-8 rounded-md border bg-background px-2 text-[10px] text-foreground outline-none"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="选择出图模型"
          >
            {PROVIDERS.map(provider => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isArtWorking || isUploading}
            className="flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="添加参考图"
            title="添加参考图"
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </div>

      {artDirection.phase === 'references' ? (
        <div className="mt-3 px-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-foreground">
              出图依据 · 已选 {selectedReferenceCount}
            </p>
            <p className="text-[9px] text-muted-foreground">
              点缩略图启用或停用；标签可切换用途
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
            {artDirection.references.map(reference => (
              <div
                key={reference.id}
                className="w-[116px] shrink-0 overflow-hidden rounded-md border bg-background"
                style={{
                  borderColor: reference.selected
                    ? 'var(--nayin-accent)'
                    : 'var(--panel-border)',
                  opacity: reference.selected ? 1 : 0.55,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleArtReference(reference.id)}
                  className="relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left"
                  aria-label={`${reference.selected ? '停用' : '启用'} ${reference.label}`}
                >
                  {reference.imageUrl ? (
                    <img
                      src={reference.imageUrl}
                      alt={reference.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-2 text-center text-[9px] leading-relaxed text-muted-foreground">
                      {reference.text}
                    </div>
                  )}
                  <span
                    className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full"
                    style={{
                      background: reference.selected
                        ? 'var(--nayin-accent)'
                        : 'color-mix(in srgb, var(--background) 80%, transparent)',
                      color: reference.selected
                        ? 'var(--background)'
                        : 'var(--muted-foreground)',
                    }}
                  >
                    {reference.selected ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                  </span>
                </button>
                <div className="p-2">
                  <p className="truncate text-[9px] font-medium text-foreground">
                    {reference.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => cycleArtReferencePurpose(reference.id)}
                    className="mt-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold"
                    style={{
                      borderColor: 'var(--panel-border)',
                      color: 'var(--nayin-accent-bright)',
                    }}
                  >
                    {PURPOSE_LABEL[reference.purpose]}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void generateArtCandidates('explore')}
            disabled={isArtWorking || selectedReferenceCount === 0}
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md text-[11px] font-semibold disabled:opacity-50"
            style={{
              background: 'var(--nayin-accent)',
              color: 'var(--background)',
            }}
          >
            {isArtWorking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            生成 6 张独立视觉方向
          </button>
        </div>
      ) : null}

      {artDirection.phase === 'generating' ? (
        <div className="mt-3 px-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-nayin-bright" />
            正在保持人物与事件不变，只比较怎么画
          </div>
          <LoadingCandidates />
        </div>
      ) : null}

      {artDirection.phase === 'selecting' ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <p className="text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground">{likedCount} 喜欢</span>
              <span className="mx-1.5">·</span>
              {rejectedCount} 淘汰
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  candidateRailRef.current?.scrollBy({
                    left: -280,
                    behavior: 'smooth',
                  })
                }
                className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground"
                style={{ borderColor: 'var(--panel-border)' }}
                aria-label="查看上一张候选"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  candidateRailRef.current?.scrollBy({
                    left: 280,
                    behavior: 'smooth',
                  })
                }
                className="flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground"
                style={{ borderColor: 'var(--panel-border)' }}
                aria-label="查看下一张候选"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div
            ref={candidateRailRef}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 custom-scrollbar"
          >
            {artDirection.candidates.map(candidate => (
              <div key={candidate.id} className="snap-start">
                <CandidateCard
                  candidate={candidate}
                  onVerdict={verdict =>
                    void setArtCandidateVerdict(candidate.id, verdict)
                  }
                />
              </div>
            ))}
          </div>
          <div className="px-3">
            <button
              type="button"
              onClick={() => void reviewArtRecipe()}
              disabled={likedCount === 0 || isArtWorking}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-[11px] font-semibold disabled:opacity-50"
              style={{
                background: 'var(--nayin-accent)',
                color: 'var(--background)',
              }}
            >
              {isArtWorking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Palette className="h-4 w-4" />
              )}
              提炼故事视觉配方
            </button>
          </div>
        </div>
      ) : null}

      {artDirection.phase === 'recipe-review' && artDirection.recipe ? (
        <div className="mt-3 px-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {RECIPE_FIELDS.map(field => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-[9px] font-semibold text-muted-foreground">
                  {field.label}
                </span>
                <input
                  value={artDirection.recipe?.[field.key].join('、') ?? ''}
                  onChange={event =>
                    updateArtRecipeField(
                      field.key,
                      event.target.value.split(/[、,，/]/),
                    )
                  }
                  placeholder={field.placeholder}
                  className="h-8 w-full rounded-md border bg-background px-2 text-[10px] text-foreground outline-none focus:ring-2"
                  style={{
                    borderColor: 'var(--panel-border)',
                    ['--tw-ring-color' as string]: 'var(--nayin-glow)',
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={lockArtRecipe}
            className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md text-[11px] font-semibold"
            style={{
              background: 'var(--nayin-accent)',
              color: 'var(--background)',
            }}
          >
            <Lock className="h-4 w-4" />
            锁定为本故事视觉配方
          </button>
        </div>
      ) : null}

      {artDirection.phase === 'locked' && artDirection.recipe ? (
        <div className="mt-3 px-3">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {RECIPE_FIELDS.map(field =>
              artDirection.recipe?.[field.key].length ? (
                <div key={field.key}>
                  <p className="text-[9px] font-semibold text-muted-foreground">
                    {field.label}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-foreground">
                    {artDirection.recipe[field.key].join(' · ')}
                  </p>
                </div>
              ) : null,
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-2.5"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            <p className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-nayin-bright" />
              后续镜头默认生成一张，并继承这套画法
            </p>
            <button
              type="button"
              onClick={resetArtDirection}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground"
              style={{ borderColor: 'var(--panel-border)' }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新定调
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
