import type { PublishingAlbumContrastStyle } from "@shared/publishingAlbum";
import type { PublishingAlbumCanonicalGeometry } from "./publishingAlbumGeometry";

export const DEFAULT_SUBTITLE_GEOMETRY = {
  kind: "region",
  shape: "rectangle",
  direction: "horizontal",
  region: { x: 0.08, y: 0.7, width: 0.84, height: 0.24 },
  points: [],
} satisfies PublishingAlbumCanonicalGeometry;
export function TypographyAppearanceControls({
  geometry,
  onGeometry,
  contrast,
  onContrast,
  lineSpacing,
  onLineSpacing,
}: {
  geometry: PublishingAlbumCanonicalGeometry | null;
  onGeometry: (geometry: PublishingAlbumCanonicalGeometry) => void;
  contrast: PublishingAlbumContrastStyle;
  onContrast: (contrast: PublishingAlbumContrastStyle) => void;
  lineSpacing: number;
  onLineSpacing: (spacing: number) => void;
}) {
  return (
    <div
      className="grid gap-3 rounded-xl border border-[var(--panel-border)] p-3 text-[11px]"
      aria-label="字幕方向与效果"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>排列</span>
        {(["horizontal", "vertical"] as const).map(direction => (
          <button
            key={direction}
            type="button"
            aria-pressed={
              geometry?.kind === "region" && geometry.direction === direction
            }
            className="rounded-md border px-3 py-1.5 aria-pressed:bg-muted"
            onClick={() =>
              onGeometry(
                geometry?.kind === "region"
                  ? { ...geometry, direction }
                  : {
                      kind: "region",
                      shape: "rectangle",
                      direction,
                      region:
                        direction === "vertical"
                          ? { x: 0.65, y: 0.1, width: 0.27, height: 0.8 }
                          : DEFAULT_SUBTITLE_GEOMETRY.region,
                      points: [],
                    }
              )
            }
          >
            {direction === "horizontal" ? "横排" : "竖排"}
          </button>
        ))}
        {geometry?.kind === "path" ? (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5"
            onClick={() =>
              onGeometry({
                ...geometry,
                points: [...geometry.points].reverse(),
              })
            }
          >
            反转走向
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          字色{" "}
          <input
            type="color"
            aria-label="字幕颜色"
            value={contrast.textColor}
            onChange={event =>
              onContrast({ ...contrast, textColor: event.target.value })
            }
            className="h-7 w-9 rounded border"
          />
        </label>
        <label className="flex items-center gap-2">
          描边{" "}
          <input
            type="color"
            aria-label="字幕描边颜色"
            value={contrast.outlineColor ?? "#000000"}
            onChange={event =>
              onContrast({ ...contrast, outlineColor: event.target.value })
            }
            className="h-7 w-9 rounded border"
          />
        </label>
        <label className="flex items-center gap-2">
          粗细{" "}
          <input
            type="range"
            min={0}
            max={8}
            step={0.5}
            aria-label="字幕描边粗细"
            value={contrast.outlineWidth}
            onChange={event =>
              onContrast({
                ...contrast,
                outlineColor: contrast.outlineColor ?? "#000000",
                outlineWidth: Number(event.target.value),
              })
            }
            className="w-20 accent-[var(--nayin-accent)]"
          />
          <span>{contrast.outlineWidth}</span>
        </label>
      </div>
      {geometry?.kind === "region" ? (
        <label className="flex items-center gap-3">
          行间距
          <input
            type="range"
            aria-label="行间距"
            min={0.8}
            max={3}
            step={0.1}
            value={lineSpacing}
            onChange={event => onLineSpacing(Number(event.target.value))}
            className="flex-1 accent-[var(--nayin-accent)]"
          />
          {lineSpacing.toFixed(1)}
        </label>
      ) : null}
    </div>
  );
}
