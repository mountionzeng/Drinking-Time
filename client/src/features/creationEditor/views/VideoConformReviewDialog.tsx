import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Crop,
  Loader2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CENTERED_VIDEO_CROP_PATH,
  VIDEO_CROP_ANCHORS,
  VIDEO_TARGET_DIMENSIONS,
  type VideoCropAnchor,
  type VideoCropPath,
} from "@shared/videoConform";
import type { OneClickTargetAspectRatio } from "../oneClickEditReport";
import {
  buildVideoConformBatchItems,
  type VideoConformRecommendation,
  type VideoConformReviewMode,
  videoConformReviewKey,
} from "../videoConformReview";

export type VideoConformReviewItem = {
  takeId: number;
  stableShotId: string;
  shotNo: number;
  title: string;
  cameraMove: string;
  videoUrl: string;
  posterUrl: string | null;
  sourceAspectRatio: string | null;
  aiExpandUnavailableReason: string | null;
  recommendation: VideoConformRecommendation;
};

type VideoConformBatchItem = {
  takeId: number;
  stableShotId: string;
  mode: VideoConformReviewMode;
  cropPath?: VideoCropPath;
};

function shotLabel(shotNo: number) {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function recommendationLabel(
  recommendation: VideoConformRecommendation
): string {
  if (recommendation.confidence === "review") return "请播放确认";
  return recommendation.mode === "ai_expand" ? "建议外扩" : "建议裁切";
}

function cropAnchorLabel(
  anchor: VideoCropAnchor,
  axis: VideoConformRecommendation["cropAxis"]
): string {
  if (anchor === "center") return "中间";
  if (axis === "vertical") return anchor === "start" ? "顶部" : "底部";
  if (axis === "horizontal") return anchor === "start" ? "左侧" : "右侧";
  return anchor === "start" ? "起点" : "终点";
}

export function CropPathControls({
  shotNo,
  axis,
  value,
  disabled,
  onChange,
}: {
  shotNo: number;
  axis: VideoConformRecommendation["cropAxis"];
  value: VideoCropPath;
  disabled: boolean;
  onChange: (value: VideoCropPath) => void;
}) {
  const rows = [
    { key: "start" as const, label: "第一帧" },
    { key: "end" as const, label: "最后一帧" },
  ];
  const pathLabel = `${cropAnchorLabel(value.start, axis)} → ${cropAnchorLabel(value.end, axis)}`;

  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-emerald-900">
          裁剪路径
        </span>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-emerald-800">
          {pathLabel}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {rows.map(row => (
          <div
            key={row.key}
            className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2"
          >
            <span className="text-[10px] font-medium text-muted-foreground">
              {row.label}
            </span>
            <div className="grid grid-cols-3 overflow-hidden rounded border border-border bg-background">
              {VIDEO_CROP_ANCHORS.map(anchor => {
                const selected = value[row.key] === anchor;
                const label = cropAnchorLabel(anchor, axis);
                return (
                  <button
                    key={anchor}
                    type="button"
                    aria-label={`${shotLabel(shotNo)} ${row.label} ${label}`}
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onChange({ ...value, [row.key]: anchor })}
                    className={`h-7 border-r border-border text-[10px] font-medium transition last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                      selected
                        ? "bg-emerald-700 text-white"
                        : "text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-emerald-900/70">
        裁剪窗口会在整段视频中平滑移动；起止位置相同就是固定裁切。
      </p>
    </section>
  );
}

export function VideoConformReviewPanel({
  items,
  targetAspectRatio,
  aiExpandReady,
  decisions,
  cropPaths,
  submitting,
  onDecisionChange,
  onCropPathChange,
  onApplyRecommendations,
  onAllCrop,
  onConfirm,
}: {
  items: readonly VideoConformReviewItem[];
  targetAspectRatio: OneClickTargetAspectRatio;
  aiExpandReady: boolean;
  decisions: ReadonlyMap<string, VideoConformReviewMode>;
  cropPaths: ReadonlyMap<string, VideoCropPath>;
  submitting: boolean;
  onDecisionChange: (key: string, mode: VideoConformReviewMode) => void;
  onCropPathChange: (key: string, path: VideoCropPath) => void;
  onApplyRecommendations: () => void;
  onAllCrop: () => void;
  onConfirm: () => void;
}) {
  const targetDimensions = VIDEO_TARGET_DIMENSIONS[targetAspectRatio];
  const confirmedCount = items.filter(item =>
    decisions.has(videoConformReviewKey(item))
  ).length;
  const cropCount = items.filter(
    item => decisions.get(videoConformReviewKey(item)) === "crop"
  ).length;
  const expandCount = items.filter(
    item => decisions.get(videoConformReviewKey(item)) === "ai_expand"
  ).length;
  const pendingCount = items.length - confirmedCount;

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="grid gap-2 border-b border-border bg-muted/30 px-5 py-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <div className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            目标画幅
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
            {targetAspectRatio}
            <span className="font-normal text-muted-foreground">
              {targetDimensions.width} × {targetDimensions.height}
            </span>
          </div>
        </div>
        <div className="rounded-md border border-border bg-background px-3 py-2">
          <div className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            已确认
          </div>
          <div className="mt-1 text-sm font-semibold">
            {confirmedCount}/{items.length}
            <span className="ml-2 font-normal text-muted-foreground">
              裁切 {cropCount}
            </span>
          </div>
        </div>
        <div
          className={`rounded-md border px-3 py-2 ${
            expandCount > 0
              ? "border-amber-300/70 bg-amber-50"
              : "border-border bg-background"
          }`}
        >
          <div className="flex items-center gap-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
            <CircleDollarSign className="h-3 w-3" />
            302 专业外扩
          </div>
          <div className="mt-1 text-sm font-semibold">
            {expandCount} 个
            <span className="ml-2 font-normal text-muted-foreground">
              提交时可能消耗额度
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto bg-muted/20 p-3 sm:p-4">
        <div className="space-y-3">
          {items.map(item => {
            const reviewKey = videoConformReviewKey(item);
            const decision = decisions.get(reviewKey);
            const confirmed = decision != null;
            const expandDisabled =
              !aiExpandReady || item.aiExpandUnavailableReason != null;
            const domKey = `${item.takeId}-${item.stableShotId}`.replace(
              /[^a-zA-Z0-9_-]/g,
              "-"
            );
            const cropId = `video-conform-${domKey}-crop`;
            const expandId = `video-conform-${domKey}-ai-expand`;
            return (
              <article
                key={reviewKey}
                className={`grid gap-3 rounded-lg border bg-background p-3 shadow-sm transition sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] xl:grid-cols-[minmax(200px,260px)_minmax(220px,1fr)_minmax(250px,0.85fr)] ${
                  confirmed ? "border-emerald-300/60" : "border-amber-300/70"
                }`}
              >
                <div className="relative overflow-hidden rounded-md border border-border bg-black">
                  <video
                    src={item.videoUrl}
                    poster={item.posterUrl ?? undefined}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    className="aspect-video h-full max-h-52 w-full bg-black object-contain"
                    aria-label={`${shotLabel(item.shotNo)} 运镜预览`}
                  />
                  <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                    {shotLabel(item.shotNo)}
                  </span>
                </div>

                <div className="min-w-0 py-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold">
                      {item.title}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {item.sourceAspectRatio ?? "未知比例"}
                      <ArrowRight className="h-2.5 w-2.5" />
                      {targetAspectRatio}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        item.recommendation.mode === "ai_expand"
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {recommendationLabel(item.recommendation)}
                    </span>
                  </div>

                  <div
                    className={`mt-3 rounded-md border px-3 py-2.5 ${
                      item.cameraMove
                        ? "border-border bg-muted/35"
                        : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                      <Clapperboard className="h-3 w-3" />
                      运镜说明
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-foreground">
                      {item.cameraMove ||
                        "未填写运镜说明，请播放视频确认主体是否会进入裁切边缘。"}
                    </p>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {item.recommendation.reason}
                  </p>
                </div>

                <div className="grid content-start gap-2 sm:col-start-2 xl:col-start-3">
                  <RadioGroup
                    value={decision ?? ""}
                    disabled={submitting}
                    onValueChange={value => {
                      if (value === "crop" || value === "ai_expand") {
                        onDecisionChange(reviewKey, value);
                      }
                    }}
                    aria-label={`${shotLabel(item.shotNo)} 画幅处理方式`}
                    className="grid gap-2"
                  >
                    <label
                      htmlFor={cropId}
                      className={`flex cursor-pointer gap-2.5 rounded-md border p-3 transition ${
                        decision === "crop"
                          ? "border-emerald-400 bg-emerald-50"
                          : "border-border hover:border-emerald-300"
                      }`}
                    >
                      <RadioGroupItem
                        id={cropId}
                        value="crop"
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <Crop className="h-3.5 w-3.5 text-emerald-700" />
                          直接裁切
                        </span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                          本地 ffmpeg 取目标画幅，不消耗 302 额度。
                        </span>
                      </span>
                    </label>
                    <label
                      htmlFor={expandId}
                      className={`flex gap-2.5 rounded-md border p-3 transition ${
                        expandDisabled
                          ? "cursor-not-allowed border-border bg-muted/50 opacity-60"
                          : decision === "ai_expand"
                            ? "cursor-pointer border-violet-400 bg-violet-50"
                            : "cursor-pointer border-border hover:border-violet-300"
                      }`}
                    >
                      <RadioGroupItem
                        id={expandId}
                        value="ai_expand"
                        disabled={expandDisabled}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <WandSparkles className="h-3.5 w-3.5 text-violet-700" />
                          302 专业视频外扩
                        </span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                          {!aiExpandReady
                            ? "缺少 API302_KEY；仍可选择免费裁切。"
                            : (item.aiExpandUnavailableReason ??
                              "Runway Expand 补出画面边缘，异步处理，可能消耗额度。")}
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                  {decision === "crop" ? (
                    <CropPathControls
                      shotNo={item.shotNo}
                      axis={item.recommendation.cropAxis}
                      value={
                        cropPaths.get(reviewKey) ?? CENTERED_VIDEO_CROP_PATH
                      }
                      disabled={submitting}
                      onChange={path => onCropPathChange(reviewKey, path)}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border bg-background px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAllCrop}
            disabled={submitting || items.length === 0}
            className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            全部直接裁切
          </button>
          <button
            type="button"
            onClick={onApplyRecommendations}
            disabled={submitting || items.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            采用全部建议
          </button>
          <span className="text-[11px] text-muted-foreground">
            建议只作判断辅助，最终以你的播放确认和选择为准。
          </span>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || items.length === 0 || pendingCount > 0}
          className={`inline-flex h-9 min-w-48 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 ${
            expandCount > 0
              ? "bg-violet-700 text-white hover:bg-violet-800"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : pendingCount > 0 ? (
            <Clapperboard className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {submitting
            ? "处理中"
            : pendingCount > 0
              ? `还有 ${pendingCount} 个镜头待确认`
              : `执行 ${items.length} 个视频${expandCount > 0 ? `（含 ${expandCount} 个 302）` : ""}`}
        </button>
      </div>
    </div>
  );
}

export default function VideoConformReviewDialog({
  open,
  onOpenChange,
  items,
  targetAspectRatio,
  aiExpandReady,
  submitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly VideoConformReviewItem[];
  targetAspectRatio: OneClickTargetAspectRatio;
  aiExpandReady: boolean;
  submitting: boolean;
  onConfirm: (items: VideoConformBatchItem[]) => Promise<void>;
}) {
  const [decisions, setDecisions] = useState<
    Map<string, VideoConformReviewMode>
  >(() => new Map());
  const [cropPaths, setCropPaths] = useState<Map<string, VideoCropPath>>(
    () => new Map()
  );
  const itemSignature = useMemo(
    () => items.map(videoConformReviewKey).join(","),
    [items]
  );

  useEffect(() => {
    if (open) {
      setDecisions(new Map());
      setCropPaths(new Map());
    }
  }, [open, targetAspectRatio]);

  useEffect(() => {
    const availableKeys = new Set(items.map(videoConformReviewKey));
    setDecisions(current => {
      const next = new Map(
        Array.from(current).filter(([key]) => availableKeys.has(key))
      );
      return next.size === current.size ? current : next;
    });
    setCropPaths(current => {
      const next = new Map(
        Array.from(current).filter(([key]) => availableKeys.has(key))
      );
      return next.size === current.size ? current : next;
    });
  }, [itemSignature, items]);

  const setDecision = (key: string, mode: VideoConformReviewMode) => {
    if (submitting) return;
    setDecisions(current => {
      const next = new Map(current);
      next.set(key, mode);
      return next;
    });
    if (mode === "crop") {
      setCropPaths(current => {
        if (current.has(key)) return current;
        const next = new Map(current);
        next.set(key, CENTERED_VIDEO_CROP_PATH);
        return next;
      });
    }
  };

  const setCropPath = (key: string, path: VideoCropPath) => {
    if (submitting) return;
    setCropPaths(current => {
      const next = new Map(current);
      next.set(key, path);
      return next;
    });
  };

  const applyRecommendations = () => {
    const nextDecisions = new Map(
      items.flatMap(item =>
        item.recommendation.mode === "ai_expand" &&
        (!aiExpandReady || item.aiExpandUnavailableReason != null)
          ? []
          : [[videoConformReviewKey(item), item.recommendation.mode] as const]
      )
    );
    setDecisions(nextDecisions);
    setCropPaths(current => {
      const next = new Map(current);
      items.forEach(item => {
        const key = videoConformReviewKey(item);
        if (nextDecisions.get(key) === "crop" && !next.has(key)) {
          next.set(key, CENTERED_VIDEO_CROP_PATH);
        }
      });
      return next;
    });
  };

  const allCrop = () => {
    setDecisions(
      new Map(items.map(item => [videoConformReviewKey(item), "crop"] as const))
    );
    setCropPaths(
      new Map(
        items.map(item => [
          videoConformReviewKey(item),
          CENTERED_VIDEO_CROP_PATH,
        ])
      )
    );
  };

  const confirm = async () => {
    const batchItems = buildVideoConformBatchItems(items, decisions, cropPaths);
    if (batchItems.length !== items.length) return;
    await onConfirm(batchItems);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-2rem))]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Clapperboard className="h-4 w-4 text-primary" />
            运镜与画幅确认台
          </DialogTitle>
          <DialogDescription>
            逐镜播放确认相机运动，再选择直接裁切或 302
            专业视频外扩。打开本窗口不会提交任务或消耗额度。
          </DialogDescription>
        </DialogHeader>
        <VideoConformReviewPanel
          items={items}
          targetAspectRatio={targetAspectRatio}
          aiExpandReady={aiExpandReady}
          decisions={decisions}
          cropPaths={cropPaths}
          submitting={submitting}
          onDecisionChange={setDecision}
          onCropPathChange={setCropPath}
          onApplyRecommendations={applyRecommendations}
          onAllCrop={allCrop}
          onConfirm={() => void confirm()}
        />
      </DialogContent>
    </Dialog>
  );
}
