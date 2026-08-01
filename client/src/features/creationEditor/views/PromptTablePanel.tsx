import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Focus, LayoutGrid, ListFilter, Share2 } from "lucide-react";
import type { PromptRevision } from "@shared/promptLineage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useCreationEditor } from "../CreationEditorContext";
import type { CreationEditorShot } from "../types";
import { displayShotCode } from "@shared/shotIdentity";
import {
  latestFrameCandidateSheet,
  type FrameCandidateSource,
} from "../frameCandidate";
import type { PromptOverride } from "../promptTable/types";
import { readableRerenderError, type RerenderReference } from "../rerender";
import {
  buildPromptLineageRevisionPreview,
  buildPromptLineageShotView,
  resolvePromptCandidateNodeId,
  type PromptLineageRowView,
} from "../promptLineage/viewModel";
import PromptDatabaseView from "./PromptDatabaseView";
import PromptRevisionDialog, {
  type PromptRevisionDialogState,
} from "./PromptRevisionDialog";
import PromptRevisionStatus from "./PromptRevisionStatus";
import PromptTable from "./PromptTable";
import ShotFrameCandidatePicker from "./ShotFrameCandidatePicker";
import ShotImageHistory from "./ShotImageHistory";
import {
  captureReferenceFrameFromVideoUrl,
  captureReferenceFrameFromFile,
} from "../video/captureFrame";

function shotLabel(shot: CreationEditorShot | null | undefined) {
  return shot ? displayShotCode(shot) : "等待镜头";
}

function messageOf(error: unknown, fallback: string) {
  return readableRerenderError(error, fallback);
}

