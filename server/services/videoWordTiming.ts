import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { STORY_TIMELINE_FPS as FPS } from "../../shared/storyMaterial";
import { buildAudioMixPlan, normalizeAudioState } from "../../shared/timelineAudioModel";
import { buildTimelineLayout, resolveTimelineVisualFrame } from "../../shared/timelineLayout";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { replacePrimaryTake } from "../repositories/replacePrimaryTake";
import { createVideoTakeIdempotently, findVideoTakeByIdempotencyKey, getVideoTakeById, updateVideoTake } from "../repositories/videos";
import { resolveManagedAudioPath } from "./audioMedia";
import { loadOwnedStoryAudioAsset } from "./storyAudioAssets";
import { getStoryMaterialState } from "./storyMaterials";
import { videoFileName } from "./videoConform";
import { localVideoDir, storeVideoBytesForTake } from "./videoMedia";

export const wordCutInput = z.object({
  storyId: z.number().int().positive(), stableShotId: z.string().min(1).max(128),
  word: z.string().regex(/^[a-z]{1,40}$/i), hold: z.boolean(),
  expectedVersion: z.number().int().nonnegative(), expectedTakeId: z.number().int().positive(),
  sourceTakeId: z.number().int().positive(), shotNo: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(4000), sentAt: z.number().int().positive(), messageId: z.string().min(1).max(160),
});

const timingSchema = z.object({
  original: z.number().int().nonnegative(), arrival: z.number().int().nonnegative(),
  release: z.number().int().nonnegative(), spoken: z.number().finite().nonnegative(),
});

