import { createHash } from "node:crypto";
import type { Story } from "../../drizzle/schema";
import {
  normalizePublishingDraftState,
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingPlatformId,
  resolvePublishingActiveVersion,
} from "../../shared/publishingDraft";
import { readTextDraftHistory } from "../../shared/textDraftHistory";
import { readSharedLayoutState } from "../../shared/sharedLayout";
import type { MemoryReading } from "../../shared/memorySpace";

/** Only explicit display fields leave this projection. Stable legacy timestamps use zero. */
export function projectMemoryStory(
  story: Pick<Story, "id" | "title" | "body">
) {
  const body = (story.body ?? {}) as Record<string, unknown>;
  const publishing = normalizePublishingDraftState(body.publishing, 0);
  const active = resolvePublishingActiveVersion(publishing);
  const versions: MemoryReading["versions"] = [];
  const published = publishing.versions ?? [active];
  for (const version of [...published].sort(
    (a, b) =>
      Number(b.versionId === active.versionId) -
      Number(a.versionId === active.versionId)
  )) {
    for (const [platform, draft] of Object.entries(version.drafts)) {
      if (!draft?.content.body.trim()) continue;
      versions.push({
        id: `published:${version.versionId}:${PUBLISHING_PLATFORM_REGISTRY[platform as PublishingPlatformId].label}`,
        title: draft.content.title,
        body: draft.content.body,
        label: `${version.displayName} · ${PUBLISHING_PLATFORM_REGISTRY[platform as PublishingPlatformId].label}${version.versionId === active.versionId ? " · 当前版本" : ""}`,
        updatedAt: draft.updatedAt || null,
        author: null,
      });
    }
  }
  const participants: MemoryReading["participants"] = [];
  const accounts: { accountId: number; name: string }[] = [];
  let pending = 0;
  // Corrupt history must be visible as an error rather than a false empty library.
  const history = readTextDraftHistory(body.textDraftHistory);
  for (const version of history.versions) {
    if (version.contribution) {
      accounts.push({
        accountId: version.contribution.userId,
        name: version.contribution.authorName,
      });
      participants.push({
        name: version.contribution.authorName,
        kind: "text",
        at: version.createdAt,
        status: version.adoption
          ? "已采用"
          : version.status === "ready"
            ? "待作者确认"
            : "未完成",
      });
      if (version.status === "ready" && !version.adoption) pending++;
    }
    if (version.status === "ready" && version.generated)
      versions.push({
        id: `draft:${version.id}`,
        title: version.generated.title,
        body: version.generated.body,
        label: version.adoption
          ? "已采用的候选"
          : version.contribution
            ? "朋友分享的候选 · 待确认"
            : "文字候选",
        updatedAt: version.completedAt ?? version.createdAt,
        author: version.contribution?.authorName ?? null,
      });
  }
  const layout = readSharedLayoutState(body.sharedLayout);
  for (const candidate of layout.candidates) {
    accounts.push({
      accountId: candidate.contributorUserId,
      name: candidate.authorName,
    });
    participants.push({
      name: candidate.authorName,
      kind: "layout",
      at: candidate.createdAt,
      status: { pending: "待作者确认", adopted: "已采用", dismissed: "已忽略" }[
        candidate.status
      ],
    });
    if (candidate.status === "pending") pending++;
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ title: story.title, versions, participants }))
    .digest("hex");
  const timestamps = [
    ...versions.map(v => v.updatedAt ?? 0),
    ...participants.map(p => p.at),
  ];
  const reading: MemoryReading = {
    storyId: story.id,
    title: story.title || "未命名故事",
    fingerprint,
    versions,
    participants: participants.sort((a, b) => b.at - a.at),
  };
  return {
    reading,
    accounts,
    pending,
    updatedAt: Math.max(0, ...timestamps) || null,
  };
}
