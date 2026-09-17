/** Persistence operations for stories. Local and MySQL behavior share this boundary. */
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  normalizePublishingDraftState,
  resolvePublishingDisplayCoverAssetId,
} from "../../shared/publishingDraft";
import {
  InsertStory,
  stories,
  Story,
  generatedImages,
  GeneratedImage,
} from "../../drizzle/schema";
import {
  applyPersonalMemoryCapture,
  type PersonalMemoryCapture,
} from "../../shared/personalMemory";
import { isUntitledStoryTitle } from "../../shared/storyTitle";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalBodyMutation,
} from "./runtime";
import { emptyBody, persistedStoryBodyRevision } from "./storyValues";
import { capturePersonalMemoryEvent } from "./memoryEvents";

// ─── Story ──────────────────────────────────────────────────────────────
//
// drinking-time 工坊的故事/镜头表持久化。当前归属语义：
// - 每条 story 属于一个 user（owner）
// - projectId 可空，未来 host page 真接上项目时再绑
// Phase 3 加共享时，会再加一张 storyMembers 表用 storyId 反查可读用户

export type StoryListItem = Pick<
  Story,
  | "id"
  | "userId"
  | "projectId"
  | "title"
  | "logline"
  | "theme"
  | "arc"
  | "summary"
  | "createdAt"
  | "updatedAt"
> & {
  cardCount: number;
  shotCount: number;
  activityDates: string[];
  coverImageUrl: string | null;
};

function chinaDateKey(value: Date | number | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function storyActivityDates(body: unknown, createdAt: Date): string[] {
  const dates = new Set<string>();
  if (body && typeof body === "object") {
    const messages = (body as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const record = message as { role?: unknown; timestamp?: unknown };
        if (record.role !== "user") continue;
        if (
          typeof record.timestamp !== "number" &&
          typeof record.timestamp !== "string"
        ) {
          continue;
        }
        const date = chinaDateKey(record.timestamp);
        if (date) dates.add(date);
      }
    }
  }
  if (dates.size === 0) {
    const fallback = chinaDateKey(createdAt);
    if (fallback) dates.add(fallback);
  }
  return Array.from(dates).sort();
}

function bodyCardCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const cards = (body as { cards?: unknown }).cards;
  return Array.isArray(cards) ? cards.length : 0;
}

function bodyShotCount(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const shots = (body as { shots?: unknown }).shots;
  return Array.isArray(shots) ? shots.length : 0;
}

function storyCoverAssetId(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const publishing = normalizePublishingDraftState(
    (body as { publishing?: unknown }).publishing
  );
  return resolvePublishingDisplayCoverAssetId(publishing);
}

type StoryListRow = {
  row: Story;
  coverAssetId: number | null;
};

function toListItem(
  row: Story,
  coverImageUrl: string | null = null
): StoryListItem {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title,
    logline: row.logline,
    theme: row.theme,
    arc: row.arc,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cardCount: bodyCardCount(row.body),
    shotCount: bodyShotCount(row.body),
    activityDates: storyActivityDates(row.body, row.createdAt),
    coverImageUrl,
  };
}

function listItemsWithCoverUrls(
  rows: StoryListRow[],
  images: GeneratedImage[],
  userId: number
): StoryListItem[] {
  const imagesById = new Map(images.map(image => [image.id, image] as const));
  return rows.map(({ row, coverAssetId }) => {
    const image = coverAssetId ? imagesById.get(coverAssetId) : undefined;
    const authorized =
      image?.storyId === row.id &&
      (image.userId === userId || image.userId === null);
    return toListItem(row, authorized ? image.imageUrl : null);
  });
}

