import type {
  CreationIntent,
  ManuscriptReference,
  VersionActor,
} from "./bookWorkflow";
import type { StoryMaterialState } from "./storyMaterial";
export type VideoWorkVersion = {
  id: string;
  number: number;
  parentId?: string;
  createdAt: number;
  name: string;
  intent: CreationIntent;
  summary: string;
  author: VersionActor;
  confirmedBy: VersionActor;
  manuscriptSource?: ManuscriptReference;
  textSource?: ManuscriptReference;
  planId?: string;
  material: StoryMaterialState;
  legacyAudioSources?: Array<{
    assetId: number;
    clipId: string;
    displayName: string;
    url: string;
  }>;
  shots: Record<string, unknown>[];
  exports: Array<{
    id: string;
    createdAt: number;
    actor: VersionActor;
    status: "rendering" | "ready" | "failed";
    aspectRatio: "16:9" | "9:16" | "1:1";
    videoUrl?: string;
    durationSec?: number;
    error?: string;
  }>;
};
export type VideoWorkflowState = {
  schemaVersion: 1;
  versions: VideoWorkVersion[];
};
export function readVideoWorkflow(value: unknown): VideoWorkflowState {
  if (value == null) return { schemaVersion: 1, versions: [] };
  const state = value as VideoWorkflowState;
  if (state.schemaVersion !== 1 || !Array.isArray(state.versions))
    throw new Error("视频版本记录无法读取");
  return structuredClone(state);
}
