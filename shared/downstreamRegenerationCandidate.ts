import type { KnownTextSource, TextSourceSnapshot } from "./textSourceLineage";
import type { StoryTimelineItem } from "./storyMaterial";
export type CandidateTarget = "timeline" | "storyboard";
export type StructuralSnapshot = {
  shots: Record<string, unknown>[];
  storyboardSource: TextSourceSnapshot;
  timeline: {
    items: StoryTimelineItem[];
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  };
};
export type DownstreamRegenerationCandidate = {
  id: string;
  storyId: number;
  userId: number;
  revision: number;
  targetKind: CandidateTarget;
  targetId: string;
  source: KnownTextSource;
  sourcePointerHash: string;
  inputFingerprint: string;
  formalFingerprint: string;
  operationTokens: string[];
  requestHashes: Record<string, string>;
  status:
    | "pending"
    | "ready"
    | "adopting"
    | "adopted"
    | "discarded"
    | "stale"
    | "failed"
    | "unknown";
  createdAt: number;
  updatedAt: number;
  before: StructuralSnapshot;
  proposal?: StructuralSnapshot;
  summary?: string;
  error?: string;
  confirmation?: {
    token: string;
    sessionId: string;
    expiresAt: number;
    proposalFingerprint: string;
  };
  adoptionAttempt?: boolean;
  restoreCandidateId?: string;
};
