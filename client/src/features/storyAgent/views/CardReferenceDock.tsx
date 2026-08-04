import React, { useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import { useCardReferenceDockSlice } from "@/features/storyAgent/spine/selectors";
import type { VisualCanvasItem } from "@/features/storyAgent/types";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import { StoryboardMediaPreviewDialog } from "./StoryboardMediaPreview";

export function CardReferenceDock({
  cardId,
  visualItems,
  generatedImage,
  imageRationale,
  onDeleteGeneratedImage,
}: {
  cardId: string;
  visualItems: VisualCanvasItem[];
  generatedImage?: GeneratedImageItem;
  imageRationale?: string | null;
  onDeleteGeneratedImage?: (image: GeneratedImageItem) => void;
}) {
  const { isArtWorking, artDirection } = useCardReferenceDockSlice();
  const {
    addVisualReference,
    removeVisualCanvasItem,
    setCharacterReferenceByUrl,
  } = useStoryAgentActions();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const isFinalizing = generatedImage?.status === "finalizing";
  const isDraft = generatedImage?.status === "draft";
  const displayReason = imageRationale?.trim();
  const characterUrl = artDirection.references.find(
    reference => reference.role === "character"
  )?.imageUrl;

  const handleFiles = async (files: FileList | File[]) => {
    const file = Array.from(files).find(entry =>
      entry.type.startsWith("image/")
    );
    if (!file) return;
    await addVisualReference(file, undefined, cardId);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    void handleFiles(event.dataTransfer.files);
  };

  return (
    <>
      <div
        className="mt-3 rounded-md border p-2"
        onPointerDown={event => event.stopPropagation()}
        style={{
          borderColor: dragActive
            ? "var(--nayin-accent)"
            : "var(--panel-border)",
          background: "var(--background)",
        }}
        onDragEnter={event => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold text-muted-foreground">
            故事材料 {visualItems.length ? `· ${visualItems.length} 张` : ""}
          </span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isArtWorking}
            className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            style={{ borderColor: "var(--panel-border)" }}
          >
            {isArtWorking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ImagePlus className="h-3 w-3" />
            )}
            添加参考
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              if (event.currentTarget.files)
                void handleFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </div>

        {generatedImage ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setPreviewImageUrl(generatedImage.imageUrl)}
            onKeyDown={event => {
              if (event.key === "Enter")
                setPreviewImageUrl(generatedImage.imageUrl);
            }}
            className="relative mt-2 grid cursor-pointer grid-cols-[72px_1fr] gap-2 overflow-hidden rounded-md border p-1.5"
            style={{ borderColor: "var(--panel-border)" }}
          >
            <button
              type="button"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onDeleteGeneratedImage?.(generatedImage);
              }}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition hover:text-destructive"
              aria-label="删除已选择画面"
              title="删除这张已选择画面，并记录为不想要"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <img
              src={generatedImage.imageUrl}
              alt={generatedImage.prompt || "当前生成画面"}
              className="aspect-square w-full rounded object-cover"
            />
            {isFinalizing ? (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-sm">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                正在出正式版
              </span>
            ) : isDraft ? (
              <span className="absolute left-2 top-2 rounded-full bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-sm">
                草稿待确认
              </span>
            ) : null}
            <div className="min-w-0 self-center">
              <div className="text-[10px] font-semibold text-foreground">
                {isFinalizing ? "正式版生成中" : "当前生成画面"}
              </div>
              <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted-foreground">
                {isFinalizing
                  ? "已收下草稿，正式版完成后会自动替换到这里"
                  : displayReason ||
                    generatedImage.prompt ||
                    "从手机端同步的故事画面"}
              </p>
              <button
                type="button"
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (generatedImage.status !== "ready") return;
                  setCharacterReferenceByUrl(
                    generatedImage.imageUrl,
                    "当前画面主角"
                  );
                }}
                disabled={generatedImage.status !== "ready"}
                className="mt-1 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor:
                    generatedImage.imageUrl === characterUrl
                      ? "var(--nayin-accent)"
                      : "var(--panel-border)",
                }}
              >
                <Star
                  className={`h-2.5 w-2.5 ${generatedImage.imageUrl === characterUrl ? "fill-amber-400 text-amber-400" : ""}`}
                />
                {generatedImage.status !== "ready"
                  ? "待正式版"
                  : generatedImage.imageUrl === characterUrl
                    ? "已设为主角"
                    : "设为主角"}
              </button>
            </div>
          </div>
        ) : null}

        {visualItems.length === 0 ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isArtWorking}
            className="mt-2 flex min-h-[50px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 text-center transition disabled:opacity-50"
            style={{
              borderColor: dragActive
                ? "var(--nayin-accent)"
                : "var(--panel-border)",
              background: dragActive ? "var(--nayin-glow)" : "transparent",
            }}
          >
            <ImagePlus className="h-3.5 w-3.5 text-nayin-bright" />
            <span className="text-[9px] font-medium text-muted-foreground">
              把与这一刻有关的照片拖进来
            </span>
          </button>
        ) : (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {visualItems.map(item => {
              const itemUrl = item.originalImageUrl || item.imageUrl;
              const isCharacter = !!characterUrl && itemUrl === characterUrl;
              return (
                <div
                  key={item.id}
                  className="group/reference relative h-14 w-14 shrink-0 overflow-hidden rounded-md border"
                  style={{
                    borderColor: isCharacter
                      ? "var(--nayin-accent)"
                      : "var(--panel-border)",
                  }}
                  title={
                    isCharacter ? "主角参照（跨镜头锁人物长相）" : item.title
                  }
                >
                  <img
                    src={itemUrl}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                  {isCharacter ? (
                    <span className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white">
                      <Star className="h-2.5 w-2.5 fill-current" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      setCharacterReferenceByUrl(itemUrl, item.title)
                    }
                    className="absolute bottom-1 left-1 flex h-5 items-center gap-0.5 rounded-full bg-background/85 px-1.5 text-[9px] font-medium text-muted-foreground opacity-0 transition hover:text-foreground group-hover/reference:opacity-100"
                    aria-label={`设为主角参照 ${item.title}`}
                  >
                    <Star className="h-2.5 w-2.5" />
                    主角
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVisualCanvasItem(item.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-muted-foreground opacity-0 transition group-hover/reference:opacity-100"
                    aria-label={`移除 ${item.title}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <StoryboardMediaPreviewDialog
        preview={
          previewImageUrl
            ? { kind: "image", url: previewImageUrl, label: "预览" }
            : null
        }
        onClose={() => setPreviewImageUrl(null)}
      />
    </>
  );
}
