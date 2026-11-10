import { randomUUID } from "node:crypto";
import { z } from "zod";
import { artPreviewBatchSchema, readArtPreviewBatches } from "../../shared/artPreview";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import { estimateStoryboardImageCost } from "../../shared/imageRenderCost";
import { artSystemPrompt } from "../../shared/artSystem";
import { ownedCreationStory, creationFingerprint } from "../repositories/textSourceLineage";
import { getGeneratedImageById, assignStoryImageToShot } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { listOwnedStoryAudioAssets } from "./storyAudioAssets";
import { prepareStoryBody } from "./storySync";
import { persistPreparedStoryBody } from "./storyBodyPersistence";
import { runJsonAgent } from "./agentRuntime";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
async function source(storyId: number, userId: number) {
  const owned = await ownedCreationStory({ storyId, userId });
  const material = await getStoryMaterialState(storyId, userId);
  if (!material) throw new Error("当前视频分镜尚未载入");
  const subtitleCues = normalizeSubtitleState(record(material.timeline.extensions).subtitleTracks).tracks.flatMap(t => t.cues);
  const shots = (Array.isArray(owned.body.shots) ? owned.body.shots : []).map(record).map((s, i) => ({
    stableShotId: text(s.stableShotId) || text(s.shotIdentity), shotNo: Number(s.shotNo) || i + 1,
    sourceVersion: text(record(s.publishingVideo).groupId),
    label: text(s.cueCode) || String(Number(s.shotNo) || i + 1).padStart(2, "0"),
    dialogue: subtitleCues.filter(c => c.provenance.kind === "shot-dialogue" && c.provenance.stableShotId === text(s.stableShotId))
      .sort((a, b) => a.startFrame - b.startFrame).map(c => c.text).join("\n") || text(s.dialogue),
    script: text(s.scriptText).replace(/分镜草案[^\n]*/g, ""), imageBrief: text(s.promptDraft),
    motion: text(s.videoPrompt) || text(s.action), sound: text(s.sound), durationMs: s.durationMs,
  }));
  if (!shots.length || shots.some(s => !s.stableShotId)) throw new Error("需要先有带镜头编号的视频分镜");
  if (shots.length > 12) throw new Error("当前超过 12 个镜头，请先为本次示意选择一个较短的分镜版本");
  const audio = normalizeAudioState(record(material.timeline.extensions).audioTracks);
  const musicIds = new Set(audio.tracks.filter(t => t.kind === "music" && !t.muted)
    .flatMap(t => t.clips.filter(c => !c.muted).map(c => c.assetId)));
  const assets = (await listOwnedStoryAudioAssets({ storyId, userId })).filter(a =>
    a.status === "ready" && a.mediaKind === "music" && musicIds.has(a.id));
  const music = assets.map(a => ({ id: a.id, name: a.displayName, durationSeconds: a.durationSeconds,
    // Only authored music notes; a file name is not an audio analysis.
    prompt: text(record(a.provenance).prompt) || text(record(a.provenance).description) }));
  return { ...owned, material, shots, music, sourceHash: creationFingerprint({ shots, audio, music,
    art: artSystemPrompt(owned.body), subtitles: record(material.timeline.extensions).subtitleTracks }) };
}
export async function planArtPreviews(input: { storyId: number; userId: number; editorName: string; instruction: string; operationToken: string; imageId?: number }) {
  const current = await source(input.storyId, input.userId);
  const batches = readArtPreviewBatches(current.body);
  const replay = batches.find(b => b.id === input.operationToken);
  if (replay) {
    if (replay.instruction !== input.instruction || input.imageId != null && replay.baselineImageId !== input.imageId)
      throw new Error("操作标识已用于另一项示意要求");
    return replay;
  }
  if (batches.length >= 40) throw new Error("示意方案历史已满，请先整理仓库");
  const selected = current.material.shots.flatMap(s => s.imageVersions).find(i => i.isPrimary && i.selectionSource === "explicit");
  const baselineImageId = input.imageId ?? current.material.artSystemReference?.image.id ?? selected?.id;
  if (!baselineImageId) throw new Error("请先告诉我采用哪张效果图，例如“用图片 #2038 生成一组镜头示意图”");
  const image = await getGeneratedImageById(baselineImageId);
  if (!image || image.storyId !== input.storyId || image.userId !== input.userId) throw new Error("这张效果图不属于当前故事");
  const projected = current.material.warehouseImages?.find(i => i.id === baselineImageId);
  if (!image.imageUrl || projected?.availability === "missing" || projected?.status === "rejected") throw new Error("这张效果图已缺失或被弃用，请选择可用的参考图片");
  const schema = z.object({ shots: z.array(z.object({ stableShotId: z.string(), brief: z.string().min(1).max(1400), adaptation: z.string().min(1).max(400) })).min(1).max(12) });
  const result = await runJsonAgent<z.infer<typeof schema>>({
    systemPrompt: "你是分镜美术迁移设计师。用户已选定效果图，后续图会真正携带它作为视觉参考。为每个既有镜头写一段静态示意图要求和简短迁移说明。效果决定可延续的配色、材质、粒子/线条等视觉语言；不机械复制构图和主体，不把隐喻变成未要求的角色。每镜内容由该镜当前台词和用户最新意愿决定。instruction、当前imageBrief/motion优先于script中可能过时的动作、画风与文字建议；不从旧script继承与用户新要求矛盾的风格。结合已提供音乐说明和镜头时间安排疏密/情绪；未分析音频不得编造BPM或声称听过音乐。保持原镜头数量、身份和顺序，不写视频动作堆叠，用关键瞬间呈现。保留界面需要的空间，台词由字幕轨呈现，不生成文字。不要默认油画、水彩、手绘或任何固定风格。不得声称已看过未提供的图片。输出JSON {shots:[{stableShotId,brief,adaptation}]}，brief中英均可，adaptation用中文解释为什么这种迁移适合这一镜，不能输出操作或代码。所有时间只参考durationMs，不采用script旧时码；adaptation不要引用具体秒数。brief应在600字符以内，adaptation在180字符以内。",
    message: JSON.stringify({ instruction: input.instruction, baselineImageId, art: artSystemPrompt(current.body), shots: current.shots, music: current.music }),
    history: Array.isArray(current.body.messages) ? current.body.messages.slice(-12).flatMap(item => {
      const m = record(item);
      return m.role === "user" && typeof m.content === "string" ? [{ role: "user" as const, content: m.content.slice(0, 2000) }] : [];
    }) : [],
    maxTokens: 3600, fallback: () => { throw new Error("未能整理镜头示意要求，尚未生成图片"); },
  });
  const planned = schema.parse(result.parsed).shots;
  if (planned.length !== current.shots.length || planned.some((s, i) => s.stableShotId !== current.shots[i].stableShotId)) throw new Error("示意方案的镜头编号不匹配，未保存或生成");
  const batch = artPreviewBatchSchema.parse({ id: input.operationToken, version: Math.max(0, ...batches.map(b => b.version)) + 1, createdAt: Date.now(), editorId: input.userId, editorName: input.editorName,
    instruction: input.instruction, sourceHash: current.sourceHash, baselineImageId,
    musicContext: current.music.length ? `参考当前配乐：${current.music.map(m => m.name).join("、")}；按已有说明与镜头时长设计，尚未做音频节拍检测。` : "参考分镜中的声音说明；当前没有可识别的已选配乐，不假定节拍。",
    estimatedCny: Math.round(estimateStoryboardImageCost().estimatedCny * planned.length * 100) / 100,
    shots: planned.map((s, i) => ({ ...s, shotNo: current.shots[i].shotNo, label: current.shots[i].label, requestId: randomUUID() })),
  });
  if ((await source(input.storyId, input.userId)).sourceHash !== current.sourceHash) throw new Error("整理期间台词、音乐或镜头已变化，请重新整理示意方案");
  const next = { ...current.body, artPreviewBatches: [...batches, batch] };
  await persistPreparedStoryBody({ ...input, expectedRevision: current.revision, body: prepareStoryBody(next, current.revision + 1, next) });
  return batch;
}

