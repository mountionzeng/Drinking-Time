import type { ShotConversationMedia } from "./shotConversationMedia";
import {
  getStoryGeneratedImages,
  promoteStoryImageToCurrent,
} from "../repositories/images";
import {
  getStoryById,
  updateStoryBodyIfRevision,
} from "../repositories/stories";
import {
  jsonRecord,
  persistedStoryBodyRevision,
} from "../repositories/storyValues";
import {
  loadOwnedStoryVisualAggregate,
  saveStoryVisualAggregateCas,
  visualDocumentFromTimeline,
} from "../persistence/storyVisualPersistence";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  replaceRevisionFrameRoles,
  replaceRevisionInDocument,
  type ChatImageRevision,
} from "../../shared/chatImageRevision";
import type { Task } from "./storyboardImageTask";
import { readImageDimensions } from "./imageEditDimensions";

/** attachLuminanceCandidates 写入的免费候选：在画廊里标明「只调亮度」，和 AI 新图区分开。 */
function luminanceLabels(meta: unknown): { candidateLabels?: Record<number, string> } {
  const items = (meta as { luminanceCandidates?: Array<{ imageId: number; strength: string; fromImageId: number }> } | undefined)?.luminanceCandidates;
  if (!Array.isArray(items) || !items.length) return {};
  return { candidateLabels: Object.fromEntries(items.map(item =>
    [item.imageId, `免费·只调亮度（${item.strength === "mid" ? "中档" : "全档"}）：AI 新图 #${item.fromImageId} 按原图亮度，0 算力`])) };
}

