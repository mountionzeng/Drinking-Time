export const STORY_INTENT_PURPOSES = [
  "preserve",
  "gift",
  "share",
  "persuade",
  "create",
] as const;

export type StoryIntentPurpose = (typeof STORY_INTENT_PURPOSES)[number];
export type StoryIntentConfirmationStatus = "provisional" | "confirmed";
export type StoryIntentProvenanceSource =
  | "user"
  | "recognition"
  | "migration"
  | "version_snapshot";

export type StoryIntentProfile = {
  primaryPurpose: StoryIntentPurpose;
  secondaryPurposes: StoryIntentPurpose[];
  coreAudience: string;
  secondaryAudiences: string[];
  /** Publishing channel only. Changing it must not infer a new purpose/audience. */
  channel: string;
  expression: {
    tone: string;
    desiredEffect: string;
  };
  status: StoryIntentConfirmationStatus;
  revision: number;
  provenance: {
    source: StoryIntentProvenanceSource;
    updatedAt: number;
    sourceId?: string;
  };
};

export type IntentProposalStatus =
  | "pending"
  | "rejected"
  | "superseded"
  | "accepted";

export type IntentProposalSourceKind =
  | "recognition"
  | "legacy_pre_version"
  | "legacy_confirmed_intent"
  | "legacy_opening_intent";

export type IntentProposalScope = {
  kind: IntentProposalSourceKind;
  storyId: number;
  versionId: string | null;
  intentRevision: number;
};

type IntentProfileChanges = Partial<
  Omit<Pick<
    StoryIntentProfile,
    | "primaryPurpose"
    | "secondaryPurposes"
    | "coreAudience"
    | "secondaryAudiences"
    | "channel"
    | "expression"
  >, "expression">
> & { expression?: Partial<StoryIntentProfile["expression"]> };

export type IntentProposal = {
  id: string;
  source: IntentProposalScope;
  changes: IntentProfileChanges;
  evidence: string[];
  status: IntentProposalStatus;
  createdAt: number;
  resolvedAt?: number;
};

