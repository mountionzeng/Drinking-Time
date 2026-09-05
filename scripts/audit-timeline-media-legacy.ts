/**
 * U10 legacy retirement gate — READ ONLY.
 *
 * Counts, across real local Stories, how much content still depends on each
 * legacy read path, so the decision to delete a read is driven by data instead
 * of by "the new fixtures pass". This script never writes a Story, never
 * migrates, and never touches managed media.
 *
 * Usage:
 *   pnpm tsx scripts/audit-timeline-media-legacy.ts [--persist <path>] [--json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type LegacyAuditReport = {
  storiesTotal: number;
  /** Stories carrying a formal Timeline media slice (U3 subtitles / U9 audio). */
  storiesWithFormalSubtitles: number;
  storiesWithFormalAudio: number;
  /** Stories still holding legacy ChatCut import content. */
  storiesWithChatCutAudioTracks: number;
  storiesWithChatCutScriptCues: number;
  /** Stories with legacy per-shot TTS fields. */
  storiesWithShotVoiceAudio: number;
  shotsWithVoiceAudio: number;
  /** ChatCut audio clips, split by whether their URL could be materialized. */
  chatCutAudioClips: number;
  chatCutAudioClipsMaterializable: number;
  chatCutAudioClipsUnmaterializable: number;
  /** Audio clips that explicitly claim a linked visual source (dedupe input). */
  linkedVisualSourceClips: number;
  /** Stories that would show nothing at all if the legacy adapter were removed. */
  storiesOnlyServedByLegacy: number;
};

const MATERIALIZABLE = /^https:\/\/([a-z0-9.-]*\.)?s3([.-][a-z0-9-]+)?\.amazonaws\.com\//i;

export function auditLegacyTimelineMedia(state: Json): LegacyAuditReport {
  const stories = array(state.stories);
  const timelines = array(state.storyTimelines).map(record);
  const timelineByStory = new Map<number, Json>();
  for (const timeline of timelines) {
    const storyId = Number(timeline.storyId);
    if (Number.isInteger(storyId)) timelineByStory.set(storyId, timeline);
  }

  const report: LegacyAuditReport = {
    storiesTotal: stories.length,
    storiesWithFormalSubtitles: 0,
    storiesWithFormalAudio: 0,
    storiesWithChatCutAudioTracks: 0,
    storiesWithChatCutScriptCues: 0,
    storiesWithShotVoiceAudio: 0,
    shotsWithVoiceAudio: 0,
    chatCutAudioClips: 0,
    chatCutAudioClipsMaterializable: 0,
    chatCutAudioClipsUnmaterializable: 0,
    linkedVisualSourceClips: 0,
    storiesOnlyServedByLegacy: 0,
  };

  for (const rawStory of stories) {
    const story = record(rawStory);
    const storyId = Number(story.id);
    const body = record(story.body);

    // Formal Timeline media lives in the stored envelope's extension slices.
    const timeline = timelineByStory.get(storyId);
    const items = timeline?.items;
    const envelope = record(items);
    const subtitleSlice = record(envelope.subtitleTracks);
    const audioSlice = record(envelope.audioTracks);
    const subtitleCues = array(array(subtitleSlice.tracks)[0] as unknown)
      .length
      ? 0
      : array(record(array(subtitleSlice.tracks)[0]).cues).length;
    const hasFormalSubtitles = subtitleCues > 0;
    let formalAudioClips = 0;
    for (const rawTrack of array(audioSlice.tracks)) {
      const track = record(rawTrack);
      const clips = array(track.clips);
      formalAudioClips += clips.length;
      for (const rawClip of clips) {
        if (typeof record(rawClip).linkedVisualSourceId === "string") {
          report.linkedVisualSourceClips += 1;
        }
      }
    }
    const hasFormalAudio = formalAudioClips > 0;
    if (hasFormalSubtitles) report.storiesWithFormalSubtitles += 1;
    if (hasFormalAudio) report.storiesWithFormalAudio += 1;

    // Legacy ChatCut import content on the Story body.
    const chatCut = record(body.chatCutImport);
    const chatCutTracks = array(chatCut.audioTracks);
    const chatCutCues = array(chatCut.scriptCues);
    if (chatCutTracks.length > 0) report.storiesWithChatCutAudioTracks += 1;
    if (chatCutCues.length > 0) report.storiesWithChatCutScriptCues += 1;
    let storyChatCutClips = 0;
    for (const rawTrack of chatCutTracks) {
      for (const rawClip of array(record(rawTrack).clips)) {
        const clip = record(rawClip);
        const url = typeof clip.audioUrl === "string" ? clip.audioUrl.trim() : "";
        if (!url) continue;
        storyChatCutClips += 1;
        report.chatCutAudioClips += 1;
        if (MATERIALIZABLE.test(url)) report.chatCutAudioClipsMaterializable += 1;
        else report.chatCutAudioClipsUnmaterializable += 1;
      }
    }

    // Legacy per-shot TTS fields.
    let storyVoiceShots = 0;
    for (const rawShot of array(body.shots)) {
      const shot = record(rawShot);
      const hasVoice = Object.keys(shot).some(
        key => key.startsWith("voiceAudio") && Boolean(shot[key])
      );
      if (hasVoice) storyVoiceShots += 1;
    }
    if (storyVoiceShots > 0) {
      report.storiesWithShotVoiceAudio += 1;
      report.shotsWithVoiceAudio += storyVoiceShots;
    }

    const hasLegacy =
      storyChatCutClips > 0 || chatCutCues.length > 0 || storyVoiceShots > 0;
    if (hasLegacy && !hasFormalSubtitles && !hasFormalAudio) {
      report.storiesOnlyServedByLegacy += 1;
    }
  }

  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const persistFlag = args.indexOf("--persist");
  const persistPath =
    persistFlag >= 0
      ? args[persistFlag + 1]
      : process.env.LOCAL_PERSIST_PATH?.trim() ||
        path.resolve(process.cwd(), ".webdev", "local-persist.json");

  const raw = await readFile(persistPath, "utf8");
  const report = auditLegacyTimelineMedia(JSON.parse(raw) as Json);

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`[legacy-audit] 数据源（只读）: ${persistPath}\n`);
  console.log(`故事总数                      ${report.storiesTotal}`);
  console.log(`  已有正式字幕                ${report.storiesWithFormalSubtitles}`);
  console.log(`  已有正式音轨                ${report.storiesWithFormalAudio}`);
  console.log(`  仍有 ChatCut 音轨           ${report.storiesWithChatCutAudioTracks}`);
  console.log(`  仍有 ChatCut 台词 cue       ${report.storiesWithChatCutScriptCues}`);
  console.log(`  仍有镜头 voiceAudio*        ${report.storiesWithShotVoiceAudio}（镜头 ${report.shotsWithVoiceAudio} 个）`);
  console.log(`  **只能靠 legacy 才有内容**  ${report.storiesOnlyServedByLegacy}`);
  console.log("");
  console.log(`ChatCut 音频片段总数          ${report.chatCutAudioClips}`);
  console.log(`  可物化（S3 白名单内）       ${report.chatCutAudioClipsMaterializable}`);
  console.log(`  不可物化                    ${report.chatCutAudioClipsUnmaterializable}`);
  console.log(`显式 linked visual source     ${report.linkedVisualSourceClips}`);
  console.log("");
  console.log(
    report.storiesOnlyServedByLegacy > 0
      ? "→ 结论：仍有故事只能靠 legacy adapter 才有内容，本轮不得删除旧读取。"
      : "→ 结论：没有故事只依赖 legacy adapter，可考虑按路径逐条退役。"
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
