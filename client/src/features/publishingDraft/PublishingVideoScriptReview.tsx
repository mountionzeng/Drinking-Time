import React from "react";
import { Loader2 } from "lucide-react";
import type { PublishingVideoStoryboardPreview } from "@shared/publishingVideoStoryboard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PublishingVideoScriptReview({
  preview,
  open = true,
  confirming = false,
  onCancel,
  onConfirm,
}: {
  preview: PublishingVideoStoryboardPreview | null;
  open?: boolean;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!preview) return null;

  const segmentsByParagraph = new Map<string, typeof preview.segments>();
  for (const segment of preview.segments) {
    const current = segmentsByParagraph.get(segment.sourceParagraphId) ?? [];
    current.push(segment);
    segmentsByParagraph.set(segment.sourceParagraphId, current);
  }
  const shotsById = new Map(preview.shots.map(shot => [shot.draftShotId, shot]));

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onCancel()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>剧本预览 · {preview.shots.length} 个镜头</DialogTitle>
          <DialogDescription>
            下面是从文字稿转写出的可表演剧本。它还没有写入正式故事版，也不会生成图片、视频或音频。
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[58vh] space-y-3 overflow-y-auto pr-1"
          aria-label="剧本预览内容"
          data-testid="publishing-video-script-preview"
        >
          {preview.paragraphs.map(paragraph => {
            const segments = segmentsByParagraph.get(paragraph.paragraphId) ?? [];
            return (
              <article
                key={paragraph.paragraphId}
                className="rounded-lg border p-3"
                style={{ borderColor: "var(--panel-border)" }}
                data-testid={`publishing-preview-${paragraph.paragraphId}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    正文 {paragraph.ordinal}
                  </span>
                  <span className="rounded-full bg-[var(--nayin-surface)] px-2 py-0.5 text-[10px] text-muted-foreground">
                    {paragraph.classification === "narrative"
                      ? "叙事"
                      : paragraph.classification === "cta"
                        ? "行动号召 · 转为画面/表演"
                        : "格式内容 · 转为画面/表演"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  来源：{paragraph.text}
                </p>
                <div className="mt-3 space-y-2">
                  {segments.map(segment => (
                    <div
                      key={segment.segmentId}
                      className="rounded-md bg-[var(--nayin-surface)]/65 p-2.5"
                    >
                      <p className="text-xs leading-5 text-foreground">
                        <span className="font-semibold text-[var(--nayin-accent)]">
                          剧本：
                        </span>
                        {segment.scriptText}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        画面处理：{segment.visualTreatment}
                        {segment.treatmentReason
                          ? `（${segment.treatmentReason}）`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {segment.shotIds.map(shotId => {
                          const shot = shotsById.get(shotId);
                          if (!shot) return null;
                          return (
                            <span
                              key={shotId}
                              className="rounded border px-1.5 py-1 text-[10px] text-foreground"
                              style={{ borderColor: "var(--panel-border)" }}
                            >
                              {shotId.replace(/^draft-/, "镜头 ")}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            先不确认
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming || preview.status === "stale"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium text-[var(--background)] disabled:cursor-not-allowed disabled:opacity-45"
            style={{
              background: "var(--nayin-accent)",
              borderColor: "var(--nayin-accent)",
            }}
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            确认写入故事版
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PublishingVideoScriptReview;
