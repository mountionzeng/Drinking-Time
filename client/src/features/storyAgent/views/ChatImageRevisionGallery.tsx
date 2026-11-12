import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useUiText } from "@/features/uiLanguage/UiLanguage";

/** Server-owned receipts survive refresh. Polling only resumes existing purchases. */
export function ChatImageRevisionGallery({
  storyId,
  onContentChange,
  onSelectImage,
  selectedImageId,
  onOpenShot,
  hidden,
  stableShotId,
}: {
  storyId: number;
  onContentChange?: () => void;
  onSelectImage?: (image: {
    imageId: number;
    imageUrl: string;
    shotNo: number;
    stableShotId: string;
  }) => void;
  selectedImageId?: number | null;
  onOpenShot?: (stableShotId: string) => void;
  hidden?: boolean;
  stableShotId?: string | null;
}) {
  const ui = useUiText();
  const query = trpc.storyAgent.chatImageRevisions.useQuery(
    { storyId },
    { refetchInterval: 5000 }
  );
  const recover = trpc.storyAgent.recoverStoryboardImage.useMutation();
  const utils = trpc.useUtils();
  const active = useRef(false);
  useEffect(() => {
    const pending = query.data?.find(r => r.status === "accepted");
    if (!pending || active.current) return;
    active.current = true;
    void recover
      .mutateAsync({ storyId, requestId: pending.requestId })
      .then(result => {
        if (result.status === "ok")
          void Promise.allSettled([
            utils.storyAgent.storyImages.invalidate({ storyId }),
            utils.storyAgent.storyMaterialState.invalidate({ storyId }),
          ]);
      })
      .catch(() => {})
      .finally(() => {
        active.current = false;
      });
  }, [query.data, query.dataUpdatedAt, storyId]);
  // AI 改图出图后，在旁边追加免费的「只调亮度」候选（服务端幂等，不替换任何图）。
  const attach = trpc.storyAgent.attachLuminanceCandidates.useMutation();
  const attached = useRef(new Set<string>());
  useEffect(() => {
    for (const revision of query.data ?? []) {
      if (revision.status !== "succeeded" || revision.decision || revision.paletteReferenceImageId || revision.candidateLabels || revision.requestId.startsWith("image:") ||
        revision.candidates.some(image => image.dimensionCheck && !["matched", "resized"].includes(image.dimensionCheck.status)) ||
        revision.requestId.startsWith("luma") || revision.requestId.startsWith("color") || Date.now() - revision.createdAt > 24 * 3600_000 ||
        attached.current.has(revision.requestId)) continue;
      attached.current.add(revision.requestId);
      void attach.mutateAsync({ storyId, requestId: revision.requestId })
        .then(result => { if (result.status === "ok") void utils.storyAgent.chatImageRevisions.invalidate({ storyId }); })
        .catch(() => {});
    }
  }, [query.data, storyId]);
  const signature = query.data
    ?.map(
      r =>
        `${r.requestId}:${r.status}:${r.candidates.map(c => c.imageId).join(",")}:${r.decision?.kind}`
    )
    .join(";");
  useEffect(() => {
    onContentChange?.();
  }, [signature, onContentChange]);
  const revisions = query.data?.filter(revision => !stableShotId ||
    (revision.stableShotId === stableShotId && !revision.decision && !revision.requestId.startsWith("image:")));
  if (hidden || !revisions?.length) return null;
  const shownShotCards = new Set<string>();
  return (
    <section className="space-y-4 py-2" aria-label={ui("对话改图")}>
      {revisions.map(revision => {
        const label = String(revision.shotNo).padStart(2, "0");
        if (
          (revision.decision || revision.requestId.startsWith("image:")) &&
          onOpenShot
        ) {
          if (shownShotCards.has(revision.stableShotId)) return null;
          shownShotCards.add(revision.stableShotId);
          return (
            <button
              key={revision.requestId}
              type="button"
              onClick={() => onOpenShot(revision.stableShotId)}
              className="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left focus-visible:outline focus-visible:outline-2"
            >
              {revision.candidates[0] && (
                <img
                  src={revision.candidates[0].imageUrl}
                  alt=""
                  className="h-10 w-14 rounded object-contain"
                />
              )}
              <span className="text-xs">
                {ui("第 {0} 镜 · 对话与素材", [label])}
              </span>
            </button>
          );
        }
        return (
          <article
            key={revision.requestId}
            className="space-y-2 rounded-xl border border-border p-3"
            aria-label={ui("第 {0} 镜 · 改图", [label])}
          >
            <p className="text-xs font-medium">
              {ui("第 {0} 镜 · 改图", [label])} · {ui("原图")} #
              {revision.sourceImageId}
            </p>
            {revision.instruction && (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {revision.instruction}
              </p>
            )}
            {revision.paletteSummary && <p className="text-xs text-muted-foreground">{revision.paletteSummary}</p>}
            <div className={revision.sourceImageUrl ? "grid grid-cols-2 items-start gap-2" : ""}>
            {revision.sourceImageUrl && (
              <figure>
                <img src={revision.sourceImageUrl} alt={ui("原图")} className="max-h-48 w-full rounded-lg object-contain" onLoad={onContentChange} />
                <figcaption className="text-[11px] text-muted-foreground">{ui("原图")} #{revision.sourceImageId}</figcaption>
              </figure>
            )}

            {revision.candidates.length > 0 ? (
              <div
                className={
                  revision.candidates.length > 1
                    ? "grid grid-cols-2 gap-2"
                    : "space-y-2"
                }
              >
                {revision.candidates.map((image, index) => (
                  <figure key={image.imageId}>
                    <button
                      type="button"
                      className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nayin-accent)] aria-pressed:ring-2 aria-pressed:ring-[var(--nayin-accent)]"
                      aria-pressed={selectedImageId === image.imageId}
                      onClick={() =>
                        onSelectImage?.({
                          ...image,
                          shotNo: revision.shotNo,
                          stableShotId: revision.stableShotId,
                        })
                      }
                    >
                      <img
                        src={image.imageUrl}
                        alt={ui("第 {0} 镜 · 第 {1} 张", [label, index + 1])}
                        className="max-h-72 w-full rounded-lg object-contain"
                        onLoad={onContentChange}
                      />
                    </button>
                    <figcaption className="text-[11px] text-muted-foreground">
                      {index + 1} · #{image.imageId}
                      {image.dimensionCheck && <span className="block">
                        {image.dimensionCheck.status === "mismatch"
                          ? ui("尺寸不符：{0}，应为 {1}；保留结果，不可替换", [
                              `${image.dimensionCheck.output?.width}×${image.dimensionCheck.output?.height}`,
                              `${image.dimensionCheck.expected.width}×${image.dimensionCheck.expected.height}`])
                          : image.dimensionCheck.status === "unverified"
                            ? ui("尺寸待核对，暂不可替换")
                            : ui(image.dimensionCheck.status === "resized" ? "{0} · 已等比还原原图尺寸" : "{0} · 原图尺寸已锁定", [
                                `${image.dimensionCheck.expected.width}×${image.dimensionCheck.expected.height}`])}
                      </span>}
                      {revision.candidateLabels?.[image.imageId] ? <span className="block">{revision.candidateLabels[image.imageId]}</span> : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                {ui(
                  revision.status === "failed"
                    ? "改图未完成，原图保留"
                    : revision.status === "unknown"
                      ? "正在核对原任务，暂不重复提交"
                      : "图片正在生成，你可以继续聊天"
                )}
              </p>
            )}
            </div>
            {revision.status === "failed" && revision.error && (
              <p className="text-xs text-muted-foreground break-words">{ui(revision.error)}</p>
            )}
            {revision.editMode === "retexture" && (
              <p className="text-xs text-muted-foreground">{ui("原图精修：请对比明暗、灰度、构图和物体位置；确认前不替换原素材，也不自动生成视频。")}</p>
            )}
            {revision.decision ? (
              <p className="text-xs text-muted-foreground">
                {ui(
                  revision.decision.kind === "replaced"
                    ? "已采用 · 旧版保留在仓库"
                    : "已保留原图 · 新图留在仓库"
                )}
              </p>
            ) : revision.status === "succeeded" && revision.candidates.some(image => !image.dimensionCheck || ["matched", "resized"].includes(image.dimensionCheck.status)) ? (
              <p className="text-xs">
                {ui(
                  revision.referenceOnly
                    ? "新版已保存在仓库。回复“图片 #编号替换参考帧”确认；视频和剪辑线保持不变。"
                    : revision.candidates.length === 1
                    ? "是否替换原素材？回复“替换原图”或“保留原图”。"
                    : "是否替换原素材？回复“第 {0} 镜第 2 张替换原图”，或“第 {0} 镜保留原图”。",
                  [label]
                )}
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