export async function readChatImageRevisions(
  storyId: number,
  userId: number
): Promise<ChatImageRevision[]> {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const body = jsonRecord(story.body);
  const tasks = (
    Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : []
  ) as Task[];
  const revisions: ChatImageRevision[] = tasks
    .filter(t => t.meta?.conversationRevision && t.meta.parentImageId)
    .map(t => ({
      requestId: t.requestId,
      stableShotId: t.shotIdentity,
      shotNo: Number(t.meta!.shotNo.replace(/^SH/i, "")),
      sourceImageId: t.meta!.parentImageId!,
      editMode: t.meta!.editMode,
      referenceOnly: t.meta!.referenceOnly,
      paletteReferenceImageId: t.meta!.paletteReferenceImageId,
      paletteSummary: typeof jsonRecord(t.meta!.paletteReading).summary === "string"
        ? String(jsonRecord(t.meta!.paletteReading).summary).slice(0,240) : undefined,
      createdAt: t.createdAt ?? 0,
      instruction: t.meta!.instruction ?? "",
      status: t.status,
      candidates: t.result?.status === "ok" ? t.result.candidates : [],
      error: t.result?.status === "error" ? t.result.error : undefined,
      decision: t.decision,
      ...luminanceLabels(t.meta),
    }));
  const included = new Set(
    revisions.flatMap(r => r.candidates.map(c => c.imageId))
  );
  // Older successful edits already have immutable parent-image lineage, even if the chat reply lost its metadata.
  const images = await getStoryGeneratedImages(storyId, userId);
  const media = (Array.isArray(body.shotConversationMedia) ? body.shotConversationMedia : []) as ShotConversationMedia[];
  const shots = Array.isArray(body.shots) ? body.shots : [];
  for (const record of media) {
    const shotIndex = shots.findIndex((shot, index) => shotIdentityFromShot(shot as Record<string, unknown>, index) === record.stableShotId);
    if (shotIndex < 0) continue;
    const candidates = record.imageIds.flatMap(id => {
      const image = images.find(image => image.id === id);
      return image ? [{imageId: image.id, imageUrl: image.imageUrl}] : [];
    });
    if (!candidates.length) continue;
    revisions.push({requestId: `image:conversation:${record.stableShotId}:${record.imageIds.join("-")}`,
      stableShotId: record.stableShotId, shotNo: Number(shots[shotIndex].shotNo) || shotIndex + 1,
      sourceImageId: candidates[0].imageId, createdAt: record.createdAt, instruction: record.instruction,
      status: "succeeded", candidates, editorUserId: record.editorUserId});
    candidates.forEach(image => included.add(image.imageId));
  }
  for (const image of images) {
    if (
      !image.parentImageId ||
      !image.shotIdentity ||
      !/^SH\d+$/i.test(image.shotNo ?? "") ||
      included.has(image.id)
    )
      continue;
    revisions.push({
      requestId: `image:${image.id}`,
      stableShotId: image.shotIdentity,
      shotNo: Number(image.shotNo!.slice(2)),
      sourceImageId: image.parentImageId,
      createdAt: +new Date(image.createdAt),
      instruction: "",
      status: "succeeded",
      candidates: [{ imageId: image.id, imageUrl: image.imageUrl }],
      // Legacy candidates remain visible; only new durable requests use the replacement dialogue.
      decision: {
        kind: image.isCurrent ? "replaced" : "kept",
        imageId: image.isCurrent ? image.id : undefined,
        at: +new Date(image.createdAt),
        userId,
      },
    });
  }
  return revisions.map(revision => ({ ...revision, sourceImageUrl: images.find(image => image.id === revision.sourceImageId)?.imageUrl }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** A replay can finish projection after a committed timeline decision. CAS never displaces a newer choice. */
async function syncSelectedRevision(
  storyId: number,
  userId: number,
  task: Task
) {
  if (
    task.meta?.referenceOnly || task.decision?.kind !== "replaced" ||
    !task.decision.imageId ||
    !task.meta?.parentImageId
  )
    return;
  const images = await getStoryGeneratedImages(storyId, userId);
  const source = images.find(image => image.id === task.meta!.parentImageId);
  const candidate = images.find(image => image.id === task.decision!.imageId);
  if (!source?.isCurrent || !candidate || candidate.isCurrent) return;
  await promoteStoryImageToCurrent({
    storyId,
    userId,
    imageId: candidate.id,
    expectedCurrentImageId: source.id,
    metadata: {
      source: "chat_image_replace",
      requestId: task.requestId,
      sourceImageId: source.id,
    },
  });
}

export async function decideChatImageRevision(input: {
  storyId: number;
  userId: number;
  requestId: string;
  kind: "keep" | "replace";
  imageId?: number;
}): Promise<NonNullable<Task["decision"]>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const aggregate = await loadOwnedStoryVisualAggregate(input);
    if (!aggregate) throw new Error("故事不存在或无权访问");
    const body = jsonRecord(aggregate.story.body);
    const revision = persistedStoryBodyRevision(body);
    const tasks = structuredClone(
      (Array.isArray(body.storyboardImageTasks)
        ? body.storyboardImageTasks
        : []) as Task[]
    );
    const task = tasks.find(
      t => t.requestId === input.requestId && t.meta?.conversationRevision
    );
    if (
      !task ||
      task.status !== "succeeded" ||
      task.result?.status !== "ok" ||
      !task.meta?.parentImageId
    )
      throw new Error("这次改图尚未完成，请等图片出现后再选择");
    const kind = input.kind === "keep" ? "kept" : "replaced";
    if (task.decision) {
      if (
        task.decision.kind === kind &&
        (kind === "kept" || task.decision.imageId === input.imageId)
      ) {
        await syncSelectedRevision(input.storyId, input.userId, task);
        return task.decision;
      }
      throw new Error("这次选择已经处理，请重新选择需要修改的素材");
    }
    const decision = {
      kind,
      imageId: kind === "replaced" ? input.imageId : undefined,
      at: Date.now(),
      userId: input.userId,
    } as const;
    task.decision = decision;
    const nextBody = {
      ...body,
      storyboardImageTasks: tasks,
      _revision: revision + 1,
    };
    if (kind === "kept") {
      if (
        await updateStoryBodyIfRevision({
          id: input.storyId,
          userId: input.userId,
          expectedRevision: revision,
          body: nextBody,
        })
      )
        return decision;
      continue;
    }
    const candidate = task.result.candidates.find(
      c => c.imageId === input.imageId
    );
    const images = await getStoryGeneratedImages(input.storyId, input.userId);
    const source = images.find(
      i =>
        i.id === task.meta!.parentImageId &&
        i.shotIdentity === task.shotIdentity
    );
    const image = images.find(
      i =>
        i.id === candidate?.imageId &&
        i.parentImageId === source?.id &&
        i.shotIdentity === task.shotIdentity
    );
    if (!candidate || !source || !image)
      throw new Error("图片与原素材的关系已经变化，请重新选择");
    // Also covers older results and free derived candidates without recorded checks.
    const expected = task.meta.sourceDimensions ?? await readImageDimensions(source.imageUrl);
    const actual = await readImageDimensions(image.imageUrl);
    if (actual.width !== expected.width || actual.height !== expected.height)
      throw new Error(`新版尺寸 ${actual.width}×${actual.height} 与原图 ${expected.width}×${expected.height} 不符，未替换。 / Dimensions differ; original retained.`);
    if (task.meta.referenceOnly) {
      // Approval of a video reference is not permission to cover the video with a still.
      const referenceDecision = { ...decision, referenceOnly: true };
      task.decision = referenceDecision;
      if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId,
        expectedRevision: revision, body: nextBody })) return referenceDecision;
      continue;
    }
    const document =
      aggregate.timeline && visualDocumentFromTimeline(aggregate.timeline);
    if (!document) throw new Error("当前时间线不可用，新图保留在对话和仓库中");
    const shots = Array.isArray(body.shots)
      ? (body.shots as Record<string, unknown>[])
      : [];
    let sourceIsFrame = false;
    const nextShots = shots.map((s, i) => {
      if (shotIdentityFromShot(s, i) !== task.shotIdentity) return s;
      const generationParams = replaceRevisionFrameRoles(
        s.generationParams,
        source.id,
        image.id
      );
      sourceIsFrame ||=
        JSON.stringify(generationParams) !== JSON.stringify(s.generationParams);
      return { ...s, generationParams };
    });
    const nextDocument = replaceRevisionInDocument(document, {
      stableShotId: task.shotIdentity,
      sourceImageId: source.id,
      imageId: image.id,
      imageUrl: image.imageUrl,
      sourceIsPrimary: source.isCurrent,
      sourceIsFrame,
    });
    // Timeline slot, first/last-frame roles and the user's decision commit together.
    await saveStoryVisualAggregateCas({
      ...input,
      expectedStoryRevision: revision,
      expectedTimelineVersion: aggregate.timeline!.version,
      nextStoryBody: { ...nextBody, shots: nextShots },
      nextDocument,
    });
    await syncSelectedRevision(input.storyId, input.userId, task);
    return decision;
  }
  throw new Error("故事正在更新，选择尚未保存，请稍后再试");
}
