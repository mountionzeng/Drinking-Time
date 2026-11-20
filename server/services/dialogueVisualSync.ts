import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  cupTypes,
  type DialogueVisualSync,
} from "../../shared/dialogueVisualSync";
import {
  buildTimelineLayout,
  resolveTimelineVisualFrame,
} from "../../shared/timelineLayout";
import {
  audioMixInputGainAtFrame,
  buildAudioMixPlan,
  normalizeAudioState,
  type AudioMixPlanInput,
} from "../../shared/timelineAudioModel";
import {
  normalizeSubtitleState,
  type SubtitleCue,
} from "../../shared/timelineSubtitleModel";
import {
  timelineImageClipStartFrame,
  STORY_TIMELINE_FPS as FPS,
  type StoryMaterialState,
} from "../../shared/storyMaterial";
import {
  imageClipId,
  moveVisualClip,
  visualTrackId,
} from "../../shared/visualClipModel";
import {
  saveStoryVisualTimelineCas,
  loadOwnedStoryVisualAggregate,
  visualDocumentFromTimeline,
} from "../persistence/storyVisualPersistence";
import { resolveManagedAudioPath } from "./audioMedia";
import { loadOwnedStoryAudioAsset } from "./storyAudioAssets";
import { videoFileName } from "./videoConform";
import { localVideoDir } from "./videoMedia";
import { frameRegionRuntime } from "./localFrameRegions";
import type { TimelineEditResult } from "./timelineEditAgent";

const run = promisify(execFile);
const seconds = (frame: number) => (frame / FPS).toFixed(2) + " 秒";
const info = (reply: string): TimelineEditResult => ({
  handled: true,
  appliedCount: 0,
  reply,
});

function speechCue(
  material: StoryMaterialState,
  cmd: DialogueVisualSync,
  from: number,
  until: number,
) {
  const tracks = normalizeSubtitleState(
    material.timeline.extensions?.subtitleTracks,
  ).tracks;
  const compact = (s: string) => s.replace(/[\s\p{P}]/gu, "").toLowerCase();
  const candidates: SubtitleCue[] = [];
  for (const track of tracks) {
    const cues = track.cues
      .filter(
        (c) => c.text.trim() && c.startFrame >= from && c.startFrame < until,
      )
      .sort((a, b) => a.startFrame - b.startFrame);
    const selected = cmd.quote
      ? cues.filter((c) => compact(c.text) === compact(cmd.quote!))
      : [cues[cmd.line - 1]].filter(Boolean);
    candidates.push(...selected);
  }
  return new Set(candidates.map((c) => c.startFrame)).size === 1
    ? candidates
    : [];
}

/** Audible leading edge in a short cue-local PCM window. Continuous speech cannot identify a word boundary. */
export function voiceOnset(
  pcm: Buffer,
  windowStart: number,
  clipStart: number,
  cueFrame: number,
  mix?: AudioMixPlanInput,
) {
  const active: boolean[] = [];
  for (let byte = 0; byte + 800 <= pcm.length; byte += 800) {
    let energy = 0;
    for (let j = 0; j < 800; j += 2)
      energy += Math.pow(pcm.readInt16LE(byte + j) / 32768, 2);
    const gain = mix
      ? audioMixInputGainAtFrame(mix, windowStart + active.length)
      : 1;
    active.push((energy * gain ** 2) / 400 > Math.pow(10, -4.2));
  }
  const starts = active.flatMap((on, i) =>
    on &&
    active[i + 1] &&
    (i === 0
      ? windowStart === clipStart
      : !active[i - 1] && (i < 2 || !active[i - 2]))
      ? [windowStart + i]
      : [],
  );
  return (
    starts
      .filter((f) => Math.abs(f - cueFrame) <= 9)
      .sort((a, b) => Math.abs(a - cueFrame) - Math.abs(b - cueFrame))[0] ??
    null
  );
}

async function measureVoice(
  scope: { storyId: number; userId: number },
  clip: AudioMixPlanInput,
  cue: number,
) {
  if (clip.source.kind !== "asset") return null;
  const asset = await loadOwnedStoryAudioAsset({
    scope,
    assetId: clip.source.assetId,
  });
  if (asset?.status !== "ready") return null;
  const from = Math.max(clip.timelineStartFrame, cue - 11),
    end = Math.min(clip.timelineStartFrame + clip.durationFrames, cue + 12);
  if (end <= from) return null;
  const source = (clip.sourceInFrame + from - clip.timelineStartFrame) / FPS;
  const { stdout } = await run(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-ss",
      String(source),
      "-i",
      resolveManagedAudioPath(asset.storageKey),
      "-t",
      String((end - from) / FPS),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "12000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 8000, maxBuffer: 65536 },
  );
  return voiceOnset(stdout, from, clip.timelineStartFrame, cue, clip);
}

