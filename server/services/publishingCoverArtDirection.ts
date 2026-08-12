import type { ArtRecipeDNA } from "../../shared/artDirection";
import {
  normalizePublishingDraftState,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";

const REUSABLE_COVER_ART_SECTIONS = [
  ["艺术谱系", 420],
  ["手作完成度", 360],
  ["风格化硬约束", 420],
  ["静态图片无字硬约束", 360],
  ["文本美术信号", 220],
  ["私人策展库审美底线", 260],
  ["用户拒绝过的风格", 180],
  ["艺术跃迁", 220],
] as const;
const REUSABLE_COVER_ART_SECTION_NAMES: ReadonlySet<string> = new Set(
  REUSABLE_COVER_ART_SECTIONS.map(([name]) => name)
);

const SECTION_HEADING = /^【([^】]+)】\s*(.*)$/;
const MAX_COVER_ART_DIRECTION_CHARS = 2_200;
const MAX_MERGED_PROMPT_CHARS = 12_000;

const PHOTOGRAPHIC_SHOT_TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> =
  [
    [/\bcinematic\b/gi, "handmade illustrated"],
    [/\bsleek\b/gi, "hand-shaped"],
    [
      /\bminimal white desktop\b/gi,
      "simplified pale desktop rendered as flat painted planes",
    ],
    [
      /\bcool clinical top lighting\b/gi,
      "cool top-lit value field built from layered pigment",
    ],
    [/\bsharp rim light\b/gi, "painted edge-value contrast"],
    [
      /\bglass texture\b/gi,
      "translucent pigment layering with reserved paper highlights",
    ],
    [/\bcrisp edges\b/gi, "deliberate hand-drawn edges"],
    [
      /\bclean high-contrast look\b/gi,
      "clear painted value contrast with visible medium texture",
    ],
    [
      /\b(?:fingertip|subject) in sharp focus\b/gi,
      "fingertip defined by a clear hand-drawn contour and local value contrast",
    ],
    [
      /\bskin detail\b/gi,
      "simplified hand anatomy with visible pigment and paper texture",
    ],
    [
      /\bshallow depth of field\b/gi,
      "foreground-background separation through painted value and shape hierarchy",
    ],
    [
      /\bsoft out-of-focus background\b/gi,
      "background reduced to low-contrast painted shapes and paper reserve",
    ],
    [
      /\brealistic glass and sand detail\b/gi,
      "glass and sand expressed through translucent layered color, negative space, hand-drawn edges, pigment granulation and paper tooth",
    ],
    [
      /\bslightly painterly textures\b/gi,
      "unmistakably handmade pigment, paper tooth, dry-brush edges and visible underdrawing",
    ],
    [/\brealistic\b/gi, "stylized and visibly hand-painted"],
    [/玻璃干净反光/g, "玻璃以半透明叠色和纸面留白表现反光，不作物理级写实渲染"],
    [
      /冷白顶光\s*\+\s*轻微侧逆光/g,
      "冷白顶光与轻微侧逆光转译为冷色明度块、叠色和手绘边缘关系",
    ],
    [/指尖对焦清晰/g, "指尖以清晰的手绘轮廓和局部明度对比突出"],
    [/后景虚化/g, "后景以低对比概括色块和纸面留白弱化"],
    [/玻璃材质高反差/g, "玻璃以半透明叠色、留白和手绘边缘形成明度反差"],
    [/沙粒呈细小颗粒质感/g, "沙粒以颜料颗粒与纸面阻力表现细小质感"],
  ];

function sectionName(heading: string): string {
  return heading.replace(/·第\d+轮.*$/, "").trim();
}

function translatePhotographicShotLanguage(prompt: string): string {
  return PHOTOGRAPHIC_SHOT_TRANSLATIONS.reduce(
    (translated, [pattern, replacement]) =>
      translated.replace(pattern, replacement),
    prompt
  );
}

export function extractPublishingCoverArtDirection(
  prompt: string | null | undefined
): string {
  const sections = new Map<string, string[]>();
  let activeName: string | null = null;

  for (const line of (prompt ?? "").split(/\r?\n/)) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      activeName = sectionName(heading[1]);
      if (!REUSABLE_COVER_ART_SECTION_NAMES.has(activeName)) {
        activeName = null;
        continue;
      }
      sections.set(activeName, [
        `【${heading[1]}】${heading[2] ? `\n${heading[2]}` : ""}`,
      ]);
      continue;
    }
    if (activeName) sections.get(activeName)?.push(line);
  }

  return REUSABLE_COVER_ART_SECTIONS.flatMap(([name, limit]) => {
    const section = sections.get(name)?.join("\n").trim();
    return section ? [section.slice(0, limit)] : [];
  })
    .join("\n\n")
    .slice(0, MAX_COVER_ART_DIRECTION_CHARS);
}

