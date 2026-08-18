import type { PublishingPlatformId } from "./publishingDraft";
import { canonicalJsonStringify } from "./canonicalJson";

export const PUBLISHING_TREND_PLATFORM_IDS = [
  "xiaohongshu",
  "douyin_tiktok",
] as const;

export type PublishingTrendPlatformId =
  Extract<PublishingPlatformId, (typeof PUBLISHING_TREND_PLATFORM_IDS)[number]>;
export type PublishingTrendAuthorizationStatus =
  | "official"
  | "contract_authorized"
  | "unavailable";
export type PublishingPlatformContextStatus =
  | "verified_fresh"
  | "verified_stale"
  | "no_relevant"
  | "unavailable"
  | "provider_error"
  | "invalid_response";

export type PublishingTrendCandidate = {
  id: string;
  label: string;
  sourcePublishedAt: number | null;
};

export type PublishingPlatformContextSnapshot = {
  snapshotId: string;
  versionId: string;
  platform: PublishingTrendPlatformId;
  sourceRevision: number;
  revision: number;
  status: PublishingPlatformContextStatus;
  capability: "verified" | "unavailable";
  providerId: string;
  providerLabel: string;
  authorization: {
    status: PublishingTrendAuthorizationStatus;
    reference: string;
  };
  coverage: string;
  fetchedAt: number;
  sourcePublishedAt: number | null;
  expiresAt: number;
  sourceDocument: string;
  parserVersion: string;
  rawDigest: string;
  candidates: PublishingTrendCandidate[];
  contentSuggestions: string[];
  message: string;
  createdAt: number;
};

export type PublishingPlatformContextState = {
  revision: number;
  snapshots: PublishingPlatformContextSnapshot[];
  selectedSnapshotId: string | null;
  selectedTags: string[];
  updatedAt: number;
};

export const MAX_PUBLISHING_PLATFORM_CONTEXT_SNAPSHOTS = 8;
export const MAX_PUBLISHING_PLATFORM_CONTEXT_TAGS = 12;
export const MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES = 30;

export function normalizePublishingPlatformContextTag(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 80);
}

export function normalizePublishingPlatformContextTags(
  values: readonly string[]
): string[] {
  return Array.from(new Set(
    values.map(normalizePublishingPlatformContextTag).filter(Boolean)
  ))
    .slice(0, MAX_PUBLISHING_PLATFORM_CONTEXT_TAGS);
}

export function normalizePublishingTrendCandidateId(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
}

export function normalizePublishingTrendText(
  value: string,
  maxLength = 200
): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max)
    : "";
}

export function emptyPublishingPlatformContextState(
  now = Date.now()
): PublishingPlatformContextState {
  return {
    revision: 0,
    snapshots: [],
    selectedSnapshotId: null,
    selectedTags: [],
    updatedAt: now,
  };
}

export function isVerifiedRealtimePublishingContext(
  snapshot: PublishingPlatformContextSnapshot,
  now = Date.now()
): boolean {
  return isPersistablePublishingContextSnapshot(snapshot) &&
    snapshot.status === "verified_fresh" &&
    snapshot.fetchedAt <= now &&
    snapshot.expiresAt > now;
}

export function isPersistablePublishingContextSnapshot(
  snapshot: PublishingPlatformContextSnapshot
): boolean {
  const candidateIds = snapshot.candidates.map(candidate => candidate.id);
  return ["verified_fresh", "verified_stale", "no_relevant"].includes(snapshot.status) &&
    snapshot.capability === "verified" &&
    (snapshot.authorization.status === "official" ||
      snapshot.authorization.status === "contract_authorized") &&
    Boolean(snapshot.authorization.reference.trim()) &&
    Boolean(snapshot.providerId.trim()) &&
    snapshot.sourcePublishedAt !== null &&
    snapshot.sourcePublishedAt <= snapshot.fetchedAt &&
    snapshot.expiresAt > snapshot.fetchedAt &&
    Boolean(snapshot.sourceDocument.trim()) &&
    Boolean(snapshot.parserVersion.trim()) &&
    /^sha256-[a-f0-9]{64}$/.test(snapshot.rawDigest) &&
    snapshot.candidates.length <= MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES &&
    snapshot.candidates.every(candidate =>
      candidate.id === normalizePublishingTrendCandidateId(candidate.id) &&
      Boolean(candidate.id) &&
      candidate.label === normalizePublishingTrendText(candidate.label) &&
      Boolean(candidate.label)
    ) &&
    new Set(candidateIds).size === candidateIds.length;
}

