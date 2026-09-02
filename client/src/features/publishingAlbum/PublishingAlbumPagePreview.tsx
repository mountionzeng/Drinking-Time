import type { PublishingAlbumLayoutPlan } from "./publishingAlbumLayout";
import { useId, type CSSProperties } from "react";

export function PublishingAlbumPagePreview({
  backgroundUrl,
  plan,
  label = "画册页面预览",
  candidate = false,
  canvas = { width: 900, height: 1200 },
  backgroundStyle,
  onDoubleClick,
}: {
  backgroundUrl: string | null;
  plan: PublishingAlbumLayoutPlan | null;
  label?: string;
  candidate?: boolean;
  canvas?: { width: number; height: number };
  backgroundStyle?: CSSProperties;
  onDoubleClick?: () => void;
}) {
  const pathId = `album-text-path-${useId().replace(/:/g, "")}`;
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black/10"
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      aria-label={label}
      onDoubleClick={onDoubleClick}
      data-candidate={candidate ? "true" : "false"}
    >
      {backgroundUrl ? (
        <img
          src={backgroundUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={backgroundStyle}
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          尚未采用底图
        </div>
      )}
      {plan ? (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          role="img"
          aria-label="中文文字排版层"
        >
          {plan.svgPath ? (
            <path id={pathId} d={plan.svgPath} fill="none" />
          ) : null}
          {plan.graphemes.map(glyph =>
            glyph.grapheme === "\n" ? null : (
              <text
                key={`${glyph.index}-${glyph.x}-${glyph.y}`}
                x={glyph.x}
                y={glyph.y}
                textAnchor="middle"
                fill={plan.contrast.textColor}
                stroke={plan.contrast.outlineColor ?? "none"}
                strokeWidth={plan.contrast.outlineWidth}
                paintOrder="stroke"
                fontFamily={plan.fontFamily}
                fontSize={plan.fontSize}
                transform={
                  glyph.rotation
                    ? `rotate(${glyph.rotation} ${glyph.x} ${glyph.y})`
                    : undefined
                }
              >
                {glyph.grapheme}
              </text>
            )
          )}
        </svg>
      ) : null}
      {candidate ? (
        <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] text-white">
          候选 · 尚未采用
        </span>
      ) : null}
    </div>
  );
}
