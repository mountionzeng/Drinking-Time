import { and, eq, sql } from "drizzle-orm";
import { accountIdentities, storyChapters } from "../../drizzle/schema";
import { getDb, memoryState } from "./runtime";

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