function boundedSnapshots(
  snapshots: PublishingPlatformContextSnapshot[],
  selectedSnapshotId: string | null
): PublishingPlatformContextSnapshot[] {
  const ordered = [...snapshots].sort((left, right) =>
    left.createdAt - right.createdAt ||
    left.revision - right.revision ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
  if (ordered.length <= MAX_PUBLISHING_PLATFORM_CONTEXT_SNAPSHOTS) {
    return ordered;
  }
  const selected = selectedSnapshotId
    ? ordered.find(snapshot => snapshot.snapshotId === selectedSnapshotId)
    : undefined;
  const newest = ordered
    .filter(snapshot => snapshot.snapshotId !== selectedSnapshotId)
    .slice(-(MAX_PUBLISHING_PLATFORM_CONTEXT_SNAPSHOTS - (selected ? 1 : 0)));
  return selected
    ? [selected, ...newest].sort((left, right) => left.createdAt - right.createdAt)
    : newest;
}

function normalizeSnapshot(
  value: unknown,
  scope: {
    versionId: string;
    platform: PublishingTrendPlatformId;
    now: number;
  }
): PublishingPlatformContextSnapshot | null {
  const object = asRecord(value);
  const authorization = asRecord(object?.authorization);
  if (!object || !authorization) return null;
  const snapshotId = cleanString(object.snapshotId, 160);
  const status = cleanString(object.status, 40) as PublishingPlatformContextStatus;
  const capability = cleanString(object.capability, 20);
  const authorizationStatus = cleanString(
    authorization.status,
    40
  ) as PublishingTrendAuthorizationStatus;
  if (
    !snapshotId ||
    object.versionId !== scope.versionId ||
    object.platform !== scope.platform ||
    !["verified_fresh", "verified_stale", "no_relevant", "unavailable", "provider_error", "invalid_response"].includes(status) ||
    !["verified", "unavailable"].includes(capability) ||
    !["official", "contract_authorized", "unavailable"].includes(authorizationStatus)
  ) return null;
  if (
    Array.isArray(object.candidates) &&
    object.candidates.length > MAX_PUBLISHING_PLATFORM_CONTEXT_CANDIDATES
  ) return null;
  const candidates = Array.isArray(object.candidates)
    ? object.candidates.flatMap(candidateValue => {
        const candidate = asRecord(candidateValue);
        const id = typeof candidate?.id === "string"
          ? normalizePublishingTrendCandidateId(candidate.id)
          : "";
        const label = typeof candidate?.label === "string"
          ? normalizePublishingTrendText(candidate.label)
          : "";
        if (!candidate || !id || !label) return [];
        return [{
          id,
          label,
          sourcePublishedAt: candidate.sourcePublishedAt === null
            ? null
            : finiteInteger(candidate.sourcePublishedAt),
        }];
      })
    : [];
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) {
    return null;
  }
  const snapshot: PublishingPlatformContextSnapshot = {
    snapshotId,
    versionId: scope.versionId,
    platform: scope.platform,
    sourceRevision: finiteInteger(object.sourceRevision),
    revision: finiteInteger(object.revision),
    status,
    capability: capability as PublishingPlatformContextSnapshot["capability"],
    providerId: cleanString(object.providerId, 120),
    providerLabel: cleanString(object.providerLabel, 160),
    authorization: {
      status: authorizationStatus,
      reference: cleanString(authorization.reference, 500),
    },
    coverage: cleanString(object.coverage, 500),
    fetchedAt: finiteInteger(object.fetchedAt, scope.now),
    sourcePublishedAt: object.sourcePublishedAt === null
      ? null
      : finiteInteger(object.sourcePublishedAt),
    expiresAt: finiteInteger(object.expiresAt, scope.now),
    sourceDocument: cleanString(object.sourceDocument, 2_000),
    parserVersion: cleanString(object.parserVersion, 120),
    rawDigest: cleanString(object.rawDigest, 160),
    candidates,
    contentSuggestions: normalizePublishingPlatformContextTags(
      Array.isArray(object.contentSuggestions)
        ? object.contentSuggestions.filter((item): item is string => typeof item === "string")
        : []
    ),
    message: cleanString(object.message, 500),
    createdAt: finiteInteger(object.createdAt, scope.now),
  };
  return isPersistablePublishingContextSnapshot(snapshot) ? snapshot : null;
}

