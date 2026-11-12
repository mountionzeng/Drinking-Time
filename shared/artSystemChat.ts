import { parseColorTransferIntent } from "./colorTransferIntent";
import { parseLuminanceGradeIntent } from "./luminanceGradeIntent";

export type ArtSystemCommand = { action: "draft" | "confirm" | "copy"; imageId?: number; sourceStoryId?: number; recipeVersion?: number };

/** Route explicit whole-work art requests before any shot/media generation. */
export function parseArtSystemChat(text: string, continuing = false): ArtSystemCommand | null {
  const value = text.trim();
  // 「按图一的颜色改图二」「只调亮度」是本地免费调色，不是整部作品的美术体系讨论。
  if (parseColorTransferIntent(value) || parseLuminanceGradeIntent(value)) return null;
  const subject = /美术体系|视觉体系|美术系统|风格体系|美术基准|风格基准|art system|visual system|style guide/i.test(value);
  const opening = value.split(/[：:。！？\n]/)[0];
  const recipeVersion = Number(value.match(/\bV\s*0*(\d+)/i)?.[1]) || undefined;
  if (/^(?:怎么|如何|为什么|what\b|how\b)/i.test(opening) || /(?:不要|先不|暂不|别|不必|don't|do not)[^，。\n]{0,12}(?:建立|生成|修改|确认|采用|使用|create|confirm|use)/i.test(opening)) return null;
  if (subject && /沿用|使用|复用|套用|复制|copy|reuse/i.test(value)) {
    const sourceStoryId = Number(value.match(/(?:故事|story)\s*#?\s*(\d+)/i)?.[1]);
    if (sourceStoryId) return { action: "copy", sourceStoryId, ...(recipeVersion ? { recipeVersion } : {}) };
  }
  const imageId = Number(value.match(/(?:图片|图像|图|image)\s*#\s*(\d+)/i)?.[1]) || undefined;
  if (subject && /建立|生成|整理|设计|保存|更新|修改|改成|调整|希望|想|generate|design|create|build|save|update|change|want/i.test(opening)) return { action: "draft" };
  if (subject && /确认|采用|确定|就用|作为|设为|confirm|approve|use/i.test(opening) && !/待确认|未确认|修改|改成|调整|change|adjust/i.test(opening))
    return { action: "confirm", ...(imageId ? { imageId } : {}), ...(recipeVersion ? { recipeVersion } : {}) };
  if (subject && /建立|生成|整理|设计|保存|更新|修改|改成|调整|希望|想|generate|design|create|build|save|update|change|want/i.test(value)) return { action: "draft" };
  // Follow-up aesthetic discussion has story scope only when no shot is selected.
  if (continuing && !/第\s*\d+\s*镜|镜头\s*\d+|shot\s*\d+|生成|渲染|出图|generate|render/i.test(value) &&
      /整体|色彩|色调|构图|材质|风格|美术|视觉|palette|composition|material|style/i.test(value) &&
      /希望|想|更|再|改|调整|保持|减少|增加|want|more|less|change|keep/i.test(value)) return { action: "draft" };
  return null;
}
