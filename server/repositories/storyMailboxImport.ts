import {
  copyMailboxVideos,
  discardMailboxVideos,
} from "../services/storyMailboxVideo";
import { manuscriptFingerprint } from "../services/manuscriptSnapshot";
import { readBookWorkflow } from "../../shared/bookWorkflow";
import { copyFile, rm, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import { memoryState, nextMemoryId } from "./runtime";
import {
  appendMailboxSnapshot,
  mailboxEntry,
  mailboxGone,
  requireMailboxPair,
  withMailboxPair,
  type MailboxSql,
} from "./storyMailbox";
import {
  mintAudioStorageKey,
  resolveManagedAudioPath,
  ensureManagedAudioDirs,
} from "../services/audioMedia";
import {
  captureMailboxPackage,
  type MailboxPackage,
} from "./storyMailboxPackage";

import {
  remapMailboxValue,
  type MailboxMaps,
} from "../services/storyMailboxReferences";

async function insertCopy(
  sql: MailboxSql | null,
  pkg: MailboxPackage,
  userId: number,
  authorName: string,
  audioKeys: Map<number, string>,
  videoStaged: string[],
  onCreated: (id: number) => void
) {
  const target: Pick<
    typeof memoryState,
    | "stories"
    | "generatedImages"
    | "imageSignals"
    | "videoTakes"
    | "videoTakeRanges"
    | "videoTimelineSelections"
    | "storyAudioAssets"
    | "storyChapters"
    | "storyChapterVersions"
    | "storyTimelines"
  > = {
    stories: [],
    generatedImages: [],
    imageSignals: [],
    videoTakes: [],
    videoTakeRanges: [],
    videoTimelineSelections: [],
    storyAudioAssets: [],
    storyChapters: [],
    storyChapterVersions: [],
    storyTimelines: [],
  };
  const at = new Date();
  const base = {
    userId,
    projectId: null,
    title: pkg.title,
    logline: null,
    theme: null,
    arc: null,
    summary: null,
    body: {},
  };
  let storyId: number;
  if (sql) {
    const [result] = await sql.insert(s.stories).values(base);
    storyId = Number(result.insertId);
  } else {
    storyId = nextMemoryId("story");
    target.stories.push({
      ...base,
      id: storyId,
      createdAt: at,
      updatedAt: at,
    });
  }
  onCreated(storyId);
  const maps: MailboxMaps = {
    images: new Map(),
    videos: new Map(),
    ranges: new Map(),
    audio: new Map(),
  };
  for (const source of pkg.images) {
    const row = {
      ...source,
      userId,
      storyId,
      projectId: null,
      parentImageId: null,
      prompt: null,
      promptCompilationId: null,
      maskKey: null,
      createdAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      const [result] = await sql.insert(s.generatedImages).values(data);
      maps.images.set(source.id, Number(result.insertId));
    } else {
      const id = nextMemoryId("generatedImage");
      target.generatedImages.push({ ...row, id });
      maps.images.set(source.id, id);
    }
  }
  for (const source of pkg.images)
    if (source.parentImageId !== null) {
      const parent = maps.images.get(source.parentImageId) ?? null;
      if (sql)
        await sql
          .update(s.generatedImages)
          .set({ parentImageId: parent })
          .where(eq(s.generatedImages.id, maps.images.get(source.id)!));
      else
        target.generatedImages.find(
          i => i.id === maps.images.get(source.id)
        )!.parentImageId = parent;
    }
  for (const decision of pkg.imageDecisions) {
    const row = {
      userId,
      storyId,
      imageId: maps.images.get(decision.imageId!)!,
      action: decision.action,
      metadata: { source: "received-story" },
      createdAt: new Date(decision.createdAt),
    };
    if (sql) await sql.insert(s.imageSignals).values(row);
    else
      target.imageSignals.push({
        ...row,
        id: nextMemoryId("imageSignal"),
      });
  }
  for (const source of pkg.videos) {
    const row = {
      ...source,
      userId,
      storyId,
      sourceImageId:
        source.sourceImageId === null
          ? null
          : (maps.images.get(source.sourceImageId) ?? null),
      promptCompilationId: null,
      taskId: null,
      parameterSnapshot: null,
      idempotencyKey: null,
      errorMessage: null,
      createdAt: at,
      updatedAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      const [result] = await sql.insert(s.videoTakes).values(data);
      maps.videos.set(source.id, Number(result.insertId));
    } else {
      const id = nextMemoryId("videoTake");
      target.videoTakes.push({ ...row, id });
      maps.videos.set(source.id, id);
    }
  }
  maps.urls = await copyMailboxVideos(pkg, maps.videos, storyId, videoStaged);
  for (const source of pkg.videos) {
    const videoUrl = maps.urls.get(source.videoUrl!) ?? source.videoUrl,
      videoKey = source.videoKey
        ? (maps.urls.get(source.videoKey) ?? source.videoKey)
        : null;
    if (sql)
      await sql
        .update(s.videoTakes)
        .set({ videoUrl, videoKey })
        .where(eq(s.videoTakes.id, maps.videos.get(source.id)!));
    else
      Object.assign(
        target.videoTakes.find(v => v.id === maps.videos.get(source.id))!,
        { videoUrl, videoKey }
      );
  }
  for (const source of pkg.ranges) {
    const takeId = maps.videos.get(source.takeId);
    if (!takeId) throw new Error("missing_mailbox_video");
    const row = {
      ...source,
      userId,
      storyId,
      takeId,
      createdAt: at,
      updatedAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      const [result] = await sql.insert(s.videoTakeRanges).values(data);
      maps.ranges.set(source.id, Number(result.insertId));
    } else {
      const id = nextMemoryId("videoTakeRange");
      target.videoTakeRanges.push({ ...row, id });
      maps.ranges.set(source.id, id);
    }
  }
  for (const source of pkg.audio) {
    const storageKey = audioKeys.get(source.id);
    if (!storageKey) throw new Error("missing_mailbox_audio");
    const row = {
      ...source,
      userId,
      storyId,
      storageKey,
      provenance: { kind: "received-story", authorName },
      sourceKey: null,
      createdAt: at,
      updatedAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      const [result] = await sql.insert(s.storyAudioAssets).values(data);
      maps.audio.set(source.id, Number(result.insertId));
    } else {
      const id = nextMemoryId("storyAudioAsset");
      target.storyAudioAssets.push({ ...row, id });
      maps.audio.set(source.id, id);
    }
  }
  const remap = <T>(value: T) =>
    remapMailboxValue(value, maps, storyId, userId) as T;
  for (const source of pkg.selections) {
    const row = {
      ...remap(source),
      userId,
      storyId,
      createdAt: at,
      updatedAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      await sql.insert(s.videoTimelineSelections).values(data);
    } else
      target.videoTimelineSelections.push({
        ...row,
        id: nextMemoryId("videoTimelineSelection"),
      });
  }
  const chapterIds = new Map<number, number>();
  for (const source of pkg.chapters) {
    const row = {
      ...remap(source),
      userId,
      storyId,
      createdAt: at,
      updatedAt: at,
    };
    row.blocks.attribution = {
      editorName: authorName,
      sourceName: authorName,
      action: "received",
    };
    if (sql) {
      const { id: _, ...data } = row;
      const [r] = await sql.insert(s.storyChapters).values(data);
      chapterIds.set(source.id, Number(r.insertId));
    } else {
      const id = nextMemoryId("storyChapter");
      target.storyChapters.push({ ...row, id });
      chapterIds.set(source.id, id);
    }
  }
  for (const source of pkg.chapterVersions) {
    const row = {
      ...remap(source),
      userId,
      chapterId: chapterIds.get(source.chapterId)!,
    };
    if (sql) {
      const { id: _, ...data } = row;
      await sql
        .insert(s.storyChapterVersions)
        .values({ ...data, createdAt: new Date(source.createdAt) });
    } else
      target.storyChapterVersions.push({
        ...row,
        id: nextMemoryId("storyChapterVersion"),
        createdAt: new Date(source.createdAt),
      });
  }
  if (pkg.timeline) {
    const row = {
      ...remap(pkg.timeline),
      userId,
      storyId,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    if (sql) {
      const { id: _, ...data } = row;
      await sql.insert(s.storyTimelines).values(data);
    } else
      target.storyTimelines.push({
        ...row,
        id: nextMemoryId("storyTimeline"),
      });
  }
  const body: Record<string, unknown> = {
    ...remap(pkg.body),
    _revision: 1,
    mailboxSource: { authorName, receivedAt: at.toISOString() },
  };
  const book = readBookWorkflow(body.bookWorkflow);
  book.versions.forEach(v => {
    v.fingerprint = manuscriptFingerprint(v.chapters);
  });
  body.bookWorkflow = book;
  if (sql)
    await sql.update(s.stories).set({ body }).where(eq(s.stories.id, storyId));
  else target.stories.find(s => s.id === storyId)!.body = body;
  if (!sql) {
    // Publish the entire local copy together, after all asynchronous attachment I/O.
    memoryState.stories.push(...target.stories);
    memoryState.generatedImages.push(...target.generatedImages);
    memoryState.imageSignals.push(...target.imageSignals);
    memoryState.videoTakes.push(...target.videoTakes);
    memoryState.videoTakeRanges.push(...target.videoTakeRanges);
    memoryState.videoTimelineSelections.push(...target.videoTimelineSelections);
    memoryState.storyAudioAssets.push(...target.storyAudioAssets);
    memoryState.storyChapters.push(...target.storyChapters);
    memoryState.storyChapterVersions.push(...target.storyChapterVersions);
    memoryState.storyTimelines.push(...target.storyTimelines);
  }
  return { storyId, urls: maps.urls };
}

/** Entire DB copy and receipt commit together; filesystem staging is compensated on failure. */
export async function receiveMailboxStory(userId: number, entryId: string) {
  const initial = await mailboxEntry(userId, entryId);
  if (initial.recipientId !== userId || initial.kind === "received")
    throw mailboxGone();
  const staged: string[] = [],
    videoStaged: string[] = [];
  let localCopyId: number | null = null;
  try {
    return await withMailboxPair(userId, initial.senderId, async sql => {
      const [entry] = sql
        ? await sql
            .select()
            .from(s.storyMailboxEntries)
            .where(eq(s.storyMailboxEntries.id, entryId))
            .for("update")
        : memoryState.storyMailboxEntries.filter(e => e.id === entryId);
      if (!entry || entry.recipientId !== userId) throw mailboxGone();
      if (entry.receivedStoryId)
        return { storyId: entry.receivedStoryId, repeated: true };
      await requireMailboxPair(sql, userId, initial.senderId);
      const audioKeys = new Map<number, string>();
      if (entry.snapshot.audio.length) await ensureManagedAudioDirs();
      for (const audio of entry.snapshot.audio) {
        const key = mintAudioStorageKey();
        await copyFile(
          resolveManagedAudioPath(audio.storageKey),
          resolveManagedAudioPath(key),
          constants.COPYFILE_EXCL
        );
        staged.push(key);
        await chmod(resolveManagedAudioPath(key), 0o600);
        audioKeys.set(audio.id, key);
      }
      const { storyId, urls } = await insertCopy(
        sql,
        entry.snapshot,
        userId,
        entry.authorName,
        audioKeys,
        videoStaged,
        id => {
          if (!sql) localCopyId = id;
        }
      );
      const baseline = await captureMailboxPackage(storyId, userId, sql);
      if (sql) {
        await sql
          .update(s.storyMailboxEntries)
          .set({ receivedStoryId: storyId, readAt: new Date() })
          .where(eq(s.storyMailboxEntries.id, entryId));
        const [thread] = await sql
          .select()
          .from(s.storyMailboxThreads)
          .where(eq(s.storyMailboxThreads.id, entry.threadId));
        if (thread)
          await sql
            .update(s.storyMailboxThreads)
            .set(
              thread.recipientId === userId
                ? {
                    copyStoryId: storyId,
                    copyFingerprint: baseline.fingerprint,
                  }
                : {
                    sourceStoryId: storyId,
                    sourceFingerprint: baseline.fingerprint,
                  }
            )
            .where(eq(s.storyMailboxThreads.id, thread.id));
      } else {
        entry.receivedStoryId = storyId;
        entry.readAt = new Date();
        const thread = memoryState.storyMailboxThreads.find(
          t => t.id === entry.threadId
        );
        if (thread)
          Object.assign(
            thread,
            thread.recipientId === userId
              ? { copyStoryId: storyId, copyFingerprint: baseline.fingerprint }
              : {
                  sourceStoryId: storyId,
                  sourceFingerprint: baseline.fingerprint,
                }
          );
      }
      const [thread] = sql
        ? await sql
            .select()
            .from(s.storyMailboxThreads)
            .where(eq(s.storyMailboxThreads.id, entry.threadId))
        : memoryState.storyMailboxThreads.filter(t => t.id === entry.threadId);
      const [user] = sql
        ? await sql
            .select({ name: s.users.name })
            .from(s.users)
            .where(eq(s.users.id, userId))
        : memoryState.users.filter(u => u.id === userId);
      // Receipt is also the receiver's comparison baseline. Reuse envelope-owned bytes.
      baseline.videoFiles = Object.fromEntries(
        Object.entries(entry.snapshot.videoFiles).map(([url, file]) => [
          urls.get(url) ?? url,
          file,
        ])
      );
      baseline.audio.forEach((audio, index) => {
        audio.storageKey = entry.snapshot.audio[index].storageKey;
      });
      await appendMailboxSnapshot(sql, thread, {
        kind: "received",
        senderId: userId,
        storyId,
        authorName: user?.name?.trim() || "朋友",
        note: "",
        package: baseline,
      });
      return { storyId, repeated: false };
    });
  } catch (error) {
    if (localCopyId !== null) {
      const chapters = new Set(
        memoryState.storyChapters
          .filter(c => c.storyId === localCopyId)
          .map(c => c.id)
      );
      memoryState.storyChapterVersions =
        memoryState.storyChapterVersions.filter(
          v => !chapters.has(v.chapterId)
        );
      memoryState.stories = memoryState.stories.filter(
        r => r.id !== localCopyId
      );
      memoryState.storyChapters = memoryState.storyChapters.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.generatedImages = memoryState.generatedImages.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.imageSignals = memoryState.imageSignals.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.videoTakes = memoryState.videoTakes.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.videoTakeRanges = memoryState.videoTakeRanges.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.videoTimelineSelections =
        memoryState.videoTimelineSelections.filter(
          r => r.storyId !== localCopyId
        );
      memoryState.storyAudioAssets = memoryState.storyAudioAssets.filter(
        r => r.storyId !== localCopyId
      );
      memoryState.storyTimelines = memoryState.storyTimelines.filter(
        r => r.storyId !== localCopyId
      );
    }
    await discardMailboxVideos(videoStaged);
    await Promise.all(
      staged.map(key => rm(resolveManagedAudioPath(key), { force: true }))
    );
    throw error;
  }
}