export async function listUserStories(
  userId: number
): Promise<StoryListItem[]> {
  const db = await getDb();
  if (!db) {
    const rows = memoryState.stories
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(row => ({ row, coverAssetId: storyCoverAssetId(row.body) }));
    const coverIds = new Set(
      rows.flatMap(item =>
        item.coverAssetId === null ? [] : [item.coverAssetId]
      )
    );
    return listItemsWithCoverUrls(
      rows,
      memoryState.generatedImages.filter(image => coverIds.has(image.id)),
      userId
    );
  }
  const rows = await db
    .select()
    .from(stories)
    .where(eq(stories.userId, userId))
    .orderBy(desc(stories.updatedAt));
  const storyRows = rows.map(row => ({
    row,
    coverAssetId: storyCoverAssetId(row.body),
  }));
  const coverIds = Array.from(
    new Set(
      storyRows.flatMap(item =>
        item.coverAssetId === null ? [] : [item.coverAssetId]
      )
    )
  );
  const coverImages =
    coverIds.length === 0
      ? []
      : await db
          .select()
          .from(generatedImages)
          .where(inArray(generatedImages.id, coverIds));
  return listItemsWithCoverUrls(storyRows, coverImages, userId);
}

/** Finds an already imported immutable 拾光家忆 snapshot without trusting its title. */
export async function findShiguangImportedStory(
  userId: number,
  sourceKey: string,
  sourceRevision: string
): Promise<Story | null> {
  const matches = (story: Story) => {
    if (!story.body || typeof story.body !== "object") return false;
    const imported = (
      story.body as {
        shiguangImport?: { sourceKey?: unknown; sourceRevision?: unknown };
      }
    ).shiguangImport;
    return (
      imported?.sourceKey === sourceKey &&
      imported.sourceRevision === sourceRevision
    );
  };
  const db = await getDb();
  if (!db) {
    return (
      memoryState.stories.find(
        story => story.userId === userId && matches(story)
      ) ?? null
    );
  }
  const rows = await db
    .select()
    .from(stories)
    .where(eq(stories.userId, userId));
  return rows.find(matches) ?? null;
}

export async function listUserStorySummariesPage(
  userId: number,
  offset: number,
  limit: number
): Promise<{
  stories: Array<Pick<Story, "id" | "title">>;
  nextOffset: number | null;
}> {
  const pageSize = Math.max(1, Math.min(100, Math.trunc(limit)));
  const start = Math.max(0, Math.trunc(offset));
  const db = await getDb();
  const rows = db
    ? await db
        .select({ id: stories.id, title: stories.title })
        .from(stories)
        .where(eq(stories.userId, userId))
        .orderBy(desc(stories.updatedAt), desc(stories.id))
        .limit(pageSize + 1)
        .offset(start)
    : memoryState.stories
        .filter(story => story.userId === userId)
        .sort(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            right.id - left.id
        )
        .slice(start, start + pageSize + 1)
        .map(({ id, title }) => ({ id, title }));
  const hasMore = rows.length > pageSize;
  return {
    stories: rows.slice(0, pageSize),
    nextOffset: hasMore ? start + pageSize : null,
  };
}

export async function getStoryById(
  id: number,
  userId: number
): Promise<Story | null> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
    );
    return row ?? null;
  }
  const result = await db
    .select()
    .from(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

// getLatestStoryForProject 已移除（U6）：故事是唯一单位后，Creation 侧改为
// 跟随传入的当前故事 storyId，不再"取项目里最新的故事"。如需按项目列故事用 listUserStories。

export async function createStory(data: InsertStory): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const row: Story = {
      id: nextMemoryId("story"),
      userId: data.userId,
      projectId: data.projectId ?? null,
      title: data.title,
      logline: data.logline ?? null,
      theme: data.theme ?? null,
      arc: data.arc ?? null,
      summary: data.summary ?? null,
      // Drizzle 把 json 列推成 unknown；写盘走 JSON.stringify 没问题
      body: (data.body ?? emptyBody()) as unknown,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.stories.push(row);
    await persistMemoryState();
    return { id: row.id };
  }
  const result = await db.insert(stories).values(data);
  return { id: result[0].insertId };
}

/**
 * 整故事覆盖式更新。前端的存储模型就是「整 blob 写盘」，所以这里照着做。
 * 校验所有权：传错 userId 的写不进来。
 */
