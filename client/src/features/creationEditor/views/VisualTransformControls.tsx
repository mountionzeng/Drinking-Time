import {
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import React from "react";

import type { TimelineTransform } from "@shared/storyMaterial";

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[68px_minmax(0,1fr)_48px] items-center gap-2 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={event => onChange(Number(event.currentTarget.value))}
        className="w-full accent-[var(--primary)]"
      />
      <span className="text-right font-mono tabular-nums text-foreground">
        {display}
      </span>
    </label>
  );
}

export default function VisualTransformControls({
  transform,
  minZoom,
  maxZoom = 4,
  onChange,
}: {
  transform: TimelineTransform;
  minZoom: number;
  maxZoom?: number;
  onChange: (patch: Partial<TimelineTransform>) => void;
}) {
  const rotationDeg = transform.rotationDeg ?? 0;
  const rotateBy = (degrees: number) =>
    onChange({
      rotationDeg: Math.max(-180, Math.min(180, rotationDeg + degrees)),
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <RangeRow
          label="缩放"
          value={transform.zoom}
          min={minZoom}
          max={maxZoom}
          step={0.01}
          display={`${transform.zoom.toFixed(2)}x`}
          onChange={zoom => onChange({ zoom })}
        />
        <RangeRow
          label="水平位置"
          value={transform.panX}
          min={-1}
          max={1}
          step={0.01}
          display={`${Math.round(transform.panX * 100)}`}
          onChange={panX => onChange({ panX })}
        />
        <RangeRow
          label="垂直位置"
          value={transform.panY}
          min={-1}
          max={1}
          step={0.01}
          display={`${Math.round(transform.panY * 100)}`}
          onChange={panY => onChange({ panY })}
        />
      </div>

      <div>
        <h3 className="mb-3 text-[11px] font-semibold">旋转与翻转</h3>
        <RangeRow
          label="旋转"
          value={rotationDeg}
          min={-180}
          max={180}
          step={1}
          display={`${Math.round(rotationDeg)}°`}
          onChange={value => onChange({ rotationDeg: value })}
        />
        <div className="mt-3 grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => rotateBy(-90)}
            className="flex h-8 items-center justify-center rounded-sm border border-border hover:bg-muted"
            aria-label="向左旋转九十度"
            title="左转 90°"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => rotateBy(90)}
            className="flex h-8 items-center justify-center rounded-sm border border-border hover:bg-muted"
            aria-label="向右旋转九十度"
            title="右转 90°"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange({ flipX: !transform.flipX })}
            className={`flex h-8 items-center justify-center rounded-sm border ${transform.flipX ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
            aria-label="水平翻转"
            title="水平翻转"
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange({ flipY: !transform.flipY })}
            className={`flex h-8 items-center justify-center rounded-sm border ${transform.flipY ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
            aria-label="垂直翻转"
            title="垂直翻转"
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
