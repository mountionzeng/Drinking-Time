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

function sectionName(heading: string): string {
  return heading.replace(/·第\d+轮.*$/, "").trim();
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
  const block = [
    "【正式封面美术 DNA｜故事级硬约束】",
    "封面只控制美术表达，不复制封面的主体、物件、场景、构图或封面排版。剧本与本镜图片要求控制这一镜画什么；本次用户修改原话拥有最高优先级。",
    art,
  ].join("\n");
  const available = Math.max(0, maxLength - block.length - 2);
  return `${block}\n\n${shotPrompt.trim().slice(0, available)}`.trim();
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
