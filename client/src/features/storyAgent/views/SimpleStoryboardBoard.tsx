import type { HTMLAttributes, MouseEvent } from "react";
import {
  ImagePlus,
  ListPlus,
  Loader2,
  PlusCircle,
  Trash2,
  Upload,
} from "lucide-react";

import {
  creationTimelineShotId,
} from "@/features/creationEditor/CreationEditorContext";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import {
  imageClipEditorTargetForShot,
  timelineTransformStyle,
  type ImageClipEditorTarget,
} from "@/features/creationEditor/imageClipEditorModel";
import {
  videoClipEditorTargetForTake,
  type VideoClipEditorTarget,
} from "@/features/creationEditor/videoClipEditorModel";
import { videoTakeFrameUrl } from "@/features/creationEditor/videoAssetViewModel";
import type { StoryShot } from "@/features/storyAgent/types";
import type { GeneratedImageItem } from "@/features/mobileChat/types";
import { displayShotCode } from "@shared/shotIdentity";

import { shortText, storyShotInsertIdentity } from "./storyboardReviewModel";
import {
  StoryboardVideoThumbnail,
  storyboardPreviewVideoTake,
} from "./StoryboardMediaPreview";
import { writeStoryboardImageDragPayload } from "../storyboardLocalMedia";
import { writeVideoTakeDragPayload } from "./videoTakeDrag";
import type { ShotPendingCandidate } from "../shotCandidateSummary";
import ShotCandidateBadge from "./ShotCandidateBadge";

export function AddShotButton({
  shotLabel,
  inserting,
  disabled,
  onClick,
  compact = false,
}: {
  shotLabel: string;
  inserting: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-sm bg-muted/45 text-[10px] font-medium text-muted-foreground transition hover:bg-[var(--nayin-glow)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35 disabled:cursor-wait disabled:opacity-70 ${
        compact ? "h-7 w-7" : "mt-2 w-full gap-1.5 px-3 py-2"
      }`}
      aria-label={`在 ${shotLabel} 后添加镜头`}
      title={`在 ${shotLabel} 后添加镜头`}
    >
      {inserting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <PlusCircle className="h-3.5 w-3.5" />
      )}
      {compact ? null : "添加镜头"}
    </button>
  );
}

export function DeleteShotButton({
  shotLabel,
  deleting,
  disabled,
  onClick,
  compact = false,
}: {
  shotLabel: string;
  deleting: boolean;
  disabled: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}) {
  const label = `删除 ${shotLabel}`;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-muted/45 text-[10px] font-medium text-muted-foreground transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-wait disabled:opacity-70 ${
        compact ? "h-7 w-7" : "mt-2 min-h-[34px] gap-1.5 px-3 py-2"
      }`}
      aria-label={label}
      title={label}
    >
      {deleting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {compact ? null : "删除"}
    </button>
  );
}

export function StoryboardMediaDropOverlay({
  shotLabel,
  importing,
  moving = false,
}: {
  shotLabel: string;
  importing: boolean;
  moving?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center gap-1.5 rounded-sm border bg-background/95 px-2 text-[9px] font-semibold text-foreground shadow-sm"
      style={{ borderColor: "var(--nayin-accent)" }}
      aria-live="polite"
    >
      {importing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-nayin-bright" />
      ) : moving ? (
        <ImagePlus className="h-3.5 w-3.5 text-nayin-bright" />
      ) : (
        <Upload className="h-3.5 w-3.5 text-nayin-bright" />
      )}
      {importing
        ? `正在导入 ${shotLabel}`
        : moving
          ? `移动到 ${shotLabel}`
          : `导入到 ${shotLabel}`}
    </div>
  );
}

type StoryboardShotMediaDropHandlerFactory = (
  shot: StoryShot,
  stableShotId: string | null,
  timelineShotId: string,
  isOnTimeline: boolean
) => HTMLAttributes<HTMLElement>;

