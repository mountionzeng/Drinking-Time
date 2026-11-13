import * as mailboxVideo from "./services/storyMailboxVideo";
import { localVideoDir } from "./services/videoMedia";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as s from "../drizzle/schema";
import { storyMailboxRouter } from "./routers/storyMailbox";
import { createStory } from "./repositories/stories";
import {
  getDb,
  memoryState,
  resetMemoryStateForTesting,
} from "./repositories/runtime";
import { mailboxContactId } from "./repositories/storyMailbox";
import {
  captureMailboxPackage,
  mailboxDigest,
} from "./repositories/storyMailboxPackage";
import { resolveManagedAudioPath } from "./services/audioMedia";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../shared/publishingDraft";
import { ENV } from "./_core/env";
const api = (id: number) =>
  storyMailboxRouter.createCaller({
    user: { id, name: id === 1 ? "林" : "岱" },
    req: {},
    res: {},
  } as TrpcContext);
const at = new Date("2026-11-13T10:00:00Z");
let dir: string;
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  dir = await mkdtemp(path.join(tmpdir(), "mailbox-test-"));
  vi.stubEnv("LOCAL_AUDIO_DIR", dir);
  resetMemoryStateForTesting();
  await getDb();
  vi.spyOn(ENV, "cookieSecret", "get").mockReturnValue(
    "mailbox-test-cookie-secret-32-characters"
  );
  vi.spyOn(ENV, "localImageDir", "get").mockReturnValue(
    path.join(dir, "images")
  );
  memoryState.users.push(
    ...[1, 2, 3].map(
      id =>
        ({ id, name: id === 1 ? "林" : id === 2 ? "岱" : "第三人" }) as s.User
    )
  );
  // A prior explicit connection, as created by the accepted share-link flow.
  memoryState.storyMailboxContacts.push(
    { id: randomUUID(), ownerId: 1, peerId: 2, removedAt: null },
    { id: randomUUID(), ownerId: 2, peerId: 1, removedAt: null }
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function blocks(body: string): s.StoryChapter["blocks"] {
  return {
    body,
    blockIds: ["line"],
    containsAiText: false,
    settings: null,
    coverKey: null,
    bodyTextureKey: null,
    images: {},
    illustrations: [],
  };
}
async function story(owner = 1) {
  const publishing = upsertPublishingPlatformDraft(
    emptyPublishingDraftState(),
    {
      platform: "xiaohongshu",
      content: { title: "纸船", body: "旧正文", tags: [] },
      now: 1,
    }
  );
  const { id } = await createStory({
    userId: owner,
    title: "纸船",
    body: {
      publishing,
      memory: { secret: "private-memory" },
      chatHistory: [{ content: "private-chat" }],
    },
  });
  memoryState.storyChapters.push({
    id: 101,
    storyId: id,
    userId: owner,
    position: 0,
    title: "第一章",
    blocks: blocks("最新保存的文字"),
    layout: null,
    version: 2,
    createdAt: at,
    updatedAt: at,
  });
  memoryState.storyChapterVersions.push({
    id: 301,
    chapterId: 101,
    userId: owner,
    version: 1,
    title: "旧章",
    blocks: blocks("旧章正文"),
    layout: null,
    reason: "save",
    createdAt: at,
  });
  return id;
}
async function send(storyId: number, note = "") {
  const preview = await api(1).preview({ storyId });
  const input = {
    storyId,
    note,
    fingerprint: preview.fingerprint,
    contactId: mailboxContactId(1, 2),
    requestId: randomUUID(),
  };
  const sent = await api(1).send(input);
  const history = await api(2).history({ contactId: mailboxContactId(2, 1) });
  return { input, sent, entry: history.entries[0] };
}
async function completeStory() {
  const id = await story();
  const image: s.GeneratedImage = {
    id: 401,
    storyId: id,
    userId: 1,
    projectId: null,
    shotNo: "SH01",
    shotIdentity: "shot-one",
    imageKey: "images/boat.webp",
    imageUrl: "/api/images/boat.webp",
    prompt: "private-prompt",
    promptCompilationId: 88,
    generationType: "generate",
    parentImageId: null,
    isCurrent: true,
    maskKey: null,
    createdAt: at,
  };
  const video: s.VideoTake = {
    id: 501,
    storyId: id,
    userId: 1,
    stableShotId: "shot-one",
    sourceImageId: 401,
    status: "available",
    promptCompilationId: 88,
    taskId: "private-task",
    provider: "302",
    model: "video",
    prompt: "private-prompt",
    subtitle: null,
    durationSec: 4,
    aspectRatio: "16:9",
    videoKey: "take-501.mp4",
    videoUrl: "/api/videos/take-501.mp4",
    errorMessage: null,
    parameterSnapshot: { credential: "private-key" },
    idempotencyKey: "private-idempotency",
    extractionCapability: "available",
    createdAt: at,
    updatedAt: at,
  };
  const range: s.VideoTakeRange = {
    id: 601,
    takeId: 501,
    storyId: id,
    userId: 1,
    stableShotId: "shot-one",
    startSec: 1,
    endSec: 3,
    label: "片段",
    source: "manual",
    createdAt: at,
    updatedAt: at,
  };
  memoryState.generatedImages.push(image);
  memoryState.videoTakes.push(video);
  memoryState.videoTakeRanges.push(range);
  memoryState.videoTimelineSelections.push({
    id: 701,
    storyId: id,
    userId: 1,
    stableShotId: "shot-one",
    takeId: 501,
    rangeId: 601,
    selectionType: "range",
    createdAt: at,
    updatedAt: at,
  });
  const key = "a".repeat(32);
  await writeFile(resolveManagedAudioPath(key), "test audio bytes");
  memoryState.storyAudioAssets.push({
    id: 801,
    storyId: id,
    userId: 1,
    storageKey: key,
    displayName: "旁白",
    mediaKind: "narration",
    sourceKind: "local-upload",
    sourceKey: "private-source",
    checksum: "b".repeat(64),
    status: "ready",
    failureReason: null,
    durationFrames: 120,
    durationSeconds: 4,
    sampleRate: 48000,
    channels: 2,
    codecName: "mp3",
    formatName: "mp3",
    provenance: { secret: "private-receipt" },
    createdAt: at,
    updatedAt: at,
  });
  const timeline = {
    items: [
      {
        stableShotId: "shot-one",
        included: true,
        position: 0,
        plannedDurationMs: 4000,
        durationFrames: 120,
        timelineStartFrame: 15,
        visualLayer: 2,
        imageTransforms: { 401: { zoom: 1.4 } },
        primaryVideoEdit: {
          takeId: 501,
          sourceStartSec: 1,
          sourceEndSec: 3,
          effects: {
            playbackRate: 1.5,
            reverse: true,
            volume: 0.4,
            muted: false,
          },
        },
        visualClips: [
          {
            id: "clip",
            takeId: 501,
            rangeId: 601,
            offsetMs: 500,
            durationMs: 2000,
          },
        ],
        imageClips: [
          {
            id: "still",
            imageId: 401,
            durationFrames: 1,
            composition: { opacity: 0.4, fadeInFrames: 3, fadeOutFrames: 4 },
          },
        ],
        anchors: [{ id: "anchor", sourceId: "image-401", timelineFrame: 20 }],
      },
    ],
    visualLayerState: { count: 3, hidden: [1] },
    subtitleTracks: {
      tracks: [
        {
          id: "sub",
          cues: [
            { id: "cue", text: "船来了", startFrame: 30, durationFrames: 60 },
          ],
        },
      ],
    },
    audioTracks: {
      tracks: [
        {
          kind: "narration",
          clips: [
            {
              id: "voice",
              assetId: 801,
              sourceInFrame: 5,
              sourceOutFrame: 90,
              timelineStartFrame: 12,
              gain: 0.4,
              fadeInFrames: 3,
              fadeOutFrames: 4,
            },
          ],
        },
      ],
    },
  };
  memoryState.storyTimelines.push({
    id: 901,
    storyId: id,
    userId: 1,
    version: 5,
    items: timeline,
    createdAt: at,
    updatedAt: at,
  });
  const row = memoryState.stories.find(r => r.id === id)!;
  row.body = {
    ...(row.body as object),
    shots: [
      {
        stableShotId: "shot-one",
        shotNo: 1,
        subject: "纸船",
        sourceCardContent: "private-card",
      },
    ],
    videoWorkflow: {
      schemaVersion: 1,
      versions: [1, 2].map(n => ({
        id: `video-${n}`,
        number: n,
        name: `影片 V${n}`,
        createdAt: n,
        author: { userId: 1, name: "林" },
        confirmedBy: { userId: 1, name: "林" },
        material: {
          storyId: id,
          timeline: {
            storyId: id,
            version: 5,
            items: timeline.items,
            extensions: {
              audioTracks: timeline.audioTracks,
              subtitleTracks: timeline.subtitleTracks,
            },
          },
          shots: [
            {
              currentImage: image,
              currentVideo: video,
              videoTakes: [{ ...video, ranges: [range] }],
            },
          ],
        },
        shots: [],
        exports: [
          {
            id: `export-${n}`,
            createdAt: n,
            actor: { userId: 1, name: "林" },
            status: "ready",
            videoUrl: `/api/videos/export-${id}-${n}.mp4`,
            aspectRatio: "16:9",
          },
        ],
      })),
    },
  };
  await mkdir(localVideoDir(), { recursive: true });
  for (const file of [
    "take-501.mp4",
    `export-${id}-1.mp4`,
    `export-${id}-2.mp4`,
  ])
    await writeFile(path.join(localVideoDir(), file), `test video ${file}`);
  return id;
}
describe("private full-story mailbox", () => {
  it("sends saved text only, preserves chapter versions, and never transfers private context", async () => {
    const id = await story(),
      source = structuredClone(memoryState.stories[0]);
    const { entry, sent } = await send(id, "加了第二段");
    expect(entry.inventory).toMatchObject({
      chapters: 1,
      images: 0,
      videos: 0,
      timelineItems: 0,
      chapterVersions: 1,
    });
    expect(entry.authorName).toBe("林");
    expect(JSON.stringify(entry)).not.toMatch(
      /userId|senderId|private|snapshot/
    );
    const received = await api(2).receive({ entryId: entry.id });
    const copy = memoryState.stories.find(s => s.id === received.storyId)!;
    expect(JSON.stringify(copy.body)).not.toMatch(
      /private-memory|private-chat/
    );
    expect(JSON.stringify(copy.body)).toContain("最新保存的文字");
    expect(
      memoryState.storyChapterVersions.find(v => v.userId === 2)?.blocks.body
    ).toBe("旧章正文");
    expect(memoryState.stories[0]).toEqual(source);
    expect(await api(1).refresh({ threadId: sent.threadId })).toEqual({
      added: 0,
    });
  });
  it("retains complete media, all versions and exact edit geometry with new owned IDs", async () => {
    const id = await completeStory();
    const original = structuredClone(memoryState.storyTimelines[0]);
    const { entry } = await send(id);
    expect(entry.inventory).toMatchObject({
      images: 1,
      videos: 1,
      audio: 1,
      timelineItems: 1,
      videoVersions: 2,
      exports: 2,
    });
    // Sender deletion cannot remove the retained attachment.
    await rm(resolveManagedAudioPath("a".repeat(32)));
    const received = await api(2).receive({ entryId: entry.id });
    const timeline = memoryState.storyTimelines.find(
      t => t.storyId === received.storyId
    )!;
    const image = memoryState.generatedImages.find(
      i => i.storyId === received.storyId
    )!;
    const video = memoryState.videoTakes.find(
      v => v.storyId === received.storyId
    )!;
    const audio = memoryState.storyAudioAssets.find(
      a => a.storyId === received.storyId
    )!;
    const items = timeline.items as typeof original.items & any;
    expect(items.items[0]).toMatchObject({
      durationFrames: 120,
      timelineStartFrame: 15,
      visualLayer: 2,
      primaryVideoEdit: {
        takeId: video.id,
        sourceStartSec: 1,
        sourceEndSec: 3,
        effects: { playbackRate: 1.5, reverse: true },
      },
      imageTransforms: { [image.id]: { zoom: 1.4 } },
    });
    expect(items.items[0].anchors[0].sourceId).toBe(`image-${image.id}`);
    expect(items.audioTracks.tracks[0].clips[0]).toMatchObject({
      assetId: audio.id,
      sourceInFrame: 5,
      fadeOutFrames: 4,
    });
    expect(items.subtitleTracks).toEqual(
      (original.items as any).subtitleTracks
    );
    expect(
      await readFile(resolveManagedAudioPath(audio.storageKey), "utf8")
    ).toBe("test audio bytes");
    const body = memoryState.stories.find(s => s.id === received.storyId)!
      .body as any;
    expect(body.videoWorkflow.versions).toHaveLength(2);
    expect(video.videoKey).toBe(`take-${video.id}.mp4`);
    expect(
      await readFile(path.join(localVideoDir(), video.videoKey!), "utf8")
    ).toBe("test video take-501.mp4");
    expect(body.videoWorkflow.versions[0].exports[0].videoUrl).toBe(
      `/api/videos/export-${received.storyId}-1.mp4`
    );
    expect(
      await readFile(
        path.join(localVideoDir(), `export-${received.storyId}-1.mp4`),
        "utf8"
      )
    ).toContain("test video");
    expect(body.videoWorkflow.versions[0].author).toEqual({
      userId: 0,
      name: "林",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /private-(prompt|task|key|receipt|card|idempotency)/
    );
    expect(memoryState.storyTimelines[0]).toEqual(original);
  });
  it("attributes saved edits, avoids count-only diffs, and stops future updates after removal", async () => {
    const { entry, sent } = await send(await story());
    const received = await api(2).receive({ entryId: entry.id });
    const chapter = memoryState.storyChapters.find(
      c => c.storyId === received.storyId
    )!;
    chapter.blocks.body = "岱补写了结尾";
    await api(1).refresh({ threadId: sent.threadId });
    const history = await api(1).history({ contactId: mailboxContactId(1, 2) });
    expect(history.entries[0]).toMatchObject({ authorName: "岱", mine: false });
    expect(await api(1).refresh({ threadId: sent.threadId })).toEqual({
      added: 0,
    });
    const count = memoryState.storyMailboxEntries.length;
    await api(1).removeContact({ contactId: mailboxContactId(1, 2) });
    chapter.blocks.body = "删除联系之后的新结尾";
    await expect(
      api(2).refresh({ threadId: sent.threadId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memoryState.storyMailboxEntries).toHaveLength(count);
    expect(await api(2).receive({ entryId: entry.id })).toEqual({
      storyId: received.storyId,
      repeated: true,
    });
    expect(
      memoryState.stories.find(s => s.id === received.storyId)
    ).toBeTruthy();
  });
  it("rejects strangers and foreign stories, envelopes and refreshes", async () => {
    const id = await story();
    const { entry, sent } = await send(id);
    await expect(api(3).receive({ entryId: entry.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      api(3).refresh({ threadId: sent.threadId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      api(3).history({ contactId: mailboxContactId(1, 2) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api(2).preview({ storyId: id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      api(1).send({
        storyId: id,
        contactId: mailboxContactId(1, 3),
        requestId: randomUUID(),
        fingerprint: "a".repeat(64),
        note: "",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("deduplicates concurrent sends/receipts, binds retries, and rejects stale previews", async () => {
    const id = await story();
    const preview = await api(1).preview({ storyId: id });
    const input = {
      storyId: id,
      contactId: mailboxContactId(1, 2),
      requestId: randomUUID(),
      fingerprint: preview.fingerprint,
      note: "hello",
    };
    await Promise.all([api(1).send(input), api(1).send(input)]);
    expect(memoryState.storyMailboxEntries).toHaveLength(1);
    await expect(
      api(1).send({ ...input, note: "different" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const entryId = memoryState.storyMailboxEntries[0].id;
    const copies = await Promise.all([
      api(2).receive({ entryId }),
      api(2).receive({ entryId }),
    ]);
    expect(copies[0].storyId).toBe(copies[1].storyId);
    expect(memoryState.stories).toHaveLength(2);
    memoryState.storyChapters[0].blocks.body = "another edit";
    await expect(
      api(1).send({ ...input, requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects missing assets without partial copies or false success", async () => {
    const id = await completeStory();
    memoryState.videoTakes = [];
    await expect(api(1).preview({ storyId: id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(memoryState.storyMailboxEntries).toHaveLength(0);
    expect(memoryState.stories).toHaveLength(1);
  });
  it("enforces capacity for recipients and receipts without losing prior work", async () => {
    const id = await story();
    const { entry } = await send(id);
    const original = memoryState.storyMailboxEntries[0];
    for (let n = 1; n < 500; n++)
      memoryState.storyMailboxEntries.push({
        ...structuredClone(original),
        id: randomUUID(),
      });
    await expect(api(2).receive({ entryId: entry.id })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(memoryState.stories).toHaveLength(1);
    expect(memoryState.storyMailboxEntries).toHaveLength(500);
    expect(memoryState.storyMailboxEntries[0].receivedStoryId).toBeNull();
    const thread = memoryState.storyMailboxThreads[0];
    for (let n = 1; n < 200; n++)
      memoryState.storyMailboxThreads.push({
        ...thread,
        id: randomUUID(),
        senderId: 3,
      });
    await expect(send(id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(memoryState.storyMailboxThreads).toHaveLength(200);
  });
  it("uses canonical fingerprints after JSON persistence", async () => {
    const pkg = await captureMailboxPackage(await story(), 1);
    expect(mailboxDigest(pkg)).toBe(
      mailboxDigest(JSON.parse(JSON.stringify(pkg)))
    );
    expect(mailboxDigest({ a: 1, b: 2 })).toBe(mailboxDigest({ b: 2, a: 1 }));
  });
  it("marks only observed letters read and paginates without dropping history", async () => {
    const id = await story();
    for (let n = 0; n < 32; n++) await send(id, `Message ${n}`);
    const first = await api(2).history({ contactId: mailboxContactId(2, 1) });
    expect(first.entries).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    await api(2).markRead({
      contactId: mailboxContactId(2, 1),
      entryIds: first.entries.map(e => e.id),
    });
    expect((await api(2).contacts())[0].unread).toBe(2);
    const rest = await api(2).history({
      contactId: mailboxContactId(2, 1),
      cursor: first.nextCursor!,
    });
    expect(rest.entries).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(
      new Set([...first.entries, ...rest.entries].map(e => e.id)).size
    ).toBe(32);
  });
  it("rolls back an incomplete receipt and allows a retry with the same envelope", async () => {
    const id = await completeStory(),
      { entry } = await send(id);
    const saved = memoryState.storyMailboxEntries.find(e => e.id === entry.id)!;
    const audio = saved.snapshot.audio[0];
    const filename = resolveManagedAudioPath(audio.storageKey);
    const bytes = await readFile(filename);
    await rm(filename);
    await expect(api(2).receive({ entryId: entry.id })).rejects.toBeTruthy();
    expect(memoryState.stories).toHaveLength(1);
    expect(
      memoryState.storyMailboxEntries.find(e => e.id === entry.id)
        ?.receivedStoryId
    ).toBeNull();
    await writeFile(filename, bytes);
    expect(await api(2).receive({ entryId: entry.id })).toHaveProperty(
      "storyId"
    );
  });
  it("keeps image and audio assetId namespaces distinct inside film plans", async () => {
    const id = await completeStory(),
      row = memoryState.stories.find(s => s.id === id)!;
    (row.body as Record<string, unknown>).bookVideoRecords = [
      {
        id: "plan",
        versionId: "v",
        status: "adopted",
        layout: { body: "船", illustrations: [{ assetId: 401, after: null }] },
        preparedAudio: {
          version: 1,
          narration: { assetId: 801, sourceAssetId: 801 },
          music: [],
        },
      },
    ];
    memoryState.imageSignals.push({
      id: 1,
      userId: 1,
      storyId: id,
      imageId: 401,
      action: "swipe_right",
      metadata: { secret: "private-learning" },
      createdAt: at,
    });
    const { entry } = await send(id),
      copy = await api(2).receive({ entryId: entry.id });
    const target = memoryState.stories.find(s => s.id === copy.storyId)!
      .body as any;
    const image = memoryState.generatedImages.find(
        i => i.storyId === copy.storyId
      )!,
      audio = memoryState.storyAudioAssets.find(
        a => a.storyId === copy.storyId
      )!;
    expect(target.bookVideoRecords[0].layout.illustrations[0].assetId).toBe(
      image.id
    );
    expect(
      target.bookVideoRecords[0].preparedAudio.narration.sourceAssetId
    ).toBe(audio.id);
    expect(memoryState.imageSignals.find(i => i.userId === 2)).toMatchObject({
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "received-story" },
    });
  });
  it("never rolls back another writer's story when attachment staging fails", async () => {
    const id = await completeStory(),
      { entry } = await send(id);
    let unrelated = 0;
    vi.spyOn(mailboxVideo, "copyMailboxVideos").mockImplementationOnce(
      async () => {
        unrelated = (
          await createStory({
            userId: 3,
            title: "Concurrent independent story",
            body: {},
          })
        ).id;
        expect(memoryState.stories.filter(s => s.userId === 2)).toHaveLength(0);
        throw new Error("simulated attachment failure");
      }
    );
    await expect(api(2).receive({ entryId: entry.id })).rejects.toBeTruthy();
    expect(memoryState.stories.find(s => s.id === unrelated)?.title).toBe(
      "Concurrent independent story"
    );
    expect(memoryState.stories.filter(s => s.userId === 2)).toHaveLength(0);
  });
});
