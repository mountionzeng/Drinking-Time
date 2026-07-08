import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Play,
  ScanLine,
  Video,
} from "lucide-react";
import type { CreationEditorShot } from "@/features/creationEditor/CreationEditorContext";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import { compileVideoShotRecipe } from "@/features/creationEditor/promptTable/videoRecipe";
import {
  cropFrameQuadrant,
  FRAME_QUADRANTS,
  type FrameQuadrant,
} from "@/features/creationEditor/video/frameCrop";
import {
  videoTakeAffordance,
  videoTakeErrorMessage,
} from "@/features/creationEditor/videoAssetViewModel";
import type { ShotVideoProviderStatus } from "@shared/videoAsset";
import { writeVideoTakeDragPayload } from "./videoTakeDrag";

function compactSnapshot(snapshot: Record<string, unknown> | null | undefined) {
  if (!snapshot) return "";
  const model = typeof snapshot.model === "string" ? snapshot.model : "";
  const duration =
    typeof snapshot.durationSec === "number" ? `${snapshot.durationSec}s` : "";
  const aspect =
    typeof snapshot.aspectRatio === "string" ? snapshot.aspectRatio : "";
  return [model, duration, aspect].filter(Boolean).join(" · ");
}

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

function quadrantImageStyle(quadrant: FrameQuadrant): CSSProperties {
  const right = quadrant === "top-right" || quadrant === "bottom-right";
  const bottom = quadrant === "bottom-left" || quadrant === "bottom-right";
  return {
    width: "200%",
    height: "200%",
    maxWidth: "none",
    left: right ? "-100%" : "0",
    top: bottom ? "-100%" : "0",
  };
}

type ShotMaterialBasketProps = {
  shot: CreationEditorShot;
  previousShots: CreationEditorShot[];
  generating: boolean;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
  }) => Promise<unknown>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  movingVideoTakeId?: number | null;
  onAdoptVideoTake?: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  onPromoteFrameCrop?: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
  promotingFrameCrop?: boolean;
  shotVideoProviderStatus?: ShotVideoProviderStatus | null;
};

