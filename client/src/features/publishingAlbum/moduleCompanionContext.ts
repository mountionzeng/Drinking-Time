import type { LayoutModuleContext } from "@shared/layoutModuleContext";
import type { ModuleDocument } from "./imagePackModules";
import type { ModuleRenderer } from "./imagePackModuleRenderer";
import { lineContextExcerpt, linePosition, locateLine, splitLines, type LineModule } from "@shared/lineModules";

/** 03 supplies canonical block order and bindings here. This adapter never creates persistent ids. */
export type ModuleLineSource = {
  chapterId: string;
  blocks: readonly LineModule[];
  moduleBlockIds: Readonly<Record<string, string>>;
  titles?: readonly string[];
};

export function moduleCompanionContext(input: {
  storyId: number;
  scope: string;
  document: ModuleDocument;
  pageIndex: number;
  selectedId: string | null;
  editing?: { id: string; text: string; cursor?: number } | null;
  lineSource?: ModuleLineSource;
  renderer: Pick<ModuleRenderer, "draw">;
}): LayoutModuleContext | null {
  const page = input.document.pages[input.pageIndex];
  const module = page?.modules.find(item => item.id === input.selectedId);
  if (!module) return null;
  const context: LayoutModuleContext = {
    storyId: input.storyId,
    scope: input.scope,
    moduleId: module.id,
    kind: module.kind,
    page: input.pageIndex + 1,
    pageCount: input.document.pages.length,
    rect: { ...module.rect },
    pageText: page.modules
      .filter(item => item.kind === "text")
      .map(item =>
        input.editing?.id === item.id ? input.editing.text : item.text
      )
      .join("\n\n")
      .slice(0, 16_000),
    ...(module.kind === "text"
      ? {
          text:
            input.editing?.id === module.id ? input.editing.text : module.text,
          fontSize: (module.fontSize * module.rect.width) / module.contentWidth,
          emphasis: module.emphasis ?? "normal",
          backdrop: Boolean(module.backdrop),
        }
      : { crop: { ...module.crop } }),
  };
  if (module.kind === "text" && module.id !== "cover-title") {
    const text = context.text ?? "";
    const selectedLines = splitLines(text);
    const localIndex = input.editing?.id === module.id && input.editing.cursor !== undefined
      ? locateLine(text, input.editing.cursor)
      : selectedLines.length === 1 ? 0 : null;
    let blocks: readonly LineModule[];
    let index: number;
    if (input.lineSource) {
      // A binding with a multi-line pending edit is not yet a canonical one-line block.
      // Let 03 split/save it first; do not invent ids or infer bindings from repeated text.
      const blockId = input.lineSource.moduleBlockIds[module.id];
      blocks = input.lineSource.blocks;
      index = selectedLines.length === 1 ? blocks.findIndex(block => block.id === blockId) : -1;
      if (index >= 0) blocks = blocks.map((block, i) => i === index ? { ...block, text: selectedLines[0] } : block);
    } else {
      // Legacy layout discussion follows layout order, including cross-page moves.
      blocks = input.document.pages.flatMap(page => page.modules.flatMap(item => {
        if (item.kind !== "text" || item.id === "cover-title") return [];
        const value = input.editing?.id === item.id ? input.editing.text : item.text;
        return splitLines(value).map((text, i) => ({ id: `${item.id}:line:${i}`, text }));
      }));
      index = localIndex === null ? -1 : blocks.findIndex(block => block.id === `${module.id}:line:${localIndex}`);
    }
    const position = linePosition(input.lineSource?.chapterId ?? input.scope, blocks, index);
    if (position) context.line = {
      source: input.lineSource ? "chapter" : "layout",
      position,
      excerpt: lineContextExcerpt({ lines: blocks.map(block => block.text), index, titles: input.lineSource?.titles, limit: 6000 }),
    };
  }
  try {
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 600,
      height: 800,
    });
    input.renderer.draw(page, canvas);
    const preview = canvas.toDataURL("image/jpeg", 0.72);
    if (
      preview.startsWith("data:image/jpeg;base64,") &&
      preview.length <= 240_000
    )
      context.pagePreview = preview;
  } catch {
    // A missing preview must not prevent discussing the text and layout data.
  }
  return context;
}
