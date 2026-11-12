import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { parseChatCutXml, buildChatCutStoryPayload } from "./chatCutXml";
import { getStoryById } from "../repositories/stories";
import { getStoryTimeline, updateStoryAndTimelineAtomic } from "../repositories/timelines";
import { getVideoTakeById } from "../repositories/videos";
import { loadAuthorizedStoryImage } from "../persistence/storyVisualPersistence";
import { getStoryAudioAssetRow } from "../repositories/audioAssets";
import { getStoryRevision } from "./storySync";
import { withVisualEditServiceLock } from "./visualClipEditing";
import { emptyAudioState, type AudioTrackKind } from "../../shared/timelineAudioModel";
import { DEFAULT_TIMELINE_TRANSFORM, DEFAULT_TIMELINE_VIDEO_EFFECTS, type StoryTimelineItem } from "../../shared/storyMaterial";

export const chatCutRelinkSchema = z.object({
  storyId: z.number().int().positive(),
  expectedStoryRevision: z.number().int().nonnegative(),
  expectedTimelineVersion: z.number().int().nonnegative(),
  xml: z.string().min(1).max(2_000_000),
  assets: z.array(z.object({
    name: z.string().min(1).max(300),
    kind: z.enum(["video", "image", "audio"]),
    id: z.number().int().positive(),
  })).min(1).max(250),
});

type Envelope = { gain: number; fadeInFrames: number; fadeOutFrames: number };
const rows = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];

/** Only constant gain/opacity plus linear boundary fades are supported. */
export function readChatCutEnvelopes(xml: string): Map<string, Envelope> {
  const raw = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const sequence = raw.xmeml?.project?.children?.sequence ?? raw.xmeml?.sequence;
  const result = new Map<string, Envelope>();
  for (const media of ["video", "audio"]) for (const track of rows(sequence?.media?.[media]?.track)) {
    for (const clip of rows(track.clipitem)) {
      const parameters = rows(clip.filter).flatMap(f => rows(f.effect?.parameter));
      const p = parameters.find(p => p.parameterid === (media === "audio" ? "level" : "opacity"));
      const unit = media === "audio" ? 1 : 100;
      const gain = Number(p?.value ?? unit) / unit;
      const keys = rows(p?.keyframe).map(k => ({ when: Number(k.when), value: Number(k.value) / unit }));
      const start = Number(clip.in), end = Number(clip.out);
      if (!Number.isFinite(gain) || gain < 0 || gain > (media === "audio" ? 4 : 1) ||
          keys.some((k, i) => !Number.isInteger(k.when) || k.when < start || k.when > end ||
            (k.value !== 0 && Math.abs(k.value - gain) > 1e-6) || (i > 0 && k.when < keys[i-1].when))) {
        throw new Error(`不支持的音量/透明度曲线：${clip.name}`);
      }
      const fadeInFrames = keys[0]?.value === 0 && keys.length > 1 ? keys[1].when - start : 0;
      const fadeOutFrames = keys.at(-1)?.value === 0 && keys.length > 1 ? end - keys.at(-2)!.when : 0;
      if (keys.slice(1, -1).some(k => k.value !== gain) || fadeInFrames + fadeOutFrames > end - start)
        throw new Error(`不是边界淡入淡出：${clip.name}`);
      result.set(clip["@_id"], { gain, fadeInFrames, fadeOutFrames });
    }
  }
  return result;
}

const audioSlots: AudioTrackKind[] = ["narration", "ambience", "sfx", "source", "music"];
const audioLabels = ["旁白 / Narration", "环境声 / Ambience", "音效 / SFX", "打字音效 / Typing", "音乐 / Music"];

/** Attach already imported, owned media to a new XML story in one CAS.
 * No paths, providers, downloads or unowned asset URLs are accepted here.
 */
