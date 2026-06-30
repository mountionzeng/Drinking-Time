import { Check, Image as ImageIcon, Library, Loader2, Video, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { StoryMaterialState } from "@shared/storyMaterial";

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
};

export default function AnimaticMaterialDrawer({
  open,
  state,
  selectedStableShotId,
  onClose,
  onSelectShot,
  onPromoteImage,
  onAdoptVideo,
}: Props) {
  const [scope, setScope] = useState<"shot" | "all">("shot");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const shots = useMemo(
    () =>
      (state?.shots ?? []).filter(
        shot => scope === "all" || shot.stableShotId === selectedStableShotId
      ),
    [scope, selectedStableShotId, state?.shots]
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
        {shots.map(shot => (
          <section key={shot.stableShotId} className="space-y-2">
            <button
              type="button"
              onClick={() => onSelectShot(shot.shotNo)}
              className="text-xs font-semibold text-foreground hover:text-primary"
            >
              SH{String(shot.shotNo).padStart(2, "0")}
            </button>
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
                      alt={`SH${shot.shotNo} 图片版本`}
                      className="aspect-video w-full bg-muted object-cover"
                    />
                    <div className="flex items-center justify-between gap-1 p-1.5">
                      <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
                        <ImageIcon className="h-3 w-3 shrink-0" />
                        图 #{image.id}
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
              {shot.videoTakes.map(take => {
                const adopted = take.id === shot.currentVideo?.id;
                const stale =
                  shot.currentImage != null &&
                  take.sourceImageId != null &&
                  shot.currentImage.id !== take.sourceImageId;
                const key = `video-${take.id}`;
                return (
                  <article
                    key={take.id}
                    className="col-span-2 overflow-hidden rounded-md border border-border bg-card"
                  >
                    {take.videoUrl && take.status === "available" ? (
                      <video
                        src={take.videoUrl}
                        controls
                        preload="metadata"
                        className="aspect-video w-full bg-black object-contain"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-muted text-xs text-muted-foreground">
                        {take.errorMessage || take.status}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 p-2">
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Video className="h-3 w-3" />
                        Take {take.id}
                        {stale ? " · 基于旧主图" : ""}
                      </span>
                      <button
                        type="button"
                        disabled={
                          adopted ||
                          take.status !== "available" ||
                          !take.videoUrl ||
                          savingKey === key
                        }
                        onClick={() =>
                          void run(key, () =>
                            onAdoptVideo({
                              stableShotId: shot.stableShotId,
                              takeId: take.id,
                              plannedDurationSec:
                                (shot.timelineItem?.plannedDurationMs ?? 3000) /
                                1000,
                            })
                          )
                        }
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
                  </article>
                );
              })}
            </div>
          </section>
        ))}
        {shots.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            当前镜头还没有历史素材。
          </div>
        ) : null}
      </div>
    </aside>
  );
}
