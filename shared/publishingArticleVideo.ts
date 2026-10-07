import { z } from "zod";
import {
  imagePackParagraphs,
  normalizeImagePackBody,
  resolveIllustrationOffset,
} from "./articleIllustrations";
import {
  canonicalizePublishingVideoParagraphs,
  type PublishingVideoStoryboardPreview,
  type PublishingVideoStoryboardShot,
} from "./publishingVideoStoryboard";

export const publishingArticleLayoutSchema = z.object({
  body: z.string().min(1).max(100_000),
  illustrations: z
    .array(
      z.object({
        assetId: z.number().int().positive(),
        after: z
          .object({
            text: z.string().max(100_000),
            occurrence: z.number().int().nonnegative(),
            matches: z.number().int().nonnegative(),
          })
          .nullable(),
      })
    )
    .max(100),
});

export type PublishingArticleLayout = z.infer<
  typeof publishingArticleLayoutSchema
>;
export type PublishingArticleVideoRow = {
  id: string;
  text: string;
  voiceText: string;
  referenceImageId?: number;
  referencePrompt?: string;
  referenceImageUrl?: string;
};

/** The layout, not the model, owns text coverage and image placement. */
export function publishingArticleVideoRows(
  layout: PublishingArticleLayout
): PublishingArticleVideoRow[] {
  const body = normalizeImagePackBody(layout.body);
  const paragraphs = imagePackParagraphs(body);
  const seen = new Set<number>();
  const placements = layout.illustrations
    .map(placement => {
      if (seen.has(placement.assetId)) throw new Error("插图重复，请重新选择");
      seen.add(placement.assetId);
      const offset = resolveIllustrationOffset(paragraphs, placement.after);
      if (offset == null)
        throw new Error("插图位置对应的文字已变化，请先重新定位插图");
      return { ...placement, offset };
    })
    .sort((left, right) => left.offset - right.offset);
  const rows: PublishingArticleVideoRow[] = [];
  const leading = body.slice(0, placements[0]?.offset ?? body.length).trim();
  if (leading)
    rows.push({ id: "article-leading", text: leading, voiceText: leading });
  for (let index = 0; index < placements.length; ) {
    const start = index;
    const offset = placements[index].offset;
    while (index < placements.length && placements[index].offset === offset)
      index++;
    const text = body
      .slice(offset, placements[index]?.offset ?? body.length)
      .trim();
    // Several illustrations at one position all survive; narration is read once.
    for (let current = start; current < index; current++) {
      const placement = placements[current];
      rows.push({
        id: `article-image-${placement.assetId}`,
        referenceImageId: placement.assetId,
        text,
        voiceText: current === start ? text : "",
      });
    }
  }
  return rows;
}

export type ArticleVideoRequirements = Pick<
  PublishingVideoStoryboardShot,
  | "subject"
  | "action"
  | "imageRequirement"
  | "videoRequirement"
  | "soundRequirement"
>;

export const ARTICLE_VIDEO_PLANNING_VERSION = 2;

export const articleVideoSupplementSchema = z.object({
  anchorRowId: z.string().min(1),
  position: z.enum(["before", "after"]),
  sourceRowId: z.string().min(1),
  reason: z.string().trim().min(1).max(300),
  subject: z.string().trim().min(1).max(2_000),
  action: z.string().trim().min(1).max(2_000),
  imageRequirement: z.string().trim().min(1).max(4_000),
  videoRequirement: z.string().trim().min(1).max(4_000),
  soundRequirement: z.string().max(2_000).default(""),
  beat: z.enum(["开场", "起势", "转折", "收束"]).optional(),
});
export type ArticleVideoSupplement = z.infer<
  typeof articleVideoSupplementSchema
>;

function supplementShotId(addition: ArticleVideoSupplement): string {
  const identity = JSON.stringify([
    addition.anchorRowId, addition.position, addition.sourceRowId,
    addition.reason, addition.action, addition.imageRequirement,
  ]);
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index++) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  }
  return `${addition.anchorRowId}-supplement-${addition.position}-${(hash >>> 0).toString(36)}`;
}

