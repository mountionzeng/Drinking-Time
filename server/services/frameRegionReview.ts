import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { createChatImageEditPlan } from "../../shared/chatImageEditPlan";
import { isImageObjectRemoval } from "../../shared/imageObjectRemoval";
import { cloudArtDirection, forestPaletteFeedbackDecision, forestPaletteStatus, forestPaletteConsistencyDecision, isForestToneEdit, isForestGreenMatchEdit, frameRegionReviewSchema, regionInstruction, regionTemporalFrames, regionLabels, isRegionRefinement, isCloudAppearanceEdit, regionReviewDecision, regionInheritanceDecision, regionTargets, reviseRegionScope, type FrameRegionReview, type FrameRegionTask } from "../../shared/frameRegionReview";
import { prepareCloudShapeQuote } from "./cloudShapeEdit";
import { prepareFrameReviewVideo } from "./frameReviewVideo";
import { isFrameReviewVideoRequest } from "../../shared/frameReviewVideo";
import { formatComputeQuote } from "../../shared/computeMoney";
import { isFrameReferenceChat, type ChatFrameReference } from "../../shared/chatFrameReference";
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
  reviewId?: string; expectedRevision?: number; language?: string; sourceFrame?: ChatFrameReference; inspectOnly?: boolean };
const deps = { story: getStoryById, update: updateStoryBodyIfRevision, material: getStoryMaterialState,
  images: getStoryGeneratedImages, createImage: createGeneratedImage, extract: extractChatFrameReferences,
  read: readStoryImageBytes, store: storeImageBytes, inspect: inspectLocalFrameRegions, recolor: recolorLocalFrameRegion, cloudQuote: prepareCloudShapeQuote, videoPlan: prepareFrameReviewVideo };
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
  const suppliedFrame = input.sourceFrame;
  if (input.inspectOnly && !suppliedFrame) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择新抽取的帧 / Select a captured frame" });
  if (suppliedFrame && (suppliedFrame.storyId !== input.storyId || suppliedFrame.stableShotId !== input.stableShotId ||
    suppliedFrame.imageId !== input.imageId || (suppliedFrame.origin !== "warehouse-video" && suppliedFrame.timelineVersion !== material.timeline.version))) throw conflict();
  if (!extracting && !suppliedFrame && !previous) throw conflict();
  // A newly selected immutable warehouse image starts a fresh review after a
  // timeline change. Old confirmations still fail; no old scope is auto-approved.
  const restartSelected = !extracting && !suppliedFrame && (previous?.phase === "cancelled"
      ? regionTargets(input.instruction).length > 0 && (isRegionRefinement(input.instruction) || isImageObjectRemoval(input.instruction))
      : previous?.timelineVersion !== material.timeline.version) && Boolean(input.imageId) &&
    !regionReviewDecision(input.instruction) && !regionInheritanceDecision(input.instruction) &&
    (regionTargets(input.instruction).length > 0 || previous?.activeTarget === "cloud" && isCloudAppearanceEdit(input.instruction));
  if (!extracting && !suppliedFrame && !restartSelected && (previous!.phase === "cancelled" || previous!.timelineVersion !== material.timeline.version)) throw conflict();
  if (previous && !suppliedFrame && isFrameReviewVideoRequest(input.instruction)) {
    const videoPlan = await d.videoPlan({ userId: input.userId, storyId: input.storyId, stableShotId: previous.stableShotId,
      review: { reviewId: previous.id, reviewRevision: previous.revision, timelineVersion: previous.timelineVersion } });
    return { handled: true as const, frameReview: previous, videoPlan,
      reply: say("已带入确认过的关键帧和原视频时长，请查看视频参数与报价。尚未购买或替换剪辑；关键帧生成不能保证逐帧复现原运镜。",
        "Reviewed keyframes and the original duration are ready for a quote. Nothing purchased or replaced; keyframe generation cannot guarantee the original camera motion frame for frame.") };
  }
  let review: FrameRegionReview;
  if (suppliedFrame) {
    const image = (await d.images(input.storyId, input.userId)).find(image => image.id === suppliedFrame.imageId &&
      image.userId === input.userId && image.storyId === input.storyId && image.shotIdentity === suppliedFrame.stableShotId);
    if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "原帧不属于这个镜头 / Source frame unavailable in this shot" });
    const size = await sharp(await d.read(image)).metadata();
    review = { id: randomUUID(), revision: 0, storyId: input.storyId, stableShotId: suppliedFrame.stableShotId, shotNo: suppliedFrame.shotNo,
      timelineVersion: material.timeline.version, phase: "frames_ready", frames: [{ ...suppliedFrame, imageUrl: image.imageUrl,
        imageSize: size.width && size.height ? { width: size.width, height: size.height } : undefined }], tasks: [], instructions: [],
      createdAt: Date.now(), updatedAt: Date.now(), editorUserId: input.userId };
    previous = undefined;
  } else if (extracting) {
    const result = await d.extract(input);
    if (result.frames.length !== result.requestedCount) throw new Error(`抽帧未全部完成，已得到的帧保留在仓库 / Partial capture: ${result.failures.join("; ")}`);
    const frame = result.frames[0];
    review = { id: randomUUID(), revision: 0, storyId: input.storyId, stableShotId: frame.stableShotId, shotNo: frame.shotNo,
      timelineVersion: material.timeline.version, phase: "frames_ready", frames: result.frames, tasks: [], instructions: [],
      createdAt: Date.now(), updatedAt: Date.now(), editorUserId: input.userId };
    previous = undefined;
  } else if (restartSelected) {
    review = { ...structuredClone(previous!), id: randomUUID(), revision: 0, timelineVersion: material.timeline.version,
      phase: "frames_ready", tasks: [], sourceImages: [], instructions: [], approvedRevision: undefined,
      createdAt: Date.now(), updatedAt: Date.now() };
    previous = undefined;
  } else review = structuredClone(previous!);
  const save = async () => {
    // Keep completed frame-to-palette links when the active task moves on.
    for (const task of [...(previous?.tasks ?? []), ...review.tasks]) {
      if (task.target !== "forest" || !task.candidate || task.inheritance?.status !== "accepted") continue;
      review.forestPaletteApplications = [...(review.forestPaletteApplications ?? []).filter(item => item.imageId !== task.candidate!.imageId),
        { imageId: task.candidate.imageId, referenceImageId: task.inheritance.imageId }].slice(-100);
    }
    // Preserve references offered by older versions, including when this turn
    // removes a declined task. A refusal applies only to its target frame.
    for (const task of previous?.tasks ?? []) {
      if (!task.inheritance || review.forestTreatmentHistory?.some(item => item.imageId === task.inheritance!.imageId)) continue;
      const { status: _status, createdTask: _created, decidedAt: _decided, ...treatment } = task.inheritance;
      review.forestTreatmentHistory = [...(review.forestTreatmentHistory ?? []), treatment].slice(-40);
    }
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
  const removalPlan = (instruction: string, imageId?: number) => {
    const image = images.find(image => image.id === imageId && image.userId === input.userId &&
      image.storyId === input.storyId && image.shotIdentity === review.stableShotId);
    if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "请先选中要修改的原图，未改用其他底图 / Select the source image first" });
    return { handled: true as const, frameReview: review,
      imageEditPlan: createChatImageEditPlan([{ imageId: image.id, imageUrl: image.imageUrl, label: `图片 #${image.id}` }], instruction),
      reply: say(`已记录图片 #${image.id} 的删除要求，旧粉色范围不用于这次改图。请在下方明确删哪个、留哪个（位置、大小或颜色），核对张数和预计费用后点击“确认并生成”。结果保留为候选。`,
        `Your object-removal request is recorded for image #${image.id}; the old pink scope will not be used. Specify which object to remove or keep by position, size or color. Review the image count and estimated cost, then click Confirm and generate. Results remain candidates.`) };
  };
  if (!input.inspectOnly && isImageObjectRemoval(input.instruction))
    return removalPlan(input.instruction, input.imageId ?? review.tasks.find(task => task.target === review.activeTarget)?.imageId);
  // Legacy reviews may contain removal instructions but only category-wide masks.
  // Confirming such a mask cannot select an instance or authorize a purchase.
  if (regionReviewDecision(input.instruction) === "confirm_scope") {
    const named = regionTargets(input.instruction);
    const removal = review.tasks.find(task => (!named.length || named.includes(task.target)) && isImageObjectRemoval(task.instruction));
    if (removal) {
      if (input.imageId && input.imageId !== removal.imageId) throw conflict();
      return removalPlan(removal.instruction, removal.imageId);
    }
  }
  const sameShotReviews = () => [...readFrameRegionReviews(body).filter(row => row.id !== review.id &&
    row.storyId === input.storyId && row.editorUserId === input.userId && row.stableShotId === review.stableShotId), review];
  const paletteStatus = (imageId: number) => forestPaletteStatus(imageId, sameShotReviews(), images);
  // Older records only approved an edit region or inheritance, not its appearance.
  if (review.fixedForestPalette && paletteStatus(review.fixedForestPalette.imageId) !== "accepted") review.fixedForestPalette = null;
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
  const cloudQuoteReply = async (task: FrameRegionTask) => {
    task.shapeQuote = await d.cloudQuote({review,task,images:await d.images(input.storyId,input.userId),instruction:task.instruction,history:readFrameRegionReviews(body)});
    const q=task.shapeQuote;
    const direction=q.artDirection ?? task.cloudArtDirection;
    const artSummary=say(`${direction?.highlights==='white'?'高光接近白色；':''}${direction?.shadows==='colorful'?'阴影保留丰富彩色；':''}${direction?.quantity==='slightly_more'?'云数量略增；':direction?.quantity==='fewer'?'减少云数量与密度，保留留白和主体厚度；':''}${direction?.textureRepetition==='reduce'?'减少重复纹理，变化轮廓、大小和疏密；':''}`,
      `${direction?.highlights==='white'?'Near-white highlights; ':''}${direction?.shadows==='colorful'?'rich multicolored shadows; ':''}${direction?.quantity==='slightly_more'?'Slightly more clouds; ':direction?.quantity==='fewer'?'Fewer clouds, wider gaps and retained volume; ':''}${direction?.textureRepetition==='reduce'?'less repetitive texture, varied silhouettes, sizes and spacing; ':''}`);
    review.revision++; review.activeTarget="cloud";
    const forestTone=review.tasks.some(t=>t.target==='forest'&&t.forestTone&&t.candidate);
    return reply(say(`${forestTone?'森林配色候选已准备好，仍需看图确认。':''}${artSummary}云层底图 #${q.sourceImageId}，保护当前森林和飞机。粉色显示可修改范围。302 / GPT Image 2 局部编辑，一张候选，预计 ${formatComputeQuote(q.estimatedCny)}，尺寸 ${q.width}×${q.height}。确认范围和费用后回复“确认生成云层”；也可以继续说怎么改。`,
      `${forestTone?'A forest palette candidate is ready for visual review. ':''}${artSummary}Cloud source #${q.sourceImageId}; current forest and airplanes are protected. Pink shows the editable region. 302 / GPT Image 2 local edit: one candidate, estimated ${formatComputeQuote(q.estimatedCny)}, ${q.width}×${q.height}. Confirm the region and cost with “confirm clouds”, or describe more changes.`));
  };
  const inheritanceQuestion = () => {
    const pending = review.tasks.find(task => task.inheritance?.status === "pending");
    if (pending?.inheritance && review.fixedForestPalette?.imageId === pending.inheritance.imageId) return say(
      `这一帧也识别到了森林，是否沿用本镜头统一配色基准 #${pending.inheritance.imageId}？仅调整这帧的树木，保留明暗与柔和边缘。回复“沿用上一帧”或“不继承”。云层要求单独保留。`,
      `This frame also contains trees. Use this shot’s shared forest palette #${pending.inheritance.imageId}, preserving local shading and soft edges? Reply “use previous forest treatment” or “do not inherit”. The cloud request stays separate.`);
    if (pending?.inheritance?.forestTone === "reduce_green_flatness") return say(
      `这一帧也识别到了森林，是否沿用上一帧图片 #${pending.inheritance.imageId} 的森林处理：降低过强绿感，保留明暗、冷暖层次和柔和边缘？回复“沿用上一帧”或“不继承”。云层要求单独保留。`,
      `This frame also contains trees. Use the forest treatment from image #${pending.inheritance.imageId}: soften excessive green while preserving shading, color variation and soft edges? Reply “use previous forest treatment” or “do not inherit”. The cloud request stays separate.`);
    return pending ? say(`这一帧也识别到了森林，是否沿用上一帧图片 #${pending.inheritance!.imageId} 的绿色？回复“沿用上一帧”或“不继承”。云层要求单独保留。`,
      `This frame also contains trees. Use the green from previous image #${pending.inheritance!.imageId}? Reply “use previous green” or “do not inherit”. The cloud request stays separate.`) : "";
  };
  const prepareInheritance = async (imageId?: number) => {
    if (imageId) review.tasks = review.tasks.filter(task => !(task.target === "forest" && task.imageId !== imageId && task.inheritance?.status === "pending"));
    if (!imageId || review.declinedInheritanceImageIds?.includes(imageId)) return false;
    const current = review.tasks.find(task => task.target === "forest" && task.imageId === imageId);
    if (current?.inheritance || current?.candidate || current?.forestTone) return false;
    const sourceReviews = readFrameRegionReviews(body).filter(row => row.storyId === input.storyId && row.editorUserId === input.userId &&
      row.stableShotId === review.stableShotId && row.phase !== "cancelled").sort((a, b) => b.updatedAt - a.updatedAt);
    const proposedFixed = review.fixedForestPalette !== undefined ? review.fixedForestPalette :
      sourceReviews.find(row => row.fixedForestPalette !== undefined)?.fixedForestPalette;
    const fixed = proposedFixed && paletteStatus(proposedFixed.imageId) === "accepted" ? proposedFixed : null;
    // A cloud edit derived from an already treated frame is not a new frame.
    // Never compound tone reduction on the same image lineage.
    const lineage = new Set<number>();
    let ancestor = images.find(image => image.id === imageId);
    while (ancestor && !lineage.has(ancestor.id)) {
      lineage.add(ancestor.id);
      ancestor = images.find(image => image.id === ancestor!.parentImageId);
    }
    const hasTreatment = (task: FrameRegionTask) => task.target === "forest" && Boolean(task.candidate) &&
      Boolean(task.forestTone || /绿色|变绿|改绿|green/i.test(task.instruction));
    if (fixed ? lineage.has(fixed.imageId) || sourceReviews.some(row => row.tasks.some(task =>
      hasTreatment(task) && lineage.has(task.candidate!.imageId) && task.inheritance?.imageId === fixed.imageId) ||
      row.forestPaletteApplications?.some(item => lineage.has(item.imageId) && item.referenceImageId === fixed.imageId)) :
      sourceReviews.some(row => row.tasks.some(task => hasTreatment(task) && lineage.has(task.candidate!.imageId)) ||
      row.forestTreatmentHistory?.some(treatment => lineage.has(treatment.imageId)))) return false;
    const eligible = (task: FrameRegionTask) => hasTreatment(task) && task.imageId !== imageId && paletteStatus(task.candidate!.imageId) === "accepted";
    const approvedHistory = (row: FrameRegionReview) => row.forestTreatmentHistory?.filter(item => paletteStatus(item.imageId) === "accepted");
    const sourceReview = sourceReviews.find(row => row.tasks.some(eligible) || approvedHistory(row)?.length);
    const sourceTask = fixed ? undefined : sourceReview?.tasks.find(eligible);
    const savedTreatment = fixed ?? (sourceTask || !sourceReview ? undefined : approvedHistory(sourceReview)?.at(-1));
    if (!sourceTask?.candidate && !savedTreatment) return false;
    const forestTone = sourceTask?.forestTone ?? savedTreatment?.forestTone;
    const source = await read(imageId);
    let task = current;
    if (!task) {
      const [proposal] = await d.inspect([{ imageId, bytes: source }], [{ target: "forest", imageId, threshold: .35, area: "all", greenEdit: !forestTone, forestTone }]);
      if (!proposal || proposal.imageId !== imageId || proposal.target !== "forest" || !proposal.selectedPixels) return false;
      const mask = await store(proposal.mask, "inherit-forest-mask"), protection = await store(proposal.protection, "inherit-forest-protected"),
        overlay = await store(proposal.overlay, "inherit-forest-overlay"), objects = proposal.objects ? await store(proposal.objects, "inherit-forest-objects") : undefined;
      task = { target: "forest", imageId, instruction: forestTone
        ? "森林沿用上一帧处理 / Forest: use previous treatment" : "森林沿用上一帧绿色 / Forest: use previous green", threshold: .35, area: "all",
        sourceSha: hash(source), maskSha: hash(proposal.mask), maskUrl: mask.imageUrl, protectedUrl: protection.imageUrl,
        overlayUrl: overlay.imageUrl, selectedPixels: proposal.selectedPixels, objectMaskUrl: objects?.imageUrl,
        objectMaskSha: proposal.objects ? hash(proposal.objects) : undefined };
    }
    if (!task.selectedPixels) return false;
    let treatment = savedTreatment;
    if (sourceTask?.candidate) {
      const candidate = sourceTask.candidate;
      const reference = images.find(image => image.id === candidate.imageId)!;
      const referenceBytes = await read(candidate.imageId);
      const mask = await d.read({ ...reference, imageUrl: sourceTask.maskUrl });
      const protection = await d.read({ ...reference, imageUrl: sourceTask.protectedUrl });
      const objects = sourceTask.objectMaskUrl ? await d.read({ ...reference, imageUrl: sourceTask.objectMaskUrl }) : undefined;
      if (hash(mask) !== sourceTask.maskSha || (objects && hash(objects) !== sourceTask.objectMaskSha)) throw conflict();
      treatment = { sourceReviewId: sourceReview!.id, sourceRevision: sourceReview!.revision,
        imageId: candidate.imageId, imageUrl: candidate.imageUrl, imageSha: hash(referenceBytes), maskUrl: sourceTask.maskUrl, maskSha: hash(mask),
        protectedUrl: sourceTask.protectedUrl, protectedSha: hash(protection), objectMaskUrl: sourceTask.objectMaskUrl,
        objectMaskSha: sourceTask.objectMaskSha, instruction: sourceTask.instruction, forestTone: sourceTask.forestTone };
    }
    // Declining this frame must not erase the recipe for later frames.
    review.forestTreatmentHistory = [...(review.forestTreatmentHistory ?? []).filter(item => item.imageId !== treatment!.imageId), treatment!].slice(-40);
    if (fixed !== undefined) review.fixedForestPalette = fixed;
    task.inheritance = { ...treatment!, status: "pending", createdTask: !current };
    delete task.approvedRevision;
    review.tasks = [...review.tasks.filter(item => item.target !== "forest"), task];
    return true;
  };
  // A capture asks a question; it never approves a palette, mask or purchase.
  if (input.inspectOnly) {
    const frame = review.frames[0];
    let forestFound = false;
    try {
      const proposals = await d.inspect([{ imageId: frame.imageId, bytes: await read(frame.imageId) }],
        [{ target: "forest", imageId: frame.imageId, threshold: .35, area: "all" }]);
      forestFound = proposals.some(item => item.imageId === frame.imageId && item.target === "forest" && item.selectedPixels > 0);
    } catch {
      return reply(say("这一帧已引用。暂时没有定位清楚物体，你想改哪里、还要一起改什么？可以直接在这里说。",
        "This frame is attached. I couldn’t locate its objects yet. What would you like to change together?"));
    }
    if (forestFound && await prepareInheritance(frame.imageId)) review.phase = "scope_review";
    const pendingPalette = review.tasks.find(task => task.inheritance?.status === "pending")?.inheritance;
    const context = say(`第 ${String(review.shotNo).padStart(2, "0")} 镜 · ${frame.origin === "warehouse-video" ? "源视频 " : ""}${frame.shotTimeSec.toFixed(2)} 秒。`,
      `Shot ${String(review.shotNo).padStart(2, "0")} · ${frame.origin === "warehouse-video" ? "Source video " : ""}${frame.shotTimeSec.toFixed(2)}s. `);
    return reply(context + (pendingPalette ? say(
      `这一帧的森林也要改吗，要沿用上一帧 #${pendingPalette.imageId} 已认可的森林处理吗？还需要改哪里？可以把森林和云的要求一起说，我先标范围，确认后再改。`,
      `Edit this forest too, using the approved treatment from #${pendingPalette.imageId}? What else should change? Describe the forest and clouds together; I’ll mark the regions before editing.`)
      : forestFound ? say("这一帧的森林也要改吗？还需要改哪里？可以把森林和云的要求一起说，我先标范围，确认后再改。",
      "Would you like to edit the forest in this frame too? What else should change? Describe the forest and clouds together; I’ll mark the regions before editing.") : say(
      "这一帧想改哪里、还要一起改什么？直接说，我先标范围。",
      "What would you like to change in this frame? Describe all changes; I’ll mark the regions first.")));
  }
  const feedback = forestPaletteFeedbackDecision(input.instruction);
  if (feedback) {
    const mentioned = [...input.instruction.matchAll(/#(\d+)\b/g)].map(match => Number(match[1]));
    const candidateId = review.tasks.find(task => task.target === "forest")?.candidate?.imageId;
    const imageIds = [...new Set(mentioned.length ? mentioned : [input.imageId ?? candidateId].filter((id): id is number => id != null))];
    if (!imageIds.length) return reply(say("请点选你评价的那张图片，我会记录这张图的森林配色反馈，不会自动改图。", "Select the image you mean; I’ll record feedback on its forest colors without generating anything."));
    for (const id of imageIds) await read(id); // Validate ownership and stable shot, including explicit # references.
    const at = Date.now();
    const decisions: NonNullable<FrameRegionReview["forestPaletteFeedback"]> = imageIds.map(imageId => ({ imageId, decision: feedback, at, instruction: input.instruction }));
    review.forestPaletteFeedback = [...(review.forestPaletteFeedback ?? []).filter(item => !imageIds.includes(item.imageId)),
      ...decisions].slice(-100);
    review.instructions = [...review.instructions, input.instruction].slice(-100);
    if (feedback === "rejected") {
      if (review.fixedForestPalette && paletteStatus(review.fixedForestPalette.imageId) !== "accepted") review.fixedForestPalette = null;
      for (const task of review.tasks) {
        if (task.inheritance && paletteStatus(task.inheritance.imageId) !== "accepted") { delete task.inheritance; delete task.approvedRevision; }
        if (task.shapeQuote && paletteStatus(task.shapeQuote.sourceImageId) === "rejected") {
          const requestId = task.shapeQuote.requestId;
          const submitted = Array.isArray(body.storyboardImageTasks) && body.storyboardImageTasks.some(item =>
            item.requestId === requestId && item.shotIdentity === review.stableShotId);
          if (!submitted) delete task.shapeQuote;
        }
      }
      review.phase = "image_review"; delete review.approvedRevision;
    }
    review.revision++;
    const names = imageIds.map(id => `#${id}`).join("、");
    return reply(feedback === "rejected" ? say(
      `${names} 的森林配色已记为不满意，不会作为后续帧的配色基准。原图和历史保留；这次没有生成、收费或替换剪辑。继续按原要求：只改树木，绿色取自原画，保留明暗、冷暖层次和柔和边缘，阴影可留少量蓝色。\n你想具体怎样调整这版配色？请直接在这段聊天里描述。方向明确前先不生成下一版。`,
      `${names}: forest colors rejected; these images won’t be used as palette references. Originals and history are retained. Nothing was generated, charged or replaced. Keep edits on trees, use scene-matched greens, preserve shading and soft edges, with some blue in shadows.\nHow would you like these colors adjusted? Describe it in this chat; no new version will be generated before the direction is clear.`) : say(
      `${names} 的森林配色已认可。下一帧识别到森林时会询问是否沿用；现在没有改图或替换剪辑。`,
      `${names}: forest colors approved. On another frame with trees, I’ll ask before reusing them. No image or timeline was changed.`));
  }
  const decision = regionReviewDecision(input.instruction);
  if (decision === "cancel") { review.phase = "cancelled"; review.revision++; return reply(say("本次范围修改已取消，记录和原素材保留。", "Region editing cancelled; history and originals are retained.")); }
  if (decision === "confirm_images") {
    if (review.tasks.some(task => task.candidate && paletteStatus(task.candidate.imageId) === "rejected"))
      return reply(say("这里还有已被你否定的配色候选，不能整组确认。请先选出满意的森林配色。", "This set contains rejected colors and cannot be approved as a whole. Choose a satisfactory forest palette first."));
    if (review.phase !== "image_review" || review.tasks.some(task => !task.candidate))
      return reply(say("还没有全部改好的关键帧。飞机和云层的形态修改需要另行生成并确认，暂不生成视频。", "Not all edited keyframes are ready. Airplane/cloud shape edits need separate candidates and review before video generation."));
    review.forestPaletteFeedback = [...(review.forestPaletteFeedback ?? []), ...review.tasks.filter(task => task.target === "forest" && task.candidate)
      .map(task => ({ imageId: task.candidate!.imageId, decision: "accepted" as const, at: Date.now(), instruction: input.instruction }))].slice(-100);
    review.phase = "images_confirmed"; review.revision++;
    return reply(say("关键帧已确认。原视频保留；生成新视频前仍需核对镜头参数和算力报价。", "Keyframes confirmed. The original video is retained; video parameters and a compute quote must be reviewed before generation."));
  }
  const consistency = forestPaletteConsistencyDecision(input.instruction);
  if (consistency === "release") {
    review.fixedForestPalette = null;
    review.instructions = [...review.instructions, input.instruction].slice(-100);
    review.revision++;
    return reply(say("已取消森林统一配色基准，现有图片保留。后续每帧可单独调整。", "The shared forest palette is released. Existing images are retained; later frames can be adjusted separately."));
  }
  const inheritDecision = regionInheritanceDecision(input.instruction) ??
    (consistency === "lock" && review.tasks.some(task => task.inheritance?.status === "pending") ? "accept" : null);
  let cloudUpdated = false;
  if (inheritDecision) {
    const pending = review.tasks.filter(task => task.inheritance?.status === "pending");
    if (inheritDecision === "accept" && pending.some(task => paletteStatus(task.inheritance!.imageId) !== "accepted"))
      return reply(say("上一张森林配色还没有得到认可，先看图确认颜色，再决定是否沿用。不会把已生成当作已满意。", "The previous forest colors have not been approved. Review their appearance before inheriting them; generation alone is not approval."));
    if (!pending.length) return reply(say("当前没有待确认的跨帧修改。请先选中要改的新帧。", "No cross-frame change is awaiting confirmation. Select the new frame first."));
    if (input.imageId && pending.some(task => task.imageId !== input.imageId))
      return reply(say("所选图片已变化，请回到待确认范围图再决定是否继承。", "The selected image changed. Return to the proposed frame before confirming inheritance."));
    if (consistency === "lock") {
      review.instructions = [...review.instructions, input.instruction].slice(-100);
      const cloud = review.tasks.find(task => task.target === "cloud");
      const cloudInstruction = regionInstruction(input.instruction, "cloud");
      if (cloud && regionTargets(input.instruction).includes("cloud") && isCloudAppearanceEdit(cloudInstruction)) {
        cloud.instruction = `${cloud.instruction}\n${cloudInstruction}`.slice(-8000);
        cloud.cloudArtDirection = cloudArtDirection(cloudInstruction, cloud.cloudArtDirection);
        delete cloud.shapeQuote; delete cloud.candidate; delete cloud.approvedRevision;
        cloudUpdated = true;
      }
    }
    for (const task of pending) {
      task.inheritance!.status = inheritDecision === "accept" ? "accepted" : "declined";
      task.inheritance!.decidedAt = Date.now();
      if (inheritDecision === "accept") {
        const policy = [...review.instructions].reverse().map(forestPaletteConsistencyDecision).find(Boolean);
        if (policy === "lock") {
          const { status: _status, createdTask: _created, decidedAt: _decided, ...palette } = task.inheritance!;
          review.fixedForestPalette = palette;
        }
        task.forestTone = task.inheritance!.forestTone;
        task.instruction = task.forestTone === "reduce_green_flatness"
          ? `森林沿用图片 #${task.inheritance!.imageId} 的处理：降低过强绿感，保留明暗和冷暖层次 / Forest: use previous tone treatment`
          : `森林沿用图片 #${task.inheritance!.imageId} 的绿色 / Forest: use previous green`;
      }
    }
    if (inheritDecision === "decline") {
      review.tasks = review.tasks.filter(task => !pending.includes(task) || !task.inheritance?.createdTask);
      for (const task of review.tasks) if (pending.includes(task)) delete task.inheritance;
      review.declinedInheritanceImageIds = [...new Set([...(review.declinedInheritanceImageIds ?? []), ...pending.map(task => task.imageId)])].slice(-20);
      review.revision++;
      return reply(say("这帧不继承森林改色，继续处理云层。", "No forest color inheritance for this frame. Continue with clouds."));
    }
  }
  if (decision === "confirm_scope" || inheritDecision === "accept") {
    if (decision === "confirm_scope") await prepareInheritance(input.imageId ?? review.tasks.find(task => task.target === review.activeTarget)?.imageId);
    const requestedTargets = regionTargets(input.instruction);
    const confirmedTasks = review.tasks.filter(task => inheritDecision === "accept" ? task.inheritance?.status === "accepted" && task.approvedRevision == null :
      task.inheritance?.status !== "pending" && (!requestedTargets.length || requestedTargets.includes(task.target)));
    if (!confirmedTasks.length && inheritanceQuestion()) { review.revision++; return reply(inheritanceQuestion()); }
    if (!["scope_review", "scope_confirmed", "image_review"].includes(review.phase) || !confirmedTasks.length || confirmedTasks.some(task => !task.selectedPixels))
      return reply(say("请先核对最新范围图；没有定位到的目标需要重新说明范围。", "Review the latest region overlays first; unresolved targets need a revised scope."));
    for (const task of confirmedTasks) task.approvedRevision = review.revision;
    if (review.tasks.every(task => task.approvedRevision != null)) review.approvedRevision = review.revision;
    review.phase = "scope_confirmed";
    const errors: string[] = [];
    for (const task of confirmedTasks) {
      if (task.candidate) continue;
      // Local color processing is deliberately narrow; never replace geometry edits with recoloring.
      if (task.target !== "forest" || (!task.forestTone && !/绿色|变绿|改绿|green/i.test(task.instruction)) || /加.*树|减少.*树|移.*树|更大|bigger|add|remove/i.test(task.instruction)) continue;
      try {
        const source = await read(task.imageId);
        if (hash(source) !== task.sourceSha) throw conflict();
        const original = images.find(image => image.id === task.imageId)!;
        const mask = await d.read({ ...original, imageUrl: task.maskUrl }), protection = await d.read({ ...original, imageUrl: task.protectedUrl });
        if (hash(mask) !== task.maskSha) throw conflict();
        const objects = task.objectMaskUrl ? await d.read({ ...original, imageUrl: task.objectMaskUrl }) : undefined;
        if (objects && hash(objects) !== task.objectMaskSha) throw conflict();
        let palette;
        if (task.inheritance?.status === "accepted") {
          const inherited = task.inheritance, reference = images.find(image => image.id === inherited.imageId)!;
          if (paletteStatus(inherited.imageId) !== "accepted") throw new Error("参考配色尚未认可或已被否定，请先确认森林颜色 / Forest reference has not been approved");
          const bytes = await read(inherited.imageId);
          const referenceMask = await d.read({ ...reference, imageUrl: inherited.maskUrl });
          const referenceProtection = await d.read({ ...reference, imageUrl: inherited.protectedUrl });
          const referenceObjects = inherited.objectMaskUrl ? await d.read({ ...reference, imageUrl: inherited.objectMaskUrl }) : referenceMask;
          if (hash(bytes) !== inherited.imageSha || hash(referenceMask) !== inherited.maskSha || hash(referenceProtection) !== inherited.protectedSha ||
            hash(referenceObjects) !== (inherited.objectMaskSha ?? inherited.maskSha)) throw conflict();
          palette = { source: bytes, mask: referenceMask, protection: referenceProtection, objects: referenceObjects };
        }
        const result = task.forestTone ? await d.recolor(source, mask, protection, objects, palette, task.forestTone)
          : palette ? await d.recolor(source, mask, protection, objects, palette) : await d.recolor(source, mask, protection, objects);
        const sourceSize = await sharp(source).metadata(), outputSize = await sharp(result.bytes).metadata();
        if (sourceSize.width !== outputSize.width || sourceSize.height !== outputSize.height) throw new Error("候选尺寸不一致 / Candidate size mismatch");
        const saved = await store(result.bytes, `${task.target}-candidate`);
        const existing = images.find(image => image.imageKey === saved.imageKey);
        const candidate = existing ?? await d.createImage({ storyId: input.storyId, userId: input.userId, shotIdentity: review.stableShotId,
          shotNo: canonicalizeShotNo(review.shotNo), imageKey: saved.imageKey, imageUrl: saved.imageUrl, parentImageId: task.imageId,
          prompt: `第 ${review.shotNo} 镜 / Shot ${review.shotNo} · 范围 R${review.revision} · ${task.instruction} · Local scene palette; candidate only`,
          isCurrent: false, generationType: "inpaint" });
        task.candidate = { imageId: candidate.id, imageUrl: candidate.imageUrl, changedPixels: result.changedPixels, outsideChangedPixels: 0 };
        // Retain the exact recipe even if the user switches frames before giving
        // appearance feedback. Its presence alone never makes it eligible.
        review.forestTreatmentHistory = [...(review.forestTreatmentHistory ?? []).filter(item => item.imageId !== candidate.id), {
          sourceReviewId: review.id, sourceRevision: review.revision, imageId: candidate.id, imageUrl: candidate.imageUrl,
          imageSha: hash(result.bytes), maskUrl: task.maskUrl, maskSha: task.maskSha,
          protectedUrl: task.protectedUrl, protectedSha: hash(protection), objectMaskUrl: task.objectMaskUrl,
          objectMaskSha: task.objectMaskSha, instruction: task.instruction, forestTone: task.forestTone,
        }].slice(-40);
      } catch (error) { errors.push(error instanceof Error ? error.message : "Local edit failed"); }
    }
    review.phase = review.tasks.some(task => task.candidate) ? "image_review" : "scope_confirmed";
    review.revision++;
    // A later scope refinement must not erase an earlier appearance request.
    const cloud = (cloudUpdated ? review.tasks : confirmedTasks).find(task => task.target === "cloud" && !task.candidate &&
      task.instruction.split(/[。；;\n]/).some(isCloudAppearanceEdit));
    if (cloud && !errors.length && !inheritanceQuestion()) return cloudQuoteReply(cloud);
    const pending = review.tasks.filter(task => !task.candidate).map(task => regionLabels[task.target][input.language === "en" ? "en" : "zh"]).join("、");
    return reply(say(`${confirmedTasks.map(task => regionLabels[task.target].zh).join("、")}范围已确认。${review.tasks.some(task => task.candidate) ? "森林改色候选已保存在仓库，请对比原帧。" : ""}${pending ? `尚无新候选：${pending}。涉及付费生成时会另行报价。` : "看完图片后可说“确认图片”。"}原视频未改动。${errors.length ? `\n本地改色未完成：${errors.join("；")}` : ""}`,
      `Regions confirmed. ${review.tasks.some(task => task.candidate) ? "A forest color candidate is saved in Warehouse; compare it with the source. " : ""}${pending ? `Candidates still needed: ${pending}. Paid generation requires a separate quote. ` : "Say ‘confirm images’ after reviewing. "}The video is unchanged.${errors.length ? `\nLocal edit incomplete: ${errors.join("; ")}` : ""}`) + (inheritanceQuestion() ? `\n${inheritanceQuestion()}` : ""));
  }
  let targets = regionTargets(input.instruction);
  if (!targets.length && isRegionRefinement(input.instruction) && review.activeTarget) targets = [review.activeTarget];
  if (!targets.length && review.activeTarget === "cloud" && isCloudAppearanceEdit(input.instruction)) targets = ["cloud"];
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
  const existingCloud = review.tasks.find(task=>task.target==="cloud");
  if (targets.length===1 && targets[0]==="cloud" && isCloudAppearanceEdit(input.instruction) && existingCloud &&
    (!selected || selected===existingCloud.imageId || selected===existingCloud.shapeQuote?.sourceImageId)) {
    existingCloud.instruction = `${existingCloud.instruction}\n${input.instruction}`.slice(-8000);
    existingCloud.cloudArtDirection=cloudArtDirection(input.instruction,existingCloud.cloudArtDirection);
    delete existingCloud.candidate;
    delete existingCloud.approvedRevision;
    review.phase="scope_review";
    review.instructions=[...review.instructions,input.instruction].slice(-100);
    if(inheritanceQuestion()) { review.revision++; return reply(inheritanceQuestion()); }
    return cloudQuoteReply(existingCloud);
  }
  const requested = targets.map(target => {
    const prior = review.tasks.find(task => task.target === target);
    const ownInstruction = regionInstruction(input.instruction, target);
    const scope = reviseRegionScope(prior && (!selected || selected === prior.imageId) ? prior : { threshold: .35, area: "all" }, ownInstruction);
    const accumulated = [prior?.imageId === (selected ?? prior?.imageId) ? prior?.instruction : undefined, ownInstruction].filter(Boolean).join("\n");
    const forestTone: FrameRegionTask["forestTone"] = target !== "forest" ? undefined :
      isForestGreenMatchEdit(ownInstruction) ? (/少量[^。；;\n]*蓝|减少[^。；;\n]*蓝|less blue|little blue/i.test(ownInstruction)
        ? "harmonize_green_less_blue" : "harmonize_green") : isForestToneEdit(ownInstruction) ? "reduce_green_flatness" :
      prior?.imageId === (selected ?? prior?.imageId) && prior?.forestTone ? prior.forestTone :
      isForestToneEdit(accumulated) ? "reduce_green_flatness" : undefined;
    return { target, ...scope, forestTone, greenEdit: target === "forest" && !forestTone && /绿色|变绿|改绿|green/i.test(accumulated), allowedImageIds: regionTemporalFrames(ownInstruction, review.frames), imageId: selected ?? (targets.length === 1 ? prior?.imageId : undefined) };
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
      inheritance: prior?.imageId === proposal.imageId ? prior.inheritance : undefined,
      instruction: [prior?.imageId === proposal.imageId ? prior.instruction : undefined, regionInstruction(input.instruction, proposal.target)].filter(Boolean).join("\n").slice(-8000), sourceSha: hash(frames.find(frame => frame.imageId === proposal.imageId)!.bytes),
      objectMaskUrl: objects?.imageUrl, objectMaskSha: proposal.objects ? hash(proposal.objects) : undefined,
      maskSha: hash(proposal.mask), maskUrl: mask.imageUrl, protectedUrl: protection.imageUrl, overlayUrl: overlay.imageUrl, selectedPixels: proposal.selectedPixels };
    if(task.target==='forest'&&request.forestTone) {
      task.forestTone=request.forestTone; delete task.inheritance;
    }
    if(task.target==='cloud') task.cloudArtDirection=cloudArtDirection(regionInstruction(input.instruction,'cloud'),prior?.imageId===proposal.imageId?prior.cloudArtDirection:undefined);
    review.tasks = [...review.tasks.filter(item => item.target !== task.target), task];
  }
  // A quote freezes its composite base. A later forest edit on that frame must
  // be confirmed and quoted again, rather than silently using the old colors.
  const changedForest = targets.includes("forest") ? review.tasks.find(task => task.target === "forest") : undefined;
  if (changedForest) {
    for (const task of review.tasks) {
      if (task.target === "cloud" && task.imageId === changedForest.imageId) delete task.shapeQuote;
    }
    if (/绿色|变绿|改绿|green|沿用|继承/i.test(input.instruction)) {
      review.declinedInheritanceImageIds = (review.declinedInheritanceImageIds ?? []).filter(id => id !== changedForest.imageId);
    }
  }
  if (review.sourceImages) review.sourceImages = review.sourceImages.filter(source => review.tasks.some(task => task.imageId === source.imageId));
  review.activeTarget = targets.at(-1);
  const targetImageId = selected ?? review.tasks.find(task => task.target === review.activeTarget)?.imageId;
  const preservesForest = /(?:森林|树木|树冠|树)[^，。；\n]*(?:不改|不动|不变|保持原样)|(?:不要动|别动)(?:森林|树)/.test(input.instruction);
  const explicitForestEdit = consistency !== "lock" && targets.includes("forest") && (isForestToneEdit(regionInstruction(input.instruction,'forest')) || !/绿色|变绿|改绿|green|沿用|继承/i.test(input.instruction));
  if (targetImageId && (preservesForest || explicitForestEdit))
    review.declinedInheritanceImageIds = [...new Set([...(review.declinedInheritanceImageIds ?? []), targetImageId])].slice(-20);
  if (!preservesForest && !explicitForestEdit) await prepareInheritance(targetImageId);
  const cloud=review.tasks.find(task=>task.target==="cloud");
  if (targets.length===1 && targets[0]==="cloud" && isCloudAppearanceEdit(input.instruction) && cloud && !inheritanceQuestion()) return cloudQuoteReply(cloud);
  const summary = targets.length > 1 ? targets.map(target => `${regionLabels[target][input.language === "en" ? "en" : "zh"]}：${regionInstruction(input.instruction, target)}`).join("\n") + "\n" : "";
  return reply(summary + say("粉色是待确认范围，原图还没有改。范围合适后说“确认范围”。",
    "Pink marks proposed regions; source images are unchanged. Refine them in chat, then say ‘confirm regions’.") + (inheritanceQuestion() ? `\n${inheritanceQuestion()}` : ""));
}

export async function frameRegionReviewHistory(input: { storyId: number; userId: number }) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "Story unavailable" });
  return readFrameRegionReviews(jsonRecord(story.body)).filter(review => review.editorUserId === input.userId);
}