export async function updateStory(
  id: number,
  userId: number,
  data: Partial<InsertStory>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      s => s.id === id && s.userId === userId
    );
    if (!row) return;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return;
  }
  await db
    .update(stories)
    .set(data)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
}

/**
 * 用途：Story 标题的唯一直写入口——只改 title 列，不碰 body，因此不参与 body 的
 *   CAS（`updateStoryBodyIfRevision` 才是 body 的写入口）。`onlyIfUntitled` 为
 *   true 时只在盘上标题仍是占位名的情况下才写入，用来兜住"自动命名不得覆盖用户
 *   手工改过的名字"这条不变量；判定放在存储写入本身（内存分支查 row.title、
 *   数据库分支进 WHERE），不依赖调用方先读一次再写。
 *   这里合并了原先的 `updateStoryTitle` 与 `updateStoryTitleIfUntitled`：两者只差
 *   这一个谓词，却各自复制了一遍所有权校验、内存/数据库双分支和返回值语义。
 * 调用入口：server/routers/storyAgent.ts 的 `storyRename`（onlyIfUntitled 省略）
 *   与 `storyAutoRename`（onlyIfUntitled: true）。
 * 下游调用：persistMemoryState（内存模式）；drizzle UPDATE（数据库模式）。
 * @returns 是否真的写入了一行——false 表示故事不存在、不属于该用户，或
 *   （onlyIfUntitled 时）标题已被人工命名过。
 */
export async function writeStoryTitle(input: {
  id: number;
  userId: number;
  title: string;
  onlyIfUntitled?: boolean;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    const row = memoryState.stories.find(
      story => story.id === input.id && story.userId === input.userId
    );
    if (!row) return false;
    if (input.onlyIfUntitled && !isUntitledStoryTitle(row.title)) return false;
    row.title = input.title;
    row.updatedAt = now();
    await persistMemoryState();
    return true;
  }
  const result = await db
    .update(stories)
    .set({ title: input.title })
    .where(
      and(
        eq(stories.id, input.id),
        eq(stories.userId, input.userId),
        ...(input.onlyIfUntitled
          ? [sql`TRIM(${stories.title}) IN ('', '未命名', '未命名故事')`]
          : [])
      )
    );
  return result[0].affectedRows === 1;
}

/**
 * Owner-scoped Story-body compare-and-swap. The revision predicate is checked
 * by the storage write itself; callers must not treat an earlier read or an
 * in-process mutex as the correctness boundary.
 *
 * 用途：Story body 唯一的资源级 CAS 写入口——目标资源（这个 Story 的 body）
 *   当前 revision 是唯一的写入冲突判定依据；owner 由 `id`+`userId` 同时校验
 *   （对应 U2 合同里的 story ScopeKey + OwnerScope 概念，这里先不引入类型，
 *   概念对齐即可）。内存模式下写盘失败会按字段把 `row` 恢复到调用前的值——
 *   只回滚仍然等于本次调用写入结果的字段，绝不用整行快照覆盖，因为并发的
 *   另一次写入（哪怕是完全不同的函数，比如 `writeStoryTitle`）可能已经在
 *   本次调用等待磁盘落盘期间，合法地改动了同一行对象上的其它字段。
 * 调用入口：server/services/storyBodyPersistence.ts 的 `persistPreparedStoryBody`
 *   （Story 文本字段与 publishing 写入都经此唯一入口）。
 * 下游调用：persistMemoryState（内存模式）；drizzle CAS UPDATE（数据库模式）。
 */
