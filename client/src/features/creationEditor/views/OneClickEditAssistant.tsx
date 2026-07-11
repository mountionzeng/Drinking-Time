import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  Film,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Scissors,
  Sparkles,
  Square,
  UserRound,
  WandSparkles,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
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
  CONSISTENCY_DIMENSION_LABELS,
  type ShotConsistencyAnalysis,
  type ShotConsistencyVerdict,
} from "@shared/shotConsistency";
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
  aspectRatioMatches,
  buildOneClickEditReport,
  collectOneClickAnchorCandidates,
  type OneClickAnchorCandidate,
  type OneClickIssueSeverity,
  type OneClickShotCheck,
  type OneClickTargetAspectRatio,
} from "../oneClickEditReport";
import {
  get302VideoExpandAvailability,
  isVideoConformReviewCandidate,
  recommendVideoConformMode,
  summarizeVideoConformResults,
  type VideoConformReviewMode,
  videoConformReviewKey,
} from "../videoConformReview";
import VideoConformReviewDialog, {
  type VideoConformReviewItem,
} from "./VideoConformReviewDialog";

type OneClickEditAssistantProps = {
  activeStoryId: number | null;
  shots: readonly CreationEditorShot[];
  materialState: StoryMaterialState | null;
  timelineShotIds: readonly string[];
  aiExpandReady: boolean;
  onSelectShot: (shotNo: number) => void;
  onPrepareTimeline: () => void;
  onConformVideos: (input: {
    items: Array<{
      takeId: number;
      stableShotId: string;
      mode: VideoConformMode;
    }>;
    targetAspectRatio: OneClickTargetAspectRatio;
  }) => Promise<VideoConformBatchResult>;
  onAnalyzeConsistency: (input: {
    anchorImageUrl?: string | null;
    maxShots?: number;
  }) => Promise<ShotConsistencyAnalysis>;
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

function verdictTone(verdict: ShotConsistencyVerdict) {
  if (verdict === "inconsistent")
    return "border-amber-300/70 bg-amber-50 text-amber-800";
  if (verdict === "consistent")
    return "border-emerald-300/60 bg-emerald-50 text-emerald-700";
  return "border-border bg-muted/70 text-muted-foreground";
}

function verdictLabel(verdict: ShotConsistencyVerdict) {
  if (verdict === "inconsistent") return "不一致";
  if (verdict === "consistent") return "一致";
  return "看不清";
}

function sourceLabel(source: OneClickAnchorCandidate["source"]) {
  if (source === "current_image") return "首帧";
  if (source === "reference") return "参考图";
  return "提示词";
}

function AnchorPicker({
  title,
  icon,
  candidates,
  selectedId,
  onSelect,
  emptyMessage = "暂无可用锚点",
}: {
  title: string;
  icon: ReactNode;
  candidates: OneClickAnchorCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
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
            {emptyMessage}
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

export function OneClickShotPreview({
  title,
  preview,
}: {
  title: string;
  preview: OneClickShotCheck["visualPreview"];
}) {
  if (!preview) {
    return (
      <span className="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
      </span>
    );
  }
  if (preview.kind === "image") {
    return (
      <img
        src={preview.url}
        alt={title}
        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        loading="lazy"
      />
    );
  }
  return (
    <>
      <video
        src={preview.url}
        aria-label={`${title} 当前视频预览`}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
      />
      <span className="pointer-events-none absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
        <Film className="h-2.5 w-2.5" />
        当前视频
      </span>
    </>
  );
}

export function OneClickMaterialLinkStatus({
  linkedCount,
  totalCount,
}: {
  linkedCount: number;
  totalCount: number;
}) {
  const missingCount = Math.max(0, totalCount - linkedCount);
  return (
    <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Film className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-emerald-900">
            已关联 {linkedCount} 个当前视频
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/80">
            素材仓库里已经采用和复用的镜头会保留，一键剪辑只处理你勾选的视频。
          </p>
        </div>
      </div>
      <span className="shrink-0 rounded-full border border-emerald-200 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
        {missingCount > 0 ? `待补 ${missingCount} 个` : "全部已关联"}
      </span>
    </section>
  );
}

function ShotCheckRow({
  check,
  selected,
  conformSelectable,
  onToggle,
  onSelectShot,
}: {
  check: OneClickShotCheck;
  selected: boolean;
  conformSelectable: boolean;
  onToggle: () => void;
  onSelectShot: (shotNo: number) => void;
}) {
  return (
    <article className="grid grid-cols-[1.25rem_4.5rem_minmax(0,1fr)] gap-3 border-b border-border/70 px-3 py-3 last:border-b-0 sm:grid-cols-[1.25rem_4.5rem_minmax(0,1fr)_auto]">
      <Checkbox
        checked={selected}
        disabled={!conformSelectable}
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
        <OneClickShotPreview
          title={check.title}
          preview={check.visualPreview}
        />
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
          {check.hasCurrentVideo &&
          aspectRatioMatches(
            check.videoAspectRatio,
            check.targetAspectRatio
          ) ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
              <CheckCircle2 className="h-3 w-3" />
              画幅已匹配
            </span>
          ) : null}
        </div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {check.dialogue || check.title}
        </div>
        {check.hasCurrentVideo ? (
          <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">运镜：</span>
            {check.cameraMove || "未填写，请在确认台播放视频判断"}
          </div>
        ) : null}
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
  onAnalyzeConsistency,
}: OneClickEditAssistantProps) {
  const [open, setOpen] = useState(false);
  const [targetAspectRatio, setTargetAspectRatio] =
    useState<OneClickTargetAspectRatio>("1:1");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedVideoKeys, setSelectedVideoKeys] = useState<Set<string>>(
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
  const selectableVideoKeys = useMemo(
    () =>
      report.checks.flatMap(check =>
        isVideoConformReviewCandidate(check) && check.videoTakeId != null
          ? [
              videoConformReviewKey({
                takeId: check.videoTakeId,
                stableShotId: check.stableShotId,
              }),
            ]
          : []
      ),
    [report.checks, targetAspectRatio]
  );
  const selectableSignature = selectableVideoKeys.join(",");
  const reviewItems = useMemo(
    () =>
      report.checks.flatMap((check): VideoConformReviewItem[] => {
        if (
          check.videoTakeId == null ||
          !check.videoUrl ||
          !selectedVideoKeys.has(
            videoConformReviewKey({
              takeId: check.videoTakeId,
              stableShotId: check.stableShotId,
            })
          ) ||
          !isVideoConformReviewCandidate(check)
        ) {
          return [];
        }
        const expandAvailability = get302VideoExpandAvailability({
          sourceAspectRatio: check.videoAspectRatio,
          targetAspectRatio,
        });
        return [
          {
            takeId: check.videoTakeId,
            stableShotId: check.stableShotId,
            shotNo: check.shotNo,
            title: check.title,
            cameraMove: check.cameraMove,
            videoUrl: check.videoUrl,
            posterUrl: check.imageUrl,
            sourceAspectRatio: check.videoAspectRatio,
            aiExpandUnavailableReason: expandAvailability.supported
              ? null
              : expandAvailability.reason,
            recommendation: recommendVideoConformMode({
              cameraMove: check.cameraMove,
              sourceAspectRatio: check.videoAspectRatio,
              targetAspectRatio,
            }),
          },
        ];
      }),
    [report.checks, selectedVideoKeys, targetAspectRatio]
  );
  const selectedCount = selectedVideoKeys.size;
  const allSelected =
    selectableVideoKeys.length > 0 &&
    selectedCount === selectableVideoKeys.length;
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

  useEffect(() => {
    const selectable = new Set(selectableVideoKeys);
    setSelectedVideoKeys(current => {
      const next = new Set(
        Array.from(current).filter(takeId => selectable.has(takeId))
      );
      return next.size === current.size ? current : next;
    });
  }, [selectableSignature]);

  const summaryState =
    report.blockingCount === 0 ? "可预剪" : `${report.blockingCount} 个阻塞`;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      setSelectedVideoKeys(new Set(selectableVideoKeys));
    }
    if (!nextOpen) setReviewOpen(false);
    setOpen(nextOpen);
  };

  const handleTargetAspectRatioChange = (
    nextTarget: OneClickTargetAspectRatio
  ) => {
    setTargetAspectRatio(nextTarget);
    setReviewOpen(false);
    setSelectedVideoKeys(
      new Set(
        report.checks.flatMap(check =>
          isVideoConformReviewCandidate(check) && check.videoTakeId != null
            ? [
                videoConformReviewKey({
                  takeId: check.videoTakeId,
                  stableShotId: check.stableShotId,
                }),
              ]
            : []
        )
      )
    );
  };

  const toggleTake = (check: OneClickShotCheck) => {
    if (check.videoTakeId == null) return;
    const key = videoConformReviewKey({
      takeId: check.videoTakeId,
      stableShotId: check.stableShotId,
    });
    setSelectedVideoKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedVideoKeys(
      allSelected ? new Set() : new Set(selectableVideoKeys)
    );
  };

  const [consistency, setConsistency] =
    useState<ShotConsistencyAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [acceptedImageIds, setAcceptedImageIds] = useState<Set<number>>(
    () => new Set()
  );

  const runConsistency = async () => {
    const anchor = characterCandidates.find(
      candidate => candidate.id === selectedCharacterAnchor
    );
    setAnalyzing(true);
    try {
      const result = await onAnalyzeConsistency({
        anchorImageUrl: anchor?.imageUrl ?? null,
      });
      setConsistency(result);
      setAcceptedImageIds(new Set());
      if (result.status === "ok") {
        const flagged = result.findings.filter(
          finding => finding.verdict === "inconsistent"
        ).length;
        toast.success(
          flagged > 0
            ? `发现 ${flagged} 个镜头与锚点不一致`
            : "各镜头画面与锚点基本一致"
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "视觉一致性识别失败"
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const acceptFinding = (imageId: number) => {
    setAcceptedImageIds(current => {
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
  };

  const runConform = async (
    items: Array<{
      takeId: number;
      stableShotId: string;
      mode: VideoConformReviewMode;
    }>
  ) => {
    if (items.length === 0) {
      toast.error("请先选择至少一个视频");
      return;
    }
    if (items.some(item => item.mode === "ai_expand") && !aiExpandReady) {
      toast.error("API302_KEY 未配置，暂时不能使用 AI 外扩");
      return;
    }
    setConforming(true);
    try {
      const result = await onConformVideos({
        items,
        targetAspectRatio,
      });
      const {
        successfulItems,
        processingCount,
        cropSuccessCount,
        expandSuccessCount,
      } = summarizeVideoConformResults(items, result.results);
      if (successfulItems.length > 0) {
        const successMessages = [
          cropSuccessCount > 0 ? `已完成 ${cropSuccessCount} 个本地裁切` : null,
          expandSuccessCount > 0
            ? processingCount > 0
              ? `已提交 ${expandSuccessCount} 个 302 外扩任务`
              : `已完成 ${expandSuccessCount} 个 302 外扩`
            : null,
        ].filter(Boolean);
        toast.success(successMessages.join("，"));
      }
      if (result.failedCount > 0) {
        const firstError = result.results.find(item => item.status === "error");
        toast.error(
          `${result.failedCount} 个视频处理失败${firstError ? `：${firstError.error}` : ""}`
        );
      }
      const successfulVideoKeys = new Set(
        successfulItems.map(item =>
          videoConformReviewKey({
            takeId: item.sourceTakeId,
            stableShotId: item.stableShotId,
          })
        )
      );
      setSelectedVideoKeys(current => {
        const next = new Set(current);
        successfulVideoKeys.forEach(key => next.delete(key));
        return next;
      });
      if (result.failedCount === 0) setReviewOpen(false);
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
                    onClick={() => handleTargetAspectRatioChange(ratio)}
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

          <OneClickMaterialLinkStatus
            linkedCount={report.currentVideoCount}
            totalCount={report.totalShots}
          />

          <section className="mt-4 rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">画幅统一流程</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  先逐镜播放确认运镜，再决定裁切还是专业外扩
                </div>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                disabled={selectableVideoKeys.length === 0 || conforming}
                className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allSelected
                  ? "取消全选"
                  : `全选 ${selectableVideoKeys.length}`}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex min-h-14 items-center gap-2.5 rounded-md border border-emerald-200 bg-emerald-50/70 px-3">
                <Crop className="h-4 w-4 shrink-0 text-emerald-700" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-emerald-800">
                    直接裁切
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    本地 ffmpeg · 免费 · 适合主体始终在安全区
                  </span>
                </span>
              </div>
              <div className="flex min-h-14 items-center gap-2.5 rounded-md border border-violet-200 bg-violet-50/70 px-3">
                <WandSparkles className="h-4 w-4 shrink-0 text-violet-700" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-violet-800">
                    302 专业视频外扩
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {aiExpandReady
                      ? "Runway Expand · 逐镜确认后才提交"
                      : "缺 API302_KEY · 当前只能选择免费裁切"}
                  </span>
                </span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              这里不会直接执行或扣费；点击底部按钮后，才会打开每个镜头的运镜确认台。
            </p>
          </section>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <AnchorPicker
              title="人物锚点"
              icon={<UserRound className="h-4 w-4 text-primary" />}
              candidates={characterCandidates}
              selectedId={selectedCharacterAnchor}
              onSelect={setSelectedCharacterAnchor}
              emptyMessage={
                report.currentVideoCount > 0
                  ? "视频已关联；人物锚点仍需首帧图或参考图。"
                  : undefined
              }
            />
            <AnchorPicker
              title="场景锚点"
              icon={<ImageIcon className="h-4 w-4 text-primary" />}
              candidates={sceneCandidates}
              selectedId={selectedSceneAnchor}
              onSelect={setSelectedSceneAnchor}
              emptyMessage={
                report.currentVideoCount > 0
                  ? "视频已关联；场景锚点仍需首帧图或参考图。"
                  : undefined
              }
            />
          </div>

          <section className="mt-4 rounded-md border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                视觉一致性
              </div>
              <button
                type="button"
                onClick={() => void runConsistency()}
                disabled={analyzing || activeStoryId == null}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {analyzing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {analyzing ? "识别中" : "AI 找不一致"}
              </button>
            </div>
            <div className="px-3 py-2">
              {consistency == null ? (
                <p className="py-1 text-xs text-muted-foreground">
                  用视觉模型把人物锚点和每个镜头的当前画面成对对比，识别五官、发型、服饰、场景、画风的漂移，逐条由你裁决。
                </p>
              ) : consistency.status === "not_configured" ? (
                <p className="py-1 text-xs text-amber-700">
                  {consistency.message}
                </p>
              ) : consistency.status === "error" ? (
                <p className="py-1 text-xs text-destructive">
                  {consistency.message}
                </p>
              ) : (
                <div>
                  <div className="pb-2 text-[11px] text-muted-foreground">
                    已检查 {consistency.findings.length} 个镜头 · 模型{" "}
                    {consistency.modelLabel} ·{" "}
                    {
                      consistency.findings.filter(
                        finding =>
                          finding.verdict === "inconsistent" &&
                          !acceptedImageIds.has(finding.imageId)
                      ).length
                    }{" "}
                    个待处理
                  </div>
                  <div className="grid gap-1.5">
                    {consistency.findings.map(finding => {
                      const accepted = acceptedImageIds.has(finding.imageId);
                      return (
                        <div
                          key={finding.imageId}
                          className={`flex items-start gap-2.5 rounded-md border px-2.5 py-2 ${
                            accepted
                              ? "border-border bg-muted/40 opacity-60"
                              : verdictTone(finding.verdict)
                          }`}
                        >
                          <img
                            src={finding.imageUrl}
                            alt={`镜头 ${finding.shotNo ?? ""} 当前画面`}
                            className="h-12 w-12 shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                              <span>镜头 {finding.shotNo ?? "?"}</span>
                              <span className="rounded border border-current/30 px-1 py-0.5 text-[10px]">
                                {accepted ? "已确认 OK" : verdictLabel(finding.verdict)}
                              </span>
                              {finding.mismatches.map(mismatch => (
                                <span
                                  key={`${finding.imageId}-${mismatch.dimension}`}
                                  className="rounded bg-background/70 px-1 py-0.5 text-[10px]"
                                >
                                  {CONSISTENCY_DIMENSION_LABELS[mismatch.dimension]}
                                </span>
                              ))}
                            </div>
                            {finding.mismatches.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed">
                                {finding.mismatches.map((mismatch, index) => (
                                  <li key={`${finding.imageId}-note-${index}`}>
                                    {CONSISTENCY_DIMENSION_LABELS[mismatch.dimension]}
                                    ：{mismatch.note}
                                  </li>
                                ))}
                              </ul>
                            ) : finding.note ? (
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {finding.note}
                              </p>
                            ) : null}
                          </div>
                          {finding.verdict === "inconsistent" && !accepted ? (
                            <button
                              type="button"
                              onClick={() => acceptFinding(finding.imageId)}
                              className="h-7 shrink-0 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                            >
                              这张 OK
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

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
                      conformSelectable={isVideoConformReviewCandidate(check)}
                      selected={Boolean(
                        check.videoTakeId != null &&
                          selectedVideoKeys.has(
                            videoConformReviewKey({
                              takeId: check.videoTakeId,
                              stableShotId: check.stableShotId,
                            })
                          )
                      )}
                      onToggle={() => toggleTake(check)}
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
            onClick={() => setReviewOpen(true)}
            disabled={conforming || selectedCount === 0}
            className="inline-flex h-9 min-w-36 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {conforming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Film className="h-4 w-4" />
            )}
            {conforming
              ? "处理中"
              : selectedCount > 0
                ? `确认 ${selectedCount} 个镜头的运镜`
                : "没有待统一的视频"}
          </button>
        </div>
      </SheetContent>
      <VideoConformReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        items={reviewItems}
        targetAspectRatio={targetAspectRatio}
        aiExpandReady={aiExpandReady}
        submitting={conforming}
        onConfirm={runConform}
      />
    </Sheet>
  );
}
