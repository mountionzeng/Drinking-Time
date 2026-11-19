import { useEffect, useRef, useState } from "react";
import { compareImagePixels } from "./imagePixelChanges";

export function ImageChangePreview({ sourceUrl, candidateUrl, en, onContentChange }: {
  sourceUrl: string; candidateUrl: string; en: boolean; onContentChange?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ key: string; url?: string; changed?: number; total?: number; error?: string }>();
  const key = JSON.stringify([sourceUrl, candidateUrl]);
  const current = result?.key === key ? result : undefined;
  const notify = useRef(onContentChange);
  notify.current = onContentChange;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResult(undefined);
    void compareImagePixels(sourceUrl, candidateUrl, controller.signal).then(diff => {
      if (controller.signal.aborted) return;
      const canvas = document.createElement("canvas");
      canvas.width = diff.width; canvas.height = diff.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas-unavailable");
      const image = context.createImageData(diff.width, diff.height);
      image.data.set(diff.pixels);
      context.putImageData(image, 0, 0);
      setResult({ key, url: canvas.toDataURL(), changed: diff.changedPixels, total: diff.totalPixels });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "comparison-failed" });
    });
    return () => controller.abort();
  }, [open, sourceUrl, candidateUrl, key]);
  useEffect(() => { notify.current?.(); }, [open, result]);
  return <details className="mt-2 text-xs text-muted-foreground" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer py-1">{en ? "Actual changes" : "实际改动位置 / Actual changes"}</summary>
    {open && <div className="mt-1 space-y-1" role="status">
      {!current ? <p>{en ? "Comparing original pixels…" : "正在比较原始像素…"}</p>
        : current.error ? <p>{current.error === "size-mismatch"
          ? (en ? "Image sizes differ; pixel positions cannot be compared." : "两张图尺寸不同，无法按原位置比较。")
          : (en ? "Could not read both images. Changes are unverified." : "未能读取两张图片，尚无法核对实际变化。")}</p>
        : <>
          <img src={current.url} alt={en ? "Pink marks pixels that differ from the source" : "粉色标出与原图不同的像素"} className="max-h-72 w-full rounded object-contain" />
          <p>{en ? "Changed pixels" : "变化像素"} {current.changed} / {current.total} ({((current.changed! / current.total!) * 100).toFixed(2)}%)</p>
          <p>{en ? "Pink marks actual pixel differences, not a planned region. Visual approval is still needed." : "粉色是实际像素变化，不是计划范围；效果是否满意仍需你确认。"}</p>
        </>}
    </div>}
  </details>;
}