export default function PromptTablePanel() {
  const {
    activeStoryId,
    shots,
    selectedShotNo,
    selectedShot,
    materialState,
    promptLineageMode,
    promptProjection,
    isLoading,
    error,
    isSaving,
    rerenderingShotNos,
    rerenderError,
    updatePromptOverride,
    rerenderShot,
    promoteFrameCrop,
    refetch,
  } = useCreationEditor();
  const utils = trpc.useUtils();
  const createCandidateMut = trpc.promptLineage.createCandidate.useMutation();
  const confirmCandidateMut = trpc.promptLineage.confirmCandidate.useMutation();
  const rejectCandidateMut = trpc.promptLineage.rejectCandidate.useMutation();
  const restoreRevisionMut = trpc.promptLineage.restoreRevision.useMutation();
  const [viewMode, setViewMode] = useState<"cards" | "database">("cards");
  const [editScope, setEditScope] = useState<"shot" | "source">("shot");
  const [historyRow, setHistoryRow] = useState<PromptLineageRowView | null>(
    null
  );
  const [dialogState, setDialogState] =
    useState<PromptRevisionDialogState | null>(null);
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [inspectedCandidate, setInspectedCandidate] =
    useState<FrameCandidateSource | null>(null);
  const [candidateCompareOpen, setCandidateCompareOpen] = useState(false);
  const [referenceShotNo, setReferenceShotNo] = useState<number | null>(null);
  const [extractingFrame, setExtractingFrame] = useState(false);
  const [localVideoRef, setLocalVideoRef] = useState<{
    file: File;
    preview: string;
  } | null>(null);
  const [localVideoDragOver, setLocalVideoDragOver] = useState(false);

  const selectedShotMaterial = useMemo(() => {
    if (!selectedShot) return undefined;
    return materialState?.shots.find(item =>
      selectedShot.stableShotId
        ? item.stableShotId === selectedShot.stableShotId
        : item.shotNo === selectedShot.shotNo
    );
  }, [materialState, selectedShot]);

  // 有图片或有视频的镜头列表（排除当前选中镜头），用于参考镜头下拉
  const referenceOptions = useMemo(() => {
    return shots.filter(s => {
      if (s.shotNo === selectedShotNo) return false;
      const ms = materialState?.shots.find(item =>
        s.stableShotId
          ? item.stableShotId === s.stableShotId
          : item.shotNo === s.shotNo
      );
      return Boolean(
        ms?.currentImage?.imageUrl ||
          s.imageUrl ||
          ms?.currentVideo?.videoUrl ||
          ms?.videoTakes.some(
            take => take.status === "available" && take.videoUrl
          ) ||
          s.videoTakes?.some(
            take => take.status === "available" && take.videoUrl
          )
      );
    });
  }, [shots, selectedShotNo, materialState]);

  // 解析参考镜头的图片 URL（仅对有图的镜头返回）
  const referenceImageUrl = useMemo(() => {
    if (referenceShotNo == null) return undefined;
    const refShot = shots.find(s => s.shotNo === referenceShotNo);
    if (!refShot) return undefined;
    const material = materialState?.shots.find(ms =>
      refShot.stableShotId
        ? ms.stableShotId === refShot.stableShotId
        : ms.shotNo === referenceShotNo
    );
    return material?.currentImage?.imageUrl || refShot.imageUrl || undefined;
  }, [referenceShotNo, shots, materialState]);

  // 获取参考镜头的视频 URL（仅对有视频的镜头返回）
  const referenceVideoUrl = useMemo(() => {
    if (referenceShotNo == null) return undefined;
    const refShot = shots.find(s => s.shotNo === referenceShotNo);
    if (!refShot) return undefined;
    const material = materialState?.shots.find(ms =>
      refShot.stableShotId
        ? ms.stableShotId === refShot.stableShotId
        : ms.shotNo === referenceShotNo
    );
    return (
      material?.currentVideo?.videoUrl ||
      material?.videoTakes.find(
        take => take.status === "available" && take.videoUrl
      )?.videoUrl ||
      refShot.selectedVideoTake?.videoUrl ||
      refShot.videoTakes?.find(
        take => take.status === "available" && take.videoUrl
      )?.videoUrl ||
      undefined
    );
  }, [referenceShotNo, shots, materialState]);

  const currentShotVideoUrl = useMemo(() => {
    if (!selectedShot) return undefined;
    return (
      selectedShotMaterial?.currentVideo?.videoUrl ||
      selectedShotMaterial?.videoTakes.find(
        take => take.status === "available" && take.videoUrl
      )?.videoUrl ||
      selectedShot.selectedVideoTake?.videoUrl ||
      selectedShot.videoTakes?.find(
        take => take.status === "available" && take.videoUrl
      )?.videoUrl ||
      undefined
    );
  }, [selectedShot, selectedShotMaterial]);

  useEffect(() => {
    setInspectedCandidate(null);
    setCandidateCompareOpen(false);
    setEditScope("shot");
    setReferenceShotNo(null);
    setLocalVideoRef(null);
  }, [selectedShot?.stableShotId, selectedShot?.shotNo]);

  useEffect(() => {
    if (
      selectedShot?.shotNo == null ||
      !rerenderingShotNos.includes(selectedShot.shotNo)
    ) {
      return;
    }
    setInspectedCandidate(null);
    setCandidateCompareOpen(false);
  }, [rerenderingShotNos, selectedShot?.shotNo]);

  const latestMaterialCandidate = useMemo(() => {
    return latestFrameCandidateSheet(
      selectedShotMaterial?.imageVersions ?? [],
      selectedShot?.promptRun?.imageId
    );
  }, [selectedShot?.promptRun?.imageId, selectedShotMaterial]);

  const frameCandidate =
    inspectedCandidate ?? latestMaterialCandidate ?? undefined;

  const historyQuery = trpc.promptLineage.listRevisionHistory.useQuery(
    {
      storyId: activeStoryId ?? 0,
      nodeId: historyRow?.nodeId ?? 0,
      limit: 8,
    },
    {
      enabled:
        promptLineageMode === "lineage" &&
        activeStoryId != null &&
        historyRow != null,
      refetchOnWindowFocus: false,
    }
  );

  const lineageView = useMemo(() => {
    if (
      promptLineageMode !== "lineage" ||
      !promptProjection ||
      !selectedShot?.stableShotId ||
      selectedShot.shotNo == null
    ) {
      return null;
    }
    return buildPromptLineageShotView({
      aggregate: promptProjection,
      stableShotId: selectedShot.stableShotId,
      shotNo: selectedShot.shotNo,
    });
  }, [promptLineageMode, promptProjection, selectedShot]);

  const latestConfirmedRevision = useMemo(() => {
    if (!lineageView) return null;
    return (
      [...lineageView.rows].sort(
        (left, right) => right.revisionId - left.revisionId
      )[0] ?? null
    );
  }, [lineageView]);

  const invalidatePromptViews = useCallback(async () => {
    if (activeStoryId == null) return;
    await Promise.all([
      utils.promptLineage.getStoryProjection.invalidate({
        storyId: activeStoryId,
      }),
      utils.storyAgent.storyMaterialState.invalidate({
        storyId: activeStoryId,
      }),
      utils.storyAgent.storyImages.invalidate({ storyId: activeStoryId }),
      utils.storyAgent.storyVideoAssets.invalidate({ storyId: activeStoryId }),
      utils.storyAgent.storyGet.invalidate({ id: activeStoryId }),
    ]);
    refetch();
  }, [activeStoryId, refetch, utils]);

  const openLineageCandidatePreview = useCallback(
    async (row: PromptLineageRowView, override: PromptOverride) => {
      if (activeStoryId == null || !promptProjection) {
        throw new Error("提示词数据库尚未加载完成");
      }
      const nextValue = override.value?.trim() ?? row.value.trim();
      const nextWeight =
        typeof override.weight === "number" && Number.isFinite(override.weight)
          ? override.weight
          : row.weight;
      if (!nextValue) {
        throw new Error("提示词内容不能为空");
      }
      if (nextValue === row.value.trim() && nextWeight === row.weight) {
        throw new Error("没有检测到新的提示词改动。");
      }
      const candidateNodeId = resolvePromptCandidateNodeId({
        aggregate: promptProjection,
        row,
        targetScope: editScope,
      });
      if (candidateNodeId == null) {
        throw new Error(`${row.label} 没有可以修改的共享来源。`);
      }
      const created = await createCandidateMut.mutateAsync({
        storyId: activeStoryId,
        nodeId: candidateNodeId,
        targetStableShotId:
          editScope === "shot" ? (selectedShot?.stableShotId ?? null) : null,
        content: nextValue,
        weight: nextWeight,
        reason: `creation-editor:${row.dimension}`,
        expectedVersion: promptProjection.state.version,
      });
      if (!created.projection) {
        throw new Error("候选预览返回为空");
      }
      setDialogState({
        kind: "candidate",
        targetScope: editScope,
        row,
        nextValue,
        nextWeight,
        expectedVersion: created.version,
        candidateRevisionId: created.candidate.id,
        preview: buildPromptLineageRevisionPreview({
          aggregate: created.projection,
          nodeId: created.candidate.nodeId,
          revisionId: created.candidate.id,
        }),
      });
    },
    [
      activeStoryId,
      createCandidateMut,
      editScope,
      promptProjection,
      selectedShot?.stableShotId,
    ]
  );

  const previewOverride = useCallback(
    async (shotNo: number, dimension: string, override: PromptOverride) => {
      setPanelError(null);
      setDialogError(null);
      if (promptLineageMode !== "lineage" || !lineageView) {
        await updatePromptOverride(shotNo, dimension, override);
        return;
      }
      const row = lineageView.rows.find(item => item.dimension === dimension);
      if (!row) throw new Error(`找不到维度 ${dimension}`);
      await openLineageCandidatePreview(row, override);
    },
    [
      lineageView,
      openLineageCandidatePreview,
      promptLineageMode,
      updatePromptOverride,
    ]
  );

  const previewDatabaseOverride = useCallback(
    async (row: PromptLineageRowView, override: PromptOverride) => {
      setPanelError(null);
      setDialogError(null);
      await openLineageCandidatePreview(row, override);
    },
    [openLineageCandidatePreview]
  );

  const previewRestoreRevision = useCallback(
    async (row: PromptLineageRowView, revision: PromptRevision) => {
      if (!promptProjection) {
        throw new Error("提示词数据库尚未加载完成");
      }
      setDialogError(null);
      setDialogState({
        kind: "restore",
        row,
        revision,
        expectedVersion: promptProjection.state.version,
        preview: buildPromptLineageRevisionPreview({
          aggregate: promptProjection,
          nodeId: row.nodeId,
          revisionId: revision.id,
        }),
      });
    },
    [promptProjection]
  );

  const closeDialog = useCallback(async () => {
    if (!dialogState) return;
    setDialogError(null);
    if (dialogState.kind !== "candidate") {
      setDialogState(null);
      return;
    }
    setDialogPending(true);
    try {
      await rejectCandidateMut.mutateAsync({
        storyId: activeStoryId ?? 0,
        candidateRevisionId: dialogState.candidateRevisionId,
        expectedVersion: dialogState.expectedVersion,
      });
      await invalidatePromptViews();
      setDialogState(null);
    } catch (error) {
      setDialogError(messageOf(error, "候选已创建，但撤销失败"));
    } finally {
      setDialogPending(false);
    }
  }, [activeStoryId, dialogState, invalidatePromptViews, rejectCandidateMut]);

  const confirmDialog = useCallback(async () => {
    if (!dialogState || activeStoryId == null) return;
    setDialogPending(true);
    setDialogError(null);
    try {
      let projection = null;
      if (dialogState.kind === "candidate") {
        const result = await confirmCandidateMut.mutateAsync({
          storyId: activeStoryId,
          candidateRevisionId: dialogState.candidateRevisionId,
          expectedVersion: dialogState.expectedVersion,
        });
        projection = result.projection;
      } else {
        const result = await restoreRevisionMut.mutateAsync({
          storyId: activeStoryId,
          revisionId: dialogState.revision.id,
          expectedVersion: dialogState.expectedVersion,
        });
        projection = result.projection;
      }
      if (projection) {
        utils.promptLineage.getStoryProjection.setData(
          { storyId: activeStoryId },
          { mode: "lineage", projection }
        );
      }
      await invalidatePromptViews();
      setDialogState(null);
      setHistoryRow(null);
    } catch (error) {
      setDialogError(messageOf(error, "提示词确认失败"));
    } finally {
      setDialogPending(false);
    }
  }, [
    activeStoryId,
    confirmCandidateMut,
    dialogState,
    invalidatePromptViews,
    restoreRevisionMut,
    utils,
  ]);

  const resolveReferenceForRerender = useCallback(async () => {
    const captureVideoReference = async (
      videoUrl: string,
      fallback?: RerenderReference
    ): Promise<RerenderReference | undefined> => {
      setExtractingFrame(true);
      try {
        const captured = await captureReferenceFrameFromVideoUrl(videoUrl);
        return {
          imageUrl: captured.frameUrl,
          identityImageUrl: captured.identityCropUrl,
        };
      } catch (error) {
        console.warn(
          "[PromptTablePanel] reference frame extraction failed",
          error
        );
        setPanelError(
          `${messageOf(error, "参考视频取帧失败")}；已改用当前提示词继续重渲。`
        );
        return fallback;
      } finally {
        setExtractingFrame(false);
      }
    };

    // 优先级：本地拖入的视频 > 手动选择的参考镜头 > 本镜现成视频
    if (localVideoRef) {
      setExtractingFrame(true);
      try {
        const captured = await captureReferenceFrameFromFile(
          localVideoRef.file
        );
        return {
          imageUrl: captured.frameUrl,
          identityImageUrl: captured.identityCropUrl,
        };
      } catch (error) {
        console.warn(
          "[PromptTablePanel] local reference frame extraction failed",
          error
        );
        setPanelError(
          `${messageOf(error, "本地参考视频取帧失败")}；已改用当前提示词继续重渲。`
        );
        return undefined;
      } finally {
        setExtractingFrame(false);
      }
    }
    if (referenceVideoUrl) {
      return captureVideoReference(referenceVideoUrl, {
        imageUrl: referenceImageUrl,
      });
    }
    if (referenceImageUrl) return { imageUrl: referenceImageUrl };
    if (currentShotVideoUrl) {
      return captureVideoReference(currentShotVideoUrl);
    }
    return undefined;
  }, [
    currentShotVideoUrl,
    localVideoRef,
    referenceImageUrl,
    referenceVideoUrl,
  ]);

  const rerenderConfirmedLineageShot = useCallback(async () => {
    if (!selectedShotNo || !lineageView) return;
    setPanelError(null);
    const reference = await resolveReferenceForRerender();
    await rerenderShot(selectedShotNo, lineageView.rows, reference);
  }, [lineageView, rerenderShot, resolveReferenceForRerender, selectedShotNo]);

  return (
    <aside
      className="creation-board-panel flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="镜头设计表"
      data-testid="analysis-prompt-table-panel"
    >
      <div className="creation-board-panel-header shrink-0 justify-between">
        <div className="creation-board-panel-title">
          <ListFilter className="creation-board-panel-icon" />
          <h2 className="creation-board-panel-title-text">镜头设计表</h2>
        </div>
        <span className="creation-board-panel-status">
          {shotLabel(selectedShot)}
        </span>
      </div>

      {/* 参考视频区域：固定在 header 和滚动内容之间 */}
      {selectedShot ? (
        <div className="shrink-0 border-b border-border/70 px-4 pb-3 pt-2">
          {!localVideoRef ? (
            <div
              className={`flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs transition-colors ${
                localVideoDragOver
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
              onDragOver={e => {
                e.preventDefault();
                setLocalVideoDragOver(true);
              }}
              onDragLeave={() => setLocalVideoDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setLocalVideoDragOver(false);
                const file = Array.from(e.dataTransfer.files).find(f =>
                  f.type.startsWith("video/")
                );
                if (file) {
                  setLocalVideoRef({
                    file,
                    preview: URL.createObjectURL(file),
                  });
                  setReferenceShotNo(null);
                }
              }}
            >
              <span>拖入本地视频作为参考，让出图和视频风格一致</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
              <span className="truncate text-muted-foreground">
                参考视频：{localVideoRef.file.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(localVideoRef.preview);
                  setLocalVideoRef(null);
                }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          )}
          {referenceOptions.length > 0 || currentShotVideoUrl ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">或选已有镜头：</span>
              <select
                value={referenceShotNo ?? ""}
                onChange={e => {
                  const val = e.target.value;
                  setReferenceShotNo(val === "" ? null : Number(val));
                }}
                disabled={extractingFrame}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="">
                  {currentShotVideoUrl ? "本镜视频（默认）" : "不使用"}
                </option>
                {referenceOptions.map(s => {
                  const ms = materialState?.shots.find(item =>
                    s.stableShotId
                      ? item.stableShotId === s.stableShotId
                      : item.shotNo === s.shotNo
                  );
                  const hasImage = Boolean(
                    ms?.currentImage?.imageUrl || s.imageUrl
                  );
                  const hasVideo = Boolean(
                    ms?.currentVideo?.videoUrl ||
                      ms?.videoTakes.some(
                        take => take.status === "available" && take.videoUrl
                      ) ||
                      s.selectedVideoTake?.videoUrl ||
                      s.videoTakes?.some(
                        take => take.status === "available" && take.videoUrl
                      )
                  );
                  const tag = hasVideo ? " 🎬" : hasImage ? " 🖼️" : "";
                  return (
                    <option key={s.shotNo} value={s.shotNo}>
                      {shotLabel(s)}
                      {tag}
                    </option>
                  );
                })}
              </select>
              {extractingFrame ? (
                <span className="text-muted-foreground">正在从视频取帧…</span>
              ) : referenceShotNo != null ? (
                <span className="text-muted-foreground">
                  → FLUX Kontext 保持角色一致
                </span>
              ) : currentShotVideoUrl ? (
                <span className="text-muted-foreground">
                  → 默认跟随本镜视频
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]"
        data-testid="prompt-table-scroll-viewport"
      >
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message || "加载镜头设计表失败"}
          </div>
        ) : null}
        {panelError ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {panelError}
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载镜头设计表…
          </div>
        ) : shots.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            生成故事版后，镜头设计表会出现在这里。
          </div>
        ) : (
          <>
            {promptLineageMode === "lineage" && promptProjection ? (
              <PromptRevisionStatus
                row={latestConfirmedRevision}
                storyVersion={promptProjection.state.version}
                historyOpen={
                  historyRow?.nodeId === latestConfirmedRevision?.nodeId
                }
                historyItems={historyQuery.data?.items ?? []}
                historyLoading={
                  historyQuery.isLoading || historyQuery.isFetching
                }
                historyError={historyQuery.error?.message ?? null}
                onOpenHistory={() => {
                  if (!latestConfirmedRevision) return;
                  setHistoryRow(current =>
                    current?.nodeId === latestConfirmedRevision.nodeId
                      ? null
                      : latestConfirmedRevision
                  );
                }}
                onRestoreRevision={revision => {
                  if (!latestConfirmedRevision) return;
                  void previewRestoreRevision(
                    latestConfirmedRevision,
                    revision
                  ).catch(error => {
                    setPanelError(messageOf(error, "历史版本预览失败"));
                  });
                }}
              />
            ) : null}
            {selectedShot ? (
              <ShotFrameCandidatePicker
                shot={selectedShot}
                candidate={frameCandidate}
                compareOpen={candidateCompareOpen}
                onCompareOpenChange={setCandidateCompareOpen}
                disabled={
                  isSaving ||
                  rerenderingShotNos.includes(selectedShot.shotNo)
                }
                onPromote={promoteFrameCrop}
              />
            ) : null}
            <ShotImageHistory
              inspectedCandidateId={frameCandidate?.imageId}
              onInspectCandidate={candidate => {
                setInspectedCandidate(candidate);
                setCandidateCompareOpen(true);
              }}
            />

            <div className="mb-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {promptLineageMode === "lineage"
                ? "当前镜头已切到统一提示词数据库。先预览并确认修订，再单独重渲图片。"
                : "当前还是兼容模式。首次确认修订后，这个镜头会切到统一提示词数据库。"}
            </div>
            {promptLineageMode === "lineage" && selectedShot ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
                <span className="text-xs font-medium text-foreground">
                  修改范围
                </span>
                <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
                  <button
                    type="button"
                    aria-pressed={editScope === "shot"}
                    onClick={() => setEditScope("shot")}
                    className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors ${
                      editScope === "shot"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Focus className="h-3.5 w-3.5" />仅{" "}
                    {shotLabel(selectedShot)}
                  </button>
                  <button
                    type="button"
                    aria-pressed={editScope === "source"}
                    onClick={() => setEditScope("source")}
                    className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors ${
                      editScope === "source"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    共享范围
                  </button>
                </div>
              </div>
            ) : null}

            <Tabs
              value={viewMode}
              onValueChange={value =>
                setViewMode(value as "cards" | "database")
              }
              className="min-h-0 flex-1"
            >
              <TabsList className="mb-3 grid w-full grid-cols-2">
                <TabsTrigger value="cards">
                  <LayoutGrid className="h-4 w-4" />
                  配方卡片
                </TabsTrigger>
                <TabsTrigger value="database">
                  <Database className="h-4 w-4" />
                  数据库视图
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cards" className="min-h-0">
                <PromptTable
                  shot={selectedShot}
                  shots={shots}
                  rows={lineageView?.rows}
                  disabled={isSaving}
                  rerendering={
                    selectedShotNo != null &&
                    selectedShotNo != null &&
                    rerenderingShotNos.includes(selectedShotNo)
                  }
                  applyLabel={
                    promptLineageMode === "lineage" ? "预览影响" : "应用"
                  }
                  rerenderStrategy={
                    promptLineageMode === "lineage"
                      ? "confirmed-only"
                      : "apply-first"
                  }
                  error={rerenderError}
                  onOverrideChange={async (shotNo, dimension, override) => {
                    try {
                      await previewOverride(shotNo, dimension, override);
                    } catch (error) {
                      setPanelError(messageOf(error, "提示词预览失败"));
                    }
                  }}
                  onRerenderShot={async (shotNo, rows) => {
                    try {
                      setPanelError(null);
                      const reference = await resolveReferenceForRerender();
                      await rerenderShot(
                        shotNo,
                        promptLineageMode === "lineage" && lineageView
                          ? lineageView.rows
                          : rows,
                        reference
                      );
                    } catch (error) {
                      setPanelError(messageOf(error, "图片生成失败"));
                    }
                  }}
                />
              </TabsContent>

              <TabsContent value="database" className="min-h-0">
                {promptLineageMode === "lineage" && lineageView ? (
                  <PromptDatabaseView
                    rows={lineageView.rows}
                    disabled={isSaving}
                    rerendering={
                      selectedShotNo != null &&
                      selectedShotNo != null &&
                      rerenderingShotNos.includes(selectedShotNo)
                    }
                    historyNodeId={historyRow?.nodeId ?? null}
                    historyItems={historyQuery.data?.items ?? []}
                    historyLoading={
                      historyQuery.isLoading || historyQuery.isFetching
                    }
                    historyError={historyQuery.error?.message ?? null}
                    onOpenHistory={row => {
                      setPanelError(null);
                      setHistoryRow(current =>
                        current?.nodeId === row.nodeId ? null : row
                      );
                    }}
                    onPreviewChange={async (row, override) => {
                      try {
                        await previewDatabaseOverride(row, override);
                      } catch (error) {
                        setPanelError(messageOf(error, "提示词预览失败"));
                      }
                    }}
                    onRerender={async () => {
                      try {
                        await rerenderConfirmedLineageShot();
                      } catch (error) {
                        setPanelError(messageOf(error, "图片生成失败"));
                      }
                    }}
                    onRestoreRevision={async (row, revision) => {
                      try {
                        await previewRestoreRevision(row, revision);
                      } catch (error) {
                        setPanelError(messageOf(error, "历史版本预览失败"));
                      }
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-md border border-border/70 bg-muted/20 px-4 text-sm text-muted-foreground">
                    这个镜头还在兼容模式。先在左侧配方卡片里确认一次修订，再回来查看数据库视图。
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <PromptRevisionDialog
        open={Boolean(dialogState)}
        state={dialogState}
        materialState={materialState}
        pending={dialogPending}
        error={dialogError}
        onOpenChange={open => {
          if (open) return;
          void closeDialog();
        }}
        onConfirm={() => {
          void confirmDialog();
        }}
      />
    </aside>
  );
}
