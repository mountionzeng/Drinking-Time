export type ChatCutTimelineClip = {
  id: string;
  name: string;
  mediaKind: "video" | "image" | "audio" | "unknown";
  startMs: number;
  endMs: number;
  sourceInMs: number;
  sourceOutMs: number;
};

export type ChatCutTimelineTrack = {
  index: number;
  clips: ChatCutTimelineClip[];
};

export type ChatCutScriptCue = {
  code: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
};

export type ChatCutTimelineManifest = {
  projectName: string;
  sequenceName: string;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
  primaryVideoTrackIndex: number;
  videoTracks: ChatCutTimelineTrack[];
  audioTracks: ChatCutTimelineTrack[];
  scriptCues: ChatCutScriptCue[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function frameMs(frame: unknown, fps: number): number {
  return Math.max(0, Math.round((number(frame) / fps) * 1000));
}

function normalizeClip(value: unknown, fps: number): ChatCutTimelineClip | null {
  const clip = record(value);
  const id = text(clip.id);
  const name = text(clip.name, id || "未命名素材");
  const startMs = frameMs(clip.startFrame, fps);
  const endMs = frameMs(clip.endFrame, fps);
  if (!id || endMs <= startMs) return null;
  const mediaKind = text(clip.mediaKind, "unknown");
  return {
    id,
    name,
    mediaKind:
      mediaKind === "video" ||
      mediaKind === "image" ||
      mediaKind === "audio"
        ? mediaKind
        : "unknown",
    startMs,
    endMs,
    sourceInMs: frameMs(clip.inFrame, fps),
    sourceOutMs: frameMs(clip.outFrame, fps),
  };
}

function normalizeTrack(value: unknown, fps: number): ChatCutTimelineTrack | null {
  const track = record(value);
  const index = Math.max(1, Math.round(number(track.index, 1)));
  const clips = Array.isArray(track.clips)
    ? track.clips
        .map(clip => normalizeClip(clip, fps))
        .filter((clip): clip is ChatCutTimelineClip => Boolean(clip))
        .sort((left, right) => left.startMs - right.startMs)
    : [];
  return clips.length > 0 ? { index, clips } : null;
}

function normalizeScriptCue(
  value: unknown,
  fps: number
): ChatCutScriptCue | null {
  const cue = record(value);
  const code = text(cue.code);
  const cueText = text(cue.text);
  if (!code || !cueText) return null;
  const startFrame = number(cue.startFrame, Number.NaN);
  const endFrame = number(cue.endFrame, Number.NaN);
  return {
    code,
    text: cueText,
    startMs: Number.isFinite(startFrame) ? frameMs(startFrame, fps) : null,
    endMs: Number.isFinite(endFrame) ? frameMs(endFrame, fps) : null,
  };
}

export function normalizeChatCutTimeline(
  body: unknown
): ChatCutTimelineManifest | null {
  const root = record(body);
  const imported = record(root.chatCutImport);
  if (text(imported.sourceFormat) !== "xmeml") return null;
  const fps = Math.max(1, number(imported.fps, 30));
  const durationFrames = Math.max(0, number(imported.durationFrames));
  const normalizeTracks = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map(track => normalizeTrack(track, fps))
      .filter((track): track is ChatCutTimelineTrack => Boolean(track));
  const scriptCues = (Array.isArray(imported.scriptCues)
    ? imported.scriptCues
    : []
  )
    .map(cue => normalizeScriptCue(cue, fps))
    .filter((cue): cue is ChatCutScriptCue => Boolean(cue));

  return {
    projectName: text(imported.projectName, "ChatCut 工程"),
    sequenceName: text(imported.sequenceName, "主时间线"),
    fps,
    width: Math.max(1, Math.round(number(imported.width, 1080))),
    height: Math.max(1, Math.round(number(imported.height, 1080))),
    durationMs: frameMs(durationFrames, fps),
    primaryVideoTrackIndex: Math.max(
      1,
      Math.round(number(imported.primaryVideoTrackIndex, 1))
    ),
    videoTracks: normalizeTracks(imported.videoTracks),
    audioTracks: normalizeTracks(imported.audioTracks),
    scriptCues,
  };
}

export function chatCutCueCode(name: string): string | null {
  const match = name.match(/(?:^|\b)VO[-_ ]?(\d{4}(?:-\d)?)/i);
  return match?.[1] ?? null;
}

export function chatCutSourceNameFromShot(shot: {
  action?: string | null;
  subject?: string | null;
}): string {
  const action = shot.action?.trim() ?? "";
  const fromAction = action.match(/^使用素材\s+(.+)$/)?.[1]?.trim();
  return fromAction || shot.subject?.trim() || "未关联素材";
}

export function chatCutBaseName(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? value;
  try {
    return decodeURIComponent(leaf).trim().toLocaleLowerCase();
  } catch {
    return leaf.trim().toLocaleLowerCase();
  }
}
