/** Public mailbox values deliberately contain no account ids or share tokens. */
export type MailboxInventory = {
  chapters: number;
  images: number;
  videos: number;
  audio: number;
  timelineItems: number;
  bookVersions: number;
  chapterVersions: number;
  videoVersions: number;
  exports: number;
};
export type MailboxChange = {
  kind: keyof MailboxInventory | "text" | "editing";
  added?: number;
  removed?: number;
  updated?: number;
  names?: string[];
};
export type MailboxEntry = {
  id: string;
  threadId: string;
  kind: "sent" | "updated" | "received";
  authorName: string;
  mine: boolean;
  createdAt: string;
  title: string;
  note: string;
  inventory: MailboxInventory;
  changes: MailboxChange[];
  ownStoryId: number | null;
  receivedStoryId: number | null;
  unread: boolean;
};
export type MailboxContact = {
  id: string;
  name: string;
  removed: boolean;
  unread: number;
};
export const OPEN_STORY_MAILBOX = "dt:open-story-mailbox";
export function mailboxChanges(
  before: MailboxInventory | undefined,
  after: MailboxInventory
): MailboxChange[] {
  const changes: MailboxChange[] = [];
  for (const key of Object.keys(after) as Array<keyof MailboxInventory>) {
    const delta = after[key] - (before?.[key] ?? 0);
    if (delta > 0) changes.push({ kind: key, added: delta });
    if (delta < 0) changes.push({ kind: key, removed: -delta });
  }
  return changes;
}
