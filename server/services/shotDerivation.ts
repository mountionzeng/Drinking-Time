import { nanoid } from "nanoid";
import { invokeAgent } from "../_core/agentChannel";
import {
  confirmDerivedShotAtomic,
  createGeneratedImage,
  createShotDerivationDraft,
  getShotDerivationDraft,
  getStoryById,
  getVideoTakeById,
  undoDerivedShotAtomic,
  updateShotDerivationDraft,
} from "../db";
import { editImage, storeImageBytes } from "./imageGen";
import { materializeImageInput } from "./imageAssets";
import { getStoryMaterialState } from "./storyMaterials";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import { DEFAULT_TIMELINE_TRANSFORM } from "../../shared/storyMaterial";

type ReferenceRole = "person" | "scene" | "object" | "composition";

function decodeBase64(value: string): Buffer {
  const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(payload, "base64");
}

function parseJsonObject(value: string): Record<string, unknown> {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("模型没有返回有效分析");
  }
  return parsed as Record<string, unknown>;
}

export async function createDerivationDraft(
  input: {
    storyId: number;
    sourceStableShotId: string;
    sourceTakeId: number;
    sourceTimeSec: number;
    crop: Record<string, number>;
    fullFrameBase64: string;
    cropBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
  },
  userId: number
) {
  const take = await getVideoTakeById(input.sourceTakeId, userId);
  if (
    !take ||
    take.storyId !== input.storyId ||
    take.stableShotId !== input.sourceStableShotId ||
    take.status !== "available" ||
    take.extractionCapability !== "available"
  ) {
    throw new Error("来源视频不存在或不属于当前镜头");
  }
  const [fullFrame, crop] = await Promise.all([
    storeImageBytes(decodeBase64(input.fullFrameBase64), input.mimeType),
    storeImageBytes(decodeBase64(input.cropBase64), input.mimeType),
  ]);
  if (
    fullFrame.status !== "ok" ||
    !fullFrame.imageUrl ||
    crop.status !== "ok" ||
    !crop.imageUrl
  ) {
    throw new Error("派生参考图保存失败");
  }
  return createShotDerivationDraft({
    storyId: input.storyId,
    userId,
    sourceStableShotId: input.sourceStableShotId,
    sourceTakeId: input.sourceTakeId,
    sourceTimeSec: input.sourceTimeSec,
    crop: input.crop,
    fullFrameImageUrl: fullFrame.imageUrl,
    cropImageUrl: crop.imageUrl,
    provisionalStableShotId: `shot-${nanoid(12)}`,
    status: "draft",
  });
}

export async function analyzeDerivationDraft(
  input: {
    draftId: number;
    instruction?: string;
    referenceRole?: ReferenceRole;
  },
  userId: number
) {
  const draft = await getShotDerivationDraft(input.draftId, userId);
  if (!draft) throw new Error("派生草稿不存在");
  const [fullFrame, cropFrame] = await Promise.all([
    materializeImageInput(draft.fullFrameImageUrl),
    materializeImageInput(draft.cropImageUrl),
  ]);
  let analysis: Record<string, unknown>;
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    analysis = {
      summary: "从框选区域延伸的新镜头",
      referenceRole: input.referenceRole ?? "composition",
      prompt: input.instruction || "cinematic continuation from the selected crop",
    };
  } else {
    const result = await invokeAgent(
      [
        {
          role: "system",
          content:
            "你是小酌的镜头派生分析器。第一张图是完整帧，第二张图是用户框选区域。理解这个局部在原镜头中的作用，并提出一个新镜头。严格输出 JSON：summary, referenceRole(person|scene|object|composition), prompt, title, subject, action, intent, dialogue, durationMs。",
        },
        {
          role: "user",
          content: [
            { type: "text", text: input.instruction || "以框选区域为主要参考派生新镜头。" },
            { type: "image_url", image_url: { url: fullFrame } },
            { type: "image_url", image_url: { url: cropFrame } },
          ],
        },
      ],
      900,
      { type: "json_object" }
    );
    analysis = parseJsonObject(result.text);
  }
  const role =
    input.referenceRole ??
    (["person", "scene", "object", "composition"].includes(
      String(analysis.referenceRole)
    )
      ? (analysis.referenceRole as ReferenceRole)
      : "composition");
  const proposal = {
    title: String(analysis.title || "派生镜头"),
    subject: String(analysis.subject || analysis.summary || "选中局部"),
    action: String(analysis.action || "延续原镜头动作"),
    intent: String(analysis.intent || analysis.summary || "补充叙事细节"),
    dialogue: String(analysis.dialogue || ""),
    durationMs: Math.max(500, Math.min(10000, Number(analysis.durationMs) || 2400)),
    imagePrompt: String(
      analysis.prompt || input.instruction || "cinematic continuation"
    ),
    insertAfterStableShotId: draft.sourceStableShotId,
  };
  const updated = await updateShotDerivationDraft(draft.id, userId, {
    referenceRole: role,
    analysis,
    proposal,
  });
  return updated ?? draft;
}

