/**
 * Pure contracts for one Story's conversational sound plan.
 *
 * This module deliberately contains no provider, billing, asset, Timeline, or
 * persistence calls. A plan is creative intent; those systems only consume an
 * immutable, evidence-bound version after a separate quote and confirmation.
 */

export const STORY_SOUND_ROW_KINDS = [
  "dialogue",
  "narration",
  "music",
  "ambience",
  "sfx",
] as const;
export type StorySoundRowKind = (typeof STORY_SOUND_ROW_KINDS)[number];

export const STORY_SOUND_EVIDENCE_KINDS = [
  "story",
  "shot",
  "subtitle",
  "timeline_audio",
  "character",
  "user_answer",
] as const;
export type StorySoundEvidenceKind =
  (typeof STORY_SOUND_EVIDENCE_KINDS)[number];

export type StorySoundEvidenceReference = {
  id: string;
  sourceKind: StorySoundEvidenceKind;
  sourceId: string;
  revisionHash?: string;
  sceneId?: string;
  startFrame?: number;
  endFrame?: number;
};

export type StorySoundTextOrigin =
  | "verbatim"
  | "user_authored"
  | "user_confirmed"
  | "ai_draft"
  | "not_applicable";

export type StorySoundRowEligibility =
  | "eligible"
  | "ai_draft_unconfirmed"
  | "missing_evidence"
  | "missing_content"
  | "missing_voice";

export type StorySoundPerformance = {
  emotion?: string;
  speed?: number;
  intensity?: number;
  style?: string;
};

export type StorySoundPlanRow = {
  id: string;
  kind: StorySoundRowKind;
  sceneId?: string;
  startFrame: number;
  durationFrames: number;
  characterId?: string;
  text?: string;
  description?: string;
  textOrigin: StorySoundTextOrigin;
  evidence: StorySoundEvidenceReference[];
  voiceAssignmentId?: string;
  performance: StorySoundPerformance;
  eligibility: StorySoundRowEligibility;
};

export type StoryCharacterVoiceAssignment = {
  id: string;
  characterId: string;
  voiceSource: "official" | "cloned";
  /** An owned opaque id. Never a provider credential. */
  voiceId: string;
};

export type StorySoundPlanDraft = {
  globalDirection: string;
  rows: StorySoundPlanRow[];
  characterVoiceAssignments: StoryCharacterVoiceAssignment[];
};

export type StorySoundPlanVersion = StorySoundPlanDraft & {
  id: string;
  storyId: number;
  userId: number;
  versionNumber: number;
  contentDigest: string;
  evidenceSnapshotDigest: string;
  sourceRevisions: Record<string, string>;
  createdAt: string;
};

export type StorySoundPlanWorkspace = StorySoundPlanDraft & {
  storyId: number;
  userId: number;
  revision: number;
  interviewStatus: "interviewing" | "draft" | "needs_review";
  currentStepId?: string;
  restoredFromVersionId?: string;
  /** Server-owned linear interview state. Clients may render but never author it wholesale. */
  interviewState?: unknown;
  selectionByRowId: Record<string, boolean>;
};

export type StorySoundRowOperationState =
  | "prepared"
  | "submitting"
  | "ready"
  | "failed"
  | "submission_unknown"
  | "provider_succeeded_media_missing";

export type StorySoundRowOperation = {
  id: string;
  storyId: number;
  userId: number;
  rowId: string;
  versionId: string;
  requestDigest: string;
  quoteId: string;
  state: StorySoundRowOperationState;
  amountMinorUnits: number;
  currency: string;
  assetId?: number;
  timelineClipId?: string;
};

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nonNegativeFrame = (value: unknown): number =>
  Math.max(0, Math.round(finiteNumber(value) ?? 0));

const positiveFrameDuration = (value: unknown): number =>
  Math.max(1, Math.round(finiteNumber(value) ?? 1));

const inSet = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T => typeof value === "string" && allowed.includes(value as T);