export async function updateStoryBodyIfRevision(input: {
  id: number;
  userId: number;
  expectedRevision: number;
  body: unknown;
  data?: Omit<Partial<InsertStory>, "body">;
  /**
   * 明确采用的经历（U3）。与这次 CAS 共享事务边界：CAS 输了不写，赢了才写。
   * 见 persistPreparedStoryBody 的说明——不允许 CAS 之后 best-effort 补。
   */
  personalMemoryCapture?: PersonalMemoryCapture;
}): Promise<boolean> {
  const nextRevision = persistedStoryBodyRevision(input.body);
  if (nextRevision !== input.expectedRevision + 1) {
    throw new Error(
      `Story CAS body revision ${nextRevision} must follow expected revision ${input.expectedRevision}`
    );
  }
  const db = await getDb();
  if (!db) {
    return withLocalBodyMutation(async () => {
      const row = memoryState.stories.find(
        story => story.id === input.id && story.userId === input.userId
      );
      if (
        !row ||
        persistedStoryBodyRevision(row.body) !== input.expectedRevision
      ) {
        return false;
      }
      // Copy-on-write snapshot: mutate optimistically, but if the disk flush
      // fails, restore this row to what it was before this call so a failed
      // write never leaves memoryState in a "succeeded in RAM, lost on disk"
      // state. This restore must be per-field, not a blanket
      // `Object.assign(row, previousRow)`: `row` is a live, shared object, and
      // between our mutation and the disk flush settling, a concurrent writer
      // (another CAS call once this call's optimistic revision makes it look
      // like a legal base, or an unrelated writer like writeStoryTitle
      // touching only `title`) can legitimately mutate a *different* field on
      // the same object and already succeed. A blanket restore would silently
      // erase that already-committed change. So: only roll back a field if it
      // still holds exactly the value *this call* set — if something else has
      // since changed it, that's a newer write we must not clobber.
      const previousRow = { ...row };
      // 经历与 body 进同一次 copy-on-write。落盘失败时下面会把它整份还原——
      // Story 与足迹索引同属 local-persist 聚合，所以不需要 outbox。
      const previousPersonalMemory = input.personalMemoryCapture
        ? structuredClone(memoryState.personalMemory)
        : null;
      if (input.personalMemoryCapture) {
        applyPersonalMemoryCapture(
          memoryState.personalMemory,
          input.personalMemoryCapture
        );
      }
      const writtenFields: Record<string, unknown> = { body: input.body };
      if (input.data) {
        applyDefinedValues(
          row as unknown as Record<string, unknown>,
          input.data as unknown as Record<string, unknown>
        );
        Object.assign(writtenFields, input.data);
      }
      row.body = input.body;
      row.updatedAt = now();
      writtenFields.updatedAt = row.updatedAt;
      try {
        await persistMemoryState();
      } catch (error) {
        if (previousPersonalMemory) {
          memoryState.personalMemory = previousPersonalMemory;
        }
        const rowRecord = row as unknown as Record<string, unknown>;
        const previousRecord = previousRow as unknown as Record<
          string,
          unknown
        >;
        // Known narrow limitation: for primitive `data` fields this compares by
        // value, so a concurrent writer that legitimately set the same field to
        // an identical value would still be rolled back here. `body` and
        // `updatedAt` are immune (always freshly constructed per call, so this
        // is a reference comparison). Accepted for now — closing it needs
        // per-field write tokens, which is out of scope for this unit.
        for (const key of Object.keys(writtenFields)) {
          if (rowRecord[key] === writtenFields[key]) {
            rowRecord[key] = previousRecord[key];
          }
        }
        throw error;
      }
      return true;
    });
  }
  // 包进事务是为了让采用经历和这次 CAS 同生共死。没有捕获时它只是一条
  // 单语句事务，行为与过去等价。
  return db.transaction(async tx => {
    const result = await tx
      .update(stories)
      .set({ ...(input.data ?? {}), body: input.body })
      .where(
        and(
          eq(stories.id, input.id),
          eq(stories.userId, input.userId),
          sql`CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${stories.body}, '$._revision')), '0') AS UNSIGNED) = ${input.expectedRevision}`
        )
      );
    if (result[0].affectedRows !== 1) return false;
    if (input.personalMemoryCapture) {
      await capturePersonalMemoryEvent(
        { mode: "mysql", tx },
        input.personalMemoryCapture
      );
    }
    return true;
  });
}
