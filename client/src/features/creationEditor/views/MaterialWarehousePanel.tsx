import {
  Archive,
  Ban,
  Check,
  Image as ImageIcon,
  Loader2,
  Link2,
  RotateCcw,
  Upload,
  Video,
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import type { ImageAsset } from "@shared/imageAsset";
import type { SelectionContext } from "@shared/selectionContext";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { VideoTakeAsset } from "@shared/videoAsset";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { useCreationEditor } from "../CreationEditorContext";

type WarehouseImage = Pick<
  ImageAsset,
  "id" | "imageUrl" | "shotIdentity" | "prompt" | "storyId"
>;
type WarehouseImageItem = {
  image: WarehouseImage;
  shotNo: number | null;
  stableShotId: string | null;
  isCurrent: boolean;
};
type WarehouseVideoItem = {
  take: VideoTakeAsset;
  shotNo: number | null;
  stableShotId: string | null;
  isCurrent: boolean;
  isUnmatched: boolean;
  isReusable: boolean;
};
type SelectedMaterialKey = `image:${number}` | `video:${number}`;

export function videoWarehouseActionState(input: {
  item: WarehouseVideoItem;
  activeStoryId: number | null | undefined;
  currentStableShotId: string | null | undefined;
  playable: boolean;
  busy?: boolean;
}) {
  if (input.item.isCurrent) {
    return {
      disabled: true,
      icon: "check" as const,
      label: "已采用",
    };
  }
  const sameCurrentStoryShot =
    input.item.take.storyId === input.activeStoryId &&
    input.item.take.stableShotId === input.currentStableShotId;
  return {
    disabled:
      Boolean(input.busy) || !input.playable || !input.currentStableShotId,
    icon: sameCurrentStoryShot ? ("check" as const) : ("reuse" as const),
    label: sameCurrentStoryShot ? "采用" : "复用",
  };
}

export function buildMaterialWarehouseVideoItems(
  materialState: StoryMaterialState | null | undefined
): WarehouseVideoItem[] {
  const rows: WarehouseVideoItem[] = [];
  for (const shot of materialState?.shots ?? []) {
    for (const take of shot.videoTakes) {
      rows.push({
        take,
        shotNo: shot.shotNo,
        stableShotId: shot.stableShotId,
        isCurrent: shot.currentVideo?.id === take.id,
        isUnmatched: false,
        isReusable: false,
      });
    }
  }
  for (const take of materialState?.unassignedVideoTakes ?? []) {
    rows.push({
      take,
      shotNo: null,
      stableShotId: take.stableShotId,
      isCurrent: false,
      isUnmatched: true,
      isReusable: false,
    });
  }
  for (const take of materialState?.reusableVideoTakes ?? []) {
    rows.push({
      take,
      shotNo: null,
      stableShotId: take.stableShotId,
      isCurrent: false,
      isUnmatched: false,
      isReusable: true,
    });
  }
  const seen = new Set<number>();
  return rows.filter(item => {
    if (seen.has(item.take.id)) return false;
    seen.add(item.take.id);
    return true;
  }).sort((left, right) => {
    const currentDiff = Number(right.isCurrent) - Number(left.isCurrent);
    if (currentDiff) return currentDiff;
    const selectedDiff =
      Number(right.take.isTimelineSelected) -
      Number(left.take.isTimelineSelected);
    if (selectedDiff) return selectedDiff;
    return (
      Date.parse(right.take.createdAt) - Date.parse(left.take.createdAt) ||
      right.take.id - left.take.id
    );
  });
}

function shotLabel(shotNo: number | null | undefined) {
  return shotNo == null ? "未选镜头" : `SH${String(shotNo).padStart(2, "0")}`;
}

function videoSourceLabel(item: WarehouseVideoItem) {
  if (item.shotNo != null) return shotLabel(item.shotNo);
  if (item.isReusable) return `素材 #${item.take.storyId}`;
  return item.stableShotId ? `旧镜头 ${item.stableShotId}` : "未绑定";
}

function fileMime(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? (value.split(",").pop() ?? "") : value);
    };
    reader.readAsDataURL(file);
  });
}

function imageMatchesShot(image: WarehouseImage, stableShotId: string | null) {
  return Boolean(stableShotId && image.shotIdentity === stableShotId);
}