async function cupEntrance(
  file: string,
  start: number,
  end: number,
  kinds: string[],
) {
  if (end - start > 20) throw new Error("请给出这段原视频中物体出现的秒数。");
  const { stdout } = await new Promise<{ stdout: string }>(
    (resolve, reject) => {
      const p = execFile(
        frameRegionRuntime().python,
        [path.resolve("scripts/dialogue-cup-onset.py")],
        { timeout: 30000, maxBuffer: 16384 },
        (error, stdout) =>
          error
            ? reject(
                new Error(
                  "本机看图工具暂时不可用。可指定原片中物体出现的秒数。",
                ),
              )
            : resolve({ stdout }),
      );
      p.stdin?.on("error", () => undefined);
      p.stdin?.end(
        JSON.stringify({
          file: path.join(localVideoDir(), file),
          start,
          duration: end - start,
          kinds,
        }),
      );
    },
  );
  const result = JSON.parse(stdout);
  if (
    !Number.isFinite(result.offsetSec) ||
    result.offsetSec < 0 ||
    result.offsetSec >= end - start
  )
    throw new Error(result.error || "无法定位画面中的入场动作。");
  return start + result.offsetSec;
}

export function alignedWindow(
  event: number,
  destFrames: number,
  durationFrames: number,
  end: number,
) {
  const rate = ((end - event) * FPS) / (durationFrames - destFrames);
  const start = event - (rate * destFrames) / FPS;
  if (
    !Number.isFinite(rate) ||
    !Number.isFinite(start) ||
    start < 0 ||
    rate < 0.25 ||
    rate > 4
  )
    return null;
  return { sourceStartSec: start, playbackRate: rate };
}

