/** Persistence operations for soundPlans. Local and MySQL behavior share this boundary. */
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  stories,
  storySoundWorkspaces,
  StorySoundWorkspaceRecord,
  storySoundPlanVersions,
  StorySoundPlanVersionRecord,
  storySoundRowOperations,
  StorySoundRowOperationRecord,
  storyVoiceProfiles,
  StoryVoiceProfileRecord,
  storyVoiceActivationOperations,
  StoryVoiceActivationOperationRecord,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

let storySoundMemoryMutationTail: Promise<void> = Promise.resolve();

async function withStorySoundMemoryLock<T>(
  action: () => Promise<T>
): Promise<T> {
  const previous = storySoundMemoryMutationTail;
  let release!: () => void;
  storySoundMemoryMutationTail = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

export async function getStorySoundWorkspaceRecord(
  storyId: number,
  userId: number
) {
  const db = await getDb();
  if (!db)
    return (
      memoryState.storySoundWorkspaces.find(
        row => row.storyId === storyId && row.userId === userId
      ) ?? null
    );
  return (
    (
      await db
        .select()
        .from(storySoundWorkspaces)
        .where(
          and(
            eq(storySoundWorkspaces.storyId, storyId),
            eq(storySoundWorkspaces.userId, userId)
          )
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function compareAndSaveStorySoundWorkspaceRecord(
  input: Omit<
    StorySoundWorkspaceRecord,
    "id" | "createdAt" | "updatedAt" | "revision"
  > & { expectedRevision: number }
): Promise<StorySoundWorkspaceRecord | null> {
  const { expectedRevision, ...values } = input;
  const db = await getDb();
  if (!db)
    return withStorySoundMemoryLock(async () => {
      if (
        !memoryState.stories.some(
          story => story.id === input.storyId && story.userId === input.userId
        )
      )
        return null;
      const existing = memoryState.storySoundWorkspaces.find(
        row => row.storyId === input.storyId && row.userId === input.userId
      );
      if ((existing?.revision ?? 0) !== expectedRevision) return null;
      const current = now();
      const row: StorySoundWorkspaceRecord = existing
        ? {
            ...existing,
            ...values,
            revision: existing.revision + 1,
            updatedAt: current,
          }
        : {
            id: nextMemoryId("storySoundWorkspace"),
            storyId: input.storyId,
            userId: input.userId,
            revision: 1,
            interviewStatus: input.interviewStatus,
            currentStepId: input.currentStepId ?? null,
            restoredFromVersionId: input.restoredFromVersionId ?? null,
            interviewState: input.interviewState ?? null,
            draft: input.draft,
            selectionByRowId: input.selectionByRowId,
            createdAt: current,
            updatedAt: current,
          };
      if (existing) Object.assign(existing, row);
      else memoryState.storySoundWorkspaces.push(row);
      await persistMemoryState();
      return structuredClone(row);
    });
  return db.transaction(async tx => {
    const story = (
      await tx
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        )
        .limit(1)
    )[0];
    if (!story) return null;
    if (expectedRevision === 0) {
      try {
        const result = await tx
          .insert(storySoundWorkspaces)
          .values({ ...values, revision: 1 });
        const id = Number(result[0].insertId);
        return (
          (
            await tx
              .select()
              .from(storySoundWorkspaces)
              .where(eq(storySoundWorkspaces.id, id))
              .limit(1)
          )[0] ?? null
        );
      } catch {
        return null;
      }
    }
    const result = await tx
      .update(storySoundWorkspaces)
      .set({ ...values, revision: expectedRevision + 1 })
      .where(
        and(
          eq(storySoundWorkspaces.storyId, input.storyId),
          eq(storySoundWorkspaces.userId, input.userId),
          eq(storySoundWorkspaces.revision, expectedRevision)
        )
      );
    if (result[0].affectedRows !== 1) return null;
    return (
      (
        await tx
          .select()
          .from(storySoundWorkspaces)
          .where(
            and(
              eq(storySoundWorkspaces.storyId, input.storyId),
              eq(storySoundWorkspaces.userId, input.userId)
            )
          )
          .limit(1)
      )[0] ?? null
    );
  });
}

export async function listStorySoundPlanVersionRecords(
  storyId: number,
  userId: number
) {
  const db = await getDb();
  if (!db)
    return memoryState.storySoundPlanVersions
      .filter(row => row.storyId === storyId && row.userId === userId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map(row => structuredClone(row));
  return db
    .select()
    .from(storySoundPlanVersions)
    .where(
      and(
        eq(storySoundPlanVersions.storyId, storyId),
        eq(storySoundPlanVersions.userId, userId)
      )
    )
    .orderBy(storySoundPlanVersions.versionNumber);
}

export async function getStorySoundPlanVersionRecord(
  publicId: string,
  storyId: number,
  userId: number
) {
  const db = await getDb();
  if (!db)
    return structuredClone(
      memoryState.storySoundPlanVersions.find(
        row =>
          row.publicId === publicId &&
          row.storyId === storyId &&
          row.userId === userId
      ) ?? null
    );
  return (
    (
      await db
        .select()
        .from(storySoundPlanVersions)
        .where(
          and(
            eq(storySoundPlanVersions.publicId, publicId),
            eq(storySoundPlanVersions.storyId, storyId),
            eq(storySoundPlanVersions.userId, userId)
          )
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function getOrCreateStorySoundPlanVersionRecord(
  input: Omit<
    StorySoundPlanVersionRecord,
    "id" | "publicId" | "versionNumber" | "createdAt"
  >
): Promise<StorySoundPlanVersionRecord> {
  const db = await getDb();
  if (!db)
    return withStorySoundMemoryLock(async () => {
      const duplicate = memoryState.storySoundPlanVersions.find(
        row =>
          row.storyId === input.storyId &&
          row.userId === input.userId &&
          row.contentDigest === input.contentDigest &&
          row.evidenceSnapshotDigest === input.evidenceSnapshotDigest
      );
      if (duplicate) return structuredClone(duplicate);
      if (
        !memoryState.stories.some(
          story => story.id === input.storyId && story.userId === input.userId
        )
      )
        throw new Error("Story not found");
      const number =
        Math.max(
          0,
          ...memoryState.storySoundPlanVersions
            .filter(
              row =>
                row.storyId === input.storyId && row.userId === input.userId
            )
            .map(row => row.versionNumber)
        ) + 1;
      const id = nextMemoryId("storySoundPlanVersion");
      const row: StorySoundPlanVersionRecord = {
        ...input,
        id,
        publicId: `sound-version-${id}`,
        versionNumber: number,
        createdAt: now(),
      };
      memoryState.storySoundPlanVersions.push(row);
      await persistMemoryState();
      return structuredClone(row);
    });
  return db.transaction(async tx => {
    const duplicate = (
      await tx
        .select()
        .from(storySoundPlanVersions)
        .where(
          and(
            eq(storySoundPlanVersions.storyId, input.storyId),
            eq(storySoundPlanVersions.userId, input.userId),
            eq(storySoundPlanVersions.contentDigest, input.contentDigest),
            eq(
              storySoundPlanVersions.evidenceSnapshotDigest,
              input.evidenceSnapshotDigest
            )
          )
        )
        .limit(1)
    )[0];
    if (duplicate) return duplicate;
    const [{ nextVersion }] = await tx
      .select({
        nextVersion: sql<number>`COALESCE(MAX(${storySoundPlanVersions.versionNumber}), 0) + 1`,
      })
      .from(storySoundPlanVersions)
      .where(
        and(
          eq(storySoundPlanVersions.storyId, input.storyId),
          eq(storySoundPlanVersions.userId, input.userId)
        )
      )
      .for("update");
    const publicId = randomUUID();
    try {
      await tx
        .insert(storySoundPlanVersions)
        .values({ ...input, publicId, versionNumber: Number(nextVersion) });
    } catch {
      const raced = (
        await tx
          .select()
          .from(storySoundPlanVersions)
          .where(
            and(
              eq(storySoundPlanVersions.storyId, input.storyId),
              eq(storySoundPlanVersions.userId, input.userId),
              eq(storySoundPlanVersions.contentDigest, input.contentDigest),
              eq(
                storySoundPlanVersions.evidenceSnapshotDigest,
                input.evidenceSnapshotDigest
              )
            )
          )
          .limit(1)
      )[0];
      if (raced) return raced;
      throw new Error("Failed to create sound plan version");
    }
    return (
      await tx
        .select()
        .from(storySoundPlanVersions)
        .where(eq(storySoundPlanVersions.publicId, publicId))
        .limit(1)
    )[0]!;
  });
}

export async function getOrCreateStorySoundRowOperationRecord(
  input: Omit<
    StorySoundRowOperationRecord,
    | "id"
    | "publicId"
    | "storyIdSnapshot"
    | "tombstonedAt"
    | "createdAt"
    | "updatedAt"
  > & { storyId: number }
): Promise<StorySoundRowOperationRecord> {
  const db = await getDb();
  if (!db)
    return withStorySoundMemoryLock(async () => {
      const existing = memoryState.storySoundRowOperations.find(
        row =>
          row.userId === input.userId &&
          row.storyIdSnapshot === input.storyId &&
          row.rowId === input.rowId &&
          row.requestDigest === input.requestDigest
      );
      if (existing) return structuredClone(existing);
      const version = memoryState.storySoundPlanVersions.find(
        row =>
          row.publicId === input.versionId &&
          row.storyId === input.storyId &&
          row.userId === input.userId
      );
      if (!version) throw new Error("Owned sound plan version not found");
      const id = nextMemoryId("storySoundRowOperation"),
        current = now();
      const row: StorySoundRowOperationRecord = {
        ...input,
        id,
        publicId: `sound-row-operation-${id}`,
        storyIdSnapshot: input.storyId,
        tombstonedAt: null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.storySoundRowOperations.push(row);
      await persistMemoryState();
      return structuredClone(row);
    });
  return db.transaction(async tx => {
    const existing = (
      await tx
        .select()
        .from(storySoundRowOperations)
        .where(
          and(
            eq(storySoundRowOperations.userId, input.userId),
            eq(storySoundRowOperations.storyIdSnapshot, input.storyId),
            eq(storySoundRowOperations.rowId, input.rowId),
            eq(storySoundRowOperations.requestDigest, input.requestDigest)
          )
        )
        .limit(1)
    )[0];
    if (existing) return existing;
    const version = (
      await tx
        .select({ id: storySoundPlanVersions.id })
        .from(storySoundPlanVersions)
        .where(
          and(
            eq(storySoundPlanVersions.publicId, input.versionId),
            eq(storySoundPlanVersions.storyId, input.storyId),
            eq(storySoundPlanVersions.userId, input.userId)
          )
        )
        .limit(1)
    )[0];
    if (!version) throw new Error("Owned sound plan version not found");
    const publicId = randomUUID();
    try {
      await tx
        .insert(storySoundRowOperations)
        .values({ ...input, publicId, storyIdSnapshot: input.storyId });
    } catch {
      const raced = (
        await tx
          .select()
          .from(storySoundRowOperations)
          .where(
            and(
              eq(storySoundRowOperations.userId, input.userId),
              eq(storySoundRowOperations.storyIdSnapshot, input.storyId),
              eq(storySoundRowOperations.rowId, input.rowId),
              eq(storySoundRowOperations.requestDigest, input.requestDigest)
            )
          )
          .limit(1)
      )[0];
      if (raced) return raced;
      throw new Error("Failed to create sound row operation");
    }
    return (
      await tx
        .select()
        .from(storySoundRowOperations)
        .where(eq(storySoundRowOperations.publicId, publicId))
        .limit(1)
    )[0]!;
  });
}

export async function listStorySoundRowOperationRecords(input: {
  storyIdSnapshot: number;
  userId: number;
}) {
  const db = await getDb();
  if (!db)
    return memoryState.storySoundRowOperations
      .filter(
        row =>
          row.storyIdSnapshot === input.storyIdSnapshot &&
          row.userId === input.userId
      )
      .map(row => structuredClone(row));
  return db
    .select()
    .from(storySoundRowOperations)
    .where(
      and(
        eq(storySoundRowOperations.storyIdSnapshot, input.storyIdSnapshot),
        eq(storySoundRowOperations.userId, input.userId)
      )
    );
}

export async function upsertStoryVoiceProfileRecord(input: {
  publicId: string;
  userId: number;
  profile: unknown;
}) {
  const db = await getDb();
  const current = now();
  if (!db)
    return withStorySoundMemoryLock(async () => {
      const existing = memoryState.storyVoiceProfiles.find(
        row => row.publicId === input.publicId
      );
      if (existing && existing.userId !== input.userId) {
        throw new Error("Voice profile owner mismatch");
      }
      const row: StoryVoiceProfileRecord = existing
        ? { ...existing, profile: input.profile, updatedAt: current }
        : {
            id: nextMemoryId("storyVoiceProfile"),
            ...input,
            createdAt: current,
            updatedAt: current,
          };
      if (existing) Object.assign(existing, row);
      else memoryState.storyVoiceProfiles.push(row);
      await persistMemoryState();
      return structuredClone(row);
    });
  return db.transaction(async tx => {
    const existing = (
      await tx
        .select()
        .from(storyVoiceProfiles)
        .where(eq(storyVoiceProfiles.publicId, input.publicId))
        .limit(1)
    )[0];
    if (existing && existing.userId !== input.userId) {
      throw new Error("Voice profile owner mismatch");
    }
    if (existing) {
      await tx
        .update(storyVoiceProfiles)
        .set({ profile: input.profile })
        .where(
          and(
            eq(storyVoiceProfiles.id, existing.id),
            eq(storyVoiceProfiles.userId, input.userId)
          )
        );
    } else {
      await tx.insert(storyVoiceProfiles).values(input);
    }
    return (
      await tx
        .select()
        .from(storyVoiceProfiles)
        .where(
          and(
            eq(storyVoiceProfiles.publicId, input.publicId),
            eq(storyVoiceProfiles.userId, input.userId)
          )
        )
        .limit(1)
    )[0]!;
  });
}

export async function getStoryVoiceProfileRecord(
  publicId: string,
  userId: number
) {
  const db = await getDb();
  if (!db)
    return structuredClone(
      memoryState.storyVoiceProfiles.find(
        row => row.publicId === publicId && row.userId === userId
      ) ?? null
    );
  return (
    (
      await db
        .select()
        .from(storyVoiceProfiles)
        .where(
          and(
            eq(storyVoiceProfiles.publicId, publicId),
            eq(storyVoiceProfiles.userId, userId)
          )
        )
        .limit(1)
    )[0] ?? null
  );
}

export async function getOrCreateStoryVoiceActivationOperationRecord(input: {
  profilePublicId: string;
  userId: number;
  provider: string;
  priceVersion: string;
  requestDigest: string;
}) {
  const db = await getDb();
  if (!db)
    return withStorySoundMemoryLock(async () => {
      const existing = memoryState.storyVoiceActivationOperations.find(
        row =>
          row.profilePublicId === input.profilePublicId &&
          row.userId === input.userId &&
          row.provider === input.provider &&
          row.priceVersion === input.priceVersion
      );
      if (existing) {
        if (existing.requestDigest !== input.requestDigest)
          throw new Error("Activation idempotency conflict");
        return structuredClone(existing);
      }
      const profile = memoryState.storyVoiceProfiles.find(
        row =>
          row.publicId === input.profilePublicId && row.userId === input.userId
      );
      if (!profile) throw new Error("Voice profile not found");
      const id = nextMemoryId("storyVoiceActivationOperation");
      const current = now();
      const row: StoryVoiceActivationOperationRecord = {
        id,
        publicId: `voice-activation-${id}`,
        profileId: profile.id,
        profilePublicId: profile.publicId,
        userId: input.userId,
        provider: input.provider,
        priceVersion: input.priceVersion,
        requestDigest: input.requestDigest,
        state: "prepared",
        createdAt: current,
        updatedAt: current,
      };
      memoryState.storyVoiceActivationOperations.push(row);
      await persistMemoryState();
      return structuredClone(row);
    });
  return db.transaction(async tx => {
    const existing = (
      await tx
        .select()
        .from(storyVoiceActivationOperations)
        .where(
          and(
            eq(
              storyVoiceActivationOperations.profilePublicId,
              input.profilePublicId
            ),
            eq(storyVoiceActivationOperations.userId, input.userId),
            eq(storyVoiceActivationOperations.provider, input.provider),
            eq(storyVoiceActivationOperations.priceVersion, input.priceVersion)
          )
        )
        .limit(1)
    )[0];
    if (existing) {
      if (existing.requestDigest !== input.requestDigest)
        throw new Error("Activation idempotency conflict");
      return existing;
    }
    const profile = (
      await tx
        .select()
        .from(storyVoiceProfiles)
        .where(
          and(
            eq(storyVoiceProfiles.publicId, input.profilePublicId),
            eq(storyVoiceProfiles.userId, input.userId)
          )
        )
        .limit(1)
    )[0];
    if (!profile) throw new Error("Voice profile not found");
    const publicId = randomUUID();
    await tx
      .insert(storyVoiceActivationOperations)
      .values({ ...input, publicId, profileId: profile.id, state: "prepared" });
    return (
      await tx
        .select()
        .from(storyVoiceActivationOperations)
        .where(eq(storyVoiceActivationOperations.publicId, publicId))
        .limit(1)
    )[0]!;
  });
}
