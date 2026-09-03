import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import {
  createStory,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "./db";
import { appRouter } from "./routers";
import { clearVisualEditUndoForTesting } from "./services/visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./services/visualEditSessionRegistry";

const savedDatabaseUrl = ENV.databaseUrl;

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `timeline-media-${userId}`,
      email: `timeline-media-${userId}@example.com`,
      name: `Timeline Media ${userId}`,
      loginMethod: "test",
      role: "user",
      sessionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

async function seedStory(userId: number): Promise<number> {
  const story = await createStory({
    userId,
    title: "subtitle router",
    body: { _revision: 1, shots: [{ stableShotId: "shot-a", shotNo: 1 }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId,
    expectedVersion: 0,
    items: [{ stableShotId: "shot-a", included: true, position: 0 }],
  });
  return story.id;
}

async function cues(storyId: number, userId: number) {
  const row = (await getStoryTimeline(storyId, userId)) as {
    extensions?: { subtitleTracks?: { tracks: { cues: Array<{ id: string; text: string; textRevision: number }> }[] } };
  } | null;
  return row?.extensions?.subtitleTracks?.tracks?.[0]?.cues ?? [];
}

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
});

describe("timelineMedia router", () => {
  it("initializes and edits a subtitle cue through narrow input, without expectedVersion", async () => {
    const caller = appRouter.createCaller(context(701));
    const storyId = await seedStory(701);

    const init = await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "shot-dialogue", stableShotId: "shot-a" },
          sourceTextRevision: 1,
        },
      ],
    });
    expect(init).toMatchObject({ status: "ok", changed: true });

    const [cue] = await cues(storyId, 701);
    const edit = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-edit" },
      cueId: cue.id,
      text: "改过的第一句",
      expectedTextRevision: cue.textRevision,
    });
    expect(edit).toMatchObject({ status: "ok", changed: true });
    expect((await cues(storyId, 701))[0].text).toBe("改过的第一句");
  });

  it("rejects a cross-Story cue id", async () => {
    const owner = appRouter.createCaller(context(702));
    const intruder = appRouter.createCaller(context(703));
    const ownerStory = await seedStory(702);
    const intruderStory = await seedStory(703);

    await owner.timelineMedia.initializeSubtitles({
      storyId: ownerStory,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "秘密",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [ownerCue] = await cues(ownerStory, 702);

    const stolen = await intruder.timelineMedia.editSubtitleText({
      storyId: intruderStory,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-steal" },
      cueId: ownerCue.id,
      text: "改别人的",
      expectedTextRevision: ownerCue.textRevision,
    });
    expect(stolen).toMatchObject({ status: "error" });
    expect(await cues(ownerStory, 702)).toMatchObject([{ text: "秘密" }]);
  });

  it("undoes the newest media edit", async () => {
    const caller = appRouter.createCaller(context(704));
    const storyId = await seedStory(704);
    await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [cue] = await cues(storyId, 704);
    await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-edit" },
      cueId: cue.id,
      text: "编辑后",
      expectedTextRevision: cue.textRevision,
    });

    const undo = await caller.timelineMedia.undoLatestMediaEdit({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-undo" },
    });
    expect(undo).toMatchObject({ status: "ok", changed: true });
    expect((await cues(storyId, 704))[0].text).toBe("第一句");
  });

  it("replays a repeated operation id without a second write", async () => {
    const caller = appRouter.createCaller(context(705));
    const storyId = await seedStory(705);
    await caller.timelineMedia.initializeSubtitles({
      storyId,
      operation: { editorSessionEpoch: "tab-a", operationId: "op-init" },
      candidates: [
        {
          startFrame: 0,
          durationFrames: 60,
          text: "第一句",
          provenance: { kind: "manual" },
          sourceTextRevision: 0,
        },
      ],
    });
    const [cue] = await cues(storyId, 705);
    const op = { editorSessionEpoch: "tab-a", operationId: "op-edit-once" };
    const first = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: op,
      cueId: cue.id,
      text: "只写一次",
      expectedTextRevision: cue.textRevision,
    });
    const replay = await caller.timelineMedia.editSubtitleText({
      storyId,
      operation: op,
      cueId: cue.id,
      text: "只写一次",
      expectedTextRevision: cue.textRevision,
    });
    expect(first).toMatchObject({ status: "ok", changed: true });
    expect(replay).toMatchObject({
      status: "ok",
      timelineVersion: (first as { timelineVersion: number }).timelineVersion,
    });
  });
});

afterAll(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});
