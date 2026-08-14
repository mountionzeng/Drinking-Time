import {
  normalizePublishingDraftState,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";

const REUSABLE_COVER_ART_SECTIONS = [
  "用户持续要求",
  "文本美术信号",
  "私人策展库审美底线",
  "艺术谱系",
  "手作完成度",
  "用户拒绝过的风格",
  "艺术跃迁",
  "风格化硬约束",
  "静态图片无字硬约束",
] as const;
const REUSABLE_COVER_ART_SECTION_NAMES: ReadonlySet<string> = new Set(
  REUSABLE_COVER_ART_SECTIONS
);

const SECTION_HEADING = /^【([^】]+)】\s*(.*)$/;
const MAX_MERGED_PROMPT_CHARS = 12_000;

function sectionName(heading: string): string {
  return heading.replace(/·第\d+轮.*$/, "").trim();
}

export function extractPublishingCoverArtDirection(
  prompt: string | null | undefined
): string {
  const sections: string[][] = [];
  let activeSection: string[] | null = null;

  for (const line of (prompt ?? "").split(/\r?\n/)) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      const name = sectionName(heading[1]);
      if (!REUSABLE_COVER_ART_SECTION_NAMES.has(name)) {
        activeSection = null;
        continue;
      }
      activeSection = [
        `【${heading[1]}】${heading[2] ? `\n${heading[2]}` : ""}`,
      ];
      sections.push(activeSection);
      continue;
    }
    activeSection?.push(line);
  }

  return sections
    .map(section => section.join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function applyPublishingCoverArtDirection(
  shotPrompt: string,
  coverArtDirection: string | null | undefined,
  maxLength = MAX_MERGED_PROMPT_CHARS
): string {
  const art = coverArtDirection?.trim();
  if (!art) return shotPrompt.trim().slice(0, maxLength);
  const block = `【正式采用封面的美术提示词｜原文复制】\n${art}`;
  const available = Math.max(0, maxLength - block.length - 2);
  return `${block}\n\n${shotPrompt.trim().slice(0, available)}`.trim();
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
