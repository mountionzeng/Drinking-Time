import type { InsertStory } from "../../drizzle/schema";
import {
  getStoryById,
  updateStoryBodyIfRevision,
} from "../db";
import { getStoryRevision } from "./storySync";

export type PersistedStory = NonNullable<
  Awaited<ReturnType<typeof getStoryById>>
>;

export async function getOwnedStory(
  storyId: number,
  userId: number
): Promise<PersistedStory | null> {
  return getStoryById(storyId, userId);
}

export class StoryBodyOwnershipError extends Error {
  constructor(readonly storyId: number) {
    super(`Story ${storyId} was not found for this owner`);
    this.name = "StoryBodyOwnershipError";
  }
}

export class StoryBodyRevisionConflictError extends Error {
  constructor(
    readonly storyId: number,
    readonly expectedRevision: number,
    readonly latestStory: PersistedStory
  ) {
    super(
      `Story ${storyId} revision conflict: expected ${expectedRevision}, found ${getStoryRevision(latestStory.body)}`
    );
    this.name = "StoryBodyRevisionConflictError";
  }
}

export async function persistPreparedStoryBody(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  body: unknown;
  data?: Omit<Partial<InsertStory>, "body">;
}): Promise<PersistedStory> {
  const before = await getStoryById(input.storyId, input.userId);
  if (!before) throw new StoryBodyOwnershipError(input.storyId);
  const won = await updateStoryBodyIfRevision({
    id: input.storyId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    body: input.body,
    data: input.data,
  });
  if (!won) {
    const latest = await getStoryById(input.storyId, input.userId);
    if (!latest) throw new StoryBodyOwnershipError(input.storyId);
    throw new StoryBodyRevisionConflictError(
      input.storyId,
      input.expectedRevision,
      latest
    );
  }

  // Do not read the row again after winning CAS: another writer may have
  // legitimately committed immediately afterwards, and that read would make
  // this operation report the competitor's body as its own result. The
  // pre-write snapshot supplies stable row metadata while the exact body/data
  // below are the values this CAS actually committed.
  const updated = {
    ...before,
    body: input.body,
    updatedAt: new Date(),
  } as PersistedStory;
  if (input.data) {
    for (const [key, value] of Object.entries(input.data)) {
      if (value !== undefined) {
        (updated as Record<string, unknown>)[key] = value;
      }
    }
  }
  return updated;
}
