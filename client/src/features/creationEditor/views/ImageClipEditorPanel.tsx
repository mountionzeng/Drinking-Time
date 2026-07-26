import {
  RotateCcw,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import {
  normalizeImageClipEditDraft,
  timelineTransformStyle,
  type ImageClipEditDraft,
  type ImageClipEditorTarget,
} from "../imageClipEditorModel";
import VisualTransformControls from "./VisualTransformControls";

export default function ImageClipEditorPanel({
  target,
  saving,
  onClose,
  onApply,
}: {
  target: ImageClipEditorTarget;
  saving: boolean;
  onClose: () => void;
  onApply: (draft: ImageClipEditDraft) => Promise<void>;
}) {
  const initialDraft = useMemo<ImageClipEditDraft>(
    () => normalizeImageClipEditDraft({ ...target.transform }),
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

  const normalized = normalizeImageClipEditDraft(draft);
  const updateDraft = (patch: Partial<ImageClipEditDraft>) =>
    setDraft(current => ({ ...current, ...patch }));

  return (
    <aside
      role="dialog"
      aria-label={`${target.label} 图片编辑`}
      data-testid="image-clip-editor"
      className="absolute bottom-0 right-0 top-0 z-50 flex w-[344px] max-w-[44vw] flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{target.label}</p>
          <p className="truncate font-mono text-[9px] text-muted-foreground">
            图片 #{target.imageId} · 镜头构图
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭图片编辑"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="aspect-square w-full overflow-hidden bg-black">
          <img
            src={target.imageUrl}
            alt={`${target.label} 调整预览`}
            className="h-full w-full object-cover"
            style={timelineTransformStyle(normalized)}
          />
        </div>

        <section className="px-3 py-3">
          <h2 className="mb-3 text-[11px] font-semibold">构图</h2>
          <VisualTransformControls
            transform={normalized}
            minZoom={0.25}
            onChange={updateDraft}
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
          {saving ? "保存中…" : "应用到镜头"}
        </button>
      </footer>
    </aside>
  );
}
