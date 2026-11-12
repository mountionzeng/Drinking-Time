import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { frameRegionReviewSchema, regionInstruction, regionTemporalFrames, regionLabels, isRegionRefinement, regionReviewDecision, regionTargets, reviseRegionScope, type FrameRegionReview, type FrameRegionTask } from "../../shared/frameRegionReview";
import { isFrameReferenceChat } from "../../shared/chatFrameReference";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { jsonRecord, persistedStoryBodyRevision } from "../repositories/storyValues";
import { createGeneratedImage, getStoryGeneratedImages } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { extractChatFrameReferences } from "./chatFrameReferences";
import { readStoryImageBytes } from "./chatColorTransfer";
import { storeImageBytes } from "./imageGen";
import { inspectLocalFrameRegions, recolorLocalFrameRegion } from "./localFrameRegions";

type Input = { userId: number; storyId: number; instruction: string; stableShotId?: string; imageId?: number;
  reviewId?: string; expectedRevision?: number; language?: string };
const deps = { story: getStoryById, update: updateStoryBodyIfRevision, material: getStoryMaterialState,
  images: getStoryGeneratedImages, createImage: createGeneratedImage, extract: extractChatFrameReferences,
  read: readStoryImageBytes, store: storeImageBytes, inspect: inspectLocalFrameRegions, recolor: recolorLocalFrameRegion };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const locks = new Map<string, Promise<unknown>>();
const conflict = () => new TRPCError({ code: "CONFLICT", message: "范围或剪辑版本已变化，请查看最新消息 / Review or timeline changed; read the latest message" });
export function readFrameRegionReviews(body: Record<string, unknown>): FrameRegionReview[] {
  return (Array.isArray(body.frameRegionReviews) ? body.frameRegionReviews : []).flatMap(value => {
    const parsed = frameRegionReviewSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
  });
}