function normalizeEvidence(value: unknown): StorySoundEvidenceReference | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  const sourceId = text(raw.sourceId);
  if (!id || !sourceId || !inSet(raw.sourceKind, STORY_SOUND_EVIDENCE_KINDS)) {
    return null;
  }
  const startFrame = finiteNumber(raw.startFrame);
  const endFrame = finiteNumber(raw.endFrame);
  const normalizedStart =
    startFrame === undefined ? undefined : nonNegativeFrame(startFrame);
  const normalizedEnd =
    endFrame === undefined
      ? undefined
      : Math.max(normalizedStart ?? 0, nonNegativeFrame(endFrame));
  return {
    id,
    sourceKind: raw.sourceKind,
    sourceId,
    ...(text(raw.revisionHash) ? { revisionHash: text(raw.revisionHash) } : {}),
    ...(text(raw.sceneId) ? { sceneId: text(raw.sceneId) } : {}),
    ...(normalizedStart === undefined ? {} : { startFrame: normalizedStart }),
    ...(normalizedEnd === undefined ? {} : { endFrame: normalizedEnd }),
  };
}

function normalizePerformance(value: unknown): StorySoundPerformance {
  const raw = record(value) ?? {};
  const speed = finiteNumber(raw.speed);
  const intensity = finiteNumber(raw.intensity);
  return {
    ...(text(raw.emotion) ? { emotion: text(raw.emotion) } : {}),
    ...(speed === undefined
      ? {}
      : { speed: Math.min(2, Math.max(0.5, speed)) }),
    ...(intensity === undefined
      ? {}
      : { intensity: Math.min(1, Math.max(0, intensity)) }),
    ...(text(raw.style) ? { style: text(raw.style) } : {}),
  };
}

function deriveEligibility(
  row: Omit<StorySoundPlanRow, "eligibility">
): StorySoundRowEligibility {
  if (row.evidence.length === 0) return "missing_evidence";
  if ((row.kind === "dialogue" || row.kind === "narration") && !row.text) {
    return "missing_content";
  }
  if (row.kind !== "dialogue" && row.kind !== "narration" && !row.description) {
    return "missing_content";
  }
  if (row.textOrigin === "ai_draft") return "ai_draft_unconfirmed";
  if (row.kind === "dialogue" && !row.voiceAssignmentId) {
    return "missing_voice";
  }
  return "eligible";
}

function normalizeRow(value: unknown): StorySoundPlanRow | null {
  const raw = record(value);
  if (!raw || !text(raw.id) || !inSet(raw.kind, STORY_SOUND_ROW_KINDS)) {
    return null;
  }
  const textOrigin = inSet(raw.textOrigin, [
    "verbatim",
    "user_authored",
    "user_confirmed",
    "ai_draft",
    "not_applicable",
  ] as const)
    ? raw.textOrigin
    : raw.kind === "dialogue" || raw.kind === "narration"
      ? "ai_draft"
      : "not_applicable";
  const normalized: Omit<StorySoundPlanRow, "eligibility"> = {
    id: text(raw.id)!,
    kind: raw.kind,
    ...(text(raw.sceneId) ? { sceneId: text(raw.sceneId) } : {}),
    startFrame: nonNegativeFrame(raw.startFrame),
    durationFrames: positiveFrameDuration(raw.durationFrames),
    ...(text(raw.characterId) ? { characterId: text(raw.characterId) } : {}),
    ...(text(raw.text) ? { text: text(raw.text) } : {}),
    ...(text(raw.description) ? { description: text(raw.description) } : {}),
    textOrigin,
    evidence: (Array.isArray(raw.evidence) ? raw.evidence : [])
      .map(normalizeEvidence)
      .filter((item): item is StorySoundEvidenceReference => item !== null),
    ...(text(raw.voiceAssignmentId)
      ? { voiceAssignmentId: text(raw.voiceAssignmentId) }
      : {}),
    performance: normalizePerformance(raw.performance),
  };
  return { ...normalized, eligibility: deriveEligibility(normalized) };
}

