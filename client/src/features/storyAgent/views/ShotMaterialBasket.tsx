import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  BrainCircuit,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Loader2,
  Play,
  ScanLine,
  Upload,
  Video,
  X,
} from "lucide-react";
import type {
  CreationEditorShot,
  ImportedStoryMaterialResult,
} from "@/features/creationEditor/CreationEditorContext";
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
  videoTakeFrameUrl,
} from "@/features/creationEditor/videoAssetViewModel";
import type { StoryShotEditableField } from "@/features/storyAgent/StoryAgentContext";
import { toast } from "sonner";
import type {
  ShotVideoProviderStatus,
  VideoTakeAsset,
} from "@shared/videoAsset";
import { displayShotCode } from "@shared/shotIdentity";
import {
  estimateShotVideoCost,
  SHOT_VIDEO_ASPECT_RATIO,
  type ShotDirectorResult,
} from "@shared/shotDirector";
import {
  isStartEndVideoTakeSnapshot,
  parseStartEndVideoConfig,
  type StartEndShotVideoEstimate,
} from "@shared/startEndVideo";
import {
  readStoryboardMediaBase64,
  STORYBOARD_MEDIA_ACCEPT,
  storyboardMediaMime,
} from "../storyboardLocalMedia";
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
  return displayShotCode(shot);
}

function stableShotId(shot: CreationEditorShot): string | null {
  return shot.stableShotId ?? shot.shotIdentity ?? null;
}

function currentTake(shot: CreationEditorShot): VideoTakeAsset | null {
  return (
    shot.selectedVideoTake ??
    shot.videoTakes?.find(take => take.isTimelineSelected) ??
    shot.videoTakes?.find(
      take => take.status === "available" && Boolean(take.videoUrl)
    ) ??
    null
  );
}

function shotFrame(
  shot: CreationEditorShot | null | undefined,
  role: "start" | "end"
): string | null {
  if (!shot) return null;
  const take = currentTake(shot);
  return (take ? videoTakeFrameUrl(take, role) : null) ?? shot.imageUrl ?? null;
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

export type ShotVideoWorkflowStep =
  | "analyze"
  | "apply"
  | "generate"
  | "refresh";

export function shotVideoWorkflowStep(input: {
  hasAnalysis: boolean;
  analysisApplied: boolean;
  hasProcessingTake: boolean;
}): ShotVideoWorkflowStep {
  if (input.hasProcessingTake) return "refresh";
  if (!input.hasAnalysis) return "analyze";
  if (!input.analysisApplied) return "apply";
  return "generate";
}

export function shotVideoWorkflowLabel(step: ShotVideoWorkflowStep): string {
  switch (step) {
    case "analyze":
      return "1 分析导演方案";
    case "apply":
      return "2 应用导演方案";
    case "generate":
      return "3 确认费用并生成";
    case "refresh":
      return "刷新生成状态";
  }
}

export function shotVideoDirectorInputSignature(
  shot: Partial<CreationEditorShot>
): string {
  return JSON.stringify(
    [
      shot.dialogue,
      shot.intent,
      shot.action,
      shot.performance,
      shot.environmentMotion,
      shot.cameraMove,
      shot.cameraHeight,
      shot.lens,
      shot.cameraPath,
      shot.subjectPath,
      shot.videoStart,
      shot.videoEnd,
      shot.transitionIn,
      shot.transitionOut,
      shot.sound,
      shot.soundBridge,
    ].map(value => (typeof value === "string" ? value.trim() : ""))
  );
}

type ShotMaterialBasketProps = {
  shot: CreationEditorShot;
  previousShots: CreationEditorShot[];
  nextShot?: CreationEditorShot | null;
  generating: boolean;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
    motion?: "low" | "high";
    aspectRatio?: "1:1";
    directorPromptApproved?: boolean;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<unknown>;
  onEstimateStartEndShotVideo?: (
    stableShotId: string
  ) => Promise<StartEndShotVideoEstimate>;
  onGenerateStartEndShotVideo?: (input: {
    shotNo: number;
    stableShotId: string;
    costConfirmation: {
      accepted: true;
      estimatedCny: number;
    };
  }) => Promise<unknown>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  onMarkVideoTakeUnusable?: (takeId: number) => Promise<void>;
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
  onImportStoryMaterial?: (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
  }) => Promise<ImportedStoryMaterialResult>;
  onAnalyzeShotVideoDirection?: (input: {
    shotNo: number;
    stableShotId: string;
    draftPrompt: string;
    subtitle?: string;
  }) => Promise<ShotDirectorResult>;
  onUpdateShotFields?: (
    stableShotId: string,
    patch: Partial<Record<StoryShotEditableField, string>>
  ) => Promise<void>;
  displayMode?: "panel" | "matrix";
  onClose?: () => void;
};

