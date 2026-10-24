import { useEffect, useState } from "react";
import type { Chapter } from "./useChapters";
import { makeModulePack } from "./imagePackModuleRenderer";
import { IMAGE_PACK_STYLES } from "./imagePackComposition";
import { IMAGE_PACK_TEXTURES } from "./imagePackMaterial";
import { mapChapterImages } from "./ChapterWorkspace";

type Content = Pick<Chapter, "title" | "blocks" | "layout">;
function Preview({
  content,
  urls,
  label,
}: {
  content: Content;
  urls: Record<string, string>;
  label: string;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const created: string[] = [];
    setImages([]);
    setError("");
    const layout = mapChapterImages(content.layout, urls);
    if (layout) {
      const settings = content.blocks.settings;
      void makeModulePack(
        {
          fitOverflowText: true,
          title: content.title,
          body: content.blocks.body,
          fontId: settings?.fontId ?? "noto-serif-sc",
          style:
            settings?.style && settings.style in IMAGE_PACK_STYLES
              ? (settings.style as keyof typeof IMAGE_PACK_STYLES)
              : "sage",
          texture:
            settings?.texture && settings.texture in IMAGE_PACK_TEXTURES
              ? (settings.texture as keyof typeof IMAGE_PACK_TEXTURES)
              : "paper",
          textureSeed: settings?.textureSeed ?? 0,
          includeCover: false,
          bodyTextureUrl: content.blocks.bodyTextureKey
            ? urls[content.blocks.bodyTextureKey]
            : undefined,
        },
        layout,
        abort.signal
      )
        .then(pages => {
          if (abort.signal.aborted) return;
          created.push(...pages.map(page => URL.createObjectURL(page.blob)));
          setImages([...created]);
        })
        .catch(cause => {
          if (!abort.signal.aborted)
            setError(cause instanceof Error ? cause.message : "预览失败");
        });
    }
    return () => {
      abort.abort();
      created.forEach(url => URL.revokeObjectURL(url));
    };
  }, [content, urls]);
  return (
    <article className="min-w-0 space-y-2">
      <h3 className="font-medium">
        {label} · {content.title}
      </h3>
      {content.blocks.containsAiText && (
        <p className="text-xs text-muted-foreground">包含 AI 辅助文字</p>
      )}
      <p className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">
        {content.blocks.body || "（空白章节）"}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!content.layout && (
        <p className="text-xs text-muted-foreground">未编排，打开时自动排版</p>
      )}
      <div className="flex gap-2 overflow-auto">
        {images.map((url, index) => (
          <img
            key={url}
            className="w-40 shrink-0 object-contain"
            src={url}
            alt={`${label}第 ${index + 1} 页排版`}
          />
        ))}
      </div>
    </article>
  );
}
export function ChapterComparison({
  current,
  candidate,
  currentUrls,
  candidateUrls,
}: {
  current: Content;
  candidate: Content;
  currentUrls: Record<string, string>;
  candidateUrls: Record<string, string>;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Preview label="当前章节" content={current} urls={currentUrls} />
      <Preview label="发回版本" content={candidate} urls={candidateUrls} />
    </div>
  );
}
