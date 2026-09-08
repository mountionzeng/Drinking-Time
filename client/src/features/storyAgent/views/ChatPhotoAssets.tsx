import { useEffect, useMemo, useState } from "react";
import type { StoryMaterialState } from "@shared/storyMaterial";
import VisualAssetLibrary from "@/features/creationEditor/visualAssets/VisualAssetLibrary";

export type PhotoAssetRequest = { storyId: number; instruction: string; notice: string };

/** The story aggregate remains the only durable asset store, including after refresh. */
export default function ChatPhotoAssets({ storyId, materialState, request }: {
  storyId: number;
  materialState: StoryMaterialState | null;
  request: PhotoAssetRequest | null;
}) {
  const [open, setOpen] = useState(Boolean(request));
  const [opened, setOpened] = useState(Boolean(request));
  useEffect(() => {
    if (request) { setOpen(true); setOpened(true); }
  }, [request]);
  const state = materialState?.storyId === storyId ? materialState : null;
  const images = useMemo(() => {
    const rows = [
      ...(state?.unassignedImages ?? []),
      ...(state?.visualAssets?.images ?? []),
      ...(state?.shots.flatMap(shot => [...shot.imageVersions, ...(shot.relatedImages ?? [])]) ?? []),
    ];
    return Array.from(new Map(rows.map(image => [image.id, {
      id: image.id, imageUrl: image.imageUrl, label: `图片 #${image.id}`,
    }])).values());
  }, [state]);
  const count = state?.visualAssets?.assets.length ?? 0;
  return (
    <section className="rounded-xl border border-border bg-background p-3 text-xs" aria-label="聊天照片素材">
      <button type="button" aria-expanded={open} onClick={() => {
        setOpen(!open); setOpened(true);
      }} className="w-full text-left font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        照片 → 艺术素材{count ? ` · ${count} 个资产` : ""} · {open ? "收起" : "展开"}
      </button>
      <p className="mt-1 text-muted-foreground">在聊天框添加照片，说明想保留的特征和画风。提取后在这里核对、确认费用、查看生成图。</p>
      {request?.notice ? <p role="status" className="mt-2">{request.notice}</p> : null}
      <div hidden={!open} className="mt-3 space-y-3">
        <p className="text-muted-foreground">宠物可生成正面、侧面及补充顶视；身份锁定仍需背面和头部特写。照片没拍到的部分属于推演，不是真实外观证据。生成不会自动改动镜头。</p>
        {opened ? <VisualAssetLibrary key={storyId} storyId={storyId} images={images} compact
          initialInstruction={request?.instruction ?? ""}
          initialIncludeTopView={/顶视|顶部|正侧顶/.test(request?.instruction ?? "")} /> : null}
      </div>
    </section>
  );
}
