import type {
  PublishingDraftContent,
  PublishingDraftState,
  PublishingPlatformId,
  PublishingStoryCore,
} from "@shared/publishingDraft";
import { emptyPublishingDraftState } from "@shared/publishingDraft";

export type PublishingSpeechCandidate = {
  id: string;
  kind: "narration" | "dialogue";
  text: string;
  sourcePlatform: PublishingPlatformId;
  sourceParagraphIndex: number;
};

export type PublishingVideoCover = {
  id: number;
  imageUrl: string;
  imageKey: string | null;
};

export type PublishingVideoHandoff = {
  storyId: number;
  versionId: string;
  containerRevision: number;
  versionRevision: number;
  sourcePlatform: PublishingPlatformId;
  core: PublishingStoryCore | null;
  draft: PublishingDraftContent;
  /** Historical publishing bodies keyed by version and optional source platform. */
  draftBodiesBySource?: Record<string, string>;
  cover: PublishingVideoCover | null;
  /** Same-story cover candidates explicitly selectable as a one-run style reference. */
  coverCandidates: PublishingVideoCover[];
  needsReview: boolean;
  narrationCandidates: PublishingSpeechCandidate[];
  dialogueCandidates: PublishingSpeechCandidate[];
};

export function latestPublishingDraftState(
  candidates: ReadonlyArray<PublishingDraftState | null | undefined>
): PublishingDraftState {
  const available = candidates.filter(
    (candidate): candidate is PublishingDraftState => Boolean(candidate)
  );
  if (available.length === 0) return emptyPublishingDraftState();
  return available.reduce((latest, candidate) => {
    if (candidate.revision !== latest.revision) {
      return candidate.revision > latest.revision ? candidate : latest;
    }
    return candidate.updatedAt > latest.updatedAt ? candidate : latest;
  });
}

const FULL_QUOTE_PATTERN = /^(?:“[\s\S]+”|「[\s\S]+」|『[\s\S]+』|"[\s\S]+")$/;
const DIRECT_SPEECH_PATTERN = /^(?:[^：:\n]{1,20}[：:]|[-—–]\s*)\S/;
const INLINE_QUOTE_PATTERN = /“[^”]+”|「[^」]+」|『[^』]+』|"[^"]+"/g;

function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

export function derivePublishingSpeechCandidates(params: {
  platform: PublishingPlatformId;
  body: string;
}): {
  narration: PublishingSpeechCandidate[];
  dialogue: PublishingSpeechCandidate[];
} {
  const narration: PublishingSpeechCandidate[] = [];
  const dialogue: PublishingSpeechCandidate[] = [];
  paragraphs(params.body).forEach((paragraph, paragraphIndex) => {
    const base = {
      sourcePlatform: params.platform,
      sourceParagraphIndex: paragraphIndex,
    };
    if (
      FULL_QUOTE_PATTERN.test(paragraph) ||
      DIRECT_SPEECH_PATTERN.test(paragraph)
    ) {
      dialogue.push({
        ...base,
        id: `${params.platform}:dialogue:${paragraphIndex}:0`,
        kind: "dialogue",
        text: paragraph,
      });
      return;
    }

    narration.push({
      ...base,
      id: `${params.platform}:narration:${paragraphIndex}`,
      kind: "narration",
      text: paragraph,
    });
    const inlineQuotes = paragraph.match(INLINE_QUOTE_PATTERN) ?? [];
    inlineQuotes.forEach((text, quoteIndex) => {
      dialogue.push({
        ...base,
        id: `${params.platform}:dialogue:${paragraphIndex}:${quoteIndex}`,
        kind: "dialogue",
        text,
      });
    });
  });
  return { narration, dialogue };
}

export function buildPublishingVideoHandoff(params: {
  storyId: number;
  publishing: PublishingDraftState;
  coverAsset: PublishingVideoCover | null;
  coverCandidates?: PublishingVideoCover[];
}): PublishingVideoHandoff | null {
  const platform = params.publishing.activePlatform;
  const platformDraft = params.publishing.drafts[platform];
  if (!platformDraft) return null;
  const speech = derivePublishingSpeechCandidates({
    platform,
    body: platformDraft.content.body,
  });
  const draftBodiesBySource = Object.fromEntries(
    (params.publishing.versions ?? []).flatMap(version =>
      Object.entries(version.drafts).flatMap(([versionPlatform, draft]) => {
        const body = draft?.content.body;
        return typeof body === "string"
          ? [[`${version.versionId}:${versionPlatform}`, body] as const]
          : [];
      })
    )
  );
  for (const version of params.publishing.versions ?? []) {
    const versionBody = version.drafts[version.activePlatform]?.content.body;
    if (typeof versionBody === "string") {
      draftBodiesBySource[version.versionId] = versionBody;
    }
  }
  draftBodiesBySource.__current__ = platformDraft.content.body;
  return {
    storyId: params.storyId,
    versionId: params.publishing.activeVersionId ?? "v1",
    containerRevision:
      params.publishing.containerRevision ?? params.publishing.revision,
    versionRevision:
      params.publishing.versions?.find(
        version => version.versionId === params.publishing.activeVersionId
      )?.versionRevision ?? params.publishing.revision,
    sourcePlatform: platform,
    core: params.publishing.core,
    draft: platformDraft.content,
    draftBodiesBySource,
    cover: params.coverAsset,
    coverCandidates: params.coverCandidates ?? [],
    needsReview: platformDraft.needsReview,
    narrationCandidates: speech.narration,
    dialogueCandidates: speech.dialogue,
  };
}
