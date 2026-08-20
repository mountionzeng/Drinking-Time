import { createHash } from "node:crypto";

import { canonicalJsonStringify } from "../../shared/canonicalJson";
import type { PublishingCoverArtReference } from "../../shared/publishingDraft";
import {
  applyPublishingCoverArtDirection,
  extractPublishingCoverArtDirection,
} from "./publishingCoverArtDirection";
import { engineerImagePrompt } from "./renderGate";

export const PUBLISHING_ALBUM_PROMPT_COMPILER_VERSION = 1;
export const PUBLISHING_ALBUM_ASPECT_RATIO = "3:4";

export function publishingAlbumBackgroundHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

export function composePublishingAlbumBackgroundBrief(input: {
  pageText: string;
  pageOrdinal: number;
  pageCount: number;
}): string {
  const text = input.pageText.trim() || "一段尚待填写的私人叙事";
  return [
    "【画册本页语义】",
    `这是九宫格静态画册的第 ${input.pageOrdinal}/${input.pageCount} 页。把下面文字的事件、关系、情绪和隐含意象转译成一幅独立画面；不要把原文写进像素：`,
    text,
    "【本页构图任务】",
    "依据本页语义重新选择主体、景别、空间和视觉重心。画面要与整套封面属于同一位创作者、同一材料世界，但不得照搬封面的主体位置、留白位置或版式。",
    "为产品稍后叠加的中文文字层预留一块低细节、对比稳定、边缘安静的自然空间；它必须仍是画面的一部分，而不是白纸、卡片、标签、横幅或文本框。",
    "【无字硬规则】",
    "像素中不得出现任何中文、外文、字母、数字、伪文字、Logo、水印、签名、账号、字幕、标题、标签、界面字符或类似字形的装饰。避免书页、报纸、招牌、包装、钟面、日历和屏幕；若故事事实必须出现，只能作为无字、被遮挡或完全不可读的材质。",
  ].join("\n");
}

export async function compilePublishingAlbumBackgroundPrompt(input: {
  pageText: string;
  pageOrdinal: number;
  pageCount: number;
  coverPrompt: string;
  feedback?: string;
  storyId?: number;
}): Promise<{
  prompt: string;
  artDirection: string;
  artDirectionHash: string;
}> {
  const artDirection = extractPublishingCoverArtDirection(input.coverPrompt);
  if (!artDirection) throw new Error("正式封面没有可继承的美术方向，请先重新采用有效封面");
  const brief = composePublishingAlbumBackgroundBrief(input);
  const inherited = applyPublishingCoverArtDirection(brief, artDirection);
  const prompt = await engineerImagePrompt({
    prompt: inherited,
    storyId: input.storyId,
    outputPurpose: "publishing-album",
    referencePolicy: "style-only",
    authoredBrief: true,
    longPrompt: true,
    userInstructions: input.feedback?.trim() ? [input.feedback.trim()] : undefined,
  });
  return {
    prompt,
    artDirection,
    artDirectionHash: publishingAlbumBackgroundHash(artDirection),
  };
}

export function publishingAlbumArtReferenceFromCoverPrompt(
  coverPrompt: string
): PublishingCoverArtReference | null {
  const artDirection = extractPublishingCoverArtDirection(coverPrompt);
  if (!artDirection) return null;
  const section = (name: string) => {
    const match = artDirection.match(new RegExp(`【${name}[^】]*】\\s*([^【]+)`));
    return match?.[1]?.split(/[；。\n]/).map(value => value.trim()).filter(Boolean).slice(0, 8) ?? [];
  };
  return {
    label: "正式采用封面的美术 DNA",
    style: section("艺术谱系"),
    palette: section("用户持续要求"),
    light: section("文本美术信号"),
    composition: [],
    material: section("手作完成度"),
    mood: section("文本美术信号"),
  };
}

export function publishingAlbumFontTagsFromCoverPrompt(coverPrompt: string): string[] {
  const artDirection = extractPublishingCoverArtDirection(coverPrompt) ?? "";
  const rules: ReadonlyArray<[RegExp, readonly string[]]> = [
    [/水墨|笔墨|墨色|毛笔/, ["ink", "painting", "brush"]],
    [/纸|纤维|宣纸|书页/, ["paper", "editorial"]],
    [/安静|克制|留白|清淡/, ["quiet", "minimal"]],
    [/复古|民国|旧时|怀旧/, ["retro", "republic-era"]],
    [/手写|手作|书写/, ["handwritten"]],
    [/现代|当代/, ["modern"]],
    [/几何|秩序|网格/, ["geometric"]],
    [/科技|未来|数字/, ["technology"]],
    [/戏剧|强烈|张力/, ["dramatic"]],
  ];
  return Array.from(new Set(rules.flatMap(([pattern, tags]) =>
    pattern.test(artDirection) ? tags : []
  )));
}