export default function ShotMaterialBasket({
  shot,
  previousShots,
  nextShot = null,
  generating,
  onGenerateShotVideo,
  onEstimateStartEndShotVideo,
  onGenerateStartEndShotVideo,
  onRefreshShotVideoStatus,
  onMarkVideoTakeUnusable,
  movingVideoTakeId = null,
  onAdoptVideoTake,
  onPromoteFrameCrop,
  promotingFrameCrop = false,
  shotVideoProviderStatus = null,
  onImportStoryMaterial,
  onAnalyzeShotVideoDirection,
  onUpdateShotFields,
  displayMode = "panel",
  onClose,
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
  const [markingTakeId, setMarkingTakeId] = useState<number | null>(null);
  const [draggingTakeId, setDraggingTakeId] = useState<number | null>(null);
  const [busyQuadrant, setBusyQuadrant] = useState<FrameQuadrant | null>(null);
  const [selectedQuadrant, setSelectedQuadrant] =
    useState<FrameQuadrant | null>(null);
  const [frameCropError, setFrameCropError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [analysis, setAnalysis] = useState<ShotDirectorResult | null>(null);
  const [analysisApplied, setAnalysisApplied] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applyingAnalysis, setApplyingAnalysis] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [startEndEstimate, setStartEndEstimate] =
    useState<StartEndShotVideoEstimate | null>(null);
  const [estimatingStartEnd, setEstimatingStartEnd] = useState(false);
  const [submittingStartEnd, setSubmittingStartEnd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const analysisSectionRef = useRef<HTMLDivElement | null>(null);
  const analyzedInputSignatureRef = useRef<string | null>(null);
  const directorInputSignature = useMemo(
    () => shotVideoDirectorInputSignature(shot),
    [
      shot.action,
      shot.cameraHeight,
      shot.cameraMove,
      shot.cameraPath,
      shot.dialogue,
      shot.environmentMotion,
      shot.intent,
      shot.lens,
      shot.performance,
      shot.sound,
      shot.soundBridge,
      shot.subjectPath,
      shot.transitionIn,
      shot.transitionOut,
      shot.videoEnd,
      shot.videoStart,
    ]
  );
  useEffect(() => {
    setVideoPrompt(recipe.finalPrompt);
    setMotion(suggestedMotion);
    setBusyQuadrant(null);
    setSelectedQuadrant(null);
    setFrameCropError(null);
    setAnalysis(null);
    setAnalysisApplied(false);
    setAnalysisError(null);
    setPromptDirty(false);
    setStartEndEstimate(null);
    setEstimatingStartEnd(false);
    setSubmittingStartEnd(false);
    analyzedInputSignatureRef.current = null;
  }, [shot.stableShotId]);
  useEffect(() => {
    if (!promptDirty && !analysisApplied) {
      setVideoPrompt(recipe.finalPrompt);
    }
  }, [analysisApplied, promptDirty, recipe.finalPrompt]);
  useEffect(() => {
    if (!analysis) setMotion(suggestedMotion);
  }, [analysis, suggestedMotion]);
  useEffect(() => {
    if (
      !analysis ||
      applyingAnalysis ||
      !analyzedInputSignatureRef.current ||
      analyzedInputSignatureRef.current === directorInputSignature
    ) {
      return;
    }
    analyzedInputSignatureRef.current = null;
    setAnalysis(null);
    setAnalysisApplied(false);
    setStartEndEstimate(null);
    toast.info("镜头文字已变化，请重新执行“1 分析导演方案”");
  }, [analysis, applyingAnalysis, directorInputSignature]);
  const previousShot = previousShots.at(-1) ?? null;
  const selectedTake = currentTake(shot);
  const selectedTakeIsTimeline = Boolean(
    selectedTake &&
      (selectedTake.isTimelineSelected ||
        shot.selectedVideoTake?.id === selectedTake.id)
  );
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
  const startEndConfig = useMemo(
    () =>
      parseStartEndVideoConfig(
        shot.generationParams,
        Math.max(0.1, (shot.durationMs ?? 5_000) / 1_000)
      ),
    [shot.durationMs, shot.generationParams]
  );
  const startEndProcessingTake = shot.videoTakes?.find(
    take =>
      isStartEndVideoTakeSnapshot(take.parameterSnapshot) &&
      ["submitted", "processing"].includes(take.status)
  );
  const processingTake = shot.videoTakes?.find(
    take =>
      !isStartEndVideoTakeSnapshot(take.parameterSnapshot) &&
      ["submitted", "processing"].includes(take.status)
  );
  const workflowStep = shotVideoWorkflowStep({
    hasAnalysis: Boolean(analysis),
    analysisApplied,
    hasProcessingTake: Boolean(processingTake),
  });
  const workflowLabel = canGenerate
    ? shotVideoWorkflowLabel(workflowStep)
    : generateLabel;
  const takeStats = useMemo(() => {
    const active: VideoTakeAsset[] = [];
    const unavailable: VideoTakeAsset[] = [];
    let playableCount = 0;
    let refreshableCount = 0;
    for (const take of shot.videoTakes ?? []) {
      const affordance = videoTakeAffordance(take.status);
      if (affordance.canPlay) playableCount += 1;
      if (affordance.canRefresh) refreshableCount += 1;
      if (affordance.canPlay || affordance.canRefresh) {
        active.push(take);
      } else {
        unavailable.push(take);
      }
    }
    return {
      active,
      unavailable,
      playableCount,
      refreshableCount,
      total: active.length + unavailable.length,
    };
  }, [shot.videoTakes]);

  const generate = async () => {
    if (!canGenerate || shot.imageId == null) return;
    if (!analysis || !analysisApplied) return;
    if (!(await saveVideoPrompt())) return;
    const durationSec = Math.max(
      3,
      Math.min(10, Math.round((shot.durationMs ?? 5000) / 1000))
    );
    const estimate = estimateShotVideoCost({ durationSec, motion });
    const confirmed = window.confirm(
      `预计费用 ¥${estimate.estimatedCny.toFixed(2)}。确认后才会提交 302 生成 ${durationSec} 秒、1:1 视频。是否继续？`
    );
    if (!confirmed) return;
    try {
      const result = (await onGenerateShotVideo?.({
        shotNo: shot.shotNo,
        imageId: shot.imageId,
        prompt: videoPrompt.trim(),
        subtitle: shot.dialogue || undefined,
        durationSec,
        motion,
        aspectRatio: SHOT_VIDEO_ASPECT_RATIO,
        directorPromptApproved: true,
        costConfirmation: {
          accepted: true,
          estimatedCny: estimate.estimatedCny,
        },
      })) as { takeId?: number } | undefined;
      toast.success(
        result?.takeId
          ? `视频任务已提交为 Take ${result.takeId}；生成结果会显示在当前预览和下方 Take 列表`
          : "视频任务已提交；生成结果会显示在当前预览和下方 Take 列表"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频任务提交失败");
    }
  };

  const requestStartEndEstimate = async () => {
    const targetStableShotId = stableShotId(shot);
    if (
      !startEndConfig ||
      !targetStableShotId ||
      !onEstimateStartEndShotVideo
    ) {
      return;
    }
    if (!analysis) {
      await analyzeContinuity();
      toast.info("导演方案已经生成，请检查并应用后再获取报价");
      return;
    }
    if (!analysisApplied) {
      toast.info("请先确认并应用当前图生视频导演方案");
      return;
    }
    setEstimatingStartEnd(true);
    try {
      setStartEndEstimate(
        await onEstimateStartEndShotVideo(targetStableShotId)
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "首尾帧视频报价失败"
      );
    } finally {
      setEstimatingStartEnd(false);
    }
  };

  const submitStartEnd = async () => {
    if (!startEndEstimate || !onGenerateStartEndShotVideo) return;
    setSubmittingStartEnd(true);
    try {
      await onGenerateStartEndShotVideo({
        shotNo: shot.shotNo,
        stableShotId: startEndEstimate.stableShotId,
        costConfirmation: {
          accepted: true,
          estimatedCny: startEndEstimate.estimatedCny,
        },
      });
      setStartEndEstimate(null);
      toast.success("首尾帧视频任务已提交");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "首尾帧视频提交失败"
      );
    } finally {
      setSubmittingStartEnd(false);
    }
  };

  const importForShot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const targetStableShotId = stableShotId(shot);
    if (!file || !targetStableShotId || !onImportStoryMaterial) return;
    setImporting(true);
    try {
      const imported = await onImportStoryMaterial({
        fileName: file.name,
        mimeType: storyboardMediaMime(file),
        fileBase64: await readStoryboardMediaBase64(file),
        targetStableShotId,
        note: `${shotLabel(shot)} 本地导入`,
      });
      if (imported.kind === "video" && onAdoptVideoTake) {
        await onAdoptVideoTake({
          stableShotId: imported.stableShotId,
          takeId: imported.takeId,
          plannedDurationSec: imported.plannedDurationSec,
        });
        toast.success("视频已导入当前镜头并进入时间线");
      } else {
        toast.success("图片已设为当前镜头主图");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材导入失败");
    } finally {
      setImporting(false);
    }
  };

  const saveVideoPrompt = async (): Promise<boolean> => {
    const targetStableShotId = stableShotId(shot);
    if (!promptDirty) return true;
    if (!targetStableShotId || !onUpdateShotFields) {
      toast.error("当前镜头无法保存最终视频提示词");
      return false;
    }
    setSavingPrompt(true);
    try {
      await onUpdateShotFields(targetStableShotId, {
        videoPrompt: videoPrompt.trim(),
      });
      setPromptDirty(false);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频提示保存失败");
      return false;
    } finally {
      setSavingPrompt(false);
    }
  };

  const analyzeContinuity = async (): Promise<ShotDirectorResult | null> => {
    const targetStableShotId = stableShotId(shot);
    if (!targetStableShotId || !onAnalyzeShotVideoDirection) return null;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await onAnalyzeShotVideoDirection({
        shotNo: shot.shotNo,
        stableShotId: targetStableShotId,
        draftPrompt:
          videoPrompt.trim() ||
          [shot.action, shot.cameraMove, shot.videoStart, shot.videoEnd]
            .filter(Boolean)
            .join("\n") ||
          "根据当前镜头及相邻镜头设计连续、可剪辑的视频动作",
        subtitle: shot.dialogue || undefined,
      });
      analyzedInputSignatureRef.current = directorInputSignature;
      setAnalysis(result);
      setAnalysisApplied(false);
      setMotion(result.analysis.recommendedMotion);
      return result;
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : "镜头衔接分析失败"
      );
      return null;
    } finally {
      setAnalyzing(false);
    }
  };

  const applyAnalysis = async () => {
    const targetStableShotId = stableShotId(shot);
    if (!analysis || !targetStableShotId || !onUpdateShotFields) return;
    const confirmed = window.confirm(
      "把承载方式、三段运动节拍、人物与摄影机配合、开始/结束画面和视觉保真限制写入当前镜头？"
    );
    if (!confirmed) return;
    const patch = Object.fromEntries(
      Object.entries(analysis.suggestedFields).filter(
        (entry): entry is [StoryShotEditableField, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0
      )
    ) as Partial<Record<StoryShotEditableField, string>>;
    setApplyingAnalysis(true);
    try {
      await onUpdateShotFields(targetStableShotId, patch);
      analyzedInputSignatureRef.current = shotVideoDirectorInputSignature({
        ...shot,
        ...patch,
      });
      if (patch.videoPrompt) {
        setVideoPrompt(patch.videoPrompt);
        setPromptDirty(false);
      }
      setAnalysisApplied(true);
      setStartEndEstimate(null);
      toast.success("衔接建议已写入当前镜头");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "应用衔接建议失败");
    } finally {
      setApplyingAnalysis(false);
    }
  };

  const revealAnalysis = () => {
    window.requestAnimationFrame(() => {
      analysisSectionRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
  };

  const advanceVideoWorkflow = async () => {
    if (workflowStep === "refresh") {
      if (processingTake) {
        await onRefreshShotVideoStatus?.(processingTake.id);
      }
      return;
    }
    if (workflowStep === "analyze") {
      const result = await analyzeContinuity();
      if (result) {
        revealAnalysis();
        toast.info(
          "只生成了导演方案，尚未提交视频。请检查方案后点击“2 应用导演方案”"
        );
      }
      return;
    }
    if (workflowStep === "apply") {
      revealAnalysis();
      await applyAnalysis();
      return;
    }
    await generate();
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

  const markTakeUnusable = async (takeId: number) => {
    if (!onMarkVideoTakeUnusable) return;
    setMarkingTakeId(takeId);
    try {
      await onMarkVideoTakeUnusable(takeId);
    } finally {
      setMarkingTakeId(null);
    }
  };

  const startTakeDrag = (event: DragEvent<HTMLDivElement>, takeId: number) => {
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

  const renderTakeCard = (take: VideoTakeAsset, activeSlot: boolean) => {
    const affordance = videoTakeAffordance(take.status);
    const stale =
      shot.imageId != null &&
      take.sourceImageId != null &&
      shot.imageId !== take.sourceImageId;
    const canMarkUnusable =
      Boolean(onMarkVideoTakeUnusable) &&
      take.status !== "unfollowable" &&
      (affordance.canPlay || affordance.canRefresh);
    return (
      <div
        key={take.id}
        draggable={activeSlot && Boolean(shot.stableShotId)}
        aria-grabbed={draggingTakeId === take.id}
        onDragStart={event => startTakeDrag(event, take.id)}
        onDragEnd={() => setDraggingTakeId(null)}
        title={activeSlot ? "拖到另一个镜头卡片" : "不可用 Take 不占用可用位置"}
        className={`rounded-md border px-2 py-1.5 text-[9px] transition ${
          movingVideoTakeId === take.id
            ? "cursor-wait opacity-60"
            : activeSlot
              ? "cursor-grab active:cursor-grabbing"
              : "opacity-70"
        }`}
        style={{
          borderColor:
            draggingTakeId === take.id
              ? "var(--nayin-accent)"
              : "var(--panel-border)",
          background: activeSlot ? "var(--background)" : "var(--panel-header)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-foreground">
            Take {take.id} · {affordance.label}
          </span>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {take.isTimelineSelected ? (
              <span className="inline-flex items-center gap-1 text-nayin-bright">
                <Check className="h-3 w-3" />
                已采用
              </span>
            ) : stale ? (
              <span className="text-amber-700">基于旧主图</span>
            ) : !activeSlot ? (
              <span className="text-muted-foreground">不占位</span>
            ) : null}
            {canMarkUnusable ? (
              <button
                type="button"
                disabled={markingTakeId === take.id}
                onClick={event => {
                  event.stopPropagation();
                  void markTakeUnusable(take.id);
                }}
                className="inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[8.5px] font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                style={{ borderColor: "var(--panel-border)" }}
                title="标记后会移入不可用区域，并从动态分镜时间线移除"
              >
                {markingTakeId === take.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Ban className="h-3 w-3" />
                )}
                标记不可用
              </button>
            ) : null}
          </div>
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
              preload="none"
              className="aspect-video w-full rounded-md bg-black object-contain"
            />
            {!take.isTimelineSelected ? (
              <button
                type="button"
                disabled={adoptingTakeId === take.id || !onAdoptVideoTake}
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
  };

  return (
    <div
      className={
        displayMode === "matrix" ? "py-1" : "mt-2 rounded-md border p-2"
      }
      aria-label="视频的生成、预览和采用都在故事版看板完成"
      style={
        displayMode === "matrix"
          ? undefined
          : {
              borderColor: "var(--panel-border)",
              background: "var(--panel-header)",
            }
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={STORYBOARD_MEDIA_ACCEPT}
        className="hidden"
        onChange={event => void importForShot(event)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Video className="h-3.5 w-3.5 text-nayin-bright" />
          <span className="text-[9px] font-semibold text-foreground">
            {displayMode === "matrix"
              ? `${shotLabel(shot)} · 素材 / 图生视频 / Take`
              : "镜头素材与视频"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={importing || !onImportStoryMaterial}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: "var(--panel-border)" }}
            title="导入图片作为主图，或导入视频并用于当前镜头"
          >
            {importing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            导入
          </button>
          {startEndConfig ? (
            <button
              type="button"
              disabled={
                generating ||
                estimatingStartEnd ||
                submittingStartEnd ||
                (startEndProcessingTake
                  ? !onRefreshShotVideoStatus
                  : !onEstimateStartEndShotVideo ||
                    !onGenerateStartEndShotVideo)
              }
              onClick={() => {
                if (startEndProcessingTake) {
                  void onRefreshShotVideoStatus?.(startEndProcessingTake.id);
                  return;
                }
                void requestStartEndEstimate();
              }}
              className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-nayin-bright transition hover:bg-[var(--nayin-glow)] disabled:opacity-50"
              style={{ borderColor: "var(--nayin-accent)" }}
              title={
                !analysis
                  ? "先分析人物动作、摄影机承载、运动节拍和画面保真"
                  : !analysisApplied
                    ? "先检查并应用导演方案"
                    : "使用已锁定的首帧和尾帧生成视频"
              }
            >
              {generating || estimatingStartEnd || submittingStartEnd ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Video className="h-3 w-3" />
              )}
              {startEndProcessingTake
                ? "刷新首尾帧"
                : generating || submittingStartEnd
                  ? "提交中"
                  : estimatingStartEnd
                    ? "报价中"
                    : !analysis
                      ? "分析后生成"
                      : !analysisApplied
                        ? "应用后生成"
                        : "首尾帧生成"}
            </button>
          ) : (
            <button
              type="button"
              disabled={generating || (!canGenerate && !processingTake)}
              title={
                !canGenerate && !processingTake
                  ? missing.length > 0
                    ? `暂不可生成：${missing.join(" / ")}`
                    : "暂不可生成视频"
                  : workflowStep === "analyze"
                    ? "先结合当前文字和相邻镜头生成导演方案"
                    : workflowStep === "apply"
                      ? "确认后把导演方案写入当前镜头"
                      : workflowStep === "generate"
                        ? "确认人民币费用后提交视频生成"
                        : "刷新当前视频任务状态"
              }
              onClick={() => void advanceVideoWorkflow()}
              className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              style={{ borderColor: "var(--panel-border)" }}
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Video className="h-3 w-3" />
              )}
              {generating ? "提交中" : workflowLabel}
            </button>
          )}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
              aria-label="收起视频制作"
              title="收起"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            </button>
          ) : null}
        </div>
      </div>
      {startEndEstimate ? (
        <div
          className="mt-2 grid items-center gap-2 border-y py-2 sm:grid-cols-[116px_minmax(0,1fr)_auto]"
          style={{ borderColor: "var(--panel-border)" }}
          aria-label="首尾帧视频费用确认"
        >
          <div className="flex items-center gap-1">
            <img
              src={startEndEstimate.firstFrame.imageUrl}
              alt={startEndEstimate.firstFrame.label}
              className="h-12 w-12 rounded-sm bg-black object-cover"
            />
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <img
              src={startEndEstimate.lastFrame.imageUrl}
              alt={startEndEstimate.lastFrame.label}
              className="h-12 w-12 rounded-sm bg-black object-cover"
            />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold text-foreground">
              预计人民币 ¥{startEndEstimate.estimatedCny.toFixed(2)}
            </p>
            <p className="mt-0.5 truncate text-[8px] text-muted-foreground">
              {startEndEstimate.durationSec}s · {startEndEstimate.resolution} ·
              1:1 · 候选 Take
            </p>
          </div>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setStartEndEstimate(null)}
              disabled={submittingStartEnd}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
              aria-label="取消首尾帧生成"
              title="取消"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void submitStartEnd()}
              disabled={submittingStartEnd || generating}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-sm bg-nayin-bright px-2 text-[9px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {submittingStartEnd ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              确认并生成
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_132px]">
        <div className="relative min-h-28 overflow-hidden rounded-md bg-black">
          {selectedTake?.videoUrl ? (
            <video
              src={selectedTake.videoUrl}
              poster={shot.imageUrl || undefined}
              controls
              playsInline
              preload="metadata"
              className="aspect-square h-full max-h-52 w-full object-contain"
              aria-label={`${shotLabel(shot)} 当前视频`}
            />
          ) : shot.imageUrl ? (
            <img
              src={shot.imageUrl}
              alt={`${shotLabel(shot)} 当前主图`}
              className="aspect-square h-full max-h-52 w-full object-contain"
            />
          ) : (
            <div className="flex aspect-square max-h-52 min-h-28 items-center justify-center text-neutral-500">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
          <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[8px] text-white">
            {selectedTake?.videoUrl
              ? `${selectedTakeIsTimeline ? "已采用" : "候选"} Take ${selectedTake.id}`
              : shot.imageUrl
                ? "当前主图"
                : "未导入画面"}
          </span>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-1">
            {[
              ["前尾", previousShot, "end"],
              ["本首", shot, "start"],
              ["后首", nextShot, "start"],
            ].map(([label, target, role]) => {
              const frame = shotFrame(
                target as CreationEditorShot | null,
                role as "start" | "end"
              );
              return (
                <div key={String(label)} className="min-w-0">
                  <span className="mb-1 block text-center text-[7.5px] text-muted-foreground">
                    {String(label)}
                  </span>
                  <div className="relative aspect-square overflow-hidden rounded-sm bg-muted/50">
                    {frame ? (
                      <img
                        src={frame}
                        alt={String(label)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/45" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={analyzing || !onAnalyzeShotVideoDirection}
            onClick={() => void analyzeContinuity()}
            className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-md border px-2 text-[8.5px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {analyzing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <BrainCircuit className="h-3 w-3" />
            )}
            分析图生视频
          </button>
        </div>
      </div>
      {analysisError ? (
        <p className="mt-2 flex items-start gap-1.5 text-[9px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {analysisError}
        </p>
      ) : null}
      {analysis ? (
        <div
          ref={analysisSectionRef}
          className="mt-2 border-y py-2 text-[9px]"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">
              {analysis.analysis.transitionStrategy}
            </span>
            <button
              type="button"
              disabled={applyingAnalysis || !onUpdateShotFields}
              onClick={() => void applyAnalysis()}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm bg-nayin-bright px-1.5 text-[8px] font-semibold text-white disabled:opacity-50"
            >
              {applyingAnalysis ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {analysisApplied ? "已应用" : "应用方案"}
            </button>
          </div>
          {analysis.referenceFrames.length > 0 ? (
            <div
              className="mt-2 grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${Math.min(4, analysis.referenceFrames.length)}, minmax(0, 1fr))`,
              }}
            >
              {analysis.referenceFrames.map(frame => (
                <figure key={`${frame.role}:${frame.stableShotId}`}>
                  <div className="aspect-square overflow-hidden rounded-sm bg-black">
                    <img
                      src={frame.imageUrl}
                      alt={frame.label}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <figcaption className="mt-0.5 truncate text-center text-[7px] text-muted-foreground">
                    {frame.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          <div className="mt-2 divide-y divide-[var(--panel-border)] text-muted-foreground">
            {[
              ["承载方式", analysis.analysis.cameraRig],
              ["运动节拍", analysis.analysis.motionTimeline],
              ["人物与镜头", analysis.analysis.cameraSubjectCoordination],
              ["动作衔接", analysis.analysis.actionContinuity],
              ["画面保真", analysis.analysis.preservationConstraints],
            ].map(([label, value]) => (
              <p key={label} className="grid gap-0.5 py-1 leading-relaxed">
                <span className="font-semibold text-foreground">{label}</span>
                <span>{value}</span>
              </p>
            ))}
          </div>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            执行提示：{analysis.analysis.cameraMotion}；
            {analysis.analysis.subjectMotion}
          </p>
          {analysis.analysis.risks.some(risk => risk.kind !== "none") ? (
            <p className="mt-1 text-amber-700">
              风险：
              {analysis.analysis.risks
                .filter(risk => risk.kind !== "none")
                .map(risk => risk.detail)
                .join("；")}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 grid gap-2">
        <label className="grid gap-1 text-[9px] font-medium text-muted-foreground">
          最终提交给视频模型的提示词
          <textarea
            value={videoPrompt}
            onChange={event => {
              setVideoPrompt(event.target.value);
              setPromptDirty(true);
              setStartEndEstimate(null);
            }}
            onBlur={() => void saveVideoPrompt()}
            rows={3}
            className="min-h-[4.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[10px] leading-relaxed text-foreground outline-none transition focus:border-nayin-bright"
            style={{ borderColor: "var(--panel-border)" }}
          />
          <span className="text-[8px] font-normal">
            {savingPrompt ? "保存中" : promptDirty ? "未保存" : "已保存"}
          </span>
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
      {takeStats.total > 0 ? (
        <div className="mt-2 space-y-1.5">
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[9px]"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <span className="font-semibold text-foreground">Take 总览</span>
            <span className="text-muted-foreground">
              可用 {takeStats.playableCount} / 全部 {takeStats.total}
              {takeStats.refreshableCount > 0
                ? ` · 待刷新 ${takeStats.refreshableCount}`
                : ""}
              {takeStats.unavailable.length > 0
                ? ` · 不可用 ${takeStats.unavailable.length}`
                : ""}
            </span>
          </div>
          {takeStats.active.length > 0 ? (
            takeStats.active.map(take => renderTakeCard(take, true))
          ) : (
            <p
              className="rounded-md border px-2 py-1.5 text-[9px] text-muted-foreground"
              style={{ borderColor: "var(--panel-border)" }}
            >
              当前没有可用或待刷新的 Take；不可用 Take
              已收起，不再占用可用位置。
            </p>
          )}
          {takeStats.unavailable.length > 0 ? (
            <details className="rounded-md border px-2 py-1.5 text-[9px] text-muted-foreground">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1">
                  <ChevronDown className="h-3 w-3" />
                  不可用 Take
                </span>
                <span>{takeStats.unavailable.length} 个，不占用可用位</span>
              </summary>
              <div className="mt-1.5 space-y-1.5">
                {takeStats.unavailable.map(take => renderTakeCard(take, false))}
              </div>
            </details>
          ) : null}
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
