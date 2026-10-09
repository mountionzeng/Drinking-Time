import { and, eq } from "drizzle-orm";
import {
  phoneLoginChallenges,
  type PhoneLoginChallenge,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

export async function replacePhoneChallenge(row: PhoneLoginChallenge) {
  const db = await getDb();
  if (db) {
    await db
      .insert(phoneLoginChallenges)
      .values(row)
      .onDuplicateKeyUpdate({ set: row });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const index = memoryState.phoneLoginChallenges.findIndex(
      item => item.phone === row.phone
    );
    if (index < 0) memoryState.phoneLoginChallenges.push(row);
    else memoryState.phoneLoginChallenges[index] = row;
    await persistMemoryState();
  });
}

/** Activate only after provider acceptance; late send results cannot activate a newer code. */
export async function markPhoneChallengeSent(
  phone: string,
  challengeId: string
) {
  const db = await getDb();
  const sentAt = new Date();
  if (db) {
    await db
      .update(phoneLoginChallenges)
      .set({ sentAt })
      .where(
        and(
          eq(phoneLoginChallenges.phone, phone),
          eq(phoneLoginChallenges.challengeId, challengeId)
        )
      );
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const row = memoryState.phoneLoginChallenges.find(
      item => item.phone === phone && item.challengeId === challengeId
    );
    if (row) {
      row.sentAt = sentAt;
      await persistMemoryState();
    }
  });
}

/** A row lock serializes guesses, consumption and replacement across server processes. */
export async function consumePhoneChallenge(
  phone: string,
  verify: (row: PhoneLoginChallenge) => boolean
) {
  const db = await getDb();
  const decide = (row: PhoneLoginChallenge | undefined) => {
    const now = new Date();
    if (
      !row ||
      !row.sentAt ||
      row.consumedAt ||
      row.expiresAt <= now ||
      row.attemptCount >= 5
    )
      return null;
    const valid = verify(row);
    return {
      valid,
      changes: {
        attemptCount: row.attemptCount + 1,
        consumedAt: valid ? now : null,
      },
    };
  };
  if (db)
    return db.transaction(async tx => {
      const [row] = await tx
        .select()
        .from(phoneLoginChallenges)
        .where(eq(phoneLoginChallenges.phone, phone))
        .for("update");
      const result = decide(row);
      if (!result) return false;
      await tx
        .update(phoneLoginChallenges)
        .set(result.changes)
        .where(eq(phoneLoginChallenges.phone, phone));
      return result.valid;
    });
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.phoneLoginChallenges.find(
      item => item.phone === phone
    );
    const result = decide(row);
    if (!result || !row) return false;
    Object.assign(row, result.changes);
    await persistMemoryState();
    return result.valid;
  });
}
