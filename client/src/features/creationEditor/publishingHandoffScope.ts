import type { PublishingDraftState } from "@shared/publishingDraft";
import { normalizePublishingDraftState } from "@shared/publishingDraft";
import {
  latestPublishingDraftState,
  type PublishingVideoCover,
} from "@/features/publishingDraft/publishingVideoHandoff";

type StoryPublishingSource = {
  id: number;
  body?: unknown;
};

type PublishingReadSource = {
  storyId: number;
  publishing: PublishingDraftState;
  coverAsset: PublishingVideoCover | null;
};

export function resolveScopedPublishingHandoff(input: {
  activeStoryId: number;
  spinePublishing: PublishingDraftState | null;
  story: StoryPublishingSource | null | undefined;
  publishingRead: PublishingReadSource | null | undefined;
}): {
  publishing: PublishingDraftState;
  coverAsset: PublishingVideoCover | null;
} {
  const storyBody =
    input.story?.id === input.activeStoryId &&
    input.story.body &&
    typeof input.story.body === "object" &&
    !Array.isArray(input.story.body)
      ? (input.story.body as Record<string, unknown>)
      : {};
  const scopedRead =
    input.publishingRead?.storyId === input.activeStoryId
      ? input.publishingRead
      : null;
  const publishing = latestPublishingDraftState([
    input.spinePublishing,
    scopedRead?.publishing,
    normalizePublishingDraftState(storyBody.publishing),
  ]);
  const readVersionId = scopedRead?.publishing.activeVersionId ?? "v1";
  const activeVersionId = publishing.activeVersionId ?? "v1";
  return {
    publishing,
    coverAsset:
      scopedRead && readVersionId === activeVersionId
        ? scopedRead.coverAsset
        : null,
  };
}