function runOnSelectKey(
  event: KeyboardEvent,
  action: () => void
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function plannedDurationSec(
  shot: { durationMs?: number; durationSec?: number } | null,
  plannedDurationMs: number | null | undefined
) {
  const ms =
    typeof plannedDurationMs === "number" && Number.isFinite(plannedDurationMs)
      ? plannedDurationMs
      : typeof shot?.durationMs === "number" && Number.isFinite(shot.durationMs)
        ? shot.durationMs
        : null;
  if (ms != null) return Math.max(0.1, ms / 1000);
  return typeof shot?.durationSec === "number" &&
    Number.isFinite(shot.durationSec)
    ? Math.max(0.1, shot.durationSec)
    : 3;
}

export default function MaterialWarehousePanel() {
  const { setActiveSelection } = useStoryAgentActions();
  const {
    activeStoryId,
    shots,
    selectedShot,
    selectedShotNo,
    setSelectedShotNo,
    materialState,
    isLoading,
    error,
    assignStoryImageToShot,
    importStoryMaterial,
    promoteStoryImage,
    adoptVideoTake,
    reuseVideoTake,
    markVideoTakeUnusable,
  } = useCreationEditor();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [selectedMaterialKey, setSelectedMaterialKey] =
    useState<SelectedMaterialKey | null>(null);

  const currentShot = selectedShot ?? shots[0] ?? null;
  const currentStableShotId =
    currentShot?.stableShotId ?? currentShot?.shotIdentity ?? null;
  const currentMaterial = useMemo(() => {
    if (!currentShot) return null;
    return (
      materialState?.shots.find(item =>
        currentStableShotId
          ? item.stableShotId === currentStableShotId
          : item.shotNo === currentShot.shotNo
      ) ?? null
    );
  }, [currentShot, currentStableShotId, materialState]);

  const imageItems = useMemo(() => {
    const rows: WarehouseImageItem[] = [];
    for (const image of materialState?.unassignedImages ?? []) {
      rows.push({
        image,
        shotNo: null,
        stableShotId: null,
        isCurrent: false,
      });
    }
    for (const shot of materialState?.shots ?? []) {
      for (const image of shot.imageVersions) {
        rows.push({
          image,
          shotNo: shot.shotNo,
          stableShotId: shot.stableShotId,
          isCurrent: shot.currentImage?.id === image.id,
        });
      }
    }
    for (const shot of shots) {
      if (shot.imageId == null || !shot.imageUrl) continue;
      rows.push({
        image: {
          id: shot.imageId,
          imageUrl: shot.imageUrl,
          shotIdentity: shot.stableShotId ?? shot.shotIdentity ?? null,
          prompt: shot.imagePrompt ?? null,
          storyId: activeStoryId,
        },
        shotNo: shot.shotNo,
        stableShotId: shot.stableShotId ?? shot.shotIdentity ?? null,
        isCurrent: true,
      });
    }
    const seen = new Set<number>();
    return rows.filter(row => {
      if (seen.has(row.image.id)) return false;
      seen.add(row.image.id);
      return true;
    });
  }, [activeStoryId, materialState, shots]);

  const videoItems = useMemo(
    () => buildMaterialWarehouseVideoItems(materialState),
    [materialState]
  );

  const unavailableTakeCount = videoItems.filter(
    item => item.take.status === "unfollowable"
  ).length;
  const selectedDurationSec = plannedDurationSec(
    currentShot,
    currentMaterial?.timelineItem?.plannedDurationMs
  );

  const selectImageMaterial = (item: WarehouseImageItem) => {
    const key: SelectedMaterialKey = `image:${item.image.id}`;
    setSelectedMaterialKey(key);
    const label = item.shotNo ? shotLabel(item.shotNo) : "未绑定";
    const text = `${label} 图片 #${item.image.id}`;
    setActiveSelection({
      sourceType: "storyboard-image",
      sourceId: String(item.image.id),
      selectedText: text,
      fullText: item.image.prompt || text,
      storyId: activeStoryId,
      stableShotId: item.stableShotId,
      shotNo: item.shotNo,
      imageId: item.image.id,
      objectVersion: `image:${item.image.id}`,
      materialStatus: item.isCurrent ? "current-image" : "candidate-image",
    });
  };

  const selectVideoMaterial = (item: WarehouseVideoItem) => {
    const key: SelectedMaterialKey = `video:${item.take.id}`;
    setSelectedMaterialKey(key);
    const text = `${videoSourceLabel(item)} · Take ${item.take.id}`;
    const status: SelectionContext["materialStatus"] = item.isCurrent
      ? "current-video"
      : item.take.status === "failed" || item.take.status === "timeout"
        ? "failed-video"
        : item.isUnmatched || item.isReusable
          ? "unadopted-video"
          : "timeline-material";
    setActiveSelection({
      sourceType: "animatic-video",
      sourceId: String(item.take.id),
      selectedText: text,
      fullText: item.take.prompt || text,
      storyId: activeStoryId,
      stableShotId: item.stableShotId,
      shotNo: item.shotNo,
      videoTakeId: item.take.id,
      objectVersion: `video:${item.take.id}`,
      materialStatus: status,
    });
  };

  const importFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(file =>
      /^(image|video)\//.test(fileMime(file))
    );
    if (list.length === 0) return;
    if (activeStoryId == null) {
      toast.error("请先打开一个故事");
      return;
    }
    setImporting(true);
    setPanelError(null);
    try {
      let imageCount = 0;
      let videoCount = 0;
      for (const file of list) {
        const mimeType = fileMime(file);
        const result = await importStoryMaterial({
          fileName: file.name,
          mimeType,
          fileBase64: await readFileBase64(file),
          targetStableShotId: currentStableShotId,
        });
        if (result.kind === "image") imageCount += 1;
        if (result.kind === "video") videoCount += 1;
      }
      const parts = [
        imageCount > 0 ? `${imageCount} 张图片` : null,
        videoCount > 0 ? `${videoCount} 条视频` : null,
      ].filter(Boolean);
      toast.success(`已导入 ${parts.join("、")}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "素材导入失败";
      setPanelError(message);
      toast.error(message);
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const bindImage = async (image: WarehouseImage) => {
    if (!currentStableShotId) {
      toast.error("请先选择一个镜头");
      return;
    }
    setBusyKey(`image:${image.id}`);
    setPanelError(null);
    try {
      if (imageMatchesShot(image, currentStableShotId)) {
        await promoteStoryImage(image.id);
        toast.success(`已设为 ${shotLabel(currentShot?.shotNo)} 当前首帧`);
      } else {
        await assignStoryImageToShot({
          imageId: image.id,
          targetStableShotId: currentStableShotId,
        });
        toast.success(`已绑定到 ${shotLabel(currentShot?.shotNo)}`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "图片绑定失败";
      setPanelError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const useVideo = async (take: VideoTakeAsset) => {
    if (!currentStableShotId) {
      toast.error("请先选择一个镜头");
      return;
    }
    setBusyKey(`video:${take.id}`);
    setPanelError(null);
    try {
      if (
        take.storyId === activeStoryId &&
        take.stableShotId === currentStableShotId
      ) {
        await adoptVideoTake({
          stableShotId: currentStableShotId,
          takeId: take.id,
          plannedDurationSec: selectedDurationSec,
        });
        toast.success(`已采用到 ${shotLabel(currentShot?.shotNo)}`);
      } else {
        await reuseVideoTake({
          sourceTakeId: take.id,
          targetStableShotId: currentStableShotId,
          plannedDurationSec: selectedDurationSec,
        });
        toast.success(`已复用到 ${shotLabel(currentShot?.shotNo)}`);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "视频采用失败";
      setPanelError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const markUnusable = async (take: VideoTakeAsset) => {
    setBusyKey(`video:${take.id}:unusable`);
    setPanelError(null);
    try {
      await markVideoTakeUnusable(take.id, take.storyId);
      toast.success(`Take ${take.id} 已标记不可用`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "标记失败";
      setPanelError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section
      className="creation-board-panel flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="素材仓库"
      data-testid="analysis-material-warehouse-panel"
    >
      <div className="creation-board-panel-header justify-between">
        <div className="creation-board-panel-title">
          <Archive className="creation-board-panel-icon" />
          <h2 className="creation-board-panel-title-text">素材仓库</h2>
        </div>
        <span className="creation-board-panel-status">
          {shotLabel(currentShot?.shotNo ?? selectedShotNo)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/20 p-3">
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
            <div>
              <div className="text-base font-semibold text-foreground">
                {imageItems.length}
              </div>
              图片
            </div>
            <div>
              <div className="text-base font-semibold text-foreground">
                {videoItems.length}
              </div>
              视频
            </div>
            <div>
              <div className="text-base font-semibold text-foreground">
                {unavailableTakeCount}
              </div>
              不可用
            </div>
          </div>

          <div className="space-y-2">
            {shots.map(shot => {
              const stableShotId =
                shot.stableShotId ?? shot.shotIdentity ?? null;
              const material = materialState?.shots.find(item =>
                stableShotId
                  ? item.stableShotId === stableShotId
                  : item.shotNo === shot.shotNo
              );
              const selected =
                currentShot?.shotNo === shot.shotNo ||
                selectedShotNo === shot.shotNo;
              return (
                <button
                  key={stableShotId ?? shot.shotNo}
                  type="button"
                  onClick={() => setSelectedShotNo(shot.shotNo)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    selected
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {shotLabel(shot.shotNo)}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {material?.currentImage ? (
                        <ImageIcon className="h-3 w-3" />
                      ) : null}
                      {material?.currentVideo ? (
                        <Video className="h-3 w-3" />
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {shot.dialogue || shot.action || "空镜头"}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={`m-4 rounded-md border border-dashed px-4 py-3 transition ${
              dragOver
                ? "border-primary bg-primary/10"
                : "border-border bg-background"
            }`}
            onDragOver={event => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => {
              event.preventDefault();
              setDragOver(false);
              void importFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  导入图片 / 视频
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  当前目标：{shotLabel(currentShot?.shotNo)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={importing}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                导入
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mov,.m4v"
                className="hidden"
                onChange={event => {
                  if (event.currentTarget.files) {
                    void importFiles(event.currentTarget.files);
                  }
                }}
              />
            </div>
          </div>

          {panelError || error ? (
            <div className="mx-4 mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {panelError ?? error?.message}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  图片
                </div>
                {isLoading && imageItems.length === 0 ? (
                  <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    正在读取素材
                  </div>
                ) : imageItems.length === 0 ? (
                  <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    暂无图片素材
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {imageItems.map(
                      item => {
                        const { image, shotNo, stableShotId, isCurrent } =
                          item;
                        const belongsToCurrent =
                          currentStableShotId != null &&
                          stableShotId === currentStableShotId;
                        const busy = busyKey === `image:${image.id}`;
                        const selected =
                          selectedMaterialKey === `image:${image.id}`;
                        return (
                          <article
                            key={image.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={selected}
                            onClick={() => selectImageMaterial(item)}
                            onKeyDown={event =>
                              runOnSelectKey(event, () =>
                                selectImageMaterial(item)
                              )
                            }
                            className={`cursor-pointer overflow-hidden rounded-md border bg-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                              selected
                                ? "border-primary/70 ring-2 ring-primary/20"
                                : "border-border hover:border-primary/50"
                            }`}
                          >
                            <div className="aspect-video bg-muted">
                              <img
                                src={image.imageUrl}
                                alt={
                                  shotNo
                                    ? `${shotLabel(shotNo)} 图片`
                                    : "未绑定图片"
                                }
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div className="space-y-2 p-3">
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>
                                  {shotNo ? shotLabel(shotNo) : "未绑定"}
                                </span>
                                {isCurrent ? (
                                  <span className="inline-flex items-center gap-1 text-primary">
                                    <Check className="h-3 w-3" />
                                    当前
                                  </span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  void bindImage(image);
                                }}
                                disabled={busy || !currentStableShotId}
                                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-border text-xs font-medium transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : belongsToCurrent ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Link2 className="h-3.5 w-3.5" />
                                )}
                                {belongsToCurrent
                                  ? "设为当前首帧"
                                  : "绑定到当前镜头"}
                              </button>
                            </div>
                          </article>
                        );
                      }
                    )}
                  </div>
                )}
              </section>

              <section className="min-w-0">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Video className="h-4 w-4 text-primary" />
                  视频 Take
                </div>
                {isLoading && videoItems.length === 0 ? (
                  <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    正在读取素材
                  </div>
                ) : videoItems.length === 0 ? (
                  <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    暂无视频素材
                  </div>
                ) : (
                  <div className="space-y-3">
                    {videoItems.map(item => {
                      const { take, isCurrent } = item;
                      const playable =
                        take.status === "available" && Boolean(take.videoUrl);
                      const busy = busyKey === `video:${take.id}`;
                      const unusableBusy =
                        busyKey === `video:${take.id}:unusable`;
                      const selected =
                        selectedMaterialKey === `video:${take.id}`;
                      const action = videoWarehouseActionState({
                        item,
                        activeStoryId,
                        currentStableShotId,
                        playable,
                        busy,
                      });
                      return (
                        <article
                          key={take.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          onClick={() => selectVideoMaterial(item)}
                          onKeyDown={event =>
                            runOnSelectKey(event, () =>
                              selectVideoMaterial(item)
                            )
                          }
                          className={`cursor-pointer overflow-hidden rounded-md border bg-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                            selected
                              ? "border-primary/70 ring-2 ring-primary/20"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          {take.videoUrl ? (
                            <video
                              src={take.videoUrl}
                              className="aspect-video w-full bg-black object-contain"
                              controls
                              preload="metadata"
                              onClick={() => selectVideoMaterial(item)}
                            />
                          ) : (
                            <div className="flex aspect-video items-center justify-center bg-muted text-sm text-muted-foreground">
                              {take.status}
                            </div>
                          )}
                          <div className="space-y-2 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>
                                {videoSourceLabel(item)} · Take {take.id}
                              </span>
                              <span className={isCurrent ? "text-primary" : ""}>
                                {isCurrent
                                  ? "当前"
                                  : item.isUnmatched
                                    ? `旧素材 · ${take.status}`
                                    : item.isReusable
                                      ? "可复用"
                                    : take.status}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  void useVideo(take);
                                }}
                                disabled={action.disabled}
                                className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-border text-xs font-medium transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : action.icon === "check" ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                )}
                                {action.label}
                              </button>
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  void markUnusable(take);
                                }}
                                disabled={
                                  unusableBusy || take.status === "unfollowable"
                                }
                                className="inline-flex h-8 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`标记 Take ${take.id} 不可用`}
                                title="标记不可用"
                              >
                                {unusableBusy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Ban className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