export async function readArtPreviews(storyId: number, userId: number) {
  const { body } = await ownedCreationStory({ storyId, userId });
  const tasks = (Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : []).map(record);
  return readArtPreviewBatches(body).map(batch => ({ ...batch, shots: batch.shots.map(shot => {
    const task = tasks.find(t => t.requestId === shot.requestId);
    const result = record(task?.result);
    return { ...shot, status: text(task?.status) || "planned", error: text(result.error),
      candidates: (Array.isArray(result.candidates) ? result.candidates : []).map(record).flatMap(c =>
        typeof c.imageId === "number" && typeof c.imageUrl === "string" ? [{ imageId: c.imageId, imageUrl: c.imageUrl }] : []) };
  }) }));
}

/** Validate the stored plan immediately before any media purchase. */
export async function artPreviewGenerationInput(storyId: number, userId: number, batchId: string, shotNo: number) {
  const current = await source(storyId, userId);
  const batch = readArtPreviewBatches(current.body).find(b => b.id === batchId);
  const shot = batch?.shots.find(s => s.shotNo === shotNo);
  if (!batch || !shot) throw new Error("未找到这版镜头示意方案");
  if (batch.sourceHash !== current.sourceHash) throw new Error("台词、音乐或镜头要求已变化，请重新整理示意方案；未提交图片");
  return { batch, shot };
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
