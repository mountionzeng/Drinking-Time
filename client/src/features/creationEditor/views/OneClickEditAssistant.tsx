import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  Film,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  PanelTop,
  Scissors,
  Sparkles,
  Square,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { StoryMaterialState } from "@shared/storyMaterial";
import {
  VIDEO_TARGET_DIMENSIONS,
  type VideoConformMode,
} from "@shared/videoConform";
import type {
  CreationEditorShot,
  VideoConformBatchResult,
} from "../CreationEditorContext";
import {
  ONE_CLICK_TARGET_ASPECT_RATIOS,
  buildOneClickEditReport,
  collectOneClickAnchorCandidates,
  type OneClickAnchorCandidate,
  type OneClickIssueSeverity,
  type OneClickShotCheck,
  type OneClickTargetAspectRatio,
} from "../oneClickEditReport";

type OneClickEditAssistantProps = {
  activeStoryId: number | null;
  shots: readonly CreationEditorShot[];
  materialState: StoryMaterialState | null;
  timelineShotIds: readonly string[];
  aiExpandReady: boolean;
  onSelectShot: (shotNo: number) => void;
  onPrepareTimeline: () => void;
  onConformVideos: (input: {
    takeIds: number[];
    targetAspectRatio: OneClickTargetAspectRatio;
    mode: VideoConformMode;
  }) => Promise<VideoConformBatchResult>;
};

function metricLabel(value: number, suffix = "") {
  return `${value}${suffix}`;
}

function issueTone(severity: OneClickIssueSeverity) {
  return severity === "blocking"
    ? "border-amber-300/70 bg-amber-50 text-amber-800"
    : "border-border bg-muted/70 text-muted-foreground";
}

function healthTone(score: number) {
  if (score >= 88) return "text-emerald-700";
  if (score >= 64) return "text-amber-700";
  return "text-destructive";
}

function sourceLabel(source: OneClickAnchorCandidate["source"]) {
  if (source === "current_image") return "首帧";
  if (source === "reference") return "参考图";
  return "提示词";
}

const CONFORM_MODE_OPTIONS = [
  {
    id: "crop" as const,
    label: "中心裁切",
    meta: "最快",
    icon: Crop,
  },
  {
    id: "blur_pad" as const,
    label: "模糊补边",
    meta: "保留全画面",
    icon: PanelTop,
  },
  {
    id: "ai_expand" as const,
    label: "AI 外扩",
    meta: "302 · Runway",
    icon: WandSparkles,
  },
] satisfies Array<{
  id: VideoConformMode;
  label: string;
  meta: string;
  icon: typeof Crop;
}>;

function AnchorPicker({
  title,
  icon,
  candidates,
  selectedId,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  candidates: OneClickAnchorCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-md border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <span className="text-xs text-muted-foreground">
          {candidates.length ? `${candidates.length} 个候选` : "待识别"}
        </span>
      </div>
      <div className="grid max-h-56 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
        {candidates.length === 0 ? (
          <div className="col-span-full rounded-md bg-muted/50 px-3 py-4 text-sm text-muted-foreground">
            暂无可用锚点
          </div>
        ) : (
          candidates.map(candidate => {
            const selected = selectedId === candidate.id;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelect(candidate.id)}
                className={`flex min-h-16 gap-2 rounded-md border p-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  selected
                    ? "border-primary/70 bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {candidate.imageUrl ? (
                  <img
                    src={candidate.imageUrl}
                    alt={candidate.label}
                    className="h-12 w-12 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                    <Sparkles className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs font-medium text-foreground">
                    {candidate.label}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {sourceLabel(candidate.source)}
                  </span>
                </span>
                {selected ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function ShotCheckRow({
  check,
  selected,
  onToggle,
  onSelectShot,
}: {
  check: OneClickShotCheck;
  selected: boolean;
  onToggle: () => void;
  onSelectShot: (shotNo: number) => void;
}) {
  return (
    <article className="grid grid-cols-[1.25rem_4.5rem_minmax(0,1fr)] gap-3 border-b border-border/70 px-3 py-3 last:border-b-0 sm:grid-cols-[1.25rem_4.5rem_minmax(0,1fr)_auto]">
      <Checkbox
        checked={selected}
        disabled={!check.hasCurrentVideo || check.videoTakeId == null}
        onCheckedChange={onToggle}
        aria-label={`选择 SH${String(check.shotNo).padStart(2, "0")} 视频`}
        className="mt-1"
      />
      <button
        type="button"
        onClick={() => onSelectShot(check.shotNo)}
        className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label={`查看 SH${String(check.shotNo).padStart(2, "0")}`}
      >
        {check.imageUrl ? (
          <img
            src={check.imageUrl}
            alt={check.title}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" />
          </span>
        )}
      </button>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            SH{String(check.shotNo).padStart(2, "0")}
          </span>
          <span
            className={`text-xs font-medium ${healthTone(check.healthScore)}`}
          >
            {check.healthScore}
          </span>
          {check.hasCurrentVideo ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
              <Film className="h-3 w-3" />
              视频
            </span>
          ) : null}
          {check.videoAspectRatio ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
              <Square className="h-3 w-3" />
              {check.videoAspectRatio}
            </span>
          ) : null}
        </div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {check.dialogue || check.title}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {check.issues.length === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
              <CheckCircle2 className="h-3 w-3" />
              可预剪
            </span>
          ) : (
            check.issues.map(item => (
              <span
                key={item.kind}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${issueTone(item.severity)}`}
              >
                {item.label}
              </span>
            ))
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onSelectShot(check.shotNo)}
        className="col-start-3 h-8 justify-self-start rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary sm:col-start-4 sm:justify-self-auto"
      >
        查看
      </button>
    </article>
  );
}

