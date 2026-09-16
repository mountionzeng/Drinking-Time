import { createHash } from "node:crypto";
import type { Story, StoryBody } from "../../drizzle/schema";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  normalizeAudioState,
  type AudioTrackKind,
} from "../../shared/timelineAudioModel";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import type {
  StorySoundEvidenceKind,
  StorySoundEvidenceReference,
  StorySoundRowKind,
} from "../../shared/storySoundPlan";
import { getStoryById, getStoryTimeline } from "../db";

export type StorySoundEvidenceCertainty =
  | "verbatim"
  | "explicit"
  | "confirmed"
  | "existing";

export type StorySoundEvidenceItem = StorySoundEvidenceReference & {
  text: string;
  certainty: StorySoundEvidenceCertainty;
  soundKind?: StorySoundRowKind;
  characterId?: string;
  existingTimelineClipId?: string;
};

export type StorySoundContextCharacter = {
  id: string;
  name: string;
  role?: string;
  oneLiner?: string;
  ambiguousName: boolean;
  evidenceId: string;
};

export type StorySoundContextPacket = {
  storyId: number;
  userId: number;
  evidenceSnapshotDigest: string;
  sourceRevisions: Record<string, string>;
  evidence: StorySoundEvidenceItem[];
  characters: StorySoundContextCharacter[];
};

type TimelineLike = {
  version?: number;
  extensions?: Record<string, unknown>;
} | null;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const clean = (value: unknown, max = 2_000): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const stablePart = (value: string): string => digest(value).slice(0, 12);

function soundKindFromRequirement(value: string): StorySoundRowKind {
  if (/配乐|音乐|乐曲|旋律|music/i.test(value)) return "music";
  if (
    /环境|氛围|雨|风|海浪|水声|街道|人群|鸟鸣|虫鸣|空调|室内|室外/i.test(value)
  ) {
    return "ambience";
  }
  return "sfx";
}

function dialogueIntent(value: string): boolean {
  return /道歉|说(?:道|出|着)?|问(?:道|她|他)?|回答|告诉|喊|低语|解释|承诺|争辩|劝|请求/.test(
    value
  );
}

function sourceRevision(item: Omit<StorySoundEvidenceItem, "revisionHash">) {
  return digest(
    canonicalJsonStringify({
      sourceKind: item.sourceKind,
      sourceId: item.sourceId,
      text: item.text,
      certainty: item.certainty,
      sceneId: item.sceneId,
      startFrame: item.startFrame,
      endFrame: item.endFrame,
      soundKind: item.soundKind,
      characterId: item.characterId,
      existingTimelineClipId: item.existingTimelineClipId,
    })
  );
}

function addEvidence(
  target: StorySoundEvidenceItem[],
  input: Omit<StorySoundEvidenceItem, "id" | "revisionHash">
) {
  const base = { ...input, id: `${input.sourceKind}:${input.sourceId}` };
  const revisionHash = sourceRevision(base);
  target.push({ ...base, revisionHash });
}

function storyBody(story: Story): Partial<StoryBody> {
  return story.body && typeof story.body === "object"
    ? (story.body as Partial<StoryBody>)
    : {};
}