function normalizeAssignment(
  value: unknown
): StoryCharacterVoiceAssignment | null {
  const raw = record(value);
  const id = raw ? text(raw.id) : undefined;
  const characterId = raw ? text(raw.characterId) : undefined;
  const voiceId = raw ? text(raw.voiceId) : undefined;
  if (
    !raw ||
    !id ||
    !characterId ||
    !voiceId ||
    !inSet(raw.voiceSource, ["official", "cloned"] as const)
  ) {
    return null;
  }
  return { id, characterId, voiceSource: raw.voiceSource, voiceId };
}

export function normalizeStorySoundPlanDraft(
  value: unknown
): StorySoundPlanDraft {
  const raw = record(value) ?? {};
  const seenRows = new Set<string>();
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .map(normalizeRow)
    .filter((row): row is StorySoundPlanRow => {
      if (!row || seenRows.has(row.id)) return false;
      seenRows.add(row.id);
      return true;
    });
  const seenAssignments = new Set<string>();
  const characterVoiceAssignments = (
    Array.isArray(raw.characterVoiceAssignments)
      ? raw.characterVoiceAssignments
      : []
  )
    .map(normalizeAssignment)
    .filter((assignment): assignment is StoryCharacterVoiceAssignment => {
      if (!assignment || seenAssignments.has(assignment.id)) return false;
      seenAssignments.add(assignment.id);
      return true;
    });
  return {
    globalDirection: text(raw.globalDirection) ?? "",
    rows,
    characterVoiceAssignments,
  };
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  const raw = record(value);
  if (!raw) return value;
  return Object.fromEntries(
    Object.keys(raw)
      .sort()
      .map(key => [key, sortObject(raw[key])])
  );
}

/** Stable creative snapshot input for a server-side SHA-256 digest. */
export function canonicalStorySoundPlanContent(value: unknown): string {
  const draft = normalizeStorySoundPlanDraft(value);
  const canonical = {
    globalDirection: draft.globalDirection,
    rows: draft.rows.map(({ eligibility: _eligibility, ...row }) => row),
    characterVoiceAssignments: [...draft.characterVoiceAssignments].sort(
      (a, b) => a.id.localeCompare(b.id)
    ),
  };
  return JSON.stringify(sortObject(canonical));
}

export function soundPlanRowCanBeQuoted(row: StorySoundPlanRow): boolean {
  return row.eligibility === "eligible";
}

export type ConfirmDraftTextResult =
  | { status: "ok"; draft: StorySoundPlanDraft }
  | { status: "error"; message: string };

export function confirmSoundPlanDraftText(
  draft: StorySoundPlanDraft,
  input: { rowId: string; confirmedText: string }
): ConfirmDraftTextResult {
  const confirmedText = text(input.confirmedText);
  if (!confirmedText) return { status: "error", message: "确认文本不能为空" };
  const row = draft.rows.find(candidate => candidate.id === input.rowId);
  if (!row) return { status: "error", message: "声音方案行不存在" };
  if (row.textOrigin !== "ai_draft") {
    return { status: "error", message: "只有 AI 草稿需要确认" };
  }
  return {
    status: "ok",
    draft: {
      ...draft,
      rows: draft.rows.map(candidate => {
        if (candidate.id !== input.rowId) return candidate;
        const confirmed = {
          ...candidate,
          text: confirmedText,
          textOrigin: "user_confirmed" as const,
        };
        return {
          ...confirmed,
          eligibility: deriveEligibility(confirmed),
        };
      }),
    },
  };
}

/** Restore only creative intent. Quotes, operations, assets, and clips are absent. */
export function restoreStorySoundPlanVersion(
  version: StorySoundPlanVersion
): StorySoundPlanDraft & {
  restoredFromVersionId: string;
  selectionByRowId: Record<string, boolean>;
} {
  const draft = normalizeStorySoundPlanDraft({
    globalDirection: version.globalDirection,
    rows: version.rows,
    characterVoiceAssignments: version.characterVoiceAssignments,
  });
  return {
    ...draft,
    restoredFromVersionId: version.id,
    selectionByRowId: Object.fromEntries(draft.rows.map(row => [row.id, true])),
  };
}
