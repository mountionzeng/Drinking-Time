import { useId } from "react";
import type { PublishingAlbumLayoutPlan } from "./publishingAlbumLayout";
export function PublishingAlbumTextLayer({
  plan,
  canvas,
}: {
  plan: PublishingAlbumLayoutPlan;
  canvas: { width: number; height: number };
}) {
  const pathId = `album-text-path-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${canvas.width} ${canvas.height}`}
      role="img"
      aria-label="中文文字排版层"
    >
      {plan.svgPath ? <path id={pathId} d={plan.svgPath} fill="none" /> : null}
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
  );
}