export default function ShotMaterialBasket({
  shot,
  previousShots,
  generating,
  onGenerateShotVideo,
  onRefreshShotVideoStatus,
  movingVideoTakeId = null,
  onAdoptVideoTake,
  onPromoteFrameCrop,
  promotingFrameCrop = false,
  shotVideoProviderStatus = null,
}: ShotMaterialBasketProps) {
  const rows = buildPromptTable(shot, { previousShots });
  const recipe = compileVideoShotRecipe({ shot, rows });
  const suggestedMotion = useMemo<"low" | "high">(
    () =>
      /跑|冲|追|爆|快速|剧烈|摇|甩|推拉|奔|fight|run|fast/i.test(
        [shot.action, shot.cameraMove, shot.emotion].filter(Boolean).join(" ")
      )
        ? "high"
        : "low",
    [shot.action, shot.cameraMove, shot.emotion]
  );
  const [videoPrompt, setVideoPrompt] = useState(recipe.finalPrompt);
  const [motion, setMotion] = useState<"low" | "high">(suggestedMotion);
  const [adoptingTakeId, setAdoptingTakeId] = useState<number | null>(null);
  const [draggingTakeId, setDraggingTakeId] = useState<number | null>(null);
  const [busyQuadrant, setBusyQuadrant] = useState<FrameQuadrant | null>(null);
  const [selectedQuadrant, setSelectedQuadrant] =
    useState<FrameQuadrant | null>(null);
  const [frameCropError, setFrameCropError] = useState<string | null>(null);
  useEffect(() => {
    setVideoPrompt(recipe.finalPrompt);
    setMotion(suggestedMotion);
    setBusyQuadrant(null);
    setSelectedQuadrant(null);
    setFrameCropError(null);
  }, [recipe.finalPrompt, shot.stableShotId, suggestedMotion]);
  const hasTraceableKeyframe = typeof shot.imageId === "number";
  const hasSelectedKeyframe =
    shot.imageSelectionSource === "explicit" ||
    shot.imageSelectionSource === "legacy" ||
    shot.imageIsPrimary === true;
  const missing = [
    ...recipe.missing,
    ...(recipe.sourceImageUrl && !hasTraceableKeyframe ? ["可追踪首帧"] : []),
    ...(recipe.sourceImageUrl && hasTraceableKeyframe && !hasSelectedKeyframe
      ? ["已选首帧"]
      : []),
  ];
  const providerMissing = shotVideoProviderStatus?.missing ?? [];
  const providerWarnings = shotVideoProviderStatus?.warnings ?? [];
  const providerReady = shotVideoProviderStatus?.ready ?? false;
  const candidateFrameUrl = hasSelectedKeyframe
    ? ""
    : shot.imageUrl || shot.promptRun?.imageUrl || recipe.sourceImageUrl || "";
  const candidateFrameId = shot.imageId ?? shot.promptRun?.imageId ?? undefined;
  const canPickFrameCandidate =
    Boolean(onPromoteFrameCrop && candidateFrameUrl) && !hasSelectedKeyframe;
  const canGenerate =
    hasTraceableKeyframe &&
    hasSelectedKeyframe &&
    missing.length === 0 &&
    providerReady &&
    Boolean(onGenerateShotVideo);
  const generateLabel = !providerReady
    ? "配置模型"
    : !hasTraceableKeyframe || !hasSelectedKeyframe
      ? "先选主图"
      : missing.length > 0
        ? "补全视频包"
        : "生成视频";
  const processingTake = shot.videoTakes?.find(take =>
    ["submitted", "processing"].includes(take.status)
  );
  const latestTake = shot.videoTakes?.[0];

  const generate = async () => {
    if (!canGenerate || shot.imageId == null) return;
    await onGenerateShotVideo?.({
      shotNo: shot.shotNo,
      imageId: shot.imageId,
      prompt: videoPrompt.trim(),
      subtitle: shot.dialogue || undefined,
      durationSec: Math.max(
        3,
        Math.min(10, Math.round((shot.durationMs ?? 5000) / 1000))
      ),
      motion,
    });
  };

  const adopt = async (takeId: number) => {
    if (!shot.stableShotId || !onAdoptVideoTake) return;
    setAdoptingTakeId(takeId);
    try {
      await onAdoptVideoTake({
        stableShotId: shot.stableShotId,
        takeId,
        plannedDurationSec: Math.max(0.1, (shot.durationMs ?? 3000) / 1000),
      });
    } finally {
      setAdoptingTakeId(null);
    }
  };

  const startTakeDrag = (
    event: DragEvent<HTMLDivElement>,
    takeId: number
  ) => {
    if (!shot.stableShotId) {
      event.preventDefault();
      return;
    }
    setDraggingTakeId(takeId);
    writeVideoTakeDragPayload(event.dataTransfer, {
      takeId,
      sourceStableShotId: shot.stableShotId,
      sourceShotNo: shot.shotNo,
    });
  };

  const selectCandidateFrame = async (quadrant: FrameQuadrant) => {
    if (!onPromoteFrameCrop || !candidateFrameUrl) return;
    setFrameCropError(null);
    setBusyQuadrant(quadrant);
    try {
      const cropped = await cropFrameQuadrant(candidateFrameUrl, quadrant);
      await onPromoteFrameCrop({
        shotNo: shot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: candidateFrameId,
        quadrant,
      });
      setSelectedQuadrant(quadrant);
    } catch (error) {
      setFrameCropError(
        error instanceof Error ? error.message : "候选首帧保存失败"
      );
    } finally {
      setBusyQuadrant(null);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border p-2"
      style={{
        borderColor: "var(--panel-border)",
        background: "var(--panel-header)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Video className="h-3.5 w-3.5 text-nayin-bright" />
          <span className="text-[9px] font-semibold text-foreground">
            视频确认
          </span>
        </div>
        <button
          type="button"
          disabled={generating || (!canGenerate && !processingTake)}
          title={
            !canGenerate && !processingTake
              ? missing.length > 0
                ? `暂不可生成：${missing.join(" / ")}`
                : "暂不可生成视频"
              : undefined
          }
          onClick={() => {
            if (processingTake) {
              void onRefreshShotVideoStatus?.(processingTake.id);
              return;
            }
            void generate();
          }}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)" }}
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Video className="h-3 w-3" />
          )}
          {processingTake ? "刷新视频" : generating ? "提交中" : generateLabel}
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        <p
          className="rounded-md border px-2 py-1.5 text-[9px] leading-relaxed text-muted-foreground"
          style={{ borderColor: "var(--panel-border)" }}
        >
          当前主图会同步到动态分镜作占位；视频的生成、预览和采用都在故事版看板完成。
        </p>
        <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
          导演输入（提交时自动看图）
          <textarea
            value={videoPrompt}
            onChange={event => setVideoPrompt(event.target.value)}
            rows={3}
            className="min-h-[4.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[10px] leading-relaxed text-foreground outline-none transition focus:border-nayin-bright"
            style={{ borderColor: "var(--panel-border)" }}
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-medium text-muted-foreground">
            运动幅度
          </span>
          <div
            className="grid grid-cols-2 rounded-md border p-0.5"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {(["low", "high"] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={motion === value}
                onClick={() => setMotion(value)}
                className={`h-6 min-w-12 rounded px-2 text-[9px] transition ${
                  motion === value
                    ? "bg-nayin-bright text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "low" ? "低" : "高"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 grid gap-1.5 text-[9px] text-muted-foreground sm:grid-cols-2">
        <div
          className="rounded-md border px-2 py-1.5"
          style={{ borderColor: "var(--panel-border)" }}
        >
          首帧：
          {hasTraceableKeyframe
            ? hasSelectedKeyframe
              ? `已选 image #${shot.imageId}`
              : "候选图待选择"
            : recipe.sourceImageUrl
              ? "候选图待确认"
              : "缺失"}
        </div>
        <div
          className="rounded-md border px-2 py-1.5"
          style={{ borderColor: "var(--panel-border)" }}
        >
          视频包：
          {missing.length > 0 ? `还缺 ${missing.join(" / ")}` : "可提交"}
        </div>
        <div
          className="rounded-md border px-2 py-1.5 sm:col-span-2"
          style={{ borderColor: "var(--panel-border)" }}
        >
          后端：
          {!shotVideoProviderStatus
            ? "检查配置中"
            : providerMissing.length > 0
              ? `缺 ${providerMissing.join(" / ")}`
              : providerWarnings.length > 0
                ? `可提交；提醒 ${providerWarnings.join(" / ")} 未配置`
                : `302 ${shotVideoProviderStatus.model} · ${
                    shotVideoProviderStatus.promptDirectorReady
                      ? `视觉导演 ${shotVideoProviderStatus.promptDirectorModel}`
                      : "确定性提示词"
                  }`}
        </div>
      </div>
      {canPickFrameCandidate ? (
        <div
          className="mt-2 rounded-md border p-2"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-nayin-bright" />
              <span className="text-[9px] font-semibold text-foreground">
                四宫格选首帧
              </span>
            </div>
            <span className="text-[8px] text-muted-foreground">
              选择后进入视频阶段
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {FRAME_QUADRANTS.map(quadrant => {
              const busy = busyQuadrant === quadrant.value;
              const selected = selectedQuadrant === quadrant.value;
              return (
                <button
                  key={quadrant.value}
                  type="button"
                  disabled={promotingFrameCrop || busyQuadrant != null}
                  onClick={() => void selectCandidateFrame(quadrant.value)}
                  className="group min-w-0 overflow-hidden rounded-md border bg-background text-left transition hover:border-nayin-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-65"
                  style={{ borderColor: "var(--panel-border)" }}
                  aria-label={`选择${quadrant.label}作为当前主图`}
                >
                  <div className="relative aspect-video overflow-hidden bg-black/5">
                    <img
                      src={candidateFrameUrl}
                      alt={`${shotLabel(shot)} ${quadrant.label}候选首帧`}
                      className="absolute object-fill transition-opacity group-hover:opacity-95"
                      style={quadrantImageStyle(quadrant.value)}
                      loading="eager"
                    />
                  </div>
                  <span className="flex h-7 items-center justify-between gap-1 border-t px-2 text-[8.5px]">
                    <span className="font-medium text-foreground">
                      {quadrant.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-nayin-bright">
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : selected ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                      {busy ? "保存中" : selected ? "已选" : "设为主图"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {frameCropError ? (
            <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[9px] text-destructive">
              {frameCropError}
            </p>
          ) : null}
        </div>
      ) : null}
      {latestTake ? (
        <div className="mt-2 space-y-1.5">
          {shot.videoTakes?.slice(0, 3).map(take => {
            const affordance = videoTakeAffordance(take.status);
            const stale =
              shot.imageId != null &&
              take.sourceImageId != null &&
              shot.imageId !== take.sourceImageId;
            return (
              <div
                key={take.id}
                draggable={Boolean(shot.stableShotId)}
                aria-grabbed={draggingTakeId === take.id}
                onDragStart={event => startTakeDrag(event, take.id)}
                onDragEnd={() => setDraggingTakeId(null)}
                title="拖到另一个镜头卡片"
                className={`rounded-md border px-2 py-1.5 text-[9px] transition ${
                  movingVideoTakeId === take.id
                    ? "cursor-wait opacity-60"
                    : "cursor-grab active:cursor-grabbing"
                }`}
                style={{
                  borderColor:
                    draggingTakeId === take.id
                      ? "var(--nayin-accent)"
                      : "var(--panel-border)",
                  background: "var(--background)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    Take {take.id} · {affordance.label}
                  </span>
                  {take.isTimelineSelected ? (
                    <span className="inline-flex items-center gap-1 text-nayin-bright">
                      <Check className="h-3 w-3" />
                      已采用
                    </span>
                  ) : stale ? (
                    <span className="text-amber-700">基于旧主图</span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-muted-foreground">
                  {compactSnapshot(take.parameterSnapshot) ||
                    take.prompt ||
                    shotLabel(shot)}
                </p>
                {take.errorMessage ? (
                  <p className="mt-0.5 text-destructive">
                    {videoTakeErrorMessage(take.errorMessage)}
                  </p>
                ) : null}
                {take.status === "available" && take.videoUrl ? (
                  <div className="mt-1.5 grid gap-1.5">
                    <video
                      src={take.videoUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded-md bg-black object-contain"
                    />
                    {!take.isTimelineSelected ? (
                      <button
                        type="button"
                        disabled={
                          adoptingTakeId === take.id || !onAdoptVideoTake
                        }
                        onClick={() => void adopt(take.id)}
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-nayin-bright px-2 text-[9px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {adoptingTakeId === take.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        {stale ? "仍然采用旧版" : "采用到动态分镜"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {take.parameterSnapshot ? (
                  <details className="mt-1.5 text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center gap-1">
                      <ChevronDown className="h-3 w-3" />
                      生成参数
                    </summary>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-1.5 text-[8px]">
                      {JSON.stringify(take.parameterSnapshot, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="mt-2 rounded-md border px-2 py-1.5 text-[9px] text-muted-foreground"
          style={{ borderColor: "var(--panel-border)" }}
        >
          还没有视频 take。先确认首帧和视频提示，再从这里提交。
        </p>
      )}
    </div>
  );
}