export function SimpleStoryboardBoard({
  shots,
  frameByShotNo,
  creationShotByNo,
  timelineShotIdSet,
  selectedShotNo,
  videoTakeDropTargetId,
  imageFrameDropTargetId,
  localMediaDropTargetId,
  importingMediaShotId,
  isGeneratingScript,
  insertingAfterShotNo,
  deletingShotId,
  shotMediaDropHandlers,
  onOpenShot,
  onMediaDragEnd,
  onSelectShot,
  onAddShotToTimeline,
  onInsertShotAfter,
  onDeleteShot,
  onEditVideo,
  onEditImage,
  deferSingleClick,
  cancelDeferredSingleClick,
  candidatesByShot,
  onConfirmCandidate,
  onRejectCandidate,
}: {
  shots: StoryShot[];
  frameByShotNo: Map<number, GeneratedImageItem>;
  creationShotByNo: Map<number, CreationEditorShot>;
  timelineShotIdSet: Set<string>;
  selectedShotNo: number | null;
  videoTakeDropTargetId: string | null;
  imageFrameDropTargetId: string | null;
  localMediaDropTargetId: string | null;
  importingMediaShotId: string | null;
  isGeneratingScript: boolean;
  insertingAfterShotNo: number | null;
  deletingShotId: string | null;
  shotMediaDropHandlers: StoryboardShotMediaDropHandlerFactory;
  onOpenShot: (shotNo: number) => void;
  onMediaDragEnd: () => void;
  onSelectShot?: (shotNo: number) => void;
  onAddShotToTimeline?: (shotNo: number, stableShotId?: string | null) => void;
  onInsertShotAfter?: (
    shotNo: number,
    stableShotId?: string | null
  ) => Promise<void>;
  onDeleteShot?: (
    shotNo: number,
    stableShotId?: string | null
  ) => Promise<void>;
  onEditVideo?: (target: VideoClipEditorTarget) => void;
  onEditImage?: (target: ImageClipEditorTarget) => void;
  deferSingleClick: (action: () => void) => void;
  cancelDeferredSingleClick: () => void;
  /** 阶段 E：每个镜头（按 stableShotId）待确认候选；缺省当作没有候选。 */
  candidatesByShot?: Map<string, ShotPendingCandidate[]>;
  onConfirmCandidate?: (candidate: ShotPendingCandidate) => Promise<void>;
  onRejectCandidate?: (candidate: ShotPendingCandidate) => Promise<void>;
}) {
  return (
    <div className="grid snap-y snap-mandatory gap-1 pb-2 pr-1">
      {shots.map((shot, index) => {
        const image = frameByShotNo.get(shot.shotNo);
        const creationShot = creationShotByNo.get(shot.shotNo);
        const videoPreviewTake = storyboardPreviewVideoTake(creationShot);
        const previewImageUrl =
          image?.imageUrl ?? creationShot?.imageUrl ?? null;
        const previewImageId = creationShot?.imageId ?? image?.id ?? null;
        const videoPosterUrl = videoPreviewTake
          ? videoTakeFrameUrl(videoPreviewTake, "start")
          : null;
        const insertStableShotId = storyShotInsertIdentity(shot, index);
        const shotTimelineId = creationShot
          ? creationTimelineShotId(creationShot)
          : (shot.stableShotId ??
            shot.shotIdentity ??
            `legacy-sh${String(shot.shotNo).padStart(2, "0")}`);
        const selected = selectedShotNo === shot.shotNo;
        const isOnTimeline = timelineShotIdSet.has(shotTimelineId);
        const isVideoTakeDropTarget =
          insertStableShotId != null &&
          videoTakeDropTargetId === insertStableShotId;
        const isImageFrameDropTarget =
          insertStableShotId != null &&
          imageFrameDropTargetId === insertStableShotId;
        const isLocalMediaDropTarget =
          insertStableShotId != null &&
          localMediaDropTargetId === insertStableShotId;
        const isImportingMedia =
          insertStableShotId != null &&
          importingMediaShotId === insertStableShotId;
        const title = shortText(
          shot.dialogue,
          shortText(shot.action, shortText(shot.subject, "关键镜头"))
        );
        const detail =
          [shot.subject, shot.cameraMove].filter(Boolean).join(" · ") ||
          "镜头内容待补充";
        const videoEditTarget =
          insertStableShotId && videoPreviewTake
            ? videoClipEditorTargetForTake({
                stableShotId: insertStableShotId,
                shotNo: shot.shotNo,
                cueCode: shot.cueCode,
                label: `${displayShotCode(shot)} · Take ${videoPreviewTake.id}`,
                take: videoPreviewTake,
                timelineItem: creationShot?.timelineItem,
                posterUrl: videoPosterUrl,
              })
            : null;
        const imageEditTarget =
          insertStableShotId &&
          creationShot &&
          previewImageId &&
          previewImageUrl
            ? imageClipEditorTargetForShot({
                shot: creationShot,
                stableShotId: insertStableShotId,
                imageId: previewImageId,
                imageUrl: previewImageUrl,
                label: `${displayShotCode(shot)} · 图片 #${previewImageId}`,
              })
            : null;
        const openMediaEditor = () => {
          if (videoEditTarget && onEditVideo) {
            onEditVideo(videoEditTarget);
            return;
          }
          if (imageEditTarget && onEditImage) {
            onEditImage(imageEditTarget);
          }
        };

        return (
          <article
            key={`simple-${shot.stableShotId ?? shot.shotIdentity ?? shot.shotNo}-${index}`}
            data-storyboard-shot-no={shot.shotNo}
            {...shotMediaDropHandlers(
              shot,
              insertStableShotId,
              shotTimelineId,
              isOnTimeline
            )}
            aria-busy={isImportingMedia}
            className="relative grid min-h-0 snap-start grid-cols-[72px_minmax(0,1fr)] gap-2 overflow-hidden rounded-sm p-1.5"
            style={{
              background:
                isVideoTakeDropTarget ||
                isImageFrameDropTarget ||
                isLocalMediaDropTarget
                  ? "var(--nayin-glow)"
                  : selected
                    ? "var(--nayin-glow)"
                    : "transparent",
            }}
            onClick={() => onOpenShot(shot.shotNo)}
          >
            {isLocalMediaDropTarget ||
            isImageFrameDropTarget ||
            isImportingMedia ? (
              <StoryboardMediaDropOverlay
                shotLabel={displayShotCode(shot)}
                importing={isImportingMedia}
                moving={isImageFrameDropTarget}
              />
            ) : null}
            <button
              type="button"
              draggable={Boolean(
                insertStableShotId &&
                  (videoPreviewTake?.id || creationShot?.imageId || image?.id)
              )}
              className="relative block h-[72px] w-[72px] overflow-hidden rounded-sm bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
              onDragStart={event => {
                if (!insertStableShotId) {
                  event.preventDefault();
                  return;
                }
                if (videoPreviewTake?.id) {
                  writeVideoTakeDragPayload(event.dataTransfer, {
                    takeId: videoPreviewTake.id,
                    sourceStableShotId: insertStableShotId,
                    sourceShotNo: shot.shotNo,
                  });
                  return;
                }
                const imageId = creationShot?.imageId ?? image?.id;
                if (!imageId) {
                  event.preventDefault();
                  return;
                }
                writeStoryboardImageDragPayload(event.dataTransfer, {
                  imageId,
                  sourceStableShotId: insertStableShotId,
                  sourceShotNo: shot.shotNo,
                });
              }}
              onDragEnd={onMediaDragEnd}
              onClick={event => {
                event.stopPropagation();
                if (
                  (videoPreviewTake && onEditVideo) ||
                  (previewImageUrl && previewImageId && onEditImage)
                ) {
                  deferSingleClick(() => onOpenShot(shot.shotNo));
                  return;
                }
                onOpenShot(shot.shotNo);
              }}
              onDoubleClick={event => {
                cancelDeferredSingleClick();
                if (!insertStableShotId) return;
                event.preventDefault();
                event.stopPropagation();
                openMediaEditor();
              }}
              aria-label={`编辑 ${displayShotCode(shot)}`}
              title={
                videoPreviewTake
                  ? `${displayShotCode(shot)} · 双击编辑视频`
                  : previewImageUrl && onEditImage
                    ? `${displayShotCode(shot)} · 双击编辑图片`
                    : `编辑 ${displayShotCode(shot)}`
              }
            >
              {videoPreviewTake?.videoUrl ? (
                <StoryboardVideoThumbnail
                  src={videoPreviewTake.videoUrl}
                  poster={videoPosterUrl}
                  active={selected}
                  label={`${displayShotCode(shot)} 视频缩略预览`}
                  className="h-full w-full object-cover"
                />
              ) : previewImageUrl ? (
                <img
                  src={previewImageUrl}
                  alt={`${displayShotCode(shot)} ${title}`}
                  draggable={false}
                  className="h-full w-full object-cover"
                  style={timelineTransformStyle(
                    creationShot?.timelineItem?.transform
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  {isGeneratingScript ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                </div>
              )}
              <span className="absolute left-1 top-1 rounded-sm bg-background/90 px-1 py-0.5 font-mono text-[8px] font-semibold text-foreground">
                {displayShotCode(shot)}
              </span>
            </button>
            <div className="flex min-w-0 flex-col py-0.5">
              <button
                type="button"
                className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                onClick={event => {
                  event.stopPropagation();
                  onOpenShot(shot.shotNo);
                }}
                aria-label={`编辑 ${displayShotCode(shot)} ${title}`}
              >
                <p className="line-clamp-2 text-[11px] font-semibold leading-relaxed text-foreground">
                  {title}
                </p>
                <p className="mt-1 line-clamp-1 text-[9px] leading-relaxed text-muted-foreground">
                  {detail}
                </p>
              </button>
              <div className="mt-auto flex items-center gap-1 pt-1">
                {onConfirmCandidate && onRejectCandidate ? (
                  <ShotCandidateBadge
                    shotLabel={displayShotCode(shot)}
                    candidates={
                      (insertStableShotId &&
                        candidatesByShot?.get(insertStableShotId)) ||
                      []
                    }
                    onConfirm={onConfirmCandidate}
                    onReject={onRejectCandidate}
                  />
                ) : null}
                {onAddShotToTimeline && !isOnTimeline ? (
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onAddShotToTimeline(shot.shotNo, shotTimelineId);
                      onSelectShot?.(shot.shotNo);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-muted/45 text-muted-foreground transition hover:bg-[var(--nayin-glow)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                    aria-label={`把 ${displayShotCode(shot)} 加入时间轴`}
                    title="加入时间轴"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {onInsertShotAfter ? (
                  <AddShotButton
                    compact
                    shotLabel={displayShotCode(shot)}
                    inserting={insertingAfterShotNo === shot.shotNo}
                    disabled={
                      insertingAfterShotNo != null || deletingShotId != null
                    }
                    onClick={event => {
                      event.stopPropagation();
                      void onInsertShotAfter(shot.shotNo, insertStableShotId);
                    }}
                  />
                ) : null}
                {onDeleteShot ? (
                  <DeleteShotButton
                    compact
                    shotLabel={displayShotCode(shot)}
                    deleting={deletingShotId === insertStableShotId}
                    disabled={
                      insertingAfterShotNo != null ||
                      deletingShotId != null ||
                      shots.length <= 1
                    }
                    onClick={event => {
                      event.stopPropagation();
                      void onDeleteShot(shot.shotNo, insertStableShotId);
                    }}
                  />
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
