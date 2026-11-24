import { randomUUID } from "node:crypto";
import { z } from "zod";
import { artPreviewBatchSchema, readArtPreviewBatches, type ArtPreviewBatch } from "../../shared/artPreview";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import { estimateStoryboardImageCost } from "../../shared/imageRenderCost";
import { activeArtSystemRecipe, artSystemPrompt } from "../../shared/artSystem";
import { ownedCreationStory, creationFingerprint } from "../repositories/textSourceLineage";
import { getGeneratedImageById, assignStoryImageToShot } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { listOwnedStoryAudioAssets } from "./storyAudioAssets";
import { prepareStoryBody } from "./storySync";
import { persistPreparedStoryBody } from "./storyBodyPersistence";
import { runJsonAgent } from "./agentRuntime";
import { previewArtBasis } from "./previewArtBasis";
import { isWechatImportImage, privateReferenceOrigin, wechatProviderReference } from "./wechatVideoImage";
import { preparePreviewCoverCopy } from "./previewCoverCopy";
import { stillVisualDescription } from "./confirmedStoryboardImagePrompt";
import { compileCreationEmotion } from "../../shared/creationEmotion";
import { storyEmotion } from "./creationEmotion";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
async function source(storyId: number, userId: number) {
  const owned = await ownedCreationStory({ storyId, userId });
  const material = await getStoryMaterialState(storyId, userId);
  if (!material) throw new Error("当前视频分镜尚未载入");
  const subtitleCues = normalizeSubtitleState(record(material.timeline.extensions).subtitleTracks).tracks.flatMap(t => t.cues);
  const rawShots = (Array.isArray(owned.body.shots) ? owned.body.shots : []).map(record);
  const shots = rawShots.map((s, i) => ({
    stableShotId: text(s.stableShotId) || text(s.shotIdentity), shotNo: Number(s.shotNo) || i + 1,
    sourceVersion: text(record(s.publishingVideo).groupId),
    label: text(s.cueCode) || String(Number(s.shotNo) || i + 1).padStart(2, "0"),
    dialogue: subtitleCues.filter(c => c.provenance.kind === "shot-dialogue" && c.provenance.stableShotId === text(s.stableShotId))
      .sort((a, b) => a.startFrame - b.startFrame).map(c => c.text).join("\n") || text(s.dialogue),
    script: text(s.scriptText).replace(/分镜草案[^\n]*/g, ""), imageBrief: text(s.promptDraft),
    motion: text(s.videoPrompt) || text(s.action), sound: text(s.sound), durationMs: s.durationMs,
  }));
  if (!shots.length || shots.some(s => !s.stableShotId)) throw new Error("需要先有带镜头编号的视频分镜");

  const audio = normalizeAudioState(record(material.timeline.extensions).audioTracks);
  const musicIds = new Set(audio.tracks.filter(t => t.kind === "music" && !t.muted)
    .flatMap(t => t.clips.filter(c => !c.muted).map(c => c.assetId)));
  const assets = (await listOwnedStoryAudioAssets({ storyId, userId })).filter(a =>
    a.status === "ready" && a.mediaKind === "music" && musicIds.has(a.id));
  const music = assets.map(a => ({ id: a.id, name: a.displayName, durationSeconds: a.durationSeconds,
    // Only authored music notes; a file name is not an audio analysis.
    prompt: text(record(a.provenance).prompt) || text(record(a.provenance).description) }));
  const recipe = activeArtSystemRecipe(owned.body);
  const filmStyle = recipe?.system?.filmStyleImageId ? { version: recipe.version, imageId: recipe.system.filmStyleImageId } : null;
  const artBasis = previewArtBasis(owned.body, material, owned.story.title);
  const frameNotes = rawShots.map(s => [...new Set([s.subject, s.location, s.timeLight, s.lighting, s.colorPalette,
    s.materialTexture, s.cameraAngle, s.lens, s.mood, s.characterReference, s.wardrobeReference, s.sceneReference,
    s.textureReference, s.negativePrompt && `避免：${s.negativePrompt}`,
    compileCreationEmotion(storyEmotion(owned.body, { shotId: text(s.stableShotId) }), "art")].map(text).filter(Boolean))].join("；"));
  const { source: _displayLabel, ...renderBasis } = artBasis;
  return { ...owned, material, shots, music, filmStyle, artBasis, frameNotes, artBasisHash: creationFingerprint({ renderBasis, frameNotes }),
    sourceHash: creationFingerprint({ shots, audio, music,
    art: artSystemPrompt(owned.body), subtitles: record(material.timeline.extensions).subtitleTracks }) };
}
export async function readPreviewArtBasis(storyId: number, userId: number) {
  const current = await source(storyId, userId);
  const cover = current.material.warehouseImages?.find(i => i.id === current.artBasis.coverImageId);
  const defaultReferenceId = current.material.artSystemReference?.image.id ?? cover?.id;
  return { ...current.artBasis, filmStyleImageId: current.filmStyle?.imageId ?? null,
    needsCoverCopy: !!cover?.imageUrl && (defaultReferenceId === cover.id || current.filmStyle?.imageId === cover.id) &&
      isWechatImportImage(cover.imageUrl) && !privateReferenceOrigin() };
}
export async function planArtPreviews(input: { storyId: number; userId: number; editorName: string; instruction: string; operationToken: string; imageId?: number; sampleShotId?: string; sampleShotIds?: string[]; adjustment?: string; coverCopyImageId?: number }) {
  if (input.sampleShotId && input.sampleShotIds) throw new Error("请选择一种试图镜头范围");
  const samples = input.sampleShotIds ?? (input.sampleShotId ? [input.sampleShotId] : undefined);
  const current = await source(input.storyId, input.userId);
  const batches = readArtPreviewBatches(current.body);
  const replay = batches.find(b => b.id === input.operationToken);
  if (replay) {
    if (JSON.stringify(replay.sampleShotIds) !== JSON.stringify(input.sampleShotIds) || replay.sampleShotId !== input.sampleShotId || replay.instruction !== input.instruction || replay.adjustment !== input.adjustment || replay.coverCopy?.imageId !== input.coverCopyImageId || input.imageId != null && replay.baselineImageId !== input.imageId)
      throw new Error("操作标识已用于另一项示意要求");
    return replay;
  }
  if (batches.length >= 40) throw new Error("示意方案历史已满，请先整理仓库");
  const selected = current.material.shots.flatMap(s => s.imageVersions).find(i => i.isPrimary && i.selectionSource === "explicit");
  const bookReference = samples && current.material.shots.find(s => s.imageGenerationReferences?.length)?.imageGenerationReferences?.[0];
  const baselineImageId = input.imageId ?? current.material.artSystemReference?.image.id ?? current.artBasis.coverImageId ?? selected?.id ?? bookReference?.id;
  if (!baselineImageId && !samples) throw new Error("请先告诉我采用哪张效果图，例如“用图片 #2038 生成一组镜头示意图”");
  if (baselineImageId) {
    const image = await getGeneratedImageById(baselineImageId);
    if (!image || image.storyId !== input.storyId || image.userId !== input.userId) throw new Error("这张效果图不属于当前故事");
    const projected = current.material.warehouseImages?.find(i => i.id === baselineImageId);
    if (!image.imageUrl || projected?.availability === "missing" || projected?.status === "rejected") throw new Error("这张效果图已缺失或被弃用，请选择可用的参考图片");
  }
  const targets = samples ? current.shots.filter(s => samples.includes(s.stableShotId)) : current.shots;
  if (samples && (samples.length > 3 || targets.length !== samples.length)) throw new Error("试图镜头已变化，请重新勾选一至三镜");
  if (!targets.length || targets.length > 12) throw new Error("请选择当前分镜中的一个镜头试图，或选择不超过十二镜的方案");
  const schema = z.object({ shots: z.array(z.object({ stableShotId: z.string(), brief: z.string().min(1).max(1400), adaptation: z.string().min(1).max(400) })).min(1).max(12) });
  const result = samples ? { parsed: { shots: targets.map(s => ({
    stableShotId: s.stableShotId, brief: (s.imageBrief || s.script || s.dialogue || input.instruction).slice(0, 1400),
    adaptation: "比较这个镜头的四种画面，再决定采用哪张。",
  })) } } : await runJsonAgent<z.infer<typeof schema>>({
    systemPrompt: "你是分镜美术迁移设计师。用户已选定效果图，后续图会真正携带它作为视觉参考。为每个既有镜头写一段静态示意图要求和简短迁移说明。效果决定可延续的配色、材质、粒子/线条等视觉语言；不机械复制构图和主体，不把隐喻变成未要求的角色。每镜内容由该镜当前台词和用户最新意愿决定。instruction、当前imageBrief/motion优先于script中可能过时的动作、画风与文字建议；不从旧script继承与用户新要求矛盾的风格。结合已提供音乐说明和镜头时间安排疏密/情绪；未分析音频不得编造BPM或声称听过音乐。保持原镜头数量、身份和顺序，不写视频动作堆叠，用关键瞬间呈现。保留界面需要的空间，台词由字幕轨呈现，不生成文字。不要默认油画、水彩、手绘或任何固定风格。不得声称已看过未提供的图片。输出JSON {shots:[{stableShotId,brief,adaptation}]}，brief中英均可，adaptation用中文解释为什么这种迁移适合这一镜，不能输出操作或代码。所有时间只参考durationMs，不采用script旧时码；adaptation不要引用具体秒数。brief应在600字符以内，adaptation在180字符以内。",
    message: JSON.stringify({ instruction: input.instruction, adjustment: input.adjustment, baselineImageId, art: current.artBasis, shots: current.shots, music: current.music }),
    history: Array.isArray(current.body.messages) ? current.body.messages.slice(-12).flatMap(item => {
      const m = record(item);
      return m.role === "user" && typeof m.content === "string" ? [{ role: "user" as const, content: m.content.slice(0, 2000) }] : [];
    }) : [],
    maxTokens: 3600, fallback: () => { throw new Error("未能整理镜头示意要求，尚未生成图片"); },
  });
  const planned = schema.parse(result.parsed).shots;
  if (planned.length !== targets.length || planned.some((s, i) => s.stableShotId !== targets[i].stableShotId)) throw new Error("示意方案的镜头编号不匹配，未保存或生成");
  // Follow the actual image on this shot. An unchosen or cancelled experiment contributes no direction.
  const history = readPreviewResults(current.body);
  function previousChoice(stableShotId: string) {
    const imageId = current.material.shots.find(s => s.stableShotId === stableShotId)?.currentImage?.id;
    if (!imageId) return;
    for (const prior of history) {
      const match = prior.shots.find(s => s.stableShotId === stableShotId && s.status === "succeeded" && s.candidates.some(c => c.imageId === imageId));
      if (match) return { imageId, version: prior.version,
        adjustments: [...new Set([...(match.previousChoice?.adjustments ?? []), ...(prior.adjustment ? [prior.adjustment] : [])])] };
    }
  }
  const batch = artPreviewBatchSchema.parse({ id: input.operationToken, version: Math.max(0, ...batches.map(b => b.version)) + 1, createdAt: Date.now(), editorId: input.userId, editorName: input.editorName,
    instruction: input.instruction, sourceHash: current.sourceHash, baselineImageId: baselineImageId ?? null, sampleShotId: input.sampleShotId,
    sampleShotIds: input.sampleShotIds,
    filmStyle: current.filmStyle,
    artBasis: current.artBasis, artBasisHash: current.artBasisHash, adjustment: input.adjustment,
    musicContext: current.music.length ? `参考当前配乐：${current.music.map(m => m.name).join("、")}；按已有说明与镜头时长设计，尚未做音频节拍检测。` : "参考分镜中的声音说明；当前没有可识别的已选配乐，不假定节拍。",
    estimatedCny: Math.round(estimateStoryboardImageCost().estimatedCny * planned.length * 100) / 100,
    shots: planned.map((s, i) => ({
      ...s, shotNo: targets[i].shotNo, label: targets[i].label, requestId: randomUUID(),
      frameNotes: samples ? current.frameNotes[current.shots.indexOf(targets[i])] : undefined,
      currentFrameId: current.material.shots.find(shot => shot.stableShotId === s.stableShotId)?.currentImage?.id ?? null,
      previousChoice: previousChoice(s.stableShotId),
    })),
  });
  const latest = await source(input.storyId, input.userId);
  if (latest.sourceHash !== current.sourceHash || latest.artBasisHash !== current.artBasisHash) throw new Error("整理期间创作依据已变化，请重新整理示意方案");
  const referenceIds = new Set([current.filmStyle?.imageId, ...batch.shots.flatMap(s =>
    previewRenderReferences(batch, s, current.material)?.imageIds ?? [])].filter(Boolean));
  if (input.coverCopyImageId && (input.coverCopyImageId !== current.artBasis.coverImageId || !referenceIds.has(input.coverCopyImageId)))
    throw new Error("封面已更换，请重新选择本轮要发送的封面缩图。");
  for (const id of referenceIds) {
    const image = current.material.warehouseImages?.find(i => i.id === id);
    if (image?.imageUrl && isWechatImportImage(image.imageUrl) && id !== input.coverCopyImageId) {
      if (!privateReferenceOrigin()) throw new Error(id === current.artBasis.coverImageId
        ? "MJ 无法直接读取本机私有封面。请在试图对话中勾选发送本轮封面缩图，再查看报价。"
        : `MJ 无法读取本机的私有参考图 #${id}，请更换这张参考图再查看报价。`);
      await wechatProviderReference(image.imageUrl, input.userId);
    }
  }
  if (input.coverCopyImageId) {
    batch.coverCopy = { imageId: input.coverCopyImageId, receipt: await preparePreviewCoverCopy({
      storyId: input.storyId, userId: input.userId, imageId: input.coverCopyImageId, roundId: batch.id }) };
  }
  const next = { ...current.body, artPreviewBatches: [...batches, batch] };
  await persistPreparedStoryBody({ ...input, expectedRevision: current.revision, body: prepareStoryBody(next, current.revision + 1, next) });
  return batch;
}