export async function generateDerivedCandidates(
  draftId: number,
  userId: number
) {
  const draft = await getShotDerivationDraft(draftId, userId);
  if (!draft) throw new Error("派生草稿不存在");
  const proposal =
    draft.proposal && typeof draft.proposal === "object"
      ? (draft.proposal as Record<string, unknown>)
      : {};
  const basePrompt = String(proposal.imagePrompt || "cinematic continuation");
  const variants = [
    "preserve identity and spatial continuity, restrained close reaction",
    "preserve identity and lighting, alternate cinematic composition",
    "preserve scene and wardrobe, emphasize the selected detail",
    "preserve story world, subtle camera-angle variation",
  ];
  const source = await materializeImageInput(draft.cropImageUrl);
  const results = await Promise.all(
    variants.map(variant =>
      editImage(
        source,
        `${basePrompt}. ${variant}. One uninterrupted cinematic frame only.`,
        { requireInputImage: true }
      )
    )
  );
  const failed = results.find(result => result.status !== "ok" || !result.imageUrl);
  if (failed) throw new Error(failed.message || "派生候选生成失败");
  const images = [];
  for (const result of results) {
    const image = await createGeneratedImage({
      storyId: draft.storyId,
      userId,
      shotNo: null,
      shotIdentity: draft.provisionalStableShotId,
      imageKey: result.imageKey ?? null,
      imageUrl: result.imageUrl!,
      prompt: basePrompt,
      generationType: "initial",
      isCurrent: false,
    });
    images.push(image);
  }
  await updateShotDerivationDraft(draft.id, userId, {
    candidateImageIds: images.map(image => image.id),
    status: "ready",
  });
  return images;
}

export async function confirmDerivedShot(
  input: {
    draftId: number;
    selectedImageId: number;
    expectedStoryRevision: number;
    expectedTimelineVersion: number;
  },
  userId: number
) {
  const draft = await getShotDerivationDraft(input.draftId, userId);
  if (!draft) throw new Error("派生草稿不存在");
  const candidateIds = Array.isArray(draft.candidateImageIds)
    ? draft.candidateImageIds.map(Number)
    : [];
  if (!candidateIds.includes(input.selectedImageId)) {
    throw new Error("请选择这次派生生成的候选图");
  }
  const [story, material] = await Promise.all([
    getStoryById(draft.storyId, userId),
    getStoryMaterialState(draft.storyId, userId),
  ]);
  if (!story || !material) throw new Error("故事不存在或无权操作");
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? [...body.shots] : [];
  const sourceIndex = shots.findIndex(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const shot = raw as Record<string, unknown>;
    return (
      shot.stableShotId === draft.sourceStableShotId ||
      shot.shotIdentity === draft.sourceStableShotId ||
      shot.shotKey === draft.sourceStableShotId
    );
  });
  if (sourceIndex < 0) throw new Error("来源镜头已经不存在");
  const proposal =
    draft.proposal && typeof draft.proposal === "object"
      ? (draft.proposal as Record<string, unknown>)
      : {};
  const inserted = {
    ...proposal,
    stableShotId: draft.provisionalStableShotId,
    shotIdentity: draft.provisionalStableShotId,
    shotKey: draft.provisionalStableShotId,
    sourceDerivation: {
      draftId: draft.id,
      sourceStableShotId: draft.sourceStableShotId,
      sourceTakeId: draft.sourceTakeId,
      sourceTimeSec: draft.sourceTimeSec,
      crop: draft.crop,
      referenceRole: draft.referenceRole,
    },
  };
  shots.splice(sourceIndex + 1, 0, inserted);
  const renumbered = shots.map((raw, index) =>
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>), shotNo: index + 1 }
      : raw
  );
  const nextRevision = getStoryRevision(story.body) + 1;
  const nextBody = prepareStoryBody(
    { ...body, shots: renumbered },
    nextRevision,
    story.body
  );
  const timelineItems = [...material.timeline.items];
  const timelineSourceIndex = timelineItems.findIndex(
    item => item.stableShotId === draft.sourceStableShotId
  );
  timelineItems.splice(Math.max(0, timelineSourceIndex + 1), 0, {
    stableShotId: draft.provisionalStableShotId,
    included: true,
    position: timelineSourceIndex + 1,
    plannedDurationMs: Number(proposal.durationMs) || 2400,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
  });
  const normalizedTimeline = timelineItems.map((item, position) => ({
    ...item,
    position,
  }));
  return confirmDerivedShotAtomic({
    storyId: story.id,
    userId,
    draftId: draft.id,
    selectedImageId: input.selectedImageId,
    stableShotId: draft.provisionalStableShotId,
    shotNo: `SH${String(sourceIndex + 2).padStart(2, "0")}`,
    expectedStoryRevision: input.expectedStoryRevision,
    expectedTimelineVersion: input.expectedTimelineVersion,
    nextStoryBody: nextBody,
    nextTimelineItems: normalizedTimeline,
  });
}

export async function undoDerivedShot(operationId: number, userId: number) {
  await undoDerivedShotAtomic(operationId, userId);
}
