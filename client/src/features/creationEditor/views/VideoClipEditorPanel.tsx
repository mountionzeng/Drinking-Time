import {
  Gauge,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Volume2,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  editedTimelineDurationMs,
  normalizeVideoClipEditDraft,
  type VideoClipEditDraft,
  type VideoClipEditorTarget,
} from "../videoClipEditorModel";
import { timelineTransformStyle } from "../imageClipEditorModel";
import VisualTransformControls from "./VisualTransformControls";

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[10px] text-muted-foreground">
      <span>{label}</span>
      <span className="flex h-8 items-center border-b border-border bg-muted/25 px-2 focus-within:border-primary">
        <input
          type="number"
          value={Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          onChange={event => onChange(Number(event.currentTarget.value))}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none"
        />
        {suffix ? <span className="text-[9px]">{suffix}</span> : null}
      </span>
    </label>
  );
}

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
    <label className="grid grid-cols-[68px_minmax(0,1fr)_44px] items-center gap-2 text-[10px]">
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

export default function VideoClipEditorPanel({
  target,
  saving,
  onClose,
  onApply,
}: {
  target: VideoClipEditorTarget;
  saving: boolean;
  onClose: () => void;
  onApply: (draft: VideoClipEditDraft) => Promise<void>;
}) {
  const initialDraft = useMemo<VideoClipEditDraft>(
    () => ({
      sourceStartSec: target.sourceStartSec,
      sourceEndSec: target.sourceEndSec,
      effects: { ...target.effects },
      transform: { ...target.transform },
    }),
    [target]
  );
  const [draft, setDraft] = useState(initialDraft);

  useEffect(() => setDraft(initialDraft), [initialDraft]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const normalized = normalizeVideoClipEditDraft(
    draft,
    target.mediaDurationSec
  );
  const outputDurationMs = editedTimelineDurationMs(normalized);
  const updateEffects = (patch: Partial<VideoClipEditDraft["effects"]>) =>
    setDraft(current => ({
      ...current,
      effects: { ...current.effects, ...patch },
    }));
  const updateTransform = (patch: Partial<VideoClipEditDraft["transform"]>) =>
    setDraft(current => ({
      ...current,
      transform: { ...current.transform, ...patch },
    }));

  return (
    <aside
      role="dialog"
      aria-label={`${target.label} 视频编辑`}
      data-testid="video-clip-editor"
      className="absolute bottom-0 right-0 top-0 z-50 flex w-[344px] max-w-[44vw] flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{target.label}</p>
          <p className="truncate font-mono text-[9px] text-muted-foreground">
            Take {target.takeId}
            {target.clipId ? ` · ${target.clipId}` : " · 主镜头"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭视频编辑"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="aspect-square w-full overflow-hidden bg-black">
          <video
            key={`${target.takeId}-${target.clipId ?? "primary"}`}
            src={target.videoUrl}
            poster={target.posterUrl ?? undefined}
            controls
            preload="metadata"
            className="h-full w-full object-cover"
            style={timelineTransformStyle(normalized.transform)}
          />
        </div>

        <section className="border-b border-border px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold">裁切</h2>
            <span className="font-mono text-[9px] text-muted-foreground">
              {(outputDurationMs / 1_000).toFixed(2)}s
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="入点"
              value={draft.sourceStartSec}
              min={0}
              max={Math.max(0, target.mediaDurationSec - 1 / 30)}
              step={1 / 30}
              suffix="s"
              onChange={sourceStartSec =>
                setDraft(current => ({ ...current, sourceStartSec }))
              }
            />
            <NumberField
              label="出点"
              value={draft.sourceEndSec}
              min={1 / 30}
              max={target.mediaDurationSec}
              step={1 / 30}
              suffix="s"
              onChange={sourceEndSec =>
                setDraft(current => ({ ...current, sourceEndSec }))
              }
            />
          </div>
        </section>

        <section className="border-b border-border px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[11px] font-semibold">速度与方向</h2>
          </div>
          <div
            className="mb-3 grid grid-cols-4 gap-1"
            role="group"
            aria-label="常用速度"
          >
            {[0.5, 1, 1.5, 2].map(rate => (
              <button
                key={rate}
                type="button"
                onClick={() => updateEffects({ playbackRate: rate })}
                className={`h-7 rounded-sm border text-[10px] font-medium ${Math.abs(draft.effects.playbackRate - rate) < 0.001 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
              >
                {rate}x
              </button>
            ))}
          </div>
          <RangeRow
            label="播放速度"
            value={draft.effects.playbackRate}
            min={0.25}
            max={4}
            step={0.05}
            display={`${draft.effects.playbackRate.toFixed(2)}x`}
            onChange={playbackRate => updateEffects({ playbackRate })}
          />
          <label className="mt-3 flex h-8 items-center justify-between text-[10px]">
            <span>倒放</span>
            <Checkbox
              checked={draft.effects.reverse}
              onCheckedChange={checked =>
                updateEffects({ reverse: checked === true })
              }
              aria-label="倒放视频"
            />
          </label>
        </section>

        <section className="border-b border-border px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[11px] font-semibold">原声</h2>
          </div>
          <RangeRow
            label="音量"
            value={draft.effects.volume}
            min={0}
            max={2}
            step={0.05}
            display={`${Math.round(draft.effects.volume * 100)}%`}
            onChange={volume => updateEffects({ volume })}
          />
          <label className="mt-3 flex h-8 items-center justify-between text-[10px]">
            <span>静音</span>
            <Checkbox
              checked={draft.effects.muted}
              onCheckedChange={checked =>
                updateEffects({ muted: checked === true })
              }
              aria-label="静音原声"
            />
          </label>
        </section>

        <section className="px-3 py-3">
          <h2 className="mb-3 text-[11px] font-semibold">画面</h2>
          <VisualTransformControls
            transform={normalized.transform}
            minZoom={1}
            maxZoom={8}
            onChange={updateTransform}
          />
        </section>
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-border px-3">
        <button
          type="button"
          onClick={() => setDraft(initialDraft)}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          还原
        </button>
        <button
          type="button"
          onClick={() => void onApply(normalized)}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "应用到时间线"}
        </button>
      </footer>
    </aside>
  );
}