/** Only this service owns review state. Chat snapshots cannot approve a stale mask. */
export async function runFrameRegionReview(input: Input, overrides: Partial<typeof deps> = {}) {
  const key = `${input.userId}:${input.storyId}`;
  const task = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => execute(input, { ...deps, ...overrides }));
  locks.set(key, task);
  try { return await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
async function execute(input: Input, d: typeof deps) {
  const say = (zh: string, en: string) => input.language === "en" ? en : zh;
  const owned = async () => {
    const story = await d.story(input.storyId, input.userId);
    if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在 / Story unavailable" });
    return jsonRecord(story.body);
  };
  const body = await owned();
  const material = await d.material(input.storyId, input.userId);
  if (!material) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在 / Story unavailable" });
  let previous = input.reviewId ? readFrameRegionReviews(body).find(item => item.id === input.reviewId) : undefined;
  if (input.reviewId && (!previous || previous.editorUserId !== input.userId || previous.revision !== input.expectedRevision)) throw conflict();
  if (previous && input.stableShotId && previous.stableShotId !== input.stableShotId) throw conflict();
  const extracting = isFrameReferenceChat(input.instruction);
  if (!extracting && (!previous || previous.phase === "cancelled")) throw conflict();
  if (!extracting && previous!.timelineVersion !== material.timeline.version) throw conflict();
  let review: FrameRegionReview;
  if (extracting) {
    const result = await d.extract(input);
    if (result.frames.length !== result.requestedCount) throw new Error(`抽帧未全部完成，已得到的帧保留在仓库 / Partial capture: ${result.failures.join("; ")}`);
    const frame = result.frames[0];
    review = { id: randomUUID(), revision: 0, storyId: input.storyId, stableShotId: frame.stableShotId, shotNo: frame.shotNo,
      timelineVersion: material.timeline.version, phase: "frames_ready", frames: result.frames, tasks: [], instructions: [],
      createdAt: Date.now(), updatedAt: Date.now(), editorUserId: input.userId };
    previous = undefined;
  } else review = structuredClone(previous!);
  const save = async () => {
    const latestMaterial = await d.material(input.storyId, input.userId);
    if (latestMaterial?.timeline.version !== review.timelineVersion) throw conflict();
    for (let retry = 0; retry < 3; retry++) {
      const fresh = await owned(), rows = readFrameRegionReviews(fresh), current = rows.find(row => row.id === review.id);
      if (previous && (!current || current.revision !== previous.revision)) throw conflict();
      review.updatedAt = Date.now();
      const revision = persistedStoryBodyRevision(fresh);
      if (await d.update({ id: input.storyId, userId: input.userId, expectedRevision: revision, body: {
        ...fresh, _revision: revision + 1, frameRegionReviews: [...rows.filter(row => row.id !== review.id), review].slice(-40),
      } })) return;
    }
    throw conflict();
  };
  const reply = async (content: string) => { await save(); return { handled: true as const, reply: content, frameReview: review }; };
  const images = await d.images(input.storyId, input.userId);
  const read = async (imageId: number) => {
    const image = images.find(image => image.id === imageId && image.userId === input.userId && image.storyId === input.storyId && image.shotIdentity === review.stableShotId);
    if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "原帧不属于这个镜头 / Source frame unavailable in this shot" });
    return d.read(image);
  };
  const store = async (bytes: Uint8Array, suffix: string) => {
    const result = await d.store(bytes, "image/png", { storageKey: `generated/frame-regions/${input.userId}-${review.id}-${review.revision}-${suffix}.png` });
    if (result.status !== "ok" || !result.imageUrl) throw new Error("范围图保存失败 / Could not save review image");
    return { ...result, imageUrl: result.imageUrl };
  };
  const decision = regionReviewDecision(input.instruction);
  if (decision === "cancel") { review.phase = "cancelled"; review.revision++; return reply(say("本次范围修改已取消，记录和原素材保留。", "Region editing cancelled; history and originals are retained.")); }
  if (decision === "confirm_images") {
    if (review.phase !== "image_review" || review.tasks.some(task => !task.candidate))
      return reply(say("还没有全部改好的关键帧。飞机和云层的形态修改需要另行生成并确认，暂不生成视频。", "Not all edited keyframes are ready. Airplane/cloud shape edits need separate candidates and review before video generation."));
    review.phase = "images_confirmed"; review.revision++;
    return reply(say("关键帧已确认。原视频保留；生成新视频前仍需核对镜头参数和算力报价。", "Keyframes confirmed. The original video is retained; video parameters and a compute quote must be reviewed before generation."));
  }
  if (decision === "confirm_scope") {
    const requestedTargets = regionTargets(input.instruction);
    const confirmedTasks = review.tasks.filter(task => !requestedTargets.length || requestedTargets.includes(task.target));
    if (!["scope_review", "scope_confirmed", "image_review"].includes(review.phase) || !confirmedTasks.length || confirmedTasks.some(task => !task.selectedPixels))
      return reply(say("请先核对最新范围图；没有定位到的目标需要重新说明范围。", "Review the latest region overlays first; unresolved targets need a revised scope."));
    for (const task of confirmedTasks) task.approvedRevision = review.revision;
    if (review.tasks.every(task => task.approvedRevision != null)) review.approvedRevision = review.revision;
    review.phase = "scope_confirmed";
    const errors: string[] = [];
    for (const task of confirmedTasks) {
      if (task.candidate) continue;
      // Local color processing is deliberately narrow; never replace geometry edits with recoloring.
      if (task.target !== "forest" || !/绿色|变绿|改绿|green/i.test(task.instruction) || /加.*树|减少.*树|移.*树|更大|bigger|add|remove/i.test(task.instruction)) continue;
      try {
        const source = await read(task.imageId);
        if (hash(source) !== task.sourceSha) throw conflict();
        const original = images.find(image => image.id === task.imageId)!;
        const mask = await d.read({ ...original, imageUrl: task.maskUrl }), protection = await d.read({ ...original, imageUrl: task.protectedUrl });
        if (hash(mask) !== task.maskSha) throw conflict();
        const objects = task.objectMaskUrl ? await d.read({ ...original, imageUrl: task.objectMaskUrl }) : undefined;
        if (objects && hash(objects) !== task.objectMaskSha) throw conflict();
        const result = await d.recolor(source, mask, protection, objects);
        const sourceSize = await sharp(source).metadata(), outputSize = await sharp(result.bytes).metadata();
        if (sourceSize.width !== outputSize.width || sourceSize.height !== outputSize.height) throw new Error("候选尺寸不一致 / Candidate size mismatch");
        const saved = await store(result.bytes, `${task.target}-candidate`);
        const existing = images.find(image => image.imageKey === saved.imageKey);
        const candidate = existing ?? await d.createImage({ storyId: input.storyId, userId: input.userId, shotIdentity: review.stableShotId,
          shotNo: canonicalizeShotNo(review.shotNo), imageKey: saved.imageKey, imageUrl: saved.imageUrl, parentImageId: task.imageId,
          prompt: `第 ${review.shotNo} 镜 / Shot ${review.shotNo} · 范围 R${review.revision} · ${task.instruction} · Local scene palette; candidate only`,
          isCurrent: false, generationType: "inpaint" });
        task.candidate = { imageId: candidate.id, imageUrl: candidate.imageUrl, changedPixels: result.changedPixels, outsideChangedPixels: 0 };
      } catch (error) { errors.push(error instanceof Error ? error.message : "Local edit failed"); }
    }
    review.phase = review.tasks.some(task => task.candidate) ? "image_review" : "scope_confirmed";
    review.revision++;
    const pending = review.tasks.filter(task => !task.candidate).map(task => regionLabels[task.target][input.language === "en" ? "en" : "zh"]).join("、");
    return reply(say(`${requestedTargets.length ? confirmedTasks.map(task => regionLabels[task.target].zh).join("、") : "全部"}范围已确认。${review.tasks.some(task => task.candidate) ? "森林改色候选已保存在仓库，请对比原帧。" : ""}${pending ? `尚无新候选：${pending}。涉及付费生成时会另行报价。` : "看完图片后可说“确认图片”。"}原视频未改动。${errors.length ? `\n本地改色未完成：${errors.join("；")}` : ""}`,
      `Regions confirmed. ${review.tasks.some(task => task.candidate) ? "A forest color candidate is saved in Warehouse; compare it with the source. " : ""}${pending ? `Candidates still needed: ${pending}. Paid generation requires a separate quote. ` : "Say ‘confirm images’ after reviewing. "}The video is unchanged.${errors.length ? `\nLocal edit incomplete: ${errors.join("; ")}` : ""}`));
  }
  if (/生成.*视频|渲染.*视频|\b(?:render|generate).*video/i.test(input.instruction))
    return reply(say("先确认全部关键帧，再核对视频参数和报价。当前没有提交视频任务。", "Confirm all keyframes before reviewing video settings and the quote. No video task was submitted."));
  let targets = regionTargets(input.instruction);
  if (!targets.length && isRegionRefinement(input.instruction) && review.activeTarget) targets = [review.activeTarget];
  if (!targets.length) return reply(say(`第 ${String(review.shotNo).padStart(2, "0")} 镜已抽 ${review.frames.length} 帧，保存在仓库。请一起说要改什么；我会先标范围，等你确认再改图。`,
    `Shot ${String(review.shotNo).padStart(2, "0")}: ${review.frames.length} frames saved in Warehouse. Describe all changes; review the marked regions before editing.`));
  // A clicked warehouse candidate is a source in its own right, never an instruction to
  // re-extract a differently colored video frame. URLs/ownership come from our repository.
  const selected = input.imageId;
  if (selected) {
    const image = images.find(image => image.id === selected && image.storyId === input.storyId && image.userId === input.userId && image.shotIdentity === review.stableShotId);
    if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "所选图片不属于这个镜头，未改用其他底图 / Selected image unavailable; no fallback source used" });
    if (!review.frames.some(frame => frame.imageId === selected)) {
      review.sourceImages = [...(review.sourceImages ?? []).filter(source => source.imageId !== selected), {
        storyId: input.storyId, stableShotId: review.stableShotId, shotNo: review.shotNo, imageId: image.id, imageUrl: image.imageUrl,
      }];
    }
  }
  const requested = targets.map(target => {
    const prior = review.tasks.find(task => task.target === target);
    const ownInstruction = regionInstruction(input.instruction, target);
    const scope = reviseRegionScope(prior && (!selected || selected === prior.imageId) ? prior : { threshold: .35, area: "all" }, ownInstruction);
    const accumulated = [prior?.imageId === (selected ?? prior?.imageId) ? prior?.instruction : undefined, ownInstruction].filter(Boolean).join("\n");
    return { target, ...scope, greenEdit: target === "forest" && /绿色|变绿|改绿|green/i.test(accumulated), allowedImageIds: regionTemporalFrames(ownInstruction, review.frames), imageId: selected ?? (targets.length === 1 ? prior?.imageId : undefined) };
  });
  const sources = [...review.frames, ...(review.sourceImages ?? [])];
  const frames = await Promise.all(sources.filter(frame => requested.some(task => task.imageId ? task.imageId === frame.imageId : task.allowedImageIds.includes(frame.imageId)))
    .map(async frame => ({ imageId: frame.imageId, bytes: await read(frame.imageId) })));
  const proposals = await d.inspect(frames, requested);
  if (proposals.length !== targets.length || proposals.some(task => !targets.includes(task.target) || !frames.some(frame => frame.imageId === task.imageId) || !requested.some(request => request.target === task.target && (request.imageId ? request.imageId === task.imageId : request.allowedImageIds.includes(task.imageId)))))
    throw new Error("定位结果不完整 / Incomplete region proposals");
  review.revision++; review.approvedRevision = undefined; review.phase = "scope_review";
  review.instructions = [...review.instructions, input.instruction].slice(-100);
  // Independent objects keep their approved scope and candidate when another target changes.
  review.tasks.filter(task => targets.includes(task.target)).forEach(task => { delete task.candidate; delete task.approvedRevision; });
  for (const proposal of proposals) {
    const request = requested.find(task => task.target === proposal.target)!;
    const prior = review.tasks.find(task => task.target === proposal.target);
    const mask = await store(proposal.mask, `${proposal.target}-mask`);
    const protection = await store(proposal.protection, `${proposal.target}-protected`);
    const overlay = await store(proposal.overlay, `${proposal.target}-overlay`);
    const objects = proposal.objects ? await store(proposal.objects, `${proposal.target}-objects`) : undefined;
    const task: FrameRegionTask = { target: proposal.target, imageId: proposal.imageId, threshold: request.threshold, area: request.area,
      instruction: [prior?.imageId === proposal.imageId ? prior.instruction : undefined, regionInstruction(input.instruction, proposal.target)].filter(Boolean).join("\n").slice(-8000), sourceSha: hash(frames.find(frame => frame.imageId === proposal.imageId)!.bytes),
      objectMaskUrl: objects?.imageUrl, objectMaskSha: proposal.objects ? hash(proposal.objects) : undefined,
      maskSha: hash(proposal.mask), maskUrl: mask.imageUrl, protectedUrl: protection.imageUrl, overlayUrl: overlay.imageUrl, selectedPixels: proposal.selectedPixels };
    review.tasks = [...review.tasks.filter(item => item.target !== task.target), task];
  }
  if (review.sourceImages) review.sourceImages = review.sourceImages.filter(source => review.tasks.some(task => task.imageId === source.imageId));
  review.activeTarget = targets.at(-1);
  return reply(say("粉色是待确认范围，原图还没有改。可以继续说“森林范围扩大一点”；范围合适后说“确认范围”。",
    "Pink marks proposed regions; source images are unchanged. Refine them in chat, then say ‘confirm regions’."));
}

export async function frameRegionReviewHistory(input: { storyId: number; userId: number }) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story unavailable" });
  return readFrameRegionReviews(jsonRecord(story.body)).filter(review => review.editorUserId === input.userId);
}