export function normalizePublishingPlatformContextState(
  value: unknown,
  scope: {
    versionId: string;
    platform: PublishingTrendPlatformId;
    now?: number;
  }
): PublishingPlatformContextState {
  const now = scope.now ?? Date.now();
  const object = asRecord(value);
  if (!object) return emptyPublishingPlatformContextState(now);
  const seen = new Set<string>();
  const snapshots = Array.isArray(object.snapshots)
    ? object.snapshots.flatMap(snapshotValue => {
        const snapshot = normalizeSnapshot(snapshotValue, {
          versionId: scope.versionId,
          platform: scope.platform,
          now,
        });
        if (!snapshot || seen.has(snapshot.snapshotId)) return [];
        seen.add(snapshot.snapshotId);
        return [snapshot];
      })
    : [];
  const requestedSelection = cleanString(object.selectedSnapshotId, 160) || null;
  const selectedSnapshotId = requestedSelection && seen.has(requestedSelection)
    ? requestedSelection
    : null;
  return {
    revision: finiteInteger(object.revision),
    snapshots: boundedSnapshots(snapshots, selectedSnapshotId),
    selectedSnapshotId,
    selectedTags: normalizePublishingPlatformContextTags(
      Array.isArray(object.selectedTags)
        ? object.selectedTags.filter((item): item is string => typeof item === "string")
        : []
    ),
    updatedAt: finiteInteger(object.updatedAt, now),
  };
}

export function appendPublishingPlatformContextSnapshot(
  state: PublishingPlatformContextState,
  snapshot: PublishingPlatformContextSnapshot,
  now = Date.now()
): PublishingPlatformContextState {
  if (!isPersistablePublishingContextSnapshot(snapshot)) {
    throw new Error("Only verified publishing platform context snapshots may be stored");
  }
  const existing = state.snapshots.find(
    candidate => candidate.snapshotId === snapshot.snapshotId
  );
  if (existing) {
    if (canonicalJsonStringify(existing) !== canonicalJsonStringify(snapshot)) {
      throw new Error("Publishing platform context snapshot id already has different content");
    }
    return state;
  }
  return {
    ...state,
    revision: state.revision + 1,
    snapshots: boundedSnapshots(
      [...state.snapshots, structuredClone(snapshot)],
      state.selectedSnapshotId
    ),
    updatedAt: now,
  };
}

export function selectPublishingPlatformContextTags(
  state: PublishingPlatformContextState,
  input: {
    snapshotId: string | null;
    candidateIds: string[];
    contentTags: string[];
    now?: number;
  }
): PublishingPlatformContextState {
  const snapshot = input.snapshotId
    ? state.snapshots.find(candidate => candidate.snapshotId === input.snapshotId)
    : undefined;
  if (input.snapshotId && !snapshot) {
    throw new Error(`Unknown publishing context snapshot: ${input.snapshotId}`);
  }
  const candidateMap = new Map(
    (snapshot?.candidates ?? []).map(candidate => [candidate.id, candidate.label])
  );
  const candidateTags = input.candidateIds.map(candidateId => {
    const label = candidateMap.get(candidateId);
    if (!label) throw new Error(`Unknown publishing trend candidate: ${candidateId}`);
    return label;
  });
  return {
    ...state,
    revision: state.revision + 1,
    selectedSnapshotId: input.snapshotId,
    selectedTags: normalizePublishingPlatformContextTags([
      ...candidateTags,
      ...input.contentTags,
    ]),
    updatedAt: input.now ?? Date.now(),
  };
}