export async function completeChatCutRelink(input: z.infer<typeof chatCutRelinkSchema> & { userId: number }) {
  return withVisualEditServiceLock(input.storyId, input.userId, async () => {
    const scope = { storyId: input.storyId, userId: input.userId };
    const story = await getStoryById(input.storyId, input.userId);
    if (!story) throw new Error("故事不存在或无权操作");
    const body = story.body as Record<string, any>;
    const fingerprint = createHash("sha256").update(input.xml).digest("hex");
    if (body.chatCutRelink?.fingerprint === fingerprint) return { status: "ok" as const, reused: true };
    if (body.chatCutImport?.relinkStatus !== "required") throw new Error("仅能完成尚未关联素材的新 XML 故事");
    const timeline = await getStoryTimeline(input.storyId, input.userId);
    if (getStoryRevision(body) !== input.expectedStoryRevision || (timeline?.version ?? 0) !== input.expectedTimelineVersion)
      throw new Error("故事或剪辑已改变，请刷新后核对");
    const plan = parseChatCutXml(input.xml);
    const imported = body.chatCutImport;
    for (const key of ["sequenceName", "fps", "width", "height", "durationFrames", "videoTracks", "audioTracks"] as const) {
      if (JSON.stringify(plan[key]) !== JSON.stringify(imported[key])) throw new Error("工程 XML 与故事来源不一致");
    }
    if (plan.fps !== 30 || plan.videoTracks.length !== 2 || plan.audioTracks.length !== 5 ||
        plan.primaryVideoTrackIndex !== 1 || plan.videoTracks.some(t => t.transitions.length) || plan.audioTracks.some(t => t.transitions.length))
      throw new Error("此关联流程要求已核对的 30fps 双画面轨、五音轨工程");
    const all = [...plan.videoTracks, ...plan.audioTracks].flatMap(t => t.clips);
    if (all.some(c => c.timeRemap || c.transform.rotation || c.transform.centerX || c.transform.centerY ||
        c.transform.cropLeft || c.transform.cropRight || c.transform.cropTop || c.transform.cropBottom || c.transform.scalePercent !== 100))
      throw new Error("工程含未支持的变换或变速");
    if (plan.videoTracks[0].clips.some(c => c.mediaKind !== "video") || plan.videoTracks[1].clips.some(c => c.mediaKind !== "image"))
      throw new Error("底层必须是视频，上层必须是图片");
    const bindings = new Map(input.assets.map(a => [`${a.kind}:${a.name}`, a.id]));
    if (bindings.size !== input.assets.length) throw new Error("素材绑定重复");
    const envelopes = readChatCutEnvelopes(input.xml);
    const payload = buildChatCutStoryPayload(plan);
    const items: StoryTimelineItem[] = [];
    for (const [i, clip] of plan.videoTracks[0].clips.entries()) {
      const id = bindings.get(`video:${clip.name}`);
      const take = id ? await getVideoTakeById(id, input.userId) : null;
      const shot = payload.shots[i];
      if (!take || take.storyId !== input.storyId || take.stableShotId !== shot.stableShotId || take.status !== "available" || !take.videoUrl)
        throw new Error(`视频未就绪或不属于本镜头：${clip.name}`);
      if (clip.outFrame > Math.round(Number(take.durationSec) * 30) || clip.endFrame - clip.startFrame !== clip.outFrame - clip.inFrame)
        throw new Error(`视频范围超过原素材：${clip.name}`);
      items.push({ ...payload.timelineItems[i], timelineStartFrame: clip.startFrame,
        durationFrames: clip.endFrame - clip.startFrame, plannedDurationMs: (clip.endFrame - clip.startFrame) * 1000 / 30,
        primaryVideoEdit: { takeId: take.id, sourceStartSec: clip.inFrame / 30, sourceEndSec: clip.outFrame / 30,
          effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS, muted: true } }, imageClips: [] });
    }
    for (const clip of plan.videoTracks[1].clips) {
      const id = bindings.get(`image:${clip.name}`);
      const image = id ? await loadAuthorizedStoryImage({ ...scope, imageId: id }) : null;
      if (!image) throw new Error(`文字图片不存在或不属于本故事：${clip.name}`);
      const owner = items.find(i => i.timelineStartFrame! <= clip.startFrame && i.timelineStartFrame! + i.durationFrames! >= clip.endFrame);
      if (!owner) throw new Error(`文字层跨越镜头，需要单独处理：${clip.name}`);
      const envelope = envelopes.get(clip.id)!;
      owner.imageClips!.push({ id: `chatcut-${clip.id}`, imageId: image.id, imageUrl: image.imageUrl!, label: clip.name,
        offsetFrames: clip.startFrame - owner.timelineStartFrame!, timelineStartFrame: clip.startFrame,
        durationFrames: clip.endFrame - clip.startFrame, visualLayer: 1, transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        composition: { opacity: envelope.gain, fadeInFrames: envelope.fadeInFrames, fadeOutFrames: envelope.fadeOutFrames } });
    }
    const audio = emptyAudioState();
    for (const track of plan.audioTracks) {
      const target = audio.tracks.find(t => t.kind === audioSlots[track.index-1])!;
      target.sourceTrack = { index: track.index, label: audioLabels[track.index-1] };
      for (const clip of track.clips) {
        const id = bindings.get(`audio:${clip.name}`);
        const asset = id ? await getStoryAudioAssetRow({ ...scope, assetId: id }) : null;
        if (!asset || asset.status !== "ready" || clip.outFrame > (asset.durationFrames ?? 0) ||
            clip.endFrame - clip.startFrame !== clip.outFrame - clip.inFrame)
          throw new Error(`声音范围或归属无效：${clip.name}`);
        target.clips.push({ id: `chatcut-${clip.id}`, assetId: asset.id, timelineStartFrame: clip.startFrame,
          sourceInFrame: clip.inFrame, sourceOutFrame: clip.outFrame, durationFrames: clip.endFrame - clip.startFrame,
          muted: false, ...envelopes.get(clip.id)! });
      }
    }
    const saved = await updateStoryAndTimelineAtomic({ ...scope,
      expectedStoryRevision: input.expectedStoryRevision, expectedTimelineVersion: input.expectedTimelineVersion, recordVideoRevision: true,
      nextStoryBody: { ...body, _revision: input.expectedStoryRevision + 1,
        chatCutImport: { ...imported, relinkStatus: "linked" },
        chatCutRelink: { fingerprint, importedAt: new Date().toISOString(), userId: input.userId,
          intent: "从用户提供的 ChatCut 工程恢复独立故事，保留原画面与时序", assets: input.assets } },
      nextTimeline: { items, overlays: [], visualLayerState: { count: 2, hidden: [] },
        extensions: { audioTracks: audio, subtitleTracks: { tracks: [] },
          chatCutMigration: { id: fingerprint, canvas: { width: plan.width, height: plan.height } } } },
    });
    return { status: "ok" as const, reused: false, timelineVersion: saved.timeline.version,
      videos: items.length, images: plan.videoTracks[1].clips.length, audioClips: plan.audioTracks.reduce((n,t) => n+t.clips.length, 0) };
  });
}
