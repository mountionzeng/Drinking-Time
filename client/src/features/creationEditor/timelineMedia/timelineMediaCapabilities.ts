/**
 * The capability registry that projects a timeline-media object's *kind* to the
 * commands, primary action, inspector fields and colour tone the UI shows (U6).
 *
 * One source of truth so the "添加" menu, a track row and the inspector never
 * disagree about what a `music` clip can do vs a `narration` clip. Creation
 * flow stays per-adapter; this only describes what an existing object supports.
 */
import type { AudioTrackKind } from "@shared/timelineAudioModel";

export type TimelineMediaObjectKind = "subtitle" | AudioTrackKind;

export type TimelineMediaCapability =
  | "edit-text"
  | "split"
  | "merge"
  | "move"
  | "trim"
  | "delete"
  | "gain"
  | "mute"
  | "fade"
  | "reclassify"
  | "bind"
  | "regenerate";

export type TimelineMediaInspectorField =
  | "text"
  | "timecode"
  | "volume"
  | "mute"
  | "fade"
  | "binding"
  | "regenerate";

export type TimelineMediaKindProfile = {
  kind: TimelineMediaObjectKind;
  label: string;
  /** Tailwind-ish tone classes for the block on the track. */
  tone: string;
  capabilities: readonly TimelineMediaCapability[];
  inspectorFields: readonly TimelineMediaInspectorField[];
  /** The one action a double-click / Enter runs. */
  primaryAction: TimelineMediaCapability;
  /** How a user adds one of these (drives the 添加 menu label). */
  addLabel: string | null;
};

const AUDIO_COMMON: readonly TimelineMediaCapability[] = [
  "move",
  "trim",
  "delete",
  "gain",
  "mute",
  "fade",
];
const AUDIO_INSPECTOR: readonly TimelineMediaInspectorField[] = [
  "timecode",
  "volume",
  "mute",
  "fade",
];

const PROFILES: Record<TimelineMediaObjectKind, TimelineMediaKindProfile> = {
  subtitle: {
    kind: "subtitle",
    label: "字幕",
    tone: "border-sky-500/45 bg-sky-500/10 text-sky-700",
    capabilities: ["edit-text", "split", "merge", "move", "trim", "delete"],
    inspectorFields: ["text", "timecode"],
    primaryAction: "edit-text",
    addLabel: "从当前文字生成字幕",
  },
  narration: {
    kind: "narration",
    label: "旁白",
    tone: "border-emerald-500/45 bg-emerald-500/10 text-emerald-600",
    // No `gain`-only "music" mindset: narration shows binding + regenerate.
    capabilities: [...AUDIO_COMMON, "reclassify", "bind", "regenerate"],
    inspectorFields: [...AUDIO_INSPECTOR, "binding", "regenerate"],
    primaryAction: "regenerate",
    addLabel: "从字幕生成旁白",
  },
  music: {
    kind: "music",
    label: "音乐",
    tone: "border-teal-500/45 bg-teal-500/10 text-teal-600",
    capabilities: [...AUDIO_COMMON, "reclassify"],
    inspectorFields: AUDIO_INSPECTOR,
    primaryAction: "gain",
    addLabel: "生成或导入音乐",
  },
  ambience: {
    kind: "ambience",
    label: "环境声",
    tone: "border-cyan-500/45 bg-cyan-500/10 text-cyan-600",
    capabilities: [...AUDIO_COMMON, "reclassify"],
    inspectorFields: AUDIO_INSPECTOR,
    primaryAction: "gain",
    addLabel: "生成或导入环境声",
  },
  sfx: {
    kind: "sfx",
    label: "音效",
    tone: "border-amber-500/45 bg-amber-500/10 text-amber-600",
    capabilities: [...AUDIO_COMMON, "reclassify"],
    inspectorFields: AUDIO_INSPECTOR,
    primaryAction: "gain",
    addLabel: "生成或导入音效",
  },
  source: {
    kind: "source",
    label: "原声",
    tone: "border-orange-500/45 bg-orange-500/10 text-orange-600",
    // Source has no TTS; it can still be reclassified out.
    capabilities: [...AUDIO_COMMON, "reclassify"],
    inspectorFields: AUDIO_INSPECTOR,
    primaryAction: "gain",
    addLabel: "从 ChatCut 导入原声",
  },
};

/** Fixed display order: subtitle first, then the five audio kinds. */
export const TIMELINE_MEDIA_KIND_ORDER: readonly TimelineMediaObjectKind[] = [
  "subtitle",
  "narration",
  "music",
  "ambience",
  "sfx",
  "source",
];

export function timelineMediaKindProfile(
  kind: TimelineMediaObjectKind
): TimelineMediaKindProfile {
  return PROFILES[kind];
}

export function timelineMediaSupports(
  kind: TimelineMediaObjectKind,
  capability: TimelineMediaCapability
): boolean {
  return PROFILES[kind].capabilities.includes(capability);
}

export const AUDIO_KIND_ORDER: readonly AudioTrackKind[] = [
  "narration",
  "music",
  "ambience",
  "sfx",
  "source",
];
