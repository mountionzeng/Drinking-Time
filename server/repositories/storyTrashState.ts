import { eq } from "drizzle-orm";
import { accountMemorySpaces } from "../../drizzle/schema";
import { memorySpaceStateSchema } from "../../shared/memorySpace";
import { getDb, memoryState } from "./runtime";

/** The account row is the shared durable source for desktop and mobile trash. */
export async function readTrashedStories(owner: number): Promise<Record<string, number>> {
  const db = await getDb();
  const row = db
    ? (await db.select({ state: accountMemorySpaces.state }).from(accountMemorySpaces)
        .where(eq(accountMemorySpaces.userId, owner)).limit(1))[0]
    : memoryState.accountMemorySpaces.find(item => item.userId === owner);
  return row ? memorySpaceStateSchema.pick({ trashedStories: true }).parse(row.state).trashedStories : {};
}