async function renderCut(job: object) {
  const folder = await mkdtemp(path.join(tmpdir(), "video-word-cut-"));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const production = process.env.NODE_ENV === "production";
      const python = process.env.BOOK_VIDEO_PYTHON || (production ? path.resolve(".runtime/book-video-audio/bin/python") : "python3");
      const model = process.env.BOOK_VIDEO_WHISPER_MODEL || (production ? path.resolve(".runtime/book-video-audio/base.pt") : path.join(homedir(), ".cache/whisper/base.pt"));
      const proc = execFile(python, [path.resolve("scripts/cut-word-timing.py")],
        { timeout: 120000, maxBuffer: 65536 }, (error, stdout) => error ? reject(new Error("本机剪辑未完成，请核对本机语音与画面识别工具。")) : resolve(stdout));
      proc.stdin?.on("error", () => {});
      proc.stdin?.end(JSON.stringify({ ...job, folder, model }));
    });
    const result = JSON.parse(output);
    if (result.error) throw new Error(String(result.error));
    return { timing: timingSchema.parse(result), bytes: await readFile(path.join(folder, "cut.mp4")) };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function cutVideoWord(input: z.infer<typeof wordCutInput>, userId: number) {
  const scope = { storyId: input.storyId, userId };
  const material = await getStoryMaterialState(scope.storyId, userId);
  const shot = material?.shots.find(s => s.stableShotId === input.stableShotId);
  const row = material && buildTimelineLayout(material.timeline.items).find(r => r.item.stableShotId === input.stableShotId);
  const primary = row?.item.primaryVideoEdit;
  if (!material || !shot || !row?.item.included || !primary) throw new Error("请选中剪辑线上的视频镜头。");
  const timeline = material.timeline;
  const key = "word-cut-" + createHash("sha256").update(JSON.stringify([input.messageId,input.stableShotId,input.sourceTakeId,input.word,input.hold,input.expectedVersion,input.expectedTakeId])).digest("hex").slice(0,48);
  let take = await findVideoTakeByIdempotencyKey(input.storyId, userId, key);
  if (take?.status === "available" && primary.takeId === take.id) return { takeId: take.id, reply: "已剪好。" + take.prompt + " 已保存到剪辑线，旁白和音乐沿用原来的时间。" };
  if (timeline.version !== input.expectedVersion || primary.takeId !== input.expectedTakeId) throw new Error("剪辑线已经更新，请核对当前画面后再剪。");
  // Reopening the same reviewed source with the same edit can recover a lost chat receipt.
  if (!take && input.sourceTakeId !== primary.takeId) {
    const active = await getVideoTakeById(primary.takeId, userId);
    const meta = active?.parameterSnapshot as {sourceTakeId?:number;word?:string;hold?:boolean} | null;
    if (active?.status === "available" && active.model === "local-word-cut" && active.storyId === scope.storyId &&
        active.stableShotId === shot.stableShotId && meta?.sourceTakeId === input.sourceTakeId &&
        meta.word?.toLowerCase() === input.word.toLowerCase() && meta.hold === input.hold)
      return { takeId: active.id, reply: "已剪好。" + active.prompt + " 已保存到剪辑线，旁白和音乐沿用原来的时间。" };
  }
  if (take && take.status !== "available") throw new Error("这次剪辑已有制作记录，请核对仓库中的状态。");
  if (!take) {
    const source = await getVideoTakeById(input.sourceTakeId, userId);
    if (!source || source.storyId !== input.storyId || source.stableShotId !== shot.stableShotId || source.status !== "available")
      throw new Error("所选视频不属于当前镜头，或已经不可用。");
    const file = videoFileName(source);
    if (!file || row.durationFrames > 900 || primary.sourceStartSec !== 0 || primary.effects.reverse || primary.effects.playbackRate !== 1 ||
        Math.round(primary.sourceEndSec * FPS) !== row.durationFrames || Math.round((source.durationSec ?? 0) * FPS) !== row.durationFrames ||
        (!primary.effects.muted && primary.effects.volume > 0 && source.id !== primary.takeId) || row.item.visualClipsReplacePrimary || row.item.anchors?.length)
      throw new Error("目前可直接调整 30 秒以内、完整正向播放的本地视频；请核对原声与裁切位置。");
    const matching = normalizeSubtitleState(timeline.extensions?.subtitleTracks).tracks.flatMap(t => t.cues)
      .filter(c => c.startFrame >= row.startFrame && c.startFrame < row.endFrame &&
        c.text.toLowerCase().match(/[a-z]+/g)?.includes(input.word.toLowerCase()));
    if (matching.length !== 1) throw new Error("字幕中无法唯一定位这个词，请核对镜头和英文拼写。");
    const cue = matching[0];
    if (input.hold && cue.text.toLowerCase().match(/[a-z]+/g)?.at(-1) !== input.word.toLowerCase())
      throw new Error("要在句尾停顿，请指定这句字幕的最后一个词。");
    const voices = buildAudioMixPlan({ audioState: normalizeAudioState(timeline.extensions?.audioTracks) }).inputs.filter(a =>
      (a.kind === "narration" || a.kind === "dialogue") && !a.muted && a.baseGain > 0 &&
      a.timelineStartFrame < cue.startFrame + cue.durationFrames && a.timelineStartFrame + a.durationFrames > cue.startFrame);
    if (voices.length !== 1 || voices[0].source.kind !== "asset") throw new Error("目标词附近需要唯一可听的人声。");
    const voice = voices[0];
    const asset = await loadOwnedStoryAudioAsset({ scope, assetId: voices[0].source.assetId });
    if (asset?.status !== "ready") throw new Error("无法读取这一句的原录音。");
    const audioFrom = Math.max(row.startFrame, voice.timelineStartFrame);
    const audioEnd = Math.min(row.endFrame, voice.timelineStartFrame + voice.durationFrames);
    const { bytes, timing } = await renderCut({ source: path.join(localVideoDir(), file), audio: resolveManagedAudioPath(asset.storageKey),
      frames: row.durationFrames, word: input.word, hold: input.hold, audioStart: (voice.sourceInFrame + audioFrom - voice.timelineStartFrame) / FPS,
      audioOffset: (audioFrom - row.startFrame) / FPS, audioFrames: audioEnd - audioFrom,
      cueStart: (cue.startFrame - row.startFrame) / FPS, cueEnd: (cue.startFrame + cue.durationFrames - row.startFrame) / FPS });
    for (let f = timing.arrival; f <= timing.release; f++) {
      const visible = resolveTimelineVisualFrame({ ...timeline, frame: row.startFrame + f, hiddenVisualLayers: timeline.visualLayerState?.hidden });
      if (visible.kind !== "shot" || visible.row.item.stableShotId !== shot.stableShotId) throw new Error("目标词被另一层画面遮住，请核对上层素材。");
    }
    const at = (frame: number) => ((row.startFrame + frame) / FPS).toFixed(2);
    const reply = `第 ${String(shot.shotNo).padStart(2, "0")} 镜的「${input.word}」在全片 ${at(timing.arrival)} 秒完整显示，比这版原画面提前 ${timing.original - timing.arrival} 帧。${input.hold ? "整句画面停到 " + at(timing.release) + " 秒。" : ""}`;
    const claim = await createVideoTakeIdempotently({ ...scope, stableShotId: shot.stableShotId, idempotencyKey: key,
      provider: "manual", model: "local-word-cut", prompt: reply, status: "processing", durationSec: row.durationFrames / FPS,
      aspectRatio: source.aspectRatio, extractionCapability: "available", parameterSnapshot: { sourceTakeId: source.id, timing, word: input.word, hold: input.hold } });
    if (claim.created) {
      try {
        const stored = storeVideoBytesForTake(bytes, claim.take.id);
        take = await updateVideoTake(claim.take.id, userId, { ...stored, status: "available" });
      } catch (err) {
        await updateVideoTake(claim.take.id, userId, { status: "failed", errorMessage: "保存剪辑文件失败" });
        throw err;
      }
    } else take = claim.take;
  }
  if (take?.status !== "available") throw new Error("视频尚未存入仓库。");
  await replacePrimaryTake({ ...input, userId, takeId: take.id });
  return { takeId: take.id, reply: "已剪好。" + take.prompt + " 已保存到剪辑线，旁白和音乐沿用原来的时间。" };
}

