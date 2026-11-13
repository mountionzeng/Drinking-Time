import { mailboxLegacyManuscripts } from "../services/storyMailboxLegacy";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "../../drizzle/schema";
import { getDb, memoryState, withLocalAggregateMutationLock } from "./runtime";
export type MailboxSql = Pick<
  NonNullable<Awaited<ReturnType<typeof getDb>>>,
  "select" | "insert" | "update"
>;
import {
  normalizePublishingDraftState,
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../../shared/publishingDraft";
import type {
  MailboxInventory,
  MailboxChange,
} from "../../shared/storyMailbox";
import { mailboxChanges } from "../../shared/storyMailbox";
import { decodeStoryTimelinePayload } from "./timelineCodec";

/** Server-only immutable package. APIs return an inventory, never these rows. */
export type MailboxPackage = {
  schemaVersion: 1;
  selection?: import("../../shared/storyMailboxSelection").MailboxSelection;
  title: string;
  body: Record<string, unknown>;
  chapters: schema.StoryChapter[];
  chapterVersions: schema.StoryChapterVersion[];
  images: schema.GeneratedImage[];
  imageDecisions: Array<
    Pick<schema.ImageSignal, "imageId" | "action" | "createdAt">
  >;
  videos: schema.VideoTake[];
  ranges: schema.VideoTakeRange[];
  selections: schema.VideoTimelineSelection[];
  audio: schema.StoryAudioAsset[];
  timeline: schema.StoryTimeline | null;
  videoFiles: Record<string, string>;
  inventory: MailboxInventory;
  fingerprint: string;
};
export const mailboxRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
/** MySQL JSON canonicalizes object keys; hashes must survive its round trip. */
export function mailboxDigest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    v instanceof Date
      ? v.toISOString()
      : Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .filter(([, x]) => x !== undefined)
                .map(([k, x]) => [k, canonical(x)])
            )
          : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)) ?? "null")
    .digest("hex");
}
const PRIVATE_FIELDS = new Set(
  `prompt promptCompilationId parameterSnapshot taskId idempotencyKey errorMessage failureReason provenance sourceKey maskKey sourceCardContent requestHash operationToken providerTaskId wechatImport draftMirror lineage sourceChapterId conversation conversions quote quoteId requestId billing receipt credentials apiKey accessToken`.split(
    " "
  )
);
/** Only called inside allowlisted creative containers; never on the whole body. */
export function cleanMailboxCreative<T>(value: T): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(cleanMailboxCreative) as T;
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => !PRIVATE_FIELDS.has(k))
      .map(([k, v]) => [
        k,
        (k === "userId" && typeof row.name === "string") || k === "authorUserId"
          ? 0
          : cleanMailboxCreative(v),
      ])
  ) as T;
}
const SHOT_FIELDS = new Set(
  `stableShotId shotIdentity shotNo sceneNo sceneTitle sceneArtBrief cueCode actNo subject action scriptText performance environmentMotion dialogue shotType beat cameraAngle cameraMove cameraHeight lens cameraPath subjectPath location timeLight lighting colorPalette materialTexture mood sound soundBridge styleRef note emotion intent rationale videoStart videoEnd transitionIn transitionOut transitionIntent videoPrompt emotionCharge emotionDelta visualAnchorText promptDraft negativePrompt characterReference wardrobeReference hairReference sceneReference textureReference narrativeJob plannedDurationMs relatedImageIds publishingVideo`.split(
    " "
  )
);
const cleanShot = (value: unknown) =>
  cleanMailboxCreative(
    Object.fromEntries(
      Object.entries(mailboxRecord(value)).filter(([key]) =>
        SHOT_FIELDS.has(key)
      )
    )
  );
