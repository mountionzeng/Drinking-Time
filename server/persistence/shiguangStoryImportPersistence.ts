import type { InsertStory, Story } from "../../drizzle/schema";
import { createStory, findShiguangImportedStory } from "../db";

/** Persistence boundary for immutable story snapshots imported from 拾光家忆. */
export async function findImportedShiguangStory(input: {
  userId: number;
  sourceKey: string;
  sourceRevision: string;
}): Promise<Story | null> {
  return findShiguangImportedStory(
    input.userId,
    input.sourceKey,
    input.sourceRevision
  );
}

export async function createImportedShiguangStory(
  story: InsertStory
): Promise<{ id: number }> {
  return createStory(story);
}
