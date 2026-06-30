import { useState } from "react";
import { Check, Clock, Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { canonicalizeShotNo } from "@shared/imageAsset";
import { useStorySpine } from "@/features/storyAgent/spine/storySpine";
import { useCreationEditor } from "../CreationEditorContext";
import {
  isFrameCandidateSheet,
  type FrameCandidateSource,
} from "../frameCandidate";

function formatTime(date: Date | string): string {
  const d = new Date(date);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

type Props = {
  inspectedCandidateId?: number;
  onInspectCandidate?: (candidate: FrameCandidateSource) => void;
};

export default function ShotImageHistory({
  inspectedCandidateId,
  onInspectCandidate,
}: Props) {
  const {
    selectedShot,
    selectedShotNo,
    activeStoryId,
    materialState,
    isSaving,
    refetch,
  } = useCreationEditor();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const setStoryImages = useStorySpine(state => state.setStoryImages);

  const utils = trpc.useUtils();
  const shotIdentity =
    selectedShot?.stableShotId || selectedShot?.shotIdentity || undefined;
  const materialShot = materialState?.shots.find(item =>
    shotIdentity
      ? item.stableShotId === shotIdentity
      : item.shotNo === selectedShotNo
  );

  const refreshImages = async () => {
    if (typeof activeStoryId !== "number" || typeof selectedShotNo !== "number")
      return;
    await Promise.all([
      utils.storyAgent.storyImages.invalidate({ storyId: activeStoryId }),
      utils.storyAgent.storyMaterialState.invalidate({
        storyId: activeStoryId,
      }),
      utils.storyAgent.storyGet.invalidate({ id: activeStoryId }),
    ]);
    refetch();
  };

  const selectMutation = trpc.storyAgent.recordSignal.useMutation({
    onMutate: vars => {
      setActionError(null);
      setSelectingId(vars.imageId ?? null);
    },
    onSettled: () => setSelectingId(null),
    onSuccess: async result => {
      if ("status" in result && result.status === "error") {
        setActionError(result.error);
        return;
      }
      await refreshImages();
    },
    onError: error => setActionError(error.message),
  });

  const deleteMutation = trpc.storyAgent.deleteShotImage.useMutation({
    onMutate: vars => {
      setActionError(null);
      setDeletingId(vars.imageId);
    },
    onSettled: () => setDeletingId(null),
    onSuccess: async (result, variables) => {
      if (result.status === "error") {
        setActionError(result.error);
        return;
      }
      setStoryImages(current =>
        current.filter(image => image.id !== variables.imageId)
      );
      await refreshImages();
    },
    onError: error => setActionError(error.message),
  });

  const images = materialShot?.imageVersions ?? [];
  const sortedImages = [...images].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const candidateVersionById = new Map(
    [...images]
      .filter(isFrameCandidateSheet)
      .sort((left, right) => left.id - right.id)
      .map((image, index) => [image.id, index + 1])
  );

  if (typeof selectedShotNo !== "number") return null;

  return (
    <section
      className="border-b border-border/70 px-4 py-3"
      aria-label="图片版本"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">图片版本</span>
          <span className="text-[10px] text-muted-foreground">
            {sortedImages.length} 版
          </span>
        </div>
      </div>

      {actionError ? (
        <p className="mb-2 text-[10px] text-destructive">{actionError}</p>
      ) : null}

      {sortedImages.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          还没有图片版本，点击下方“重渲本镜”生成第一版。
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sortedImages.map((img, index) => {
            const version = sortedImages.length - index;
            const shotLabel =
              canonicalizeShotNo(
                img.canonicalShotNo ?? img.rawShotNo
              ) ?? "SH??";
            const candidateVersion = candidateVersionById.get(img.id);
            const candidateSheet = candidateVersion != null;
            const inspecting = inspectedCandidateId === img.id;
            return (
              <div
                key={img.id}
                className={`group relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                  inspecting
                    ? "border-primary ring-2 ring-primary/30"
                    : img.isPrimary
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-transparent hover:border-muted-foreground/30"
                }`}
              >
                <button
                  type="button"
                  className="h-full w-full"
                  disabled={
                    isSaving ||
                    selectingId != null ||
                    deletingId != null ||
                    img.status === "rejected"
                  }
                  onClick={() => {
                    if (candidateSheet) {
                      onInspectCandidate?.({
                        imageId: img.id,
                        imageUrl: img.imageUrl,
                        label: `候选版本 V${candidateVersion}`,
                      });
                      return;
                    }
                    if (!activeStoryId || img.isPrimary) return;
                    selectMutation.mutate({
                      storyId: activeStoryId,
                      imageId: img.id,
                      action: "swipe_right",
                      metadata: {
                        source: "shot_image_history",
                        shotNo: selectedShotNo,
                        shotIdentity,
                      },
                    });
                  }}
                  title={
                    candidateSheet
                      ? `放大比较候选版本 V${candidateVersion}`
                      : img.isPrimary
                        ? "当前使用版本"
                        : `使用版本 V${version}`
                  }
                >
                  <img
                    src={img.imageUrl}
                    alt={`${shotLabel} 图片版本 V${version}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/65 px-1.5 py-1 text-[10px] text-white">
                    <span>
                      V{version}
                      {candidateSheet ? " · 四张" : ""}
                    </span>
                    <span>{formatTime(img.createdAt)}</span>
                  </span>
                </button>

                {inspecting ? (
                  <div className="absolute right-1 top-1 rounded bg-primary px-1 py-0.5 text-[9px] text-primary-foreground">
                    正在比较
                  </div>
                ) : img.isPrimary ? (
                  <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-primary px-1 py-0.5 text-[9px] text-primary-foreground">
                    <Check className="h-2.5 w-2.5" />
                    当前
                  </div>
                ) : null}
                {selectingId === img.id ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                ) : null}
                {img.status === "rejected" && (
                  <div className="absolute inset-0 bg-destructive/30 flex items-center justify-center">
                    <span className="text-destructive-foreground text-[10px] font-medium">
                      已拒绝
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="absolute left-1 top-1 rounded bg-black/65 p-1 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100 focus:opacity-100"
                  disabled={
                    deletingId === img.id || selectingId != null || isSaving
                  }
                  onClick={e => {
                    e.stopPropagation();
                    if (!activeStoryId) return;
                    deleteMutation.mutate({
                      imageId: img.id,
                      storyId: activeStoryId,
                    });
                  }}
                  title="删除这张图片"
                >
                  {deletingId === img.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