/** Persist a finished chat cut even if the browser closes while the video is encoding. */
export async function persistWordCutReply(input: z.infer<typeof wordCutInput>, userId: number, reply: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const story = await getStoryById(input.storyId, userId);
    if (!story) return false;
    const body = story.body as { _revision?: number; messages?: Array<{ id: string; text: string; who: string }> };
    const messages = [...(body.messages ?? [])], replyId = "reply:" + input.messageId;
    const previous = messages.find(m => m.id === replyId);
    if (previous) return previous.who === "s" && previous.text === reply;
    const quote = { storyId: input.storyId, stableShotId: input.stableShotId, sourceId: input.stableShotId,
      sourceType: "shot", shotNo: input.shotNo, selectedText: "第 " + input.shotNo + " 镜" };
    let index = messages.findIndex(m => m.id === input.messageId);
    if (index >= 0 && (messages[index].text !== input.instruction || messages[index].who !== "u")) return false;
    if (index < 0) {
      index = messages.findIndex(m => Number((m as {timestamp?: number}).timestamp) > input.sentAt);
      if (index < 0) index = messages.length;
      const user = { id: input.messageId, who: "u", name: "我", text: input.instruction, timestamp: input.sentAt, selectionQuote: quote };
      messages.splice(index, 0, user);
    }
    const assistant = { id: replyId, who: "s", name: "制作助手", text: reply, timestamp: input.sentAt + 1 };
    messages.splice(index + 1, 0, assistant);
    const revision = body._revision ?? 0;
    if (await updateStoryBodyIfRevision({ id: input.storyId, userId, expectedRevision: revision,
      body: { ...body, _revision: revision + 1, messages } })) return true;
  }
  return false;
}
