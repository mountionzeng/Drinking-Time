export const SEMANTIC_ART_NORMALIZER_VERSION = "semantic-art-v1";
export const SEMANTIC_ART_CATALOG_VERSION = "2026-08-31.1";

export type SemanticArtPurpose =
  | "story-frame"
  | "publishing-cover"
  | "publishing-album"
  | "image-edit"
  | "product"
  | "standard-view"
  | "factual";

export type SemanticArtScope = "main" | "auxiliary";
export type EvidencePolarity = "positive" | "negative" | "unknown";

export type SemanticArtEvidence = {
  concept: string;
  weight: number;
  source: "explicit-direction" | "current-emotion" | "story" | "shot";
  polarity: EvidencePolarity;
  quoted: boolean;
  subject:
    | "visual-direction"
    | "current-user-state"
    | "story-subject"
    | "other-subject"
    | "unknown";
};

export type NormalizedSemanticArtEvidence = {
  version: string;
  inputFingerprint: string;
  evidence: SemanticArtEvidence[];
};

export type SemanticArtCard = {
  id: string;
  version: string;
  scope: SemanticArtScope;
  concepts: string[];
  counterSignals: string[];
  providerFragments: string[];
  allowedAuxiliaryDimensions: string[];
  compatibleMainIds: string[];
  forbiddenPurposes: SemanticArtPurpose[];
  provenance: string[];
};

export type SemanticArtSelection = {
  main: SemanticArtCard | null;
  auxiliary: SemanticArtCard | null;
  reason:
    | "applied"
    | "no_evidence"
    | "low_confidence"
    | "ambiguous"
    | "purpose_disallowed"
    | "incompatible_auxiliary";
  scores: Record<string, number>;
};