export function buildPublishingArticleVideoPreview(input: {
  rows: PublishingArticleVideoRow[];
  requirements: ReadonlyMap<string, ArticleVideoRequirements>;
  supplements?: readonly ArticleVideoSupplement[];
  now: number;
}): PublishingVideoStoryboardPreview {
  const paragraphs = input.rows.flatMap(row =>
    row.voiceText
      ? canonicalizePublishingVideoParagraphs(row.voiceText).map(paragraph => ({
          ...paragraph,
          paragraphId: `${row.id}-${paragraph.paragraphId}`,
        }))
      : []
  );
  const originalShots: PublishingVideoStoryboardShot[] = input.rows.map(
    (row, index) => {
      const source = paragraphs.filter(paragraph =>
        paragraph.paragraphId.startsWith(`${row.id}-`)
      );
      const visual = row.referenceImageId
        ? "保持参考插图的主体、场景、构图和画风"
        : "按正文呈现具体人物、物件和场景";
      const requirements = input.requirements.get(row.id) ?? {
        subject: row.text || "插图中的主体",
        action: "主体自然微动，镜头缓慢推进，保持画面连续。",
        imageRequirement: `${visual}。${row.text}`,
        videoRequirement: `${visual}。以轻微的主体动作和缓慢推进呈现这段故事，保持人物外观与空间关系稳定。`,
        soundRequirement: "",
      };
      return {
        draftShotId: row.id,
        beat:
          index === 0
            ? "开场"
            : index === input.rows.length - 1
              ? "收束"
              : "起势",
        segmentIds: source.map(paragraph => `segment-${paragraph.paragraphId}`),
        sourceParagraphIds: source.map(paragraph => paragraph.paragraphId),
        scriptText: row.text,
        voiceText: row.voiceText,
        ...(row.referenceImageId
          ? { referenceImageId: row.referenceImageId }
          : {}),
        ...requirements,
      };
    }
  );
  const rowsById = new Map(input.rows.map(row => [row.id, row]));
  const originalsById = new Map(
    originalShots.map(shot => [shot.draftShotId, shot])
  );
  const seen = new Set<string>();
  const additions = (input.supplements ?? []).flatMap(addition => {
    const source = rowsById.get(addition.sourceRowId);
    if (!source || !rowsById.has(addition.anchorRowId)) return [];
    const key = `${addition.anchorRowId}:${addition.position}:${addition.reason}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const sourceShot = originalsById.get(source.id)!;
    return [
      {
        anchorRowId: addition.anchorRowId,
        position: addition.position,
        shot: {
          // Array order must not move edits or paid media onto another gap.
          draftShotId: supplementShotId(addition),
          segmentIds: [...sourceShot.segmentIds],
          sourceParagraphIds: [...sourceShot.sourceParagraphIds],
          scriptText: addition.action,
          voiceText: "",
          ...(source.referenceImageId
            ? { continuityImageId: source.referenceImageId }
            : {}),
          supplementReason: addition.reason,
          subject: addition.subject,
          action: addition.action,
          imageRequirement: addition.imageRequirement,
          videoRequirement: addition.videoRequirement,
          soundRequirement: addition.soundRequirement,
          beat: addition.beat ?? "起势",
        } satisfies PublishingVideoStoryboardShot,
      },
    ];
  });
  const shots = originalShots.flatMap(shot => [
    ...additions
      .filter(
        item =>
          item.anchorRowId === shot.draftShotId && item.position === "before"
      )
      .map(item => item.shot),
    shot,
    ...additions
      .filter(
        item =>
          item.anchorRowId === shot.draftShotId && item.position === "after"
      )
      .map(item => item.shot),
  ]);
  return {
    previewId: `article-preview-${input.now}`,
    sourceMode: "article",
    revision: 1,
    status: "preview",
    createdAt: input.now,
    updatedAt: input.now,
    source: null,
    staleReasons: [],
    paragraphs,
    segments: paragraphs.map(paragraph => {
      const shot = shots.find(shot =>
        shot.sourceParagraphIds.includes(paragraph.paragraphId)
      )!;
      return {
        segmentId: `segment-${paragraph.paragraphId}`,
        sourceParagraphId: paragraph.paragraphId,
        scriptText: paragraph.text,
        modelScriptText: paragraph.text,
        visualTreatment: shot.action,
        treatmentReason: null,
        userEdited: false,
        shotIds: shots
          .filter(shot =>
            shot.sourceParagraphIds.includes(paragraph.paragraphId)
          )
          .map(shot => shot.draftShotId),
      };
    }),
    shots,
  };
}
