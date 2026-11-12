/** Local package migration: imported bytes first, one owner-scoped Story/Timeline CAS last. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { parseChatCutXml, buildChatCutStoryPayload } from "./chatCutXml";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
} from "../../shared/storyMaterial";
import {
  emptyAudioState,
  type AudioTrackKind,
} from "../../shared/timelineAudioModel";
import type {
  SubtitleCue,
  TimelineSubtitleState,
} from "../../shared/timelineSubtitleModel";
import { getStoryById } from "../repositories/stories";
import {
  getStoryTimeline,
  updateStoryAndTimelineAtomic,
} from "../repositories/timelines";
import {
  createVideoTake,
  findVideoTakeByIdempotencyKey,
  updateVideoTake,
  setVideoTimelineSelection,
} from "../repositories/videos";
import { importAudioBytes } from "./storyAudioImport";
import { storeVideoBytesForTake } from "./videoMedia";
import { getStoryRevision } from "./storySync";
import { saveVideoWorkVersion } from "./videoWorkflow";
import { runFfmpegCommand } from "./timelineMediaExport";

const fileSchema = z.object({
  file: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  probe: z
    .object({
      format: z.object({ duration: z.string() }),
      streams: z.array(
        z
          .object({
            codec_type: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
          })
          .passthrough()
      ),
    })
    .passthrough(),
});
export type MigrationFile = z.infer<typeof fileSchema>;
const rows = (value: any): any[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const frame = (time: string) => {
  const [h, m, s, f] = time.split(":").map(Number);
  if (![h, m, s, f].every(Number.isInteger) || m >= 60 || s >= 60 || f >= 30)
    throw new Error(`无效时间码：${time}`);
  return ((h * 60 + m) * 60 + s) * 30 + f;
};
const srtFrame = (time: string) => {
  const [h, m, s, ms] = time.split(/[:,.]/).map(Number);
  return Math.round(((((h * 60 + m) * 60 + s) * 1000 + ms) * 30) / 1000);
};
export function parseBilingualSrt(srt: string): TimelineSubtitleState {
  const state: TimelineSubtitleState = {
    tracks: [
      {
        id: "chatcut-c1",
        name: "English",
        cues: [],
        placement: {
          left: 60 / 1080,
          top: 1560 / 1920,
          width: 960 / 1080,
          fontSize: 56.16 / 1920,
        },
      },
      {
        id: "chatcut-c2",
        name: "中文",
        cues: [],
        placement: {
          left: 60 / 1080,
          top: 1660 / 1920,
          width: 960 / 1080,
          fontSize: 56.16 / 1920,
        },
      },
    ],
  };
  for (const [index, block] of srt
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .entries()) {
    const match = block.match(
      /^\d+\n(\d{2}:\d{2}:\d{2}[,.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,.]\d{3})\n([\s\S]+)$/
    );
    if (!match) throw new Error(`字幕第 ${index + 1} 段格式无效`);
    const text = match[3].trim(),
      startFrame = srtFrame(match[1]),
      end = srtFrame(match[2]);
    if (!text || end <= startFrame)
      throw new Error(`字幕第 ${index + 1} 段时间无效`);
    const track = state.tracks[/[\u3400-\u9fff]/.test(text) ? 1 : 0];
    const cue: SubtitleCue = {
      id: `${track.id}-${index + 1}`,
      text,
      startFrame,
      durationFrames: end - startFrame,
      provenance: { kind: "chatcut-cue", cueCode: `srt-${index + 1}` },
      sourceTextRevision: 0,
      textEdited: false,
      timingEdited: false,
      textRevision: 1,
    };
    track.cues.push(cue);
  }
  return state;
}

/** UI evidence corrects the XML exporter's accumulated rounding, never silently guessing. */
export function buildChatCutMigration(input: {
  xml: string;
  srt: string;
  uiLabels: string[];
}) {
  const plan = parseChatCutXml(input.xml);
  if (
    plan.fps !== 30 ||
    plan.width !== 1080 ||
    plan.height !== 1920 ||
    plan.videoTracks.filter(t => t.clips.length).length !== 1
  )
    throw new Error("此迁移入口只处理已核实的 30fps、1080×1920、单画面轨工程");
  const observed = input.uiLabels.map(label => {
    const match = label.match(
      /^(.*)，([CVA])(\d+)，(\d\d:\d\d:\d\d:\d\d) 至 (\d\d:\d\d:\d\d:\d\d)$/
    );
    if (!match) throw new Error(`无法核对时间线项：${label}`);
    return {
      name: match[1],
      kind: match[2],
      index: Number(match[3]),
      start: frame(match[4]),
      end: frame(match[5]),
    };
  });
  const subtitles = parseBilingualSrt(input.srt);
  for (const [index, track] of subtitles.tracks.entries()) {
    const evidence = observed.filter(
      row => row.kind === "C" && row.index === index + 1
    );
    if (
      evidence.length !== track.cues.length ||
      track.cues.some(
        (cue, i) =>
          cue.startFrame !== evidence[i].start ||
          cue.startFrame + cue.durationFrames !== evidence[i].end
      )
    )
      throw new Error(`C${index + 1} 的 SRT 和界面时间不一致`);
  }
  const adjustments: Array<{
    id: string;
    xmlStart: number;
    xmlEnd: number;
    start: number;
    end: number;
  }> = [];
  for (const [kind, tracks] of [
    ["V", plan.videoTracks],
    ["A", plan.audioTracks],
  ] as const) {
    for (const track of tracks) {
      const evidence = observed.filter(
        row => row.kind === kind && row.index === track.index
      );
      if (evidence.length !== track.clips.length)
        throw new Error(`${kind}${track.index} 片段数不一致`);
      track.clips.forEach((clip, i) => {
        const row = evidence[i];
        if (
          clip.name.replace(/\.[^.]+$/, "") !== row.name ||
          row.end <= row.start ||
          Math.abs(clip.startFrame - row.start) > 3 ||
          Math.abs(clip.endFrame - row.end) > 3
        )
          throw new Error(`源素材和界面无法一一对应：${clip.name}`);
        adjustments.push({
          id: clip.id,
          xmlStart: clip.startFrame,
          xmlEnd: clip.endFrame,
          start: row.start,
          end: row.end,
        });
        clip.startFrame = row.start;
        clip.endFrame = row.end;
      });
    }
  }
  const raw = new XMLParser({ ignoreAttributes: false }).parse(input.xml);
  const sequence = raw.xmeml.project.children.sequence;
  const levels: Record<
    string,
    { gain: number; fadeInFrames: number; fadeOutFrames: number }
  > = {};
  for (const track of rows(sequence.media.audio.track))
    for (const clip of rows(track.clipitem)) {
      const params = rows(clip.filter).flatMap(filter =>
        rows(filter.effect?.parameter)
      );
      const level = params.find(p => p.parameterid === "level");
      const gain = Number(level?.value ?? 1);
      const keys = rows(level?.keyframe).map(k => ({
        when: Number(k.when),
        value: Number(k.value),
      }));
      if (
        !Number.isFinite(gain) ||
        gain < 0 ||
        gain > 4 ||
        keys.some(
          k =>
            !Number.isFinite(k.when) ||
            (k.value !== 0 && Math.abs(k.value - gain) > 1e-6)
        )
      )
        throw new Error(`暂不能无损迁移该音量曲线：${clip.name}`);
      const fadeInFrames =
        keys[0]?.value === 0 && keys[1]?.value === gain
          ? keys[1].when - keys[0].when
          : 0;
      const fadeOutFrames =
        keys.at(-1)?.value === 0 && keys.at(-2)?.value === gain
          ? keys.at(-1)!.when - keys.at(-2)!.when
          : 0;
      if (fadeInFrames < 0 || fadeOutFrames < 0)
        throw new Error("音量关键帧顺序无效");
      levels[String(clip["@_id"])] = { gain, fadeInFrames, fadeOutFrames };
    }
  return { plan, subtitles, levels, adjustments };
}

