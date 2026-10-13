export type NewStorySession = { storyId: number | null; draft: string };
export const emptyNewStorySession = (): NewStorySession => ({
  storyId: null,
  draft: "",
});
export const newStorySessionKey = (userId: number) =>
  `dt:mobile:new-story:v1:${userId}:session`;
export function readNewStorySession(
  storage: Pick<Storage, "getItem"> | null,
  userId: number
): NewStorySession {
  try {
    const data = JSON.parse(
      storage?.getItem(newStorySessionKey(userId)) ?? "null"
    );
    if (
      data &&
      (data.storyId === null ||
        (Number.isSafeInteger(data.storyId) && data.storyId > 0)) &&
      typeof data.draft === "string"
    )
      return { storyId: data.storyId, draft: data.draft };
  } catch {
    /* Storage is optional. */
  }
  return emptyNewStorySession();
}
export function canStartAnotherStory(input: {
  busy: boolean;
  draft: string;
  unsynced: boolean;
}) {
  return !input.busy && !input.draft.trim() && !input.unsynced;
}