export async function readArtPreviews(storyId: number, userId: number) {
  const { body } = await ownedCreationStory({ storyId, userId });
  return readPreviewResults(body);
}
function readPreviewResults(body: Record<string, unknown>) {
  const tasks = (Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : []).map(record);
  return readArtPreviewBatches(body).map(batch => ({ ...batch, shots: batch.shots.map(shot => {
    const task = tasks.find(t => t.requestId === shot.requestId);
    const result = record(task?.result);
    return { ...shot, status: text(task?.status) || "planned", error: text(result.error),
      candidates: (Array.isArray(result.candidates) ? result.candidates : []).map(record).flatMap(c =>
        typeof c.imageId === "number" && typeof c.imageUrl === "string" ? [{ imageId: c.imageId, imageUrl: c.imageUrl }] : []) };
  }) }));
}

function previewRenderReferences(batch: ArtPreviewBatch, shot: ArtPreviewBatch["shots"][number], material: StoryMaterialState) {
  const style = batch.filmStyle;
  // A separately pinned film style leaves the image-prompt slot free for this shot's adopted composition.
  const materialShot = material.shots.find(s => s.stableShotId === shot.stableShotId);
  const currentImageId = materialShot?.currentImage?.id ?? null;
  const adoptedFrame = shot.previousChoice?.imageId ?? (materialShot?.currentImage?.selectionSource === "explicit" ||
    materialShot?.timelineItem?.referencedImageId === currentImageId ? shot.currentFrameId : null);
  const priorFrame = !batch.baselineImageId || batch.baselineImageId === style?.imageId ? adoptedFrame : null;
  return batch.baselineImageId || style || priorFrame ? {
    imageIds: priorFrame ? [priorFrame] : batch.baselineImageId ? [batch.baselineImageId] : [],
    ...(batch.baselineImageId && !priorFrame ? { imagePurpose: "scene-style" as const } : {}), assets: {}, filmStyleVersion: style?.version ?? 0,
  } : undefined;
}

