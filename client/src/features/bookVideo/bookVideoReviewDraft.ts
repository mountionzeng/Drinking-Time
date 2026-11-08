import type { BookVideoRecord } from "@shared/bookVideoCreation";

type ReviewDraft = {
  recordId: string;
  revision: number;
  preview: NonNullable<BookVideoRecord["preview"]>;
};
// Transient session drafts survive changing stories; no business record is written until Save.
const drafts = new Map<string, ReviewDraft>();
const key = (storyId: number, accountId: number | null) =>
  `${accountId}:${storyId}`;
export const readReviewDraft = (storyId: number, accountId: number | null) =>
  drafts.get(key(storyId, accountId));
export function rememberReviewDraft(
  storyId: number,
  accountId: number | null,
  draft: ReviewDraft
) {
  drafts.set(key(storyId, accountId), draft);
}
export function clearReviewDraft(storyId: number, accountId: number | null) {
  drafts.delete(key(storyId, accountId));
}
