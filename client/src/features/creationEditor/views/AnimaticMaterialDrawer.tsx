import {
  Ban,
  Check,
  Copy,
  Image as ImageIcon,
  Library,
  Loader2,
  Video,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { VideoTakeAsset } from "@shared/videoAsset";
import { displayShotCode } from "@shared/shotIdentity";
import {
  videoTakeAffordance,
  videoTakeErrorMessage,
} from "../videoAssetViewModel";

type Props = {
  open: boolean;
  state: StoryMaterialState | null;
  selectedStableShotId: string | null;
  onClose: () => void;
  onSelectShot: (shotNo: number) => void;
  onPromoteImage: (imageId: number) => Promise<void>;
  onAdoptVideo: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  onReuseVideo?: (input: {
    sourceTakeId: number;
    targetStableShotId: string;
    plannedDurationSec: number;
  }) => Promise<void>;
  onMarkVideoTakeUnusable?: (
    takeId: number,
    sourceStoryId?: number | null
  ) => Promise<void>;
};

function isInactiveTake(take: VideoTakeAsset) {
  const affordance = videoTakeAffordance(take.status);
  return !affordance.canPlay && !affordance.canRefresh;
}

export default function AnimaticMaterialDrawer({
  open,
  state,
  selectedStableShotId,
  onClose,
  onSelectShot,
  onPromoteImage,
  onAdoptVideo,
  onReuseVideo,
  onMarkVideoTakeUnusable,
}: Props) {
  const [scope, setScope] = useState<"shot" | "all">("shot");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loadedVideoTakeIds, setLoadedVideoTakeIds] = useState<Set<number>>(
    () => new Set()
  );
  const shots = useMemo(
    () =>
      (state?.shots ?? []).filter(
        shot => scope === "all" || shot.stableShotId === selectedStableShotId
      ),
    [scope, selectedStableShotId, state?.shots]
  );
  const selectedShot = useMemo(
    () =>
      (state?.shots ?? []).find(
        shot => shot.stableShotId === selectedStableShotId
      ) ?? null,
    [selectedStableShotId, state?.shots]
  );

  if (!open) return null;

  const run = async (key: string, action: () => Promise<void>) => {
    setSavingKey(key);
    try {
      await action();
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(420px,92%)] flex-col border-l border-border bg-background shadow-xl">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">素材库</h3>
            <p className="text-[11px] text-muted-foreground">
              先预览，再替换同镜头素材
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:text-foreground"
          aria-label="关闭素材库"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="grid grid-cols-2 gap-1 border-b border-border p-2">
        {(["shot", "all"] as const).map(value => (
          <button
            key={value}
            type="button"
            onClick={() => setScope(value)}
            className={`h-8 rounded-md text-xs font-medium transition ${
              scope === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {value === "shot" ? "当前镜头" : "全部素材"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {shots.map(shot => {
          const orderedVideoTakes = [...shot.videoTakes].sort(
            (left, right) =>
              Number(isInactiveTake(left)) - Number(isInactiveTake(right))
          );
          const usableVideoTakeCount = shot.videoTakes.filter(
            take => videoTakeAffordance(take.status).canPlay
          ).length;
          const inactiveVideoTakeCount =
            shot.videoTakes.length -
            orderedVideoTakes.filter(take => !isInactiveTake(take)).length;
          return (
            <section key={shot.stableShotId} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectShot(shot.shotNo)}
                  className="text-xs font-semibold text-foreground hover:text-primary"
                >
                  {displayShotCode(shot)}
                </button>
                {shot.videoTakes.length > 0 ? (
                  <span className="text-[10px] text-muted-foreground">
                    Take {usableVideoTakeCount}/{shot.videoTakes.length} 可用
                    {inactiveVideoTakeCount > 0
                      ? ` · ${inactiveVideoTakeCount} 不占位`
                      : ""}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {shot.imageVersions.map(image => {
                  const current = image.id === shot.currentImage?.id;
                  const key = `image-${image.id}`;
                  return (
                    <article
                      key={image.id}
                      className="overflow-hidden rounded-md border border-border bg-card"
                    >
                      <img
                        src={image.imageUrl}
                        alt={`${displayShotCode(shot)} 图片版本`}
                        className="aspect-video w-full bg-muted object-cover"
                      />
                      <div className="flex items-center justify-between gap-1 p-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
                          <ImageIcon className="h-3 w-3 shrink-0" />图 #
                          {image.id}
                        </span>
                        <button
                          type="button"
                          disabled={current || savingKey === key}
                          onClick={() =>
                            void run(key, () => onPromoteImage(image.id))
                          }
                          className="h-6 rounded px-1.5 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:text-muted-foreground"
                        >
                          {savingKey === key ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : current ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              当前
                            </span>
                          ) : (
                            "设为主图"
                          )}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {orderedVideoTakes.map(take => {
                  const adopted = take.id === shot.currentVideo?.id;
                  const affordance = videoTakeAffordance(take.status);
                  const inactive = isInactiveTake(take);
                  const stale =
                    shot.currentImage != null &&
                    take.sourceImageId != null &&
                    shot.currentImage.id !== take.sourceImageId;
                  const key = `video-${take.id}`;
                  const reuseKey = `reuse-video-${take.id}-${selectedStableShotId ?? "none"}`;
                  const canPreview =
                    Boolean(take.videoUrl) && take.status === "available";
                  const canReuseToSelected = Boolean(
                    onReuseVideo &&
                      selectedStableShotId &&
                      selectedStableShotId !== shot.stableShotId &&
                      take.status === "available" &&
                      take.videoUrl &&
                      !inactive
                  );
                  const adoptVideo = () => {
                    if (take.storyId === state?.storyId) {
                      return onAdoptVideo({
                        stableShotId: shot.stableShotId,
                        takeId: take.id,
                        plannedDurationSec:
                          (shot.timelineItem?.plannedDurationMs ?? 3000) /
                          1000,
                      });
                    }
                    if (!onReuseVideo) {
                      return Promise.reject(new Error("视频复用入口不可用"));
                    }
                    return onReuseVideo({
                      sourceTakeId: take.id,
                      targetStableShotId: shot.stableShotId,
                      plannedDurationSec:
                        (shot.timelineItem?.plannedDurationMs ?? 3000) / 1000,
                    });
                  };
                  const previewLoaded = loadedVideoTakeIds.has(take.id);
                  return (
                    <article
                      key={take.id}
                      className={`col-span-2 overflow-hidden rounded-md border border-border bg-card ${
                        inactive ? "opacity-70" : ""
                      }`}
                    >
                      {canPreview && previewLoaded ? (
                        <video
                          src={take.videoUrl ?? undefined}
                          controls
                          preload="none"
                          className="aspect-video w-full bg-black object-contain"
                        />
                      ) : canPreview ? (
                        <button
                          type="button"
                          onClick={() =>
                            setLoadedVideoTakeIds(current => {
                              const next = new Set(current);
                              next.add(take.id);
                              return next;
                            })
                          }
                          className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-muted text-xs text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
                        >
                          <Video className="h-5 w-5" />
                          载入预览
                        </button>
                      ) : (
                        <div className="flex aspect-video items-center justify-center bg-muted text-xs text-muted-foreground">
                          {take.errorMessage
                            ? videoTakeErrorMessage(take.errorMessage)
                            : affordance.label}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 p-2">
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Video className="h-3 w-3" />
                          Take {take.id} · {affordance.label}
                          {stale ? " · 基于旧主图" : ""}
                          {inactive ? " · 不占位" : ""}
                        </span>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {canReuseToSelected ? (
                            <button
                              type="button"
                              disabled={savingKey === reuseKey}
                              onClick={() =>
                                void run(reuseKey, () =>
                                  onReuseVideo!({
                                    sourceTakeId: take.id,
                                    targetStableShotId: selectedStableShotId!,
                                    plannedDurationSec:
                                      (selectedShot?.timelineItem
                                        ?.plannedDurationMs ?? 3000) / 1000,
                                  })
                                )
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/30 px-2 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:border-border disabled:text-muted-foreground"
                            >
                              {savingKey === reuseKey ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              复用到当前镜头
                            </button>
                          ) : null}
                          {onMarkVideoTakeUnusable &&
                          take.status !== "unfollowable" &&
                          !inactive ? (
                            <button
                              type="button"
                              disabled={savingKey === `mark-video-${take.id}`}
                              onClick={() =>
                                void run(`mark-video-${take.id}`, () =>
                                  onMarkVideoTakeUnusable(take.id, take.storyId)
                                )
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[10px] font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:text-muted-foreground"
                            >
                              {savingKey === `mark-video-${take.id}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Ban className="h-3 w-3" />
                              )}
                              不可用
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={
                              adopted ||
                              take.status !== "available" ||
                              !take.videoUrl ||
                              (take.storyId !== state?.storyId &&
                                !onReuseVideo) ||
                              savingKey === key
                            }
                            onClick={() => void run(key, adoptVideo)}
                            className="h-7 rounded-md border border-primary/30 px-2 text-[10px] font-medium text-primary transition hover:bg-primary/10 disabled:border-border disabled:text-muted-foreground"
                          >
                            {savingKey === key ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : adopted ? (
                              "已采用"
                            ) : (
                              "采用"
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        {shots.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            当前镜头还没有历史素材。
          </div>
        ) : null}
      </div>
    </aside>
  );
}
