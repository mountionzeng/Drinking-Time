import { useEffect, useMemo, useState } from "react";
import { textChanges, type TextChange } from "./textChanges";
import type { Chapter } from "./useChapters";
import { makeModulePack } from "./imagePackModuleRenderer";
import { IMAGE_PACK_STYLES } from "./imagePackComposition";
import { IMAGE_PACK_TEXTURES } from "./imagePackMaterial";
import { mapChapterImages } from "./ChapterWorkspace";

type Content = Pick<Chapter, "title" | "blocks" | "layout">;
function ChangedText({ changes, side }: { changes: TextChange[]; side: "before" | "after" }) {
  return <>{changes.filter(part => part.kind !== (side === "before" ? "added" : "removed")).map((part, index) => part.kind === "removed" ? <del key={index} className="bg-red-50 text-red-800 decoration-2">{part.text}</del> : part.kind === "added" ? <mark key={index} className="bg-red-50 text-red-800 underline decoration-2">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}
function Preview({
  content,
  urls,
  label,
  changes,
  titleChanges,
  side,
  mode,
}: {
  content: Content;
  urls: Record<string, string>;
  label: string;
  changes: TextChange[];
  titleChanges: TextChange[];
  side: "before" | "after";
  mode: "text" | "images" | "all";
}) {
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode === "text") return;
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
  }, [content, urls, mode]);
  return (
    <article className="min-w-0 space-y-2">
      <h3 className="font-medium">
        {label} · <ChangedText changes={titleChanges} side={side} />
      </h3>
      <p className="text-xs text-muted-foreground">{content.blocks.attribution?.editorName || "未记录编辑者"}</p>
      {content.blocks.attribution?.changeNote && <p className="text-sm">{content.blocks.attribution.changeNote}</p>}
      {content.blocks.containsAiText && (
        <p className="text-xs text-muted-foreground">包含 AI 辅助文字</p>
      )}
      {mode !== "images" && <p className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">
        <ChangedText changes={changes} side={side} />
        {!content.blocks.body && "（空白章节）"}
      </p>}
      {mode !== "text" && <>
      <div className="flex gap-2 overflow-auto">{[...new Set([content.blocks.coverKey, content.blocks.bodyTextureKey, ...content.blocks.illustrations.map(image => image.key)].filter((key): key is string => Boolean(key)))].map(key => <figure key={key} className="w-28 shrink-0"><img src={urls[key] ?? key} alt={`${label}的${key === content.blocks.coverKey ? "封面" : key === content.blocks.bodyTextureKey ? "底图" : "插图"}`} className="h-28 w-28 object-contain" /><figcaption className="text-xs">{key === content.blocks.coverKey ? "封面" : key === content.blocks.bodyTextureKey ? "底图" : "插图"}</figcaption></figure>)}</div>
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
      </>}
    </article>
  );
}
export function ChapterComparison({
  current,
  candidate,
  currentUrls,
  candidateUrls,
  candidateLabel = "收到的版本",
  mode = "all",
}: {
  current: Content;
  candidate: Content;
  currentUrls: Record<string, string>;
  candidateUrls: Record<string, string>;
  candidateLabel?: string;
  mode?: "text" | "images" | "all";
}) {
  const changes = useMemo(() => textChanges(current.blocks.body, candidate.blocks.body), [current.blocks.body, candidate.blocks.body]);
  const titleChanges = useMemo(() => textChanges(current.title, candidate.title), [current.title, candidate.title]);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <p className="text-xs text-muted-foreground md:col-span-2">左侧为当前稿，右侧为所选版本。{mode === "images" ? "对比图片及排版；正文内容保留在各自排版中。" : <>红色下划线表示新增或改写，红色删除线表示删除。{current.blocks.body === candidate.blocks.body ? "正文没有变化。" : ""}</>}</p>
      <Preview label="当前章节" content={current} urls={currentUrls} changes={changes} titleChanges={titleChanges} side="before" mode={mode} />
      <Preview label={candidateLabel} content={candidate} urls={candidateUrls} changes={changes} titleChanges={titleChanges} side="after" mode={mode} />
    </div>
  );
}
