import type { LayoutModuleContext } from "@shared/layoutModuleContext";
import type { ModuleDocument } from "./imagePackModules";
import type { ModuleRenderer } from "./imagePackModuleRenderer";

export function moduleCompanionContext(input: {
  storyId: number;
  scope: string;
  document: ModuleDocument;
  pageIndex: number;
  selectedId: string | null;
  editing?: { id: string; text: string } | null;
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