export async function syncVisualToDialogue(
  scope: { userId: number; storyId: number },
  material: StoryMaterialState,
  cmd: DialogueVisualSync,
  selected?: string | null,
): Promise<TimelineEditResult> {
  if (cmd.ambiguous) return info("请指定一个镜头和希望画面出现的那一句台词。");
  const shot = material.shots.find((s) =>
    cmd.shotNo !== null ? s.shotNo === cmd.shotNo : s.stableShotId === selected,
  );
  if (!shot)
    return info("请指定镜头号，例如「第一镜的小茶杯随第一句台词出现」。");
  const timeline = material.timeline,
    row = buildTimelineLayout(timeline.items).find(
      (r) => r.item.stableShotId === shot.stableShotId,
    );
  if (!row?.item.included) return info("所选镜头还没有加入剪辑线。");
  const cues = speechCue(material, cmd, row.startFrame, row.endFrame);
  if (!cues.length)
    return info(
      "没有找到唯一的台词起点。请引用本镜字幕中的完整一句，或校对字幕的位置。",
    );
  const cue = cues[0];
  const audioState = normalizeAudioState(timeline.extensions?.audioTracks);
  const speech = audioState.tracks
    .filter(
      (t) =>
        (t.kind === "narration" || t.kind === "dialogue") &&
        !t.muted &&
        t.defaultGain > 0,
    )
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        !c.muted &&
        !c.textStale &&
        c.gain > 0 &&
        c.timelineStartFrame <= cue.startFrame + 9 &&
        c.timelineStartFrame + c.durationFrames > cue.startFrame - 9,
    );
  const bound = speech.filter(
    (c) =>
      c.speechBindingId &&
      cues.some((q) => q.speechBindingId === c.speechBindingId),
  );
  const voices = cues.some((c) => c.speechBindingId) ? bound : speech;
  if (voices.length !== 1)
    return info(
      "这句台词附近没有唯一可听的旁白或对白，请核对台词绑定或将其他人声轨静音。",
    );
  const input = buildAudioMixPlan({ audioState }).inputs.find(
    (i) =>
      i.id === voices[0].id &&
      i.source.kind === "asset" &&
      i.source.assetId === voices[0].assetId,
  );
  if (!input) return info("无法读取这段台词在剪辑线上的声音。");
  const dest = await measureVoice(scope, input, cue.startFrame);
  if (dest == null || dest < row.startFrame || dest >= row.endFrame)
    return info(
      "在台词附近没有检测到清楚的人声起点。请核对旁白的停顿和字幕位置。",
    );
  const aggregate = await loadOwnedStoryVisualAggregate(scope);
  const doc =
    aggregate?.timeline && visualDocumentFromTimeline(aggregate.timeline);
  if (!doc || aggregate.timeline?.version !== timeline.version)
    return info("剪辑版本已变化，请在当前版本重新发送。");
  const base = doc.items.find((i) => i.stableShotId === shot.stableShotId);
  if (!base) return info("镜头没有可编辑的时间线片段。");
  const label = "第 " + String(shot.shotNo).padStart(2, "0") + " 镜";
  let next = doc,
    before: number,
    edit: string;
  const namedImages =
    cmd.cup && cmd.eventSec === null && !cmd.imageId
      ? (base.imageClips ?? []).filter((c) => {
          const types = cupTypes(c.label);
          return cmd.kinds.length === 1
            ? types.includes(cmd.kinds[0])
            : types.length > 0 || /茶杯|杯子/u.test(c.label);
        })
      : [];
  if (namedImages.length > 1)
    return info("这个镜头有多张杯子图片，请指定图片编号。");
  const imageId = cmd.imageId ?? namedImages[0]?.imageId;
  if (imageId) {
    const matches = (base.imageClips ?? []).filter(
      (c) => c.imageId === imageId,
    );
    if (matches.length !== 1)
      return info("本镜找不到唯一的图片 #" + imageId + " 剪辑块。");
    const clip = matches[0];
    if (timeline.visualLayerState?.hidden.includes(clip.visualLayer))
      return info("这张图片所在的画面轨已隐藏。");
    before = timelineImageClipStartFrame(clip, row.startFrame);
    const moved = moveVisualClip(doc, {
      clipId: imageClipId(clip.id),
      toTrackId: visualTrackId(clip.visualLayer),
      toStartFrame: dest,
    });
    if (moved.status !== "ok") return info(moved.message);
    const relocated = moved.document.items
      .find((i) => i.stableShotId === base.stableShotId)
      ?.imageClips?.find((c) => c.id === clip.id);
    if (!relocated) return info("找不到移动后的图片，请刷新后重试。");
    next = {
      ...doc,
      items: doc.items.map((i) =>
        i !== base
          ? i
          : {
              ...base,
              imageClips: base.imageClips?.map((c) =>
                c === clip ? relocated : c,
              ),
            },
      ),
    };
    const winner = resolveTimelineVisualFrame({
      ...next,
      frame: dest,
      hiddenVisualLayers: timeline.visualLayerState?.hidden,
    });
    if (winner.kind !== "image" || winner.placement.clip.id !== clip.id)
      return info("目标帧被另一层画面遮住，请先指定要显示的画面轨。");
    edit = "图片 #" + imageId + " 入画";
  } else {
    if (!cmd.cup && cmd.eventSec === null)
      return info("请指定剪辑线上的图片编号，或补充物体在原视频中出现的秒数。");
    const primary = base.primaryVideoEdit,
      take = shot.currentVideo;
    if (
      !primary ||
      !take ||
      !take.durationSec ||
      primary.takeId !== take.id ||
      primary.effects.reverse ||
      base.visualClipsReplacePrimary ||
      base.visualClips?.length ||
      base.anchors?.length
    )
      return info("请选一段正向、可调整速度的主视频，或指定独立图片块。");
    const winner = resolveTimelineVisualFrame({
      ...timeline,
      frame: dest,
      hiddenVisualLayers: timeline.visualLayerState?.hidden,
    });
    if (
      winner.kind !== "shot" ||
      winner.row.item.stableShotId !== shot.stableShotId
    )
      return info("目标帧显示的是另一层画面，无法直接对齐本镜主视频。");
    if (!primary.effects.muted && primary.effects.volume > 0)
      return info("这段视频还启用了原声。请先分离或静音原声，再单独对齐画面。");
    const file = videoFileName(take);
    if (!file) return info("原视频尚未存到本机。");
    const event =
      cmd.eventSec ??
      (await cupEntrance(
        file,
        primary.sourceEndSec <= 20
          ? 0
          : Math.floor(primary.sourceStartSec * FPS) / FPS,
        primary.sourceEndSec,
        cmd.kinds,
      ));
    if (
      event < primary.sourceStartSec - 1 / FPS ||
      event >= primary.sourceEndSec
    )
      return info("指定的入场点在当前裁切范围之外。");
    before =
      row.startFrame +
      Math.round(
        ((event - primary.sourceStartSec) * FPS) / primary.effects.playbackRate,
      );
    if (Math.abs(before - dest) <= 1)
      return info(
        label + "的画面已经与人声对齐，约在全片 " + seconds(dest) + "。",
      );
    const timing = alignedWindow(
      event,
      dest - row.startFrame,
      row.durationFrames,
      primary.sourceEndSec,
    );
    if (!timing)
      return info("当前原片可用帧数不足以在剪辑器的速度范围内对齐并保留尾帧。");
    next = {
      ...doc,
      items: doc.items.map((i) =>
        i !== base
          ? i
          : {
              ...i,
              primaryVideoEdit: {
                ...primary,
                sourceStartSec: timing.sourceStartSec,
                effects: {
                  ...primary.effects,
                  playbackRate: timing.playbackRate,
                },
              },
            },
      ),
    };
    edit =
      (cmd.cup ? "小茶杯" : "指定动作") +
      "入画。主视频裁去部分前奏，后段以 " +
      timing.playbackRate.toFixed(2) +
      " 倍播放，保留原镜尾";
  }
  if (before === dest) return info(label + "的画面已与人声对齐。");
  const detail =
    label +
    " · " +
    seconds(before) +
    " → " +
    seconds(dest) +
    "，对齐「" +
    cue.text +
    "」开口的第一帧。" +
    edit +
    "。";
  if (cmd.preview)
    return info(
      "试算结果：" + detail + "本次仅测量；发送同一句剪辑要求即可应用。",
    );
  await saveStoryVisualTimelineCas({
    ...scope,
    expectedVersion: timeline.version,
    document: next,
  });
  return {
    handled: true,
    appliedCount: 1,
    undoSnapshot: doc.items,
    reply: "已剪好：" + detail + " 可回放或撤销本次剪辑。",
  };
}
