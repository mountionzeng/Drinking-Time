import React from "react";
import { ImageIcon } from "lucide-react";
import { useUiLanguage } from "@/features/uiLanguage/UiLanguage";
import type { ChatFrameReference } from "@shared/chatFrameReference";

/** Compact in the conversation; the image is only expanded on request. */
export function PausedFrameBadge({
  frame,
  expanded = false,
  onSelect,
}: {
  frame: ChatFrameReference;
  expanded?: boolean;
  onSelect?: (frame: ChatFrameReference) => void;
}) {
  const { language } = useUiLanguage();
  const label =
    language === "en" ? "Referenced frame" : "引用画面 / Referenced frame";
  const picture = (
    <figure className="mt-2">
      <button
        type="button"
        disabled={!onSelect}
        onClick={() => onSelect?.(frame)}
        aria-label={enLabel(language)}
      >
        <img
          src={frame.imageUrl}
          alt={label}
          className="max-h-48 max-w-full rounded object-contain"
        />
      </button>
      <figcaption className="mt-1 text-[10px] text-muted-foreground">
        {language === "en" ? "Shot" : "镜头"}{" "}
        {String(frame.shotNo).padStart(2, "0")} · #{frame.imageId} ·
        {frame.takeId ? ` Take ${frame.takeId} ·` : ""}{" "}
        {language === "en" ? "Timeline revision" : "剪辑修订"}{" "}
        {frame.timelineVersion}
        {frame.imageSize && <> · {frame.imageSize.width}×{frame.imageSize.height} · {language === "en" ? "Source frame" : "原素材帧"}</>}
      </figcaption>
    </figure>
  );
  if (expanded) return picture;
  return (
    <details className="my-1 text-xs" data-testid="paused-frame-reference">
      <summary
        aria-label={label}
        title={label}
        className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground"
      >
        <ImageIcon aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="text-[10px]">
          {(frame.timelineFrame / 30).toFixed(2)}s
        </span>
      </summary>
      {picture}
    </details>
  );
}

function enLabel(language: string) {
  return language === "en"
    ? "Select reference image"
    : "选择参考图 / Select reference image";
}