export function mailboxCreativeBody(body: unknown): Record<string, unknown> {
  const source = mailboxRecord(body),
    publishing = normalizePublishingDraftState(source.publishing);
  let safePublishing = emptyPublishingDraftState(0);
  for (const draft of Object.values(publishing.drafts))
    if (draft)
      safePublishing = upsertPublishingPlatformDraft(safePublishing, {
        platform: draft.platform,
        content: structuredClone(draft.content),
        now: 0,
      });
  safePublishing.activePlatform = publishing.activePlatform;
  const book = mailboxRecord(source.bookWorkflow),
    video = mailboxRecord(source.videoWorkflow);
  const pick = (value: unknown, keys: string[]) =>
    Object.fromEntries(
      keys
        .filter(k => k in mailboxRecord(value))
        .map(k => [k, mailboxRecord(value)[k]])
    );
  return cleanMailboxCreative({
    ...(mailboxRecord(source.chatCutImport).sourceFormat === "xmeml"
      ? {
          chatCutImport: {
            ...pick(source.chatCutImport, [
              "sourceFormat",
              "fps",
              "playbackAudioTrackIndexes",
              "scriptCues",
            ]),
            audioTracks: array(
              mailboxRecord(source.chatCutImport).audioTracks
            ).map(track => ({
              ...pick(track, ["index"]),
              clips: array(mailboxRecord(track).clips).map(clip =>
                pick(clip, [
                  "id",
                  "name",
                  "audioUrl",
                  "startFrame",
                  "endFrame",
                  "inFrame",
                  "outFrame",
                ])
              ),
            })),
          },
        }
      : {}),
    shots: array(source.shots).map(cleanShot),
    publishing: safePublishing,
    bookWorkflow: {
      schemaVersion: 1,
      revision: 0,
      current: book.current ?? {},
      conversions: [],
      versions: array(book.versions).map(v =>
        pick(v, [
          "id",
          "kind",
          "number",
          "name",
          "createdAt",
          "intent",
          "author",
          "confirmedBy",
          "editedBy",
          "aiAssisted",
          "summary",
          "parentId",
          "source",
          "chapters",
          "fingerprint",
        ])
      ),
    },
    videoWorkflow: {
      schemaVersion: 1,
      versions: array(video.versions).map(v => ({
        ...pick(v, [
          "id",
          "number",
          "parentId",
          "createdAt",
          "name",
          "intent",
          "summary",
          "author",
          "confirmedBy",
          "manuscriptSource",
          "textSource",
          "material",
          "legacyAudioSources",
          "planId",
        ]),
        shots: array(mailboxRecord(v).shots).map(cleanShot),
        exports: array(mailboxRecord(v).exports)
          .filter(e => mailboxRecord(e).status === "ready")
          .map(e =>
            pick(e, [
              "id",
              "createdAt",
              "actor",
              "status",
              "aspectRatio",
              "videoUrl",
              "durationSec",
            ])
          ),
      })),
    },
    // Confirmed film plans are creative versions; omit requests, errors and quotes.
    bookVideoRecords: array(source.bookVideoRecords)
      .filter(v => mailboxRecord(v).status === "adopted")
      .map(v => ({
        ...pick(v, [
          "id",
          "parentId",
          "versionId",
          "videoVersion",
          "confirmedAt",
          "createdAt",
          "revision",
          "bookSource",
          "layout",
          "status",
          "brief",
          "preview",
          "edits",
          "preparedAudio",
          "musicAssets",
          "manuscriptSource",
          "creationIntent",
          "author",
          "confirmedBy",
        ]),
        ...(mailboxRecord(v).storyboardSnapshot
          ? {
              storyboardSnapshot: {
                shots: array(
                  mailboxRecord(mailboxRecord(v).storyboardSnapshot).shots
                ).map(cleanShot),
              },
            }
          : {}),
      })),
  });
}

