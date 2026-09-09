import { useEffect, useState } from "react";
import type { StoryTimelineImageTextOverlay } from "@shared/storyMaterial";
import { preparePublishingAlbumExportPage } from "@/features/publishingAlbum/publishingAlbumExport";
import { PublishingAlbumTextLayer } from "@/features/publishingAlbum/PublishingAlbumTextLayer";
import type { PublishingAlbumLayoutPlan } from "@/features/publishingAlbum/publishingAlbumLayout";

const CANVAS = { width: 900, height: 900 };
/** Display the exact image's saved layer; stale font-load results cannot cross images. */
export function ImageSubtitleOverlay({
  overlay,
}: {
  overlay: StoryTimelineImageTextOverlay;
}) {
  const [result, setResult] = useState<{
    source: StoryTimelineImageTextOverlay;
    plan?: PublishingAlbumLayoutPlan;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void preparePublishingAlbumExportPage({
      pageId: "image-subtitle",
      ordinal: 1,
      text: overlay.text,
      typography: overlay.typography,
      backgroundUrl: "",
      canvas: CANVAS,
    })
      .then(page => {
        if (active) setResult({ source: overlay, plan: page.plan });
      })
      .catch(error => {
        if (active)
          setResult({
            source: overlay,
            error: error instanceof Error ? error.message : "字幕加载失败",
          });
      });
    return () => {
      active = false;
    };
  }, [overlay]);
  if (result?.source !== overlay) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-label="图片字幕层"
    >
      {result.plan ? (
        <PublishingAlbumTextLayer plan={result.plan} canvas={CANVAS} />
      ) : (
        <span
          role="status"
          className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white"
        >
          {result.error}
        </span>
      )}
    </div>
  );
}