export function compileStorySoundContextFromSources(input: {
  story: Story;
  timeline?: TimelineLike;
}): StorySoundContextPacket {
  const { story } = input;
  const body = storyBody(story);
  const evidence: StorySoundEvidenceItem[] = [];
  const storyFacts = [
    ["title", clean(story.title)],
    ["logline", clean(story.logline)],
    ["theme", clean(story.theme)],
    ["arc", clean(story.arc)],
    ["summary", clean(story.summary)],
  ] as const;
  for (const [field, value] of storyFacts) {
    if (!value) continue;
    addEvidence(evidence, {
      sourceKind: "story",
      sourceId: `${story.id}:${field}`,
      text: value,
      certainty: "confirmed",
    });
  }
  for (const card of Array.isArray(body.cards) ? body.cards : []) {
    const value = clean(card?.content);
    if (!value || !card?.id) continue;
    addEvidence(evidence, {
      sourceKind: "story",
      sourceId: `${story.id}:card:${card.id}`,
      text: value,
      certainty: "confirmed",
    });
  }

  const rawCharacters = Array.isArray(body.characters) ? body.characters : [];
  const nameCounts = new Map<string, number>();
  for (const character of rawCharacters) {
    const name = clean(character?.name, 120);
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const characters: StorySoundContextCharacter[] = [];
  rawCharacters.forEach((character, index) => {
    const name = clean(character?.name, 120);
    if (!name) return;
    const id = `character-${index + 1}-${stablePart(name)}`;
    const evidenceId = `character:${id}`;
    addEvidence(evidence, {
      sourceKind: "character",
      sourceId: id,
      text: [name, clean(character.role, 120), clean(character.oneLiner, 300)]
        .filter(Boolean)
        .join(" · "),
      certainty: "confirmed",
      characterId: id,
    });
    characters.push({
      id,
      name,
      ...(clean(character.role, 120)
        ? { role: clean(character.role, 120) }
        : {}),
      ...(clean(character.oneLiner, 300)
        ? { oneLiner: clean(character.oneLiner, 300) }
        : {}),
      ambiguousName: (nameCounts.get(name) ?? 0) > 1,
      evidenceId,
    });
  });

  const shots = Array.isArray(body.shots) ? body.shots : [];
  shots.forEach((shot, index) => {
    const shotId =
      clean(shot?.stableShotId, 160) ||
      clean(shot?.shotIdentity, 160) ||
      `shot-${index + 1}`;
    const sceneId = clean(shot?.sceneNo, 120) || `shot-${index + 1}`;
    const dialogue = clean(shot?.dialogue);
    if (dialogue) {
      addEvidence(evidence, {
        sourceKind: "shot",
        sourceId: `${shotId}:dialogue`,
        text: dialogue,
        certainty: "verbatim",
        sceneId,
        soundKind: "dialogue",
      });
    }
    const sound = clean(shot?.sound);
    if (sound) {
      addEvidence(evidence, {
        sourceKind: "shot",
        sourceId: `${shotId}:sound`,
        text: sound,
        certainty: "explicit",
        sceneId,
        soundKind: soundKindFromRequirement(sound),
      });
    }
    const action = clean(shot?.action);
    if (!dialogue && action && dialogueIntent(action)) {
      addEvidence(evidence, {
        sourceKind: "shot",
        sourceId: `${shotId}:speech-intent`,
        text: action,
        certainty: "explicit",
        sceneId,
        soundKind: "dialogue",
      });
    }
    const context = [
      clean(shot?.sceneTitle, 200),
      clean(shot?.location, 200),
      clean(shot?.mood, 200),
    ]
      .filter(Boolean)
      .join(" · ");
    if (context) {
      addEvidence(evidence, {
        sourceKind: "shot",
        sourceId: `${shotId}:context`,
        text: context,
        certainty: "confirmed",
        sceneId,
      });
    }
  });

  const extensions = input.timeline?.extensions ?? {};
  const subtitleState = normalizeSubtitleState(extensions.subtitleTracks);
  const explicitDialogueTexts = new Set(
    evidence
      .filter(
        item => item.soundKind === "dialogue" && item.certainty === "verbatim"
      )
      .map(item => item.text.replace(/\s+/g, ""))
  );
  for (const cue of subtitleState.tracks[0]?.cues ?? []) {
    const value = clean(cue.text);
    if (!value) continue;
    const matchingDialogue = evidence.find(
      item =>
        item.soundKind === "dialogue" &&
        item.certainty === "verbatim" &&
        item.text.replace(/\s+/g, "") === value.replace(/\s+/g, "")
    );
    addEvidence(evidence, {
      sourceKind: "subtitle",
      sourceId: cue.id,
      text: value,
      certainty: "verbatim",
      ...(matchingDialogue?.sceneId
        ? { sceneId: matchingDialogue.sceneId }
        : {}),
      startFrame: cue.startFrame,
      endFrame: cue.startFrame + cue.durationFrames,
      soundKind: explicitDialogueTexts.has(value.replace(/\s+/g, ""))
        ? "dialogue"
        : "narration",
    });
  }

  const audioState = normalizeAudioState(extensions.audioTracks);
  const trackKind = (kind: AudioTrackKind): StorySoundRowKind | null =>
    kind === "source" ? null : kind;
  for (const track of audioState.tracks) {
    const soundKind = trackKind(track.kind);
    if (!soundKind) continue;
    for (const clip of track.clips) {
      addEvidence(evidence, {
        sourceKind: "timeline_audio",
        sourceId: clip.id,
        text: `时间线已有${
          soundKind === "dialogue"
            ? "对白"
            : soundKind === "narration"
              ? "旁白"
              : soundKind === "music"
                ? "音乐"
                : soundKind === "ambience"
                  ? "环境声"
                  : "音效"
        }片段`,
        certainty: "existing",
        startFrame: clip.timelineStartFrame,
        endFrame: clip.timelineStartFrame + clip.durationFrames,
        soundKind,
        ...(clip.speakerId ? { characterId: clip.speakerId } : {}),
        existingTimelineClipId: clip.id,
      });
    }
  }

  const deduped = [...new Map(evidence.map(item => [item.id, item])).values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 500);
  const sourceRevisions = Object.fromEntries(
    deduped.map(item => [item.id, item.revisionHash!])
  );
  const evidenceSnapshotDigest = digest(
    canonicalJsonStringify({
      storyId: story.id,
      storyUpdatedAt:
        story.updatedAt instanceof Date
          ? story.updatedAt.toISOString()
          : String(story.updatedAt),
      timelineVersion: input.timeline?.version ?? 0,
      sourceRevisions,
    })
  );
  return {
    storyId: story.id,
    userId: story.userId,
    evidenceSnapshotDigest,
    sourceRevisions,
    evidence: deduped,
    characters,
  };
}

export async function compileStorySoundContext(input: {
  storyId: number;
  userId: number;
}): Promise<StorySoundContextPacket | null> {
  const [story, timeline] = await Promise.all([
    getStoryById(input.storyId, input.userId),
    getStoryTimeline(input.storyId, input.userId),
  ]);
  if (!story) return null;
  return compileStorySoundContextFromSources({
    story,
    timeline: timeline as TimelineLike,
  });
}

export function evidenceReference(
  item: StorySoundEvidenceItem
): StorySoundEvidenceReference {
  return {
    id: item.id,
    sourceKind: item.sourceKind as StorySoundEvidenceKind,
    sourceId: item.sourceId,
    ...(item.revisionHash ? { revisionHash: item.revisionHash } : {}),
    ...(item.sceneId ? { sceneId: item.sceneId } : {}),
    ...(item.startFrame === undefined ? {} : { startFrame: item.startFrame }),
    ...(item.endFrame === undefined ? {} : { endFrame: item.endFrame }),
  };
}
