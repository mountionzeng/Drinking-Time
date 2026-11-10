import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  listVideoMediaVersions,
  readVideoMediaVersions,
  mediaContentKey,
  type VideoMediaKind,
} from "../../shared/videoMediaVersions";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import type { VisualEditOperationRef } from "../../shared/visualEditReceipt";
import { getStoryById } from "../repositories/stories";
import { loadOwnedStoryTimelineEnvelope } from "../persistence/storyVisualPersistence";
import { loadReadyStoryAudioAsset } from "./storyAudioAssets";
import { runMediaCommand } from "./timelineAudioEditing";

type Owner = { storyId: number; userId: number };
export async function getVideoMediaVersions(input: Owner & { name?: string }) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const timeline = await loadOwnedStoryTimelineEnvelope(input);
  const state = readVideoMediaVersions(
    story.body,
    timeline?.extensions ?? {},
    story.updatedAt.getTime()
  );
  return listVideoMediaVersions(state, story.body, input);
}

export function restoreVideoMediaVersion(
  input: Owner & {
    kind: VideoMediaKind;
    versionId: string;
    expectedCurrentId: string | null;
    operation: VisualEditOperationRef;
  }
) {
  return runMediaCommand(
    {
      ...input,
      commandPayload: {
        kind: "restore-media-version",
        mediaKind: input.kind,
        versionId: input.versionId,
        expectedCurrentId: input.expectedCurrentId,
      },
      mediaVersionSelection: { kind: input.kind, versionId: input.versionId },
    },
    async slices => {
      const story = await getStoryById(input.storyId, input.userId);
      if (!story) return { status: "error", message: "故事不存在" };
      const history = readVideoMediaVersions(
        story.body,
        slices.extensions,
        story.updatedAt.getTime()
      );
      if ((history.current[input.kind] ?? null) !== input.expectedCurrentId)
        return {
          status: "error",
          message: "当前声音或字幕已更新，请刷新版本菜单后重试。",
        };
      const entry = history.entries.find(
        entry => entry.id === input.versionId && entry.kind === input.kind
      );
      if (!entry)
        return { status: "error", message: "这个版本不存在或不属于当前故事。" };
      if (history.current[input.kind] === input.versionId)
        return {
          status: "ok",
          changed: false,
          nextExtensions: slices.extensions,
        };
      const audio = structuredClone(slices.audio),
        subtitle = structuredClone(slices.subtitle);
      if (input.kind === "subtitles") {
        const restored = normalizeSubtitleState(entry.value);
        const changedTextOrTime =
          mediaContentKey("subtitles", restored) !==
          mediaContentKey("subtitles", subtitle);
        // New identities stop late TTS replies and stale edits from targeting the restored version.
        for (const track of restored.tracks)
          for (const cue of track.cues) {
            cue.id = randomUUID();
            delete cue.speechBindingId;
          }
        for (const track of audio.tracks)
          for (const clip of track.clips) {
            if (
              clip.speechBindingId ||
              (changedTextOrTime && track.kind === "narration")
            ) {
              delete clip.speechBindingId;
              clip.textStale = true;
            }
          }
        return {
          status: "ok",
          changed: true,
          nextExtensions: { subtitleTracks: restored, audioTracks: audio },
        };
      }
      const restored = normalizeAudioState({
        tracks: [entry.value],
      }).tracks.find(track => track.kind === input.kind)!;
      for (const clip of restored.clips) {
        const asset = await loadReadyStoryAudioAsset({
          scope: input,
          assetId: clip.assetId,
        });
        if (!asset || clip.sourceOutFrame > (asset.durationFrames ?? 0))
          return {
            status: "error",
            message: "这个版本引用的声音素材不可用，当前声音仍保留。",
          };
        clip.id = randomUUID();
        // A historical voice must not claim a binding to today's independent captions.
        delete clip.speechBindingId;
      }
      const replaced = audio.tracks.find(track => track.kind === input.kind)!;
      const bindings = new Set(
        replaced.clips.map(clip => clip.speechBindingId).filter(Boolean)
      );
      for (const track of subtitle.tracks)
        for (const cue of track.cues)
          if (bindings.has(cue.speechBindingId)) delete cue.speechBindingId;
      audio.tracks = audio.tracks.map(track =>
        track.kind === input.kind ? restored : track
      );
      return {
        status: "ok",
        changed: true,
        nextExtensions: { subtitleTracks: subtitle, audioTracks: audio },
      };
    }
  );
}