/** Validate the stored plan immediately before any media purchase. */
export async function artPreviewGenerationInput(storyId: number, userId: number, batchId: string, shotNo: number) {
  const current = await source(storyId, userId);
  const batch = readArtPreviewBatches(current.body).find(b => b.id === batchId);
  const shot = batch?.shots.find(s => s.shotNo === shotNo);
  if (!batch || !shot) throw new Error("未找到这版镜头示意方案");
  if (batch.sourceHash !== current.sourceHash) throw new Error("台词、音乐或镜头要求已变化，请重新整理示意方案；未提交图片");
  if (batch.artBasisHash && batch.artBasisHash !== current.artBasisHash) throw new Error("封面、画风或分镜创作依据已变化，请重新查看试图报价。");
  if (batch.filmStyle !== undefined && (batch.filmStyle?.version !== current.filmStyle?.version || batch.filmStyle?.imageId !== current.filmStyle?.imageId))
    throw new Error("全片画风参考已变化，请重新查看试图报价。");
  const renderReferences = previewRenderReferences(batch, shot, current.material);
  const currentImageId = current.material.shots.find(s => s.stableShotId === shot.stableShotId)?.currentImage?.id ?? null;
  const basis = batch.artBasis;
  const legacyPrompt = !batch.baselineImageId ? `镜头基调试图：${shot.brief}` : `跨镜头美术示意图：只迁移参考图的视觉效果，按本镜内容重新安排构图，不复制上一镜的事件。\n${shot.brief}\n迁移意图：${shot.adaptation}`;
  const prompt = basis ? [stillVisualDescription(shot.brief) || shot.brief,
    basis.direction, shot.frameNotes, !batch.sampleShotId && !batch.sampleShotIds && shot.adaptation,
    shot.previousChoice?.adjustments.length && `本镜此前已采用的调整：${shot.previousChoice.adjustments.join("；")}`,
    batch.adjustment && `本轮调整（与旧要求冲突时以本轮为准）：${batch.adjustment}`,
    basis.filmBrief && `影片创作要求：${basis.filmBrief}`,
    "画面中的人物、场景和构图以本镜为准。镜头明确要求黑白时沿用全片的线条和材质，只调整色彩；字幕由文字轨叠加。",
  ].filter(Boolean).join("\n") : legacyPrompt;
  const quotedFrame = shot.currentFrameId !== undefined ? shot.currentFrameId : shot.previousChoice?.imageId;
  const priorFrameChanged = quotedFrame !== undefined && currentImageId !== quotedFrame;
  return { batch, shot, prompt, renderReferences, priorFrameChanged, requiresNewStyleQuote: batch.filmStyle === undefined && !!current.filmStyle };
}

export async function chooseArtPreview(input: { storyId: number; userId: number; shotNo: number; ordinal: number; version?: number }) {
  const batches = await readArtPreviews(input.storyId, input.userId);
  const batch = input.version ? batches.find(b => b.version === input.version) : batches.at(-1);
  const shot = batch?.shots.find(s => s.shotNo === input.shotNo);
  const image = shot?.candidates[input.ordinal - 1];
  if (!batch || !shot || !image) throw new Error("没有找到这张示意图，请核对镜号和图片序号");
  await artPreviewGenerationInput(input.storyId, input.userId, batch.id, shot.shotNo);
  const result = await assignStoryImageToShot({ ...input, imageId: image.imageId, shotNo: `SH${String(shot.shotNo).padStart(2, "0")}`, shotIdentity: shot.stableShotId,
    metadata: { source: "chat_art_preview_choice", batchId: batch.id, version: batch.version, ordinal: input.ordinal, baselineImageId: batch.baselineImageId } });
  if (!result) throw new Error("示意图已不可用，原镜头未变");
  return { imageId: image.imageId, label: shot.label, version: batch.version };
}