export async function loadMigrationFiles(
  directory: string
): Promise<Map<string, { info: MigrationFile; bytes: Buffer }>> {
  const manifest = z
    .array(fileSchema)
    .parse(
      JSON.parse(
        await readFile(path.join(directory, "media-manifest.json"), "utf8")
      )
    );
  const files = new Map<string, { info: MigrationFile; bytes: Buffer }>();
  for (const info of manifest) {
    if (path.basename(info.file) !== info.file || files.has(info.file))
      throw new Error("素材文件名重复或包含路径");
    const bytes = await readFile(path.join(directory, "source", info.file));
    if (
      bytes.length !== info.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== info.sha256
    )
      throw new Error(`素材校验不通过：${info.file}`);
    if (!(Number(info.probe.format.duration) > 0))
      throw new Error(`素材时长无效：${info.file}`);
    files.set(info.file, { info, bytes });
  }
  return files;
}

export async function migrateChatCutProject(input: {
  storyId: number;
  userId: number;
  migrationId: string;
  expectedRevision: number;
  expectedTimelineVersion: number;
  migration: ReturnType<typeof buildChatCutMigration>;
  files: Awaited<ReturnType<typeof loadMigrationFiles>>;
}) {
  const owner = { storyId: input.storyId, userId: input.userId };
  const story = await getStoryById(input.storyId, input.userId);
  const timeline = await getStoryTimeline(input.storyId, input.userId);
  if (!story || !timeline) throw new Error("目标作品不存在或无权读取");
  const body = story.body as Record<string, any>;
  if (body.chatCutMigration?.id === input.migrationId)
    return { status: "already-imported", timelineVersion: timeline.version };
  if (
    getStoryRevision(body) !== input.expectedRevision ||
    timeline.version !== input.expectedTimelineVersion
  )
    throw new Error("作品已变动，请重新核对迁移计划");
  const { plan, subtitles, levels } = input.migration;
  const videoClips = plan.videoTracks.find(
    t => t.index === plan.primaryVideoTrackIndex
  )!.clips;
  const payload = buildChatCutStoryPayload(plan);
  const kinds: Record<number, Exclude<AudioTrackKind, "dialogue">> = {
    1: "narration",
    2: "music",
    3: "ambience",
    4: "sfx",
  };
  // Validate every file and bound before making assets. A <=1 frame audio tail is padded explicitly.
  for (const clip of [
    ...videoClips,
    ...plan.audioTracks.flatMap(t => t.clips),
  ]) {
    const file = input.files.get(clip.name);
    if (!file) throw new Error(`缺少素材：${clip.name}`);
    const duration = Number(file.info.probe.format.duration);
    const desiredEnd = clip.inFrame + clip.endFrame - clip.startFrame;
    if (desiredEnd > Math.ceil(duration * 30) + 1 || clip.timeRemap)
      throw new Error(`素材范围或变速需要人工核对：${clip.name}`);
  }
  for (const clip of videoClips) {
    const t = clip.transform;
    if (
      clip.sourceWidth !== 1024 ||
      clip.sourceHeight !== 1024 ||
      Math.abs(t.scalePercent - 105.46875) > 0.001 ||
      t.centerX ||
      t.centerY ||
      t.rotation ||
      t.cropLeft ||
      t.cropRight ||
      t.cropTop ||
      t.cropBottom ||
      t.opacityPercent !== 100
    )
      throw new Error(
        `画面不是居中的完整方形素材，需要另行核对构图：${clip.name}`
      );
  }
  if (plan.audioTracks.some(t => !kinds[t.index]))
    throw new Error("未映射的声音轨");
  const actor = { userId: input.userId, name: "本地迁移（用户授权）" };
  await saveVideoWorkVersion({
    ...owner,
    id: `${input.migrationId}-before`,
    actor,
    intent: {
      purpose: "ChatCut 迁移前保留本地剪辑",
      audience: "沿用原作品",
      platform: "本地剪辑台",
    },
    summary: "保存迁移前的全部镜头、素材、字幕与音轨",
  });
  const checkpoint = await getStoryById(input.storyId, input.userId);
  const checkpointRevision = getStoryRevision(checkpoint?.body);
  const shots = payload.shots.map((shot, index) => ({
    ...shot,
    chatCutMigrationId: input.migrationId,
    stableShotId: `${input.migrationId}-shot-${index + 1}`,
    shotIdentity: `${input.migrationId}-shot-${index + 1}`,
    durationMs:
      ((videoClips[index].endFrame - videoClips[index].startFrame) * 1000) / 30,
    note: `ChatCut 原素材 ${videoClips[index].name}；已迁入本地，可继续剪辑`,
  }));
  const items = [];
  for (const [index, clip] of videoClips.entries()) {
    const { info, bytes } = input.files.get(clip.name)!;
    const stableShotId = shots[index].stableShotId;
    const durationSec = Number(info.probe.format.duration);
    const idempotencyKey = `${input.migrationId}-${info.sha256.slice(0, 16)}`;
    let take = await findVideoTakeByIdempotencyKey(
      input.storyId,
      input.userId,
      idempotencyKey
    );
    if (!take)
      take = await createVideoTake({
        ...owner,
        stableShotId,
        sourceImageId: null,
        promptCompilationId: null,
        status: "processing",
        taskId: null,
        provider: "local-import",
        model: "chatcut-original",
        prompt: `ChatCut 原素材：${clip.name}`,
        subtitle: null,
        durationSec,
        aspectRatio: "1:1",
        videoKey: null,
        videoUrl: null,
        errorMessage: null,
        idempotencyKey,
        extractionCapability: "available",
        parameterSnapshot: {
          source: "chatcut-migration",
          fileName: clip.name,
          sha256: info.sha256,
          sourceWidth: 1024,
          sourceHeight: 1024,
          sourceDurationSec: durationSec,
        },
      });
    if (take.status !== "available" || !take.videoUrl) {
      const stored = storeVideoBytesForTake(bytes, take.id, "video/mp4");
      take = (await updateVideoTake(take.id, input.userId, {
        ...stored,
        status: "available",
      }))!;
    }
    await setVideoTimelineSelection({
      ...owner,
      stableShotId,
      takeId: take.id,
      rangeId: null,
      selectionType: "full_take",
    });
    items.push({
      stableShotId,
      included: true,
      position: index,
      timelineStartFrame: clip.startFrame,
      durationFrames: clip.endFrame - clip.startFrame,
      plannedDurationMs: shots[index].durationMs,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM },
      primaryVideoEdit: {
        takeId: take.id,
        sourceStartSec: clip.inFrame / 30,
        sourceEndSec: Math.min(
          durationSec,
          (clip.inFrame + clip.endFrame - clip.startFrame) / 30
        ),
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS, muted: true },
      },
    });
  }
  const audio = emptyAudioState();
  const audioIds = new Map<string, number>();
  for (const track of plan.audioTracks)
    for (const clip of track.clips) {
      const file = input.files.get(clip.name)!;
      let assetId = audioIds.get(clip.name);
      if (!assetId) {
        const requiredFrames = Math.max(
          ...plan.audioTracks
            .flatMap(t => t.clips)
            .filter(c => c.name === clip.name)
            .map(c => c.inFrame + c.endFrame - c.startFrame)
        );
        const paddingFrames = Math.max(
          0,
          requiredFrames -
            Math.round(Number(file.info.probe.format.duration) * 30)
        );
        if (paddingFrames > 1)
          throw new Error(`音频尾点超过一帧，不能自动补齐：${clip.name}`);
        let bytes = file.bytes;
        if (paddingFrames) {
          const temp = await mkdtemp(path.join(tmpdir(), "chatcut-audio-"));
          try {
            const source = path.join(temp, "source.mp3"),
              target = path.join(temp, "padded.wav");
            await writeFile(source, bytes);
            await runFfmpegCommand([
              "-y",
              "-i",
              source,
              "-af",
              "apad=pad_dur=0.1",
              "-t",
              (requiredFrames / 30).toFixed(6),
              "-c:a",
              "pcm_s16le",
              target,
            ]);
            bytes = await readFile(target);
          } finally {
            await rm(temp, { recursive: true, force: true });
          }
        }
        const result = await importAudioBytes({
          scope: owner,
          operationId: `${input.migrationId}-${file.info.sha256.slice(0, 16)}`,
          sourceKind: "local-upload",
          displayName: paddingFrames
            ? clip.name.replace(/\.[^.]+$/, ".wav")
            : clip.name,
          bytes,
          mediaKind: kinds[track.index],
          provenance: {
            source: "chatcut-migration",
            originalName: clip.name,
            sha256: file.info.sha256,
            track: `A${track.index}`,
            paddingFrames,
          },
        });
        if (result.status !== "ready") throw new Error(result.reason);
        if ((result.asset.durationFrames ?? 0) < requiredFrames)
          throw new Error(`受管音频时长不足：${clip.name}`);
        assetId = result.asset.id;
        audioIds.set(clip.name, assetId);
      }
      const durationFrames = clip.endFrame - clip.startFrame;
      audio.tracks
        .find(t => t.kind === kinds[track.index])!
        .clips.push({
          id: `${input.migrationId}-${clip.id}`,
          assetId,
          timelineStartFrame: clip.startFrame,
          sourceInFrame: clip.inFrame,
          sourceOutFrame: clip.inFrame + durationFrames,
          durationFrames,
          muted: false,
          ...(levels[clip.id] ?? {
            gain: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
          }),
        });
    }
  const fresh = await getStoryById(input.storyId, input.userId);
  if (!fresh) throw new Error("作品已不存在");
  // Saving the old snapshot is the only intervening body write allowed.
  if (getStoryRevision(fresh.body) !== checkpointRevision)
    throw new Error("迁移期间作品已变动，已导入素材保留仓库，未替换剪辑");
  const revision = getStoryRevision(fresh.body);
  const saved = await updateStoryAndTimelineAtomic({
    ...owner,
    expectedStoryRevision: revision,
    expectedTimelineVersion: input.expectedTimelineVersion,
    recordVideoRevision: true,
    nextStoryBody: {
      ...(fresh.body as Record<string, unknown>),
      shots,
      _revision: revision + 1,
      chatCutImport: {
        ...plan,
        importedAt: new Date().toISOString(),
        relinkStatus: "linked",
      },
      chatCutMigration: {
        id: input.migrationId,
        importedAt: new Date().toISOString(),
        author: actor,
        sourceProject: plan.projectName,
        intent: "将 ChatCut 已有剪辑迁到本地继续制作；沿用原美术参数",
        adjustments: input.migration.adjustments,
        visualEndFrame: Math.max(...videoClips.map(c => c.endFrame)),
        durationFrames: plan.durationFrames,
      },
    },
    nextTimeline: {
      items,
      overlays: [],
      visualLayerState: { count: 1, hidden: [] },
      extensions: {
        subtitleTracks: subtitles,
        audioTracks: audio,
        chatCutMigration: {
          id: input.migrationId,
          canvas: { width: plan.width, height: plan.height },
        },
      },
    },
  });
  const version = await saveVideoWorkVersion({
    ...owner,
    id: `${input.migrationId}-after`,
    actor,
    intent: {
      purpose: "Launch Video · ChatCut 迁移",
      audience: "沿用原作品",
      platform: "9:16 竖屏",
    },
    summary:
      "迁入三段原视频、英文旁白、背景音乐、两段点缀音乐、打字音效及双语字幕，保留原时序和声音参数",
  });
  return {
    status: "imported",
    timelineVersion: saved.timeline.version,
    version: version.number,
    videoTakes: items.map(item => item.primaryVideoEdit.takeId),
    audioAssets: [...audioIds.values()],
    subtitleCounts: subtitles.tracks.map(t => t.cues.length),
  };
}