async function capture(
  sql: MailboxSql | null,
  storyId: number,
  userId: number
): Promise<MailboxPackage> {
  const [storedStory] = sql
    ? await sql
        .select()
        .from(schema.stories)
        .where(
          and(eq(schema.stories.id, storyId), eq(schema.stories.userId, userId))
        )
    : memoryState.stories.filter(s => s.id === storyId && s.userId === userId);
  if (!storedStory)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const [space] = sql
    ? await sql
        .select({ state: schema.accountMemorySpaces.state })
        .from(schema.accountMemorySpaces)
        .where(eq(schema.accountMemorySpaces.userId, userId))
    : memoryState.accountMemorySpaces.filter(a => a.userId === userId);
  if (
    Object.hasOwn(
      mailboxRecord(mailboxRecord(space?.state).trashedStories),
      String(storyId)
    )
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const story = structuredClone(storedStory);
  const rows = async <
    T extends { storyId: number | null; userId: number | null; id: number },
  >(
    table: any,
    local: T[]
  ): Promise<T[]> =>
    sql
      ? ((await sql
          .select()
          .from(table)
          .where(
            and(eq(table.storyId, storyId), eq(table.userId, userId))
          )) as T[])
      : structuredClone(
          local.filter(r => r.storyId === storyId && r.userId === userId)
        );
  const [chapters, images, videos, audio, timelines, ranges, selections] =
    await Promise.all([
      rows(schema.storyChapters, memoryState.storyChapters),
      rows(schema.generatedImages, memoryState.generatedImages),
      rows(schema.videoTakes, memoryState.videoTakes),
      rows(schema.storyAudioAssets, memoryState.storyAudioAssets),
      rows(schema.storyTimelines, memoryState.storyTimelines),
      rows(schema.videoTakeRanges, memoryState.videoTakeRanges),
      rows(schema.videoTimelineSelections, memoryState.videoTimelineSelections),
    ]);
  const imageIds = images.map(i => i.id);
  const imageSignals = imageIds.length
    ? sql
      ? await sql
          .select()
          .from(schema.imageSignals)
          .where(
            and(
              inArray(schema.imageSignals.imageId, imageIds),
              eq(schema.imageSignals.userId, userId)
            )
          )
      : memoryState.imageSignals.filter(
          r =>
            r.imageId !== null &&
            imageIds.includes(r.imageId) &&
            r.userId === userId
        )
    : [];
  const latestDecision = new Map<number, schema.ImageSignal>();
  for (const signal of [...imageSignals].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
  ))
    if (signal.imageId !== null) latestDecision.set(signal.imageId, signal);
  const ids = chapters.map(c => c.id);
  const chapterVersions = ids.length
    ? sql
      ? await sql
          .select()
          .from(schema.storyChapterVersions)
          .where(
            and(
              inArray(schema.storyChapterVersions.chapterId, ids),
              eq(schema.storyChapterVersions.userId, userId)
            )
          )
      : structuredClone(
          memoryState.storyChapterVersions.filter(
            v => ids.includes(v.chapterId) && v.userId === userId
          )
        )
    : [];
  const sort = <T extends { id: number }>(items: T[]) =>
    items.sort((a, b) => a.id - b.id);
  const body = mailboxCreativeBody(story.body);
  const bookState = mailboxRecord(body.bookWorkflow);
  // Only import legacy text history when present; avoid treating today's platform mirror as another version.
  if (
    mailboxRecord(story.body).textDraftHistory ||
    (normalizePublishingDraftState(mailboxRecord(story.body).publishing)
      .versions?.length ?? 0) > 1
  ) {
    const legacy = mailboxLegacyManuscripts(story.body);
    const existing = array(bookState.versions);
    bookState.versions = [
      ...existing,
      ...legacy.map((v, index) => ({
        ...v,
        number:
          Math.max(0, ...existing.map(v => Number(mailboxRecord(v).number))) +
          index +
          1,
      })),
    ];
  }
  // The saved chapter document is authoritative, not an obsolete publishing mirror.
  const live = chapters
    .filter(
      c =>
        !c.blocks.manuscriptArchived &&
        (c.blocks.manuscriptKind ?? "text") === "text"
    )
    .sort((a, b) => a.position - b.position || a.id - b.id);
  if (live.length) {
    const p = normalizePublishingDraftState(body.publishing);
    body.publishing = upsertPublishingPlatformDraft(p, {
      platform: p.activePlatform,
      content: {
        title: story.title,
        body: live.map(c => c.blocks.body).join("\n\n"),
        tags: [],
      },
      now: 0,
    });
  }
  const ready = videos.filter(v => v.status === "available" && v.videoUrl);
  const data = {
    videoFiles: {} as Record<string, string>,
    schemaVersion: 1 as const,
    title: story.title,
    body,
    chapters: sort(chapters).map(c => ({
      ...c,
      blocks: cleanMailboxCreative(c.blocks),
    })),
    chapterVersions: sort(chapterVersions).map(c => ({
      ...c,
      blocks: cleanMailboxCreative(c.blocks),
    })),
    images: sort(images).map(i => ({
      ...i,
      prompt: null,
      promptCompilationId: null,
      maskKey: null,
    })),
    imageDecisions: [...latestDecision.values()]
      .map(({ imageId, action, createdAt }) => ({ imageId, action, createdAt }))
      .sort((a, b) => a.imageId! - b.imageId!),
    videos: sort(ready).map(v => ({
      ...v,
      prompt: "",
      promptCompilationId: null,
      taskId: null,
      errorMessage: null,
      parameterSnapshot: null,
      idempotencyKey: null,
    })),
    ranges: sort(ranges.filter(r => ready.some(v => v.id === r.takeId))),
    selections: sort(selections),
    audio: sort(audio.filter(a => a.status === "ready")).map(a => ({
      ...a,
      provenance: null,
      sourceKey: null,
      failureReason: null,
    })),
    timeline: timelines[0]
      ? { ...timelines[0], items: cleanMailboxCreative(timelines[0].items) }
      : null,
  };
  // Preserve an empty conversions list: the version reader requires it.
  mailboxRecord(body.bookWorkflow).conversions = [];
  const inventory: MailboxInventory = {
    chapters:
      chapters.filter(c => !c.blocks.manuscriptArchived).length ||
      Number(
        Boolean(
          normalizePublishingDraftState(body.publishing).drafts[
            normalizePublishingDraftState(body.publishing).activePlatform
          ]?.content.body.trim()
        )
      ),
    images: images.length,
    videos: ready.length,
    audio: data.audio.length,
    timelineItems: array(decodeStoryTimelinePayload(data.timeline?.items).items)
      .length,
    chapterVersions: chapterVersions.length,
    bookVersions: array(mailboxRecord(body.bookWorkflow).versions).length,
    videoVersions:
      array(mailboxRecord(body.videoWorkflow).versions).length +
      array(body.bookVideoRecords).length,
    exports: array(mailboxRecord(body.videoWorkflow).versions).reduce<number>(
      (n, v) => n + array(mailboxRecord(v).exports).length,
      0
    ),
  };
  if (Buffer.byteLength(JSON.stringify(data)) > 12 * 1024 * 1024)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "故事版本资料超过发送容量；原稿与全部版本仍保留",
    });
  // Source ownership metadata and volatile timestamps do not generate fake edits.
  const content = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(content)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([k]) =>
                  ![
                    "updatedAt",
                    "createdAt",
                    "userId",
                    "version",
                    "storageKey",
                  ].includes(k)
              )
              .map(([k, v]) => [k, content(v)])
          )
        : value;
  return {
    ...structuredClone(data),
    inventory,
    fingerprint: mailboxDigest(content(data)),
  };
}
export async function captureMailboxPackage(
  storyId: number,
  userId: number,
  sql?: MailboxSql | null
): Promise<MailboxPackage> {
  if (sql !== undefined) return capture(sql, storyId, userId);
  const db = await getDb();
  return db
    ? db.transaction(tx => capture(tx, storyId, userId), {
        isolationLevel: "repeatable read",
      })
    : withLocalAggregateMutationLock(() => capture(null, storyId, userId));
}
export function describeMailboxChanges(
  before: MailboxPackage | undefined,
  after: MailboxPackage
): MailboxChange[] {
  const changes = mailboxChanges(before?.inventory, after.inventory);
  if (!before) return changes;
  const changedChapters = after.chapters.filter(c => {
    const old = before.chapters.find(v => v.id === c.id);
    return (
      old &&
      mailboxDigest([old.title, old.blocks, old.layout]) !==
        mailboxDigest([c.title, c.blocks, c.layout])
    );
  });
  if (changedChapters.length)
    changes.push({
      kind: "text",
      updated: changedChapters.length,
      names: changedChapters.map(c => c.title).slice(0, 20),
    });
  else if (
    mailboxDigest(before.body.publishing) !==
    mailboxDigest(after.body.publishing)
  )
    changes.push({ kind: "text", updated: 1 });
  if (
    mailboxDigest(before.timeline?.items) !==
    mailboxDigest(after.timeline?.items)
  )
    changes.push({ kind: "timelineItems", updated: 1 });
  for (const kind of ["images", "videos", "audio"] as const) {
    const relevant = (row: object) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([k]) => !["storageKey", "createdAt", "updatedAt"].includes(k)
        )
      );
    const updated = after[kind].filter(row => {
      const old = before[kind].find(r => r.id === row.id);
      return (
        old && mailboxDigest(relevant(old)) !== mailboxDigest(relevant(row))
      );
    }).length;
    if (updated) changes.push({ kind, updated });
  }
  for (const kind of ["bookVersions", "videoVersions"] as const) {
    const field = kind === "bookVersions" ? "bookWorkflow" : "videoWorkflow";
    const oldIds = new Set(
      array(mailboxRecord(before.body[field]).versions).map(
        v => mailboxRecord(v).id
      )
    );
    const names = array(mailboxRecord(after.body[field]).versions)
      .filter(v => !oldIds.has(mailboxRecord(v).id))
      .map(v => String(mailboxRecord(v).name || ""));
    const change = changes.find(c => c.kind === kind && c.added);
    if (change && names.length) change.names = names.slice(0, 20);
  }
  if (!changes.length && before.fingerprint !== after.fingerprint)
    changes.push({ kind: "editing", updated: 1 });
  return changes;
}
