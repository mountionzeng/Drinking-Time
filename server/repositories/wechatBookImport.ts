import { and, eq, inArray, sql } from "drizzle-orm";
import { accountIdentities, chapterImports, generatedImages, stories, storyChapters } from "../../drizzle/schema";
import { getDb, memoryState, nextMemoryId, now, persistMemoryState, withLocalAggregateMutationLock } from "./runtime";

/** The browser never supplies a WeChat identity, appid, openid or grant. */
export async function wechatImportSubject(
  userId: number
): Promise<string | null> {
  const db = await getDb();
  const rows = db
    ? await db
        .select({ subject: accountIdentities.subject })
        .from(accountIdentities)
        .where(
          and(
            eq(accountIdentities.userId, userId),
            eq(accountIdentities.provider, "wechat")
          )
        )
    : memoryState.accountIdentities.filter(
        r => r.userId === userId && r.provider === "wechat"
      );
  const subjects = [
    ...new Set(
      rows.map(r => r.subject).filter(s => /^shiguang:[a-f0-9]{64}$/.test(s))
    ),
  ];
  // Ambiguous linked identities need an explicit account choice, never guess.
  if (subjects.length > 1) throw new Error("wechat_import_identity_ambiguous");
  return subjects[0] ?? null;
}

export async function ownsWechatImportImage(userId: number, key: string) {
  const db = await getDb();
  if (db) {
    const imagePath = `$.images.${JSON.stringify(key)}`;
    const rows = await db
      .select({ id: storyChapters.id })
      .from(storyChapters)
      .where(
        and(
          eq(storyChapters.userId, userId),
          sql`JSON_EXTRACT(${storyChapters.blocks}, '$.wechatImport') IS NOT NULL`,
          sql`JSON_EXTRACT(${storyChapters.blocks}, ${imagePath}) IS NOT NULL`
        )
      )
      .limit(1);
    return rows.length > 0;
  }
  return memoryState.storyChapters.some(
    r =>
      r.userId === userId &&
      Boolean(r.blocks.wechatImport && r.blocks.images[key])
  );
}

/** Catalog markers use receipts even when the imported copy has been deleted. */
export async function wechatImportedStoryIds(
  userId: number,
  requestIds: string[]
): Promise<Map<string, number>> {
  if (!requestIds.length) return new Map();
  const db = await getDb();
  if (db) {
    const rows = await db
      .select({ requestId: chapterImports.requestId, storyId: chapterImports.storyId })
      .from(chapterImports)
      .where(and(eq(chapterImports.userId, userId), inArray(chapterImports.requestId, requestIds)));
    return new Map(rows.map(row => [row.requestId, row.storyId]));
  }
  const requested = new Set(requestIds);
  return new Map(memoryState.chapterImports
    .filter(row => row.userId === userId && requested.has(row.requestId))
    .map(row => [row.requestId, row.storyId]));
}

/** Atomically index verified URLs without adopting them or duplicating imports. */
export async function indexWechatStoryboardImageUrls(input: { storyId: number; userId: number; urls: string[] }) {
  const { urls } = input;
  if (!urls.length) return;
  const db = await getDb();
  if (db) {
    await db.transaction(async tx => {
      const owner = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        )
        .for("update");
      if (!owner.length) throw new Error("故事不存在或无权访问");
      for (const url of urls) {
        const existing = await tx
          .select({ id: generatedImages.id })
          .from(generatedImages)
          .where(
            and(
              eq(generatedImages.storyId, input.storyId),
              eq(generatedImages.userId, input.userId),
              eq(generatedImages.imageUrl, url)
            )
          )
          .limit(1);
        if (!existing.length)
          await tx.insert(generatedImages).values({
            storyId: input.storyId,
            userId: input.userId,
            imageUrl: url,
            isCurrent: false,
            generationType: "initial",
          });
      }
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    if (
      !memoryState.stories.some(
        s => s.id === input.storyId && s.userId === input.userId
      )
    )
      throw new Error("故事不存在或无权访问");
    const added: number[] = [];
    try {
      for (const url of urls) {
        if (
          memoryState.generatedImages.some(
            i =>
              i.storyId === input.storyId &&
              i.userId === input.userId &&
              i.imageUrl === url
          )
        )
          continue;
        const id = nextMemoryId("generatedImage");
        memoryState.generatedImages.push({
          id,
          storyId: input.storyId,
          userId: input.userId,
          imageUrl: url,
          projectId: null,
          shotNo: null,
          shotIdentity: null,
          imageKey: null,
          prompt: null,
          promptCompilationId: null,
          parentImageId: null,
          isCurrent: false,
          generationType: "initial",
          maskKey: null,
          createdAt: now(),
        });
        added.push(id);
      }
      if (added.length) await persistMemoryState();
    } catch (error) {
      memoryState.generatedImages = memoryState.generatedImages.filter(
        i => !added.includes(i.id)
      );
      throw error;
    }
  });
}
