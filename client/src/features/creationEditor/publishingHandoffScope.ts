import type { PublishingDraftState } from "@shared/publishingDraft";
import { normalizePublishingDraftState } from "@shared/publishingDraft";
import { scopeKeysEqual, type ScopeKey } from "@shared/scopedResource";
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

function storyScope(storyId: number): ScopeKey {
  return { resourceKind: "story", storyId };
}

/**
 * 用途：按 Story ScopeKey 合并 spine 草稿、服务端 publishing 读投影与旧
 *   Story body 三个来源，拒绝任何跨 Story 或跨版本的发布状态串台。三个来源
 *   的 scope 比较统一走 `scopeKeysEqual`，不再各自手写 `=== activeStoryId`，
 *   避免只改一侧字段时漏掉另一侧比较。
 * 调用入口：Story Agent / Creation Editor 渲染发布工作台前，用当前
 *   activeStoryId 和各来源数据调用本函数得到唯一权威的合并结果。
 * 下游调用：@shared/scopedResource.ts 的 scopeKeysEqual；
 *   publishingVideoHandoff.ts 的 latestPublishingDraftState。
 */
export function resolveScopedPublishingHandoff(input: {
  activeStoryId: number;
  spinePublishing: PublishingDraftState | null;
  story: StoryPublishingSource | null | undefined;
  publishingRead: PublishingReadSource | null | undefined;
}): {
  publishing: PublishingDraftState;
  coverAsset: PublishingVideoCover | null;
} {
  const activeScope = storyScope(input.activeStoryId);
  const storyBody =
    input.story?.id != null &&
    scopeKeysEqual(storyScope(input.story.id), activeScope) &&
    input.story.body &&
    typeof input.story.body === "object" &&
    !Array.isArray(input.story.body)
      ? (input.story.body as Record<string, unknown>)
      : {};
  const scopedRead =
    input.publishingRead?.storyId != null &&
    scopeKeysEqual(storyScope(input.publishingRead.storyId), activeScope)
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
