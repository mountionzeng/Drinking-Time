import type { PublishingDraftState } from "@shared/publishingDraft";
import type {
  TextDraftContent,
  TextDraftHistory,
  TextDraftMessage,
  TextDraftRequest,
} from "@shared/textDraftHistory";
import type { MemoryFollowupSource } from "./mobileMemoryFollowup";

/** Capture the visible text and publication CAS before inference; saving never refreshes away that guard. */
export function mobileTextDraftRequest(input: {
  storyId: number;
  token: string;
  history: TextDraftHistory;
  publishing: PublishingDraftState;
  source?: MemoryFollowupSource;
  messages: TextDraftMessage[];
  instruction: string;
  basisMode?: "conversation" | "current-content";
}) {
  const { publishing, source } = input;
  if (source && source.storyId !== input.storyId)
    throw new Error("故事已切换，请重新打开小忆。");
  const platform = source?.text?.platform ?? publishing.activePlatform;
  const versionId = publishing.activeVersionId ?? "v1";
  const published = publishing.drafts[platform];
  if (
    source?.text?.versionId &&
    (source.text.versionId !== versionId ||
      source.text.bodyRevision !==
        (published?.bodyRevision ?? published?.revision))
  ) {
    throw new Error("正文已在其他位置更新，请先重新读取正文。");
  }
  const basis =
    input.basisMode === "current-content" && source
      ? {
          title: source.text?.content.title ?? source.title ?? "",
          body: source.content,
          tags: source.text?.content.tags ?? [],
        }
      : (source?.text?.content ??
        (source?.kind === "text"
          ? {
              title: published?.content.title ?? source.title ?? "",
              body: source.content,
              tags: published?.content.tags ?? [],
            }
          : (published?.content ?? null)));
  const parent = publishing.versions?.find(
    v => v.versionId === versionId
  )?.textSource;
  const reference =
    source && source.kind !== "text"
      ? `本次讨论的${source.kind === "video" ? "视频记录" : "回忆"}（${source.origin === "assistant" ? "助手整理，不作为用户事实" : "来源引用"}）`
      : "";
  return {
    storyId: input.storyId,
    operationToken: input.token,
    expectedRevision: input.history.revision,
    platform,
    parentId:
      source?.text?.parentId ??
      (parent && "textDraftId" in parent ? parent.textDraftId : null),
    basis: basis?.body.trim()
      ? {
          ...basis,
          title: basis.title || published?.content.title || "",
          ...(source?.text?.versionId && !source.text.parentId
            ? { tags: published?.content.tags ?? [] }
            : {}),
        }
      : null,
    ...(source?.text?.selection ? { selection: source.text.selection } : {}),
    messages: [
      ...(reference && source
        ? [
            {
              id: `mobile-source:${source.id}`,
              role:
                source.origin === "assistant"
                  ? ("assistant" as const)
                  : ("user" as const),
              content: `【${reference}】\n${source.content}`,
            },
          ]
        : []),
      ...input.messages.slice(reference ? -199 : -200),
    ],
    instruction: [reference, input.instruction.trim()]
      .filter(Boolean)
      .join("\n\n"),
    source: "unknown" as const,
  };
}

export type MobileTextPreview = {
  token: string;
  request?: TextDraftRequest;
  versionId?: string;
  publishingRevision: number;
  publishingVersionId: string;
  baselineBody?: string;
  baselineBodyRevision?: number;
  content?: TextDraftContent;
};
export const mobileTextPreviewKey = (userId: number, storyId: number) =>
  `dt:mobile:text-preview:v1:${userId}:${storyId}`;
