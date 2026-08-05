import {
  PUBLISHING_PLATFORM_IDS,
  buildXPublishableText,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformDraft,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import {
  getPublishingBuffer,
  type PublishingDraftBufferMap,
} from "@/features/storyAgent/storyAgentPersistence";

export type PublishingDraftStatus = {
  tone: "saved" | "editing" | "review";
  label: string;
};

export function publishingErrorMessage(
  error: unknown,
  fallback: string
): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    return fallback.includes("封面")
      ? "本地服务未连接，图片任务没有提交，也不会扣费。恢复服务后再试一次。"
      : "本地服务未连接，请恢复服务后重试；当前内容仍然保留。";
  }
  return message || fallback;
}

export function publishingStoryScopeMatches(
  requestStoryId: number,
  activeStoryId: number | null
): boolean {
  return requestStoryId === activeStoryId;
}

export function publishingContentEquals(
  left: PublishingDraftContent,
  right: PublishingDraftContent
): boolean {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

export function existingPublishingTabs(
  state: PublishingDraftState
): PublishingPlatformId[] {
  return PUBLISHING_PLATFORM_IDS.filter(platform =>
    Boolean(state.drafts[platform])
  );
}

export function publishingConvertTargets(
  state: PublishingDraftState
): PublishingPlatformId[] {
  return state.selectedPlatforms.filter(
    platform => platform !== state.activePlatform && !state.drafts[platform]
  );
}

export function updatePublishingSelection(
  state: PublishingDraftState,
  selection: {
    activePlatform: PublishingPlatformId;
    selectedPlatforms: PublishingPlatformId[];
  }
): PublishingDraftState {
  const selectedPlatforms = Array.from(
    new Set([selection.activePlatform, ...selection.selectedPlatforms])
  );
  return {
    ...state,
    activePlatform: selection.activePlatform,
    selectedPlatforms,
    updatedAt: Date.now(),
  };
}

export function getPublishingEditorContent(params: {
  state: PublishingDraftState;
  buffers: PublishingDraftBufferMap;
  storyId: number;
  platform: PublishingPlatformId;
}): PublishingDraftContent | null {
  const buffered = getPublishingBuffer(
    params.buffers,
    params.storyId,
    params.platform
  );
  return (
    buffered?.content ?? params.state.drafts[params.platform]?.content ?? null
  );
}

export function getPublishingStatus(
  draft: PublishingPlatformDraft,
  dirty: boolean
): PublishingDraftStatus {
  if (dirty) return { tone: "editing", label: "有未应用修改" };
  if (draft.needsReview) {
    return { tone: "review", label: "内核已变化，建议复核" };
  }
  return { tone: "saved", label: "已保存" };
}

export function buildPublishableText(
  content: PublishingDraftContent,
  platform?: PublishingPlatformId
): string {
  if (platform === "x") return buildXPublishableText(content);
  const sections = [content.title.trim(), content.body.trim()];
  const tags = content.tags
    .map(tag => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map(tag => `#${tag}`)
    .join(" ");
  if (tags) sections.push(tags);
  return sections.filter(Boolean).join("\n\n");
}
