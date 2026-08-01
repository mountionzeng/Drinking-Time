import type {
  NarrativeJob,
  StoryShot,
} from "@/features/storyAgent/types";
import type { StoryTimelineItem } from "@shared/storyMaterial";
import type { VideoTakeAsset, VideoTakeStatus } from "@shared/videoAsset";
import type {
  PromptOverrides,
  PromptRunRecord,
} from "./promptTable/types";

export type CreationEditorStory = {
  id: number;
  title: string;
  logline?: string | null;
};

export type CreationEditorImage = {
  id: number;
  shotNo: number | null;
  shotIdentity?: string | null;
  imageUrl: string;
  prompt?: string | null;
  status?: "selected" | "pending" | "rejected";
  isCurrent?: boolean;
  isPrimary?: boolean;
  generationType?: "generate" | "initial" | "inpaint";
  selectionSource?: "explicit" | "legacy" | "none";
};

export type CreationEditorShot = StoryShot & {
  shotKey: string;
  imageId?: number;
  imageUrl?: string;
  imagePrompt?: string | null;
  imageSelectionSource?: CreationEditorImage["selectionSource"];
  imageIsPrimary?: boolean;
  imageVersions?: CreationEditorImage[];
  videoTakes?: VideoTakeAsset[];
  selectedVideoTake?: VideoTakeAsset;
  timelineItem?: StoryTimelineItem | null;
  durationMs?: number;
  narrativeJob?: NarrativeJob;
  promptOverrides?: PromptOverrides;
  promptRun?: PromptRunRecord;
  downstreamStale?: boolean;
};

export type CreationEditorError = {
  message: string;
};

export type ImportedStoryMaterialResult =
  | {
      kind: "image";
      imageId: number;
      imageUrl: string;
    }
  | {
      kind: "video";
      takeId: number;
      videoUrl: string;
      stableShotId: string;
      plannedDurationSec: number;
    };

export type StoryImageMaterialAdvice = {
  imageId: number;
  imageUrl: string;
  verdict: "use" | "maybe" | "skip";
  reason: string;
  targetShotNo: number | null;
  targetStableShotId: string | null;
  videoDirection: {
    videoPrompt: string;
    cameraMove: string;
    durationSec: number;
    motion: "low" | "high";
    emotionalTone: string;
  } | null;
  note?: string;
};

export type StoryImageAdviceResult =
  | {
      status: "ok";
      advices: StoryImageMaterialAdvice[];
      modelLabel: string;
    }
  | { status: "not_configured" | "error"; message: string };

export type VideoConformBatchResult = {
  status: "ok" | "partial" | "error";
  acceptedCount: number;
  completedCount: number;
  availableCount: number;
  processingCount: number;
  failedCount: number;
  results: Array<
    | {
        status: "ok";
        sourceTakeId: number;
        stableShotId: string;
        takeId: number;
        videoStatus: VideoTakeStatus;
      }
    | {
        status: "error";
        sourceTakeId: number;
        stableShotId: string;
        error: string;
      }
  >;
};