function stableFingerprintNumber(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableFingerprint(value: string): string {
  return stableFingerprintNumber(value).toString(36);
}

export function intentProposalId(input: {
  source: Omit<IntentProposalScope, "kind">;
  candidate: LegacyIntent;
}): string {
  const normalized = storyIntentProfileFromLegacy(input.candidate, { now: 0 });
  const candidate = normalized
    ? {
        primaryPurpose: normalized.primaryPurpose,
        secondaryPurposes: normalized.secondaryPurposes,
        coreAudience: normalized.coreAudience,
        secondaryAudiences: normalized.secondaryAudiences,
        channel: normalized.channel,
        expression: normalized.expression,
      }
    : input.candidate;
  const payload = JSON.stringify({ source: input.source, candidate });
  return `recognition:${input.source.storyId}:${input.source.versionId ?? "pre"}:${input.source.intentRevision}:${stableFingerprint(payload)}`;
}

type LegacyIntent = {
  purpose?: unknown;
  audience?: unknown;
  platform?: unknown;
  channel?: unknown;
  primaryPurpose?: unknown;
  secondaryPurposes?: unknown;
  coreAudience?: unknown;
  secondaryAudiences?: unknown;
  tone?: unknown;
  desiredEffect?: unknown;
  status?: unknown;
  revision?: unknown;
  expression?: unknown;
  provenance?: unknown;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(Boolean)
    : [];
}

function purpose(value: unknown, legacyPurpose?: unknown): StoryIntentPurpose {
  if (
    typeof value === "string" &&
    (STORY_INTENT_PURPOSES as readonly string[]).includes(value)
  ) return value as StoryIntentPurpose;
  if (legacyPurpose === "gift") return "gift";
  if (legacyPurpose === "social_post") return "share";
  if (["linkedin_job_search", "portfolio", "product_intro"].includes(String(legacyPurpose))) return "persuade";
  if (["fiction", "creative_expression"].includes(String(legacyPurpose))) return "create";
  return "preserve";
}

export function storyIntentProfileFromLegacy(
  value: LegacyIntent | null | undefined,
  options: { revision?: number; source?: StoryIntentProvenanceSource; now?: number } = {}
): StoryIntentProfile | null {
  if (!value || typeof value !== "object") return null;
  const now = options.now ?? Date.now();
  const expression = value.expression && typeof value.expression === "object"
    ? value.expression as Record<string, unknown>
    : null;
  const provenance = value.provenance && typeof value.provenance === "object"
    ? value.provenance as Record<string, unknown>
    : null;
  const provenanceSource = provenance?.source;
  return {
    primaryPurpose: purpose(value.primaryPurpose, value.purpose),
    secondaryPurposes: textList(value.secondaryPurposes)
      .filter(item => (STORY_INTENT_PURPOSES as readonly string[]).includes(item)) as StoryIntentPurpose[],
    coreAudience: text(value.coreAudience, text(value.audience, "待确认")),
    secondaryAudiences: textList(value.secondaryAudiences),
    channel: text(value.channel, text(value.platform, "unknown")),
    expression: {
      tone: text(expression?.tone, text(value.tone)),
      desiredEffect: text(expression?.desiredEffect, text(value.desiredEffect)),
    },
    status: value.status === "confirmed" ? "confirmed" : "provisional",
    revision: Math.max(0, Math.floor(options.revision ?? (typeof value.revision === "number" ? value.revision : 0))),
    provenance: {
      source: options.source ?? (
        provenanceSource === "user" || provenanceSource === "recognition" || provenanceSource === "migration" || provenanceSource === "version_snapshot"
          ? provenanceSource
          : "migration"
      ),
      updatedAt: typeof provenance?.updatedAt === "number" ? provenance.updatedAt : now,
      sourceId: text(provenance?.sourceId) || undefined,
    },
  };
}

export function storyIntentScopeRevision(value: unknown): number {
  const profile = storyIntentProfileFromLegacy(
    value && typeof value === "object" ? value as LegacyIntent : null,
    { now: 0 }
  );
  if (!profile) return 0;
  return stableFingerprintNumber(JSON.stringify({
    revision: profile.revision,
    primaryPurpose: profile.primaryPurpose,
    secondaryPurposes: profile.secondaryPurposes,
    coreAudience: profile.coreAudience,
    secondaryAudiences: profile.secondaryAudiences,
    channel: profile.channel,
    expression: profile.expression,
  }));
}

export function resolveStoryIntentProfile(input: {
  preVersionProfile: StoryIntentProfile | null;
  activeVersionSnapshot?: StoryIntentProfile | null;
}): { profile: StoryIntentProfile | null; authority: "active_version" | "pre_version" | "none" } {
  if (input.activeVersionSnapshot) return { profile: input.activeVersionSnapshot, authority: "active_version" };
  if (input.preVersionProfile) return { profile: input.preVersionProfile, authority: "pre_version" };
  return { profile: null, authority: "none" };
}

function diffProfile(current: StoryIntentProfile, candidate: StoryIntentProfile): IntentProfileChanges {
  const changes: IntentProfileChanges = {};
  for (const key of ["primaryPurpose", "secondaryPurposes", "coreAudience", "secondaryAudiences", "channel"] as const) {
    if (JSON.stringify(current[key]) !== JSON.stringify(candidate[key])) {
      (changes as Record<string, unknown>)[key] = structuredClone(candidate[key]);
    }
  }
  const expression: Partial<StoryIntentProfile["expression"]> = {};
  if (current.expression.tone !== candidate.expression.tone) expression.tone = candidate.expression.tone;
  if (current.expression.desiredEffect !== candidate.expression.desiredEffect) expression.desiredEffect = candidate.expression.desiredEffect;
  if (Object.keys(expression).length > 0) changes.expression = expression;
  return changes;
}

export function createIntentProposal(input: {
  id: string;
  currentProfile: StoryIntentProfile;
  candidate: StoryIntentProfile;
  source: IntentProposalScope;
  evidence?: string[];
  existing?: IntentProposal[];
  now?: number;
}): IntentProposal | null {
  if (input.existing?.some(item => item.id === input.id)) return null;
  const changes = diffProfile(input.currentProfile, input.candidate);
  if (Object.keys(changes).length === 0) return null;
  return {
    id: input.id,
    source: { ...input.source },
    changes,
    evidence: [...(input.evidence ?? [])],
    status: "pending",
    createdAt: input.now ?? Date.now(),
  };
}

function resolveProposal(proposal: IntentProposal, status: Exclude<IntentProposalStatus, "pending">, now: number): IntentProposal {
  return proposal.status === "pending" ? { ...proposal, status, resolvedAt: now } : proposal;
}

export function rejectIntentProposal(proposal: IntentProposal, now = Date.now()): IntentProposal {
  return resolveProposal(proposal, "rejected", now);
}

export function supersedeIntentProposal(proposal: IntentProposal, now = Date.now()): IntentProposal {
  return resolveProposal(proposal, "superseded", now);
}

export function acceptIntentProposal(
  proposal: IntentProposal,
  currentScope: Omit<IntentProposalScope, "kind">,
  now = Date.now()
): { proposal: IntentProposal; action: "profile_update" | "version_transition"; nextProfile: IntentProfileChanges } | null {
  if (
    proposal.status !== "pending" ||
    proposal.source.storyId !== currentScope.storyId ||
    proposal.source.versionId !== currentScope.versionId ||
    proposal.source.intentRevision !== currentScope.intentRevision
  ) return null;
  const changesPurpose = "primaryPurpose" in proposal.changes || "coreAudience" in proposal.changes || "secondaryPurposes" in proposal.changes || "secondaryAudiences" in proposal.changes || proposal.changes.expression?.desiredEffect !== undefined;
  return {
    proposal: resolveProposal(proposal, "accepted", now),
    action: currentScope.versionId && changesPurpose ? "version_transition" : "profile_update",
    nextProfile: structuredClone(proposal.changes),
  };
}

export function migrateLegacyStoryIntent(input: {
  activeVersionSnapshot?: StoryIntentProfile | null;
  preVersionProfile?: StoryIntentProfile | null;
  confirmedIntent?: LegacyIntent | null;
  openingIntent?: LegacyIntent | null;
  storyId: number;
  activeVersionId?: string | null;
  now?: number;
}): { profile: StoryIntentProfile | null; proposals: IntentProposal[] } {
  const now = input.now ?? Date.now();
  const candidates = [
    input.preVersionProfile && { kind: "legacy_pre_version" as const, profile: input.preVersionProfile },
    input.confirmedIntent && { kind: "legacy_confirmed_intent" as const, profile: storyIntentProfileFromLegacy(input.confirmedIntent, { now }) },
    input.openingIntent && { kind: "legacy_opening_intent" as const, profile: storyIntentProfileFromLegacy(input.openingIntent, { now }) },
  ].filter((item): item is { kind: Exclude<IntentProposalSourceKind, "recognition">; profile: StoryIntentProfile } => Boolean(item && item.profile));
  const profile = input.activeVersionSnapshot ?? input.preVersionProfile ?? candidates[0]?.profile ?? null;
  if (!profile) return { profile: null, proposals: [] };
  const proposals = candidates.flatMap((candidate, index) => {
    if (candidate.profile === profile) return [];
    const proposal = createIntentProposal({
      id: `migration:${input.storyId}:${candidate.kind}:${index}`,
      currentProfile: profile,
      candidate: candidate.profile,
      source: { kind: candidate.kind, storyId: input.storyId, versionId: input.activeVersionId ?? null, intentRevision: profile.revision },
      now,
    });
    return proposal ? [proposal] : [];
  });
  return { profile, proposals };
}
