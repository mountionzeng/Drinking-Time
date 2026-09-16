/** Pure, redacted contracts for reusable user-owned voice identities. */

export const STORY_VOICE_PROFILE_STATUSES = [
  "draft",
  "sample_ready",
  "training",
  "submission_unknown",
  "preview_ready",
  "active",
  "failed",
  "deactivated",
  "withdrawn",
] as const;
export type StoryVoiceProfileStatus =
  (typeof STORY_VOICE_PROFILE_STATUSES)[number];

export type StoryVoiceConsent = {
  id: string;
  policyVersion: string;
  confirmedAt: string;
  sampleDigest: string;
  challengeId: string;
};

export type StoryVoiceChallenge = {
  id: string;
  promptDigest: string;
  expiresAt: string;
  verifiedAt?: string;
  sampleDigest: string;
};

export type StoryVoiceProviderIdentity = {
  provider: "doubao";
  resourceId: string;
  voiceId: string;
};

export type StoryVoiceActivation = {
  status: "inactive" | "prepared" | "active" | "failed" | "submission_unknown";
  priceVersion?: string;
};

export type StoryVoiceProfile = {
  id: string;
  userId: number;
  displayName: string;
  subject: "self";
  rightsBasis: "self_voice";
  assuranceLevel: "asserted" | "fresh_liveness" | "provider_verified";
  allowedUseScope: "story_only" | "all_owned_stories";
  allowedStoryId?: number;
  consent?: StoryVoiceConsent;
  challenge?: StoryVoiceChallenge;
  provider?: StoryVoiceProviderIdentity;
  previewAcceptedAt?: string;
  activation: StoryVoiceActivation;
  status: StoryVoiceProfileStatus;
};

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
const inSet = <T extends string>(
  value: unknown,
  values: readonly T[]
): value is T => typeof value === "string" && values.includes(value as T);

function normalizeConsent(value: unknown): StoryVoiceConsent | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = text(raw.id);
  const policyVersion = text(raw.policyVersion);
  const confirmedAt = text(raw.confirmedAt);
  const sampleDigest = text(raw.sampleDigest);
  const challengeId = text(raw.challengeId);
  return id && policyVersion && confirmedAt && sampleDigest && challengeId
    ? { id, policyVersion, confirmedAt, sampleDigest, challengeId }
    : undefined;
}

function normalizeChallenge(value: unknown): StoryVoiceChallenge | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = text(raw.id);
  const promptDigest = text(raw.promptDigest);
  const expiresAt = text(raw.expiresAt);
  const sampleDigest = text(raw.sampleDigest);
  if (!id || !promptDigest || !expiresAt || !sampleDigest) return undefined;
  return {
    id,
    promptDigest,
    expiresAt,
    sampleDigest,
    ...(text(raw.verifiedAt) ? { verifiedAt: text(raw.verifiedAt) } : {}),
  };
}

function normalizeProvider(
  value: unknown
): StoryVoiceProviderIdentity | undefined {
  const raw = record(value);
  if (!raw || raw.provider !== "doubao") return undefined;
  const resourceId = text(raw.resourceId);
  const voiceId = text(raw.voiceId);
  return resourceId && voiceId
    ? { provider: "doubao", resourceId, voiceId }
    : undefined;
}

function normalizeActivation(value: unknown): StoryVoiceActivation {
  const raw = record(value);
  const status =
    raw &&
    inSet(raw.status, [
      "inactive",
      "prepared",
      "active",
      "failed",
      "submission_unknown",
    ] as const)
      ? raw.status
      : "inactive";
  return {
    status,
    ...(raw && text(raw.priceVersion)
      ? { priceVersion: text(raw.priceVersion) }
      : {}),
  };
}

/** Unknown fields are intentionally discarded so secrets/raw samples cannot leak. */
export function normalizeStoryVoiceProfile(
  value: unknown
): StoryVoiceProfile | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  const userId = int(raw.userId);
  const displayName = text(raw.displayName);
  if (
    !id ||
    !userId ||
    !displayName ||
    raw.subject !== "self" ||
    raw.rightsBasis !== "self_voice" ||
    !inSet(raw.assuranceLevel, [
      "asserted",
      "fresh_liveness",
      "provider_verified",
    ] as const) ||
    !inSet(raw.allowedUseScope, ["story_only", "all_owned_stories"] as const) ||
    !inSet(raw.status, STORY_VOICE_PROFILE_STATUSES)
  ) {
    return null;
  }
  return {
    id,
    userId,
    displayName,
    subject: "self",
    rightsBasis: "self_voice",
    assuranceLevel: raw.assuranceLevel,
    allowedUseScope: raw.allowedUseScope,
    ...(int(raw.allowedStoryId)
      ? { allowedStoryId: int(raw.allowedStoryId) }
      : {}),
    ...(normalizeConsent(raw.consent)
      ? { consent: normalizeConsent(raw.consent) }
      : {}),
    ...(normalizeChallenge(raw.challenge)
      ? { challenge: normalizeChallenge(raw.challenge) }
      : {}),
    ...(normalizeProvider(raw.provider)
      ? { provider: normalizeProvider(raw.provider) }
      : {}),
    ...(text(raw.previewAcceptedAt)
      ? { previewAcceptedAt: text(raw.previewAcceptedAt) }
      : {}),
    activation: normalizeActivation(raw.activation),
    status: raw.status,
  };
}

export type VoiceProfileUseFailure =
  | "owner_mismatch"
  | "story_scope_mismatch"
  | "profile_inactive"
  | "fresh_liveness_required"
  | "consent_missing"
  | "consent_sample_mismatch"
  | "provider_identity_missing"
  | "preview_not_accepted"
  | "activation_not_ready";

export type VoiceProfileUseResult =
  | { ok: true }
  | { ok: false; reason: VoiceProfileUseFailure };

export function voiceProfileCanBind(
  profile: StoryVoiceProfile,
  scope: { userId: number; storyId: number }
): VoiceProfileUseResult {
  if (profile.userId !== scope.userId) {
    return { ok: false, reason: "owner_mismatch" };
  }
  if (
    profile.allowedUseScope === "story_only" &&
    profile.allowedStoryId !== scope.storyId
  ) {
    return { ok: false, reason: "story_scope_mismatch" };
  }
  if (["deactivated", "withdrawn", "failed"].includes(profile.status)) {
    return { ok: false, reason: "profile_inactive" };
  }
  if (
    profile.assuranceLevel !== "fresh_liveness" &&
    profile.assuranceLevel !== "provider_verified"
  ) {
    return { ok: false, reason: "fresh_liveness_required" };
  }
  if (!profile.consent || !profile.challenge?.verifiedAt) {
    return { ok: false, reason: "consent_missing" };
  }
  if (
    profile.consent.challengeId !== profile.challenge.id ||
    profile.consent.sampleDigest !== profile.challenge.sampleDigest
  ) {
    return { ok: false, reason: "consent_sample_mismatch" };
  }
  if (!profile.provider) {
    return { ok: false, reason: "provider_identity_missing" };
  }
  if (!profile.previewAcceptedAt) {
    return { ok: false, reason: "preview_not_accepted" };
  }
  return { ok: true };
}

export function voiceProfileCanSynthesize(
  profile: StoryVoiceProfile,
  scope: { userId: number; storyId: number }
): VoiceProfileUseResult {
  const binding = voiceProfileCanBind(profile, scope);
  if (!binding.ok) return binding;
  if (profile.status !== "active" || profile.activation.status !== "active") {
    return { ok: false, reason: "activation_not_ready" };
  }
  return { ok: true };
}
