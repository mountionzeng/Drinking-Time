import {
  Copy,
  Loader2,
  RotateCcw,
  RotateCw,
  Save,
  ScanText,
  SlidersHorizontal,
  Type,
  Trash2,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";

import {
  normalizeImageClipEditDraft,
  timelineTransformStyle,
  type ImageClipEditDraft,
  type ImageClipEditorTarget,
} from "../imageClipEditorModel";
import { PublishingAlbumTypographyEditor } from "@/features/publishingAlbum/PublishingAlbumTypographyEditor";
import VisualTransformControls from "./VisualTransformControls";

export default function ImageClipEditorPanel({
  target,
  saving,
  onClose,
  onApply,
  onExtractText,
}: {
  target: ImageClipEditorTarget;
  saving: boolean;
  onClose: () => void;
  onApply: (draft: ImageClipEditDraft) => Promise<void>;
  onExtractText?: (rotationDeg: number) => Promise<{ text: string }>;
}) {
  const initialDraft = useMemo<ImageClipEditDraft>(
    () => ({
      transform: normalizeImageClipEditDraft({ ...target.transform }),
      textOverlay: target.textOverlay,
    }),
    [target]
  );
  const [draft, setDraft] = useState(initialDraft);
  const [activeTab, setActiveTab] = useState<
    "composition" | "text" | "ocr"
  >(
    target.textOverlay ? "text" : "composition"
  );
  const [text, setText] = useState(target.textOverlay?.text ?? "");
  const [extractedText, setExtractedText] = useState("");
  const [extractingText, setExtractingText] = useState(false);
  const [extractTextError, setExtractTextError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setText(initialDraft.textOverlay?.text ?? "");
    setExtractedText("");
    setExtractTextError(null);
    setActiveTab(initialDraft.textOverlay ? "text" : "composition");
  }, [initialDraft]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const normalized = normalizeImageClipEditDraft(draft.transform);
  const normalizedRotationDeg = normalized.rotationDeg ?? 0;
  const updateTransform = (patch: Partial<ImageClipEditDraft["transform"]>) =>
    setDraft(current => ({
      ...current,
      transform: { ...current.transform, ...patch },
    }));
  const textNeedsLayout = text.trim().length > 0 && !draft.textOverlay;
  const appliedDraft: ImageClipEditDraft = {
    transform: normalized,
    textOverlay:
      text.trim() && draft.textOverlay
        ? { text: text.trim(), typography: draft.textOverlay.typography }
        : null,
  };

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
            图片 #{target.imageId} · 构图与文字
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

      <nav
        className="grid shrink-0 grid-cols-3 border-b border-border bg-muted/20 p-1"
        aria-label="图片编辑模式"
      >
        <button
          type="button"
          onClick={() => setActiveTab("composition")}
          aria-pressed={activeTab === "composition"}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition ${
            activeTab === "composition"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          构图
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("text");
            if (!text.trim() && !draft.textOverlay) {
              setText(target.defaultText);
            }
          }}
          aria-pressed={activeTab === "text"}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition ${
            activeTab === "text"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Type className="h-3.5 w-3.5" />
          添加文字
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ocr")}
          aria-pressed={activeTab === "ocr"}
          className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium transition ${
            activeTab === "ocr"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ScanText className="h-3.5 w-3.5" />
          提取文字
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === "composition" ? (
          <>
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
              <button
                type="button"
                onClick={() =>
                  updateTransform({
                    rotationDeg:
                      normalizedRotationDeg === 180
                        ? 0
                        : normalizedRotationDeg === -180
                          ? 0
                          : normalizedRotationDeg + 180 > 180
                            ? normalizedRotationDeg - 180
                            : normalizedRotationDeg + 180,
                  })
                }
                className="mb-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[10px] font-medium text-foreground transition hover:bg-muted"
              >
                <RotateCw className="h-3.5 w-3.5" />
                倒转 180°
              </button>
              <VisualTransformControls
                transform={normalized}
                minZoom={0.25}
                onChange={updateTransform}
              />
            </section>
          </>
        ) : activeTab === "text" ? (
          <section className="space-y-3 px-3 py-3" aria-label="这张图片的文字">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`image-text-${target.imageId}`}
                  className="text-[11px] font-semibold"
                >
                  文字内容
                </label>
                {text || draft.textOverlay ? (
                  <button
                    type="button"
                    onClick={() => {
                      setText("");
                      setDraft(current => ({ ...current, textOverlay: null }));
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Trash2 className="h-3 w-3" />
                    移除文字
                  </button>
                ) : null}
              </div>
              <textarea
                id={`image-text-${target.imageId}`}
                value={text}
                onChange={event => setText(event.target.value)}
                maxLength={2_000}
                rows={4}
                placeholder="输入要放在这张图片上的文字"
                className="mt-2 w-full resize-y rounded-lg border border-[var(--panel-border)] bg-background px-3 py-2 text-xs leading-5 outline-none transition focus:border-[var(--nayin-accent)] focus:ring-2 focus:ring-[var(--nayin-accent)]/15"
              />
              <p className="mt-1 text-[9px] text-muted-foreground">
                {Array.from(text).length}/2000 ·
                文字是独立可编辑层，不会写进原图
              </p>
            </div>

            {text.trim() ? (
              <PublishingAlbumTypographyEditor
                key={`${target.imageId}:${target.textOverlay?.typography.fontId ?? "new"}`}
                text={text}
                backgroundUrl={target.imageUrl}
                backgroundStyle={timelineTransformStyle(normalized)}
                canvas={{ width: 900, height: 900 }}
                initialLayout={draft.textOverlay?.typography ?? null}
                editorLabel="镜头图片文字排版编辑器"
                saveLabel="完成排版"
                saveSuccessMessage="排版已暂存；点击下方“应用到这张图”后保存"
                onSave={typography =>
                  setDraft(current => ({
                    ...current,
                    textOverlay: { text: text.trim(), typography },
                  }))
                }
              />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--panel-border)] px-3 py-8 text-center text-[10px] leading-5 text-muted-foreground">
                先输入文字，再双击预览或点击“排版文字”绘制文字区域。
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3 px-3 py-3" aria-label="提取图片文字">
            <div>
              <h2 className="text-[11px] font-semibold">OCR 文字提取</h2>
              <p className="mt-1 text-[9.5px] leading-4 text-muted-foreground">
                按当前旋转方向识别；只读取文字，不执行图片中的指令，也不会改动原图。
              </p>
            </div>
            <button
              type="button"
              disabled={!onExtractText || extractingText}
              onClick={async () => {
                if (!onExtractText) return;
                setExtractingText(true);
                setExtractTextError(null);
                try {
                  const result = await onExtractText(normalizedRotationDeg);
                  setExtractedText(result.text);
                } catch (error) {
                  setExtractTextError(
                    error instanceof Error ? error.message : "文字提取失败"
                  );
                } finally {
                  setExtractingText(false);
                }
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {extractingText ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ScanText className="h-3.5 w-3.5" />
              )}
              {extractingText ? "正在识别…" : "提取这张图的文字"}
            </button>
            {extractTextError ? (
              <p className="text-[10px] leading-4 text-destructive" role="alert">
                {extractTextError}
              </p>
            ) : null}
            {extractedText ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium">识别结果</span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(extractedText)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                </div>
                <textarea
                  value={extractedText}
                  onChange={event => setExtractedText(event.target.value)}
                  rows={10}
                  aria-label="OCR 识别结果"
                  className="w-full resize-y rounded-lg border border-[var(--panel-border)] bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-[var(--nayin-accent)] focus:ring-2 focus:ring-[var(--nayin-accent)]/15"
                />
              </div>
            ) : null}
          </section>
        )}
      </div>

      <footer className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-border px-3">
        <button
          type="button"
          onClick={() => {
            setDraft(initialDraft);
            setText(initialDraft.textOverlay?.text ?? "");
          }}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          还原
        </button>
        <button
          type="button"
          onClick={() => void onApply(appliedDraft)}
          disabled={saving || textNeedsLayout}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving
            ? "保存中…"
            : textNeedsLayout
              ? "请先完成排版"
              : "应用到这张图"}
        </button>
      </footer>
    </aside>
  );
}