export function applyPublishingCoverArtDirection(
  shotPrompt: string,
  coverArtDirection: string | null | undefined,
  maxLength = MAX_MERGED_PROMPT_CHARS
): string {
  const art = coverArtDirection?.trim();
  if (!art) return shotPrompt.trim().slice(0, maxLength);
  const translatedShotPrompt = translatePhotographicShotLanguage(
    shotPrompt.trim()
  );
  const block = [
    "【正式封面美术 DNA｜故事级硬约束】",
    "封面只控制美术表达，不复制封面的主体、物件、场景、构图或封面排版。剧本与本镜图片要求控制这一镜画什么；本次用户修改原话拥有最高优先级。",
    art,
    "【镜头词的封面媒介转译】",
    "默认图片要求里的近景、顶光、逆光、对焦、虚化、高反差和颗粒只描述主体层级与画面关系，不授权摄影写实。它们必须用正式封面的色块、笔触、纸面、叠色、留白和手绘边缘来实现；不得生成真实皮肤毛孔、光学景深、棚拍产品布光或物理级玻璃渲染。",
  ].join("\n");
  const available = Math.max(0, maxLength - block.length - 2);
  return `${block}\n\n${translatedShotPrompt.slice(0, available)}`.trim();
}

export function publishingCoverArtRecipe(
  coverArtDirection: string | null | undefined
): ArtRecipeDNA | undefined {
  if (!coverArtDirection?.trim()) return undefined;
  return {
    style: ["严格沿用上文“正式封面美术 DNA”，不得切换成摄影写实或另一种媒介"],
    palette: [],
    light: [],
    composition: [],
    material: [],
    negative: [
      "photorealism",
      "commercial product photography",
      "smooth 3D rendering",
      "readable text or pseudo-text",
    ],
  };
}

export function selectPublishingStoryboardArtRecipe(input: {
  inheritedCoverArtRecipe?: ArtRecipeDNA;
  explicitStyleRecipe?: ArtRecipeDNA;
  storyArtRecipe?: ArtRecipeDNA;
}): ArtRecipeDNA | undefined {
  return (
    input.inheritedCoverArtRecipe ??
    input.explicitStyleRecipe ??
    input.storyArtRecipe
  );
}

export async function resolvePublishingCoverArtDirection(input: {
  storyId: number;
  storyBody: Record<string, unknown>;
  loadImage: (id: number) => Promise<{
    id: number;
    storyId: number | null;
    prompt: string | null;
  } | null>;
}): Promise<string> {
  const publishing = normalizePublishingDraftState(input.storyBody.publishing);
  const versionId =
    publishing.activeVideoStoryboardVersionId ?? publishing.activeVersionId;
  const version =
    publishing.versions?.find(candidate => candidate.versionId === versionId) ??
    resolvePublishingActiveVersion(publishing);
  const coverAssetId = version.cover?.assetId ?? publishing.cover?.assetId;
  if (!coverAssetId) return "";
  const cover = await input.loadImage(coverAssetId);
  if (!cover || cover.storyId !== input.storyId) return "";
  return extractPublishingCoverArtDirection(cover.prompt);
}