export default function OneClickEditAssistant({
  activeStoryId,
  shots,
  materialState,
  timelineShotIds,
  aiExpandReady,
  onSelectShot,
  onPrepareTimeline,
  onConformVideos,
}: OneClickEditAssistantProps) {
  const [open, setOpen] = useState(false);
  const [targetAspectRatio, setTargetAspectRatio] =
    useState<OneClickTargetAspectRatio>("1:1");
  const [conformMode, setConformMode] = useState<VideoConformMode>("crop");
  const [selectedTakeIds, setSelectedTakeIds] = useState<Set<number>>(
    () => new Set()
  );
  const [conforming, setConforming] = useState(false);
  const report = useMemo(
    () =>
      buildOneClickEditReport({
        shots,
        materialState,
        timelineShotIds,
        targetAspectRatio,
      }),
    [materialState, shots, targetAspectRatio, timelineShotIds]
  );
  const characterCandidates = useMemo(
    () => collectOneClickAnchorCandidates(report.checks, "character"),
    [report.checks]
  );
  const sceneCandidates = useMemo(
    () => collectOneClickAnchorCandidates(report.checks, "scene"),
    [report.checks]
  );
  const [selectedCharacterAnchor, setSelectedCharacterAnchor] = useState<
    string | null
  >(null);
  const [selectedSceneAnchor, setSelectedSceneAnchor] = useState<string | null>(
    null
  );
  const selectableTakeIds = useMemo(
    () =>
      report.checks.flatMap(check =>
        check.hasCurrentVideo && check.videoTakeId != null
          ? [check.videoTakeId]
          : []
      ),
    [report.checks]
  );
  const selectedCount = selectedTakeIds.size;
  const allSelected =
    selectableTakeIds.length > 0 && selectedCount === selectableTakeIds.length;
  const targetDimensions = VIDEO_TARGET_DIMENSIONS[targetAspectRatio];

  useEffect(() => {
    if (!selectedCharacterAnchor && characterCandidates[0]) {
      setSelectedCharacterAnchor(characterCandidates[0].id);
    }
  }, [characterCandidates, selectedCharacterAnchor]);

  useEffect(() => {
    if (!selectedSceneAnchor && sceneCandidates[0]) {
      setSelectedSceneAnchor(sceneCandidates[0].id);
    }
  }, [sceneCandidates, selectedSceneAnchor]);

  const summaryState =
    report.blockingCount === 0 ? "可预剪" : `${report.blockingCount} 个阻塞`;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      setSelectedTakeIds(new Set(selectableTakeIds));
    }
    setOpen(nextOpen);
  };

  const toggleTake = (takeId: number | null) => {
    if (takeId == null) return;
    setSelectedTakeIds(current => {
      const next = new Set(current);
      if (next.has(takeId)) next.delete(takeId);
      else next.add(takeId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedTakeIds(allSelected ? new Set() : new Set(selectableTakeIds));
  };

  const runConform = async () => {
    if (selectedTakeIds.size === 0) {
      toast.error("请先选择至少一个视频");
      return;
    }
    if (conformMode === "ai_expand" && !aiExpandReady) {
      toast.error("API302_KEY 未配置，暂时不能使用 AI 外扩");
      return;
    }
    setConforming(true);
    try {
      const result = await onConformVideos({
        takeIds: Array.from(selectedTakeIds),
        targetAspectRatio,
        mode: conformMode,
      });
      const processingCount = result.results.filter(
        item => item.status === "ok" && item.videoStatus === "processing"
      ).length;
      if (result.completedCount > 0) {
        toast.success(
          processingCount > 0
            ? `已提交 ${processingCount} 个 AI 外扩任务`
            : `已统一 ${result.completedCount} 个视频尺寸`
        );
      }
      if (result.failedCount > 0) {
        const firstError = result.results.find(item => item.status === "error");
        toast.error(
          `${result.failedCount} 个视频处理失败${firstError ? `：${firstError.error}` : ""}`
        );
      }
      setSelectedTakeIds(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频统一尺寸失败");
    } finally {
      setConforming(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={shots.length === 0}
        >
          <Scissors className="h-3.5 w-3.5" />
          一键剪辑
        </button>
      </SheetTrigger>
      <SheetContent className="w-[min(960px,calc(100vw-1rem))] gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b border-border pr-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SheetTitle className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-primary" />
                一键剪辑
              </SheetTitle>
              <SheetDescription>
                故事 {activeStoryId ?? "未打开"} · {summaryState}
              </SheetDescription>
            </div>
            <button
              type="button"
              onClick={() => {
                onPrepareTimeline();
                toast.success("已按当前故事顺序预排时间轴");
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <ListChecks className="h-4 w-4" />
              预排时间轴
            </button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-md border border-border bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">目标尺寸</div>
                <span className="text-xs text-muted-foreground">
                  当前：{targetAspectRatio}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ONE_CLICK_TARGET_ASPECT_RATIOS.map(ratio => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setTargetAspectRatio(ratio)}
                    className={`h-9 rounded-md border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                      targetAspectRatio === ratio
                        ? "border-primary/70 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-3 gap-2 rounded-md border border-border bg-background p-3 text-center">
              <div>
                <div className="text-lg font-semibold text-foreground">
                  {metricLabel(report.readyShots)}
                </div>
                <div className="text-[11px] text-muted-foreground">可预剪</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">
                  {metricLabel(
                    report.currentVideoCount,
                    `/${report.totalShots}`
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">视频</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">
                  {metricLabel(report.aspectMismatchCount)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  尺寸不齐
                </div>
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">画面处理</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {targetDimensions.width} × {targetDimensions.height}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                disabled={selectableTakeIds.length === 0 || conforming}
                className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allSelected ? "取消全选" : `全选 ${selectableTakeIds.length}`}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {CONFORM_MODE_OPTIONS.map(option => {
                const Icon = option.icon;
                const selected = conformMode === option.id;
                const disabled = option.id === "ai_expand" && !aiExpandReady;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setConformMode(option.id)}
                    disabled={disabled || conforming}
                    className={`flex min-h-14 items-center gap-2.5 rounded-md border px-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected
                        ? "border-primary/70 bg-primary/10 text-primary"
                        : "border-border text-foreground hover:border-primary/40"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">
                        {option.label}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {disabled ? "缺 API302_KEY" : option.meta}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <AnchorPicker
              title="人物锚点"
              icon={<UserRound className="h-4 w-4 text-primary" />}
              candidates={characterCandidates}
              selectedId={selectedCharacterAnchor}
              onSelect={setSelectedCharacterAnchor}
            />
            <AnchorPicker
              title="场景锚点"
              icon={<ImageIcon className="h-4 w-4 text-primary" />}
              candidates={sceneCandidates}
              selectedId={selectedSceneAnchor}
              onSelect={setSelectedSceneAnchor}
            />
          </div>

          <section className="mt-4 rounded-md border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-primary" />
                按场次检查
              </div>
              <span className="text-xs text-muted-foreground">
                已选 {selectedCount} · {report.warningCount} 个提醒 ·{" "}
                {report.blockingCount} 个阻塞
              </span>
            </div>
            <div>
              {report.sceneGroups.map(group => (
                <section
                  key={group.key}
                  className="border-b border-border last:border-b-0"
                >
                  <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  {group.checks.map(check => (
                    <ShotCheckRow
                      key={check.stableShotId}
                      check={check}
                      selected={Boolean(
                        check.videoTakeId != null &&
                          selectedTakeIds.has(check.videoTakeId)
                      )}
                      onToggle={() => toggleTake(check.videoTakeId)}
                      onSelectShot={shotNo => {
                        onSelectShot(shotNo);
                        setOpen(false);
                      }}
                    />
                  ))}
                </section>
              ))}
            </div>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {selectedCount} 个视频 · {targetAspectRatio} ·{" "}
            {targetDimensions.width} × {targetDimensions.height}
          </div>
          <button
            type="button"
            onClick={() => void runConform()}
            disabled={
              conforming ||
              selectedCount === 0 ||
              (conformMode === "ai_expand" && !aiExpandReady)
            }
            className="inline-flex h-9 min-w-36 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {conforming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : conformMode === "ai_expand" ? (
              <WandSparkles className="h-4 w-4" />
            ) : (
              <Scissors className="h-4 w-4" />
            )}
            {conforming ? "处理中" : `统一 ${selectedCount} 个视频`}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
