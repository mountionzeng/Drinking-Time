import type { StoryMaterialState } from "@shared/storyMaterial";
import type { ShotRenderReferences } from "@shared/shotImageRender";

/** Describe the actual selection, including a deliberate opt-out. */
export function shotImageContinuityNotice(material: StoryMaterialState, references: ShotRenderReferences, language: string) {
  const zh = language.startsWith("zh");
  const style = material.artSystemStyle;
  const lines: string[] = [];
  if (style) lines.push(zh
    ? `画风沿用全片已确认的「${style.name}」V${style.version}；取消参考图片不会清除这套画风规则。`
    : `Keep the film’s confirmed style “${style.name}” V${style.version}. Removing an image reference does not remove these style rules.`);
  if (references.assets.character) return lines.join("\n");
  const source = references.imagePurpose === "scene-style" && material.shots.find(shot =>
    [shot.currentImage, ...(shot.imageVersions ?? []), ...(shot.imageGenerationReferences ?? [])]
      .some(image => image && references.imageIds.includes(image.id)));
  if (source) lines.push(zh
    ? `尚未单独指定人物造型：本镜若出现同一人物，会参考第 ${String(source.shotNo).padStart(2, "0")} 镜的已确定画面，沿用脸型、发型和服装；动作与构图按本镜要求。请检查候选的人物是否一致，确认前不会替换原图。`
    : `No separate character design is selected. If the same character appears, use the established image from shot ${source.shotNo} for their face, hair and clothing; follow this shot for action and composition. Check the candidates for consistency before adopting.`);
  else if (!references.imageIds.length) lines.push(zh
    ? "本次没有选择人物参考图，无法保证沿用首张图的人物外观。若要保持同一人物，请取消并选回首个已确定画面；系统不会自动加回你取消的图片。"
    : "No character reference image is selected, so this render cannot reliably retain the first image’s character. To do so, cancel and select the first established image. Removed references are never silently restored.");
  return lines.join("\n");
}
