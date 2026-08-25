import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { createStory, resetMemoryStateForTesting, updateStoryTimeline } from "./db";
import { appRouter } from "./routers";
import {
  clearVisualEditUndoForTesting,
  visualEditUndoDepth,
} from "./services/visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./services/visualEditSessionRegistry";
import { storyVisualClipboardSizeForTesting } from "./services/storyVisualObjectEditing";

function context(userId: number): TrpcContext {
  return {
    user: { id: userId, openId: `visual-${userId}`, email: null, name: "Visual", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function seed(userId = 901) {
  const story = await createStory({ userId, title: "visual routes", body: { shots: [{ stableShotId: "shot-a", shotNo: 1 }, { stableShotId: "shot-b", shotNo: 2 }] } });
  await updateStoryTimeline({
    storyId: story.id,
    userId,
    expectedVersion: 0,
    items: ["shot-a", "shot-b"].map((stableShotId, position) => ({ stableShotId, included: true, position, plannedDurationMs: 1000, durationFrames: 30, timelineStartFrame: position * 30, visualLayer: 0, transform: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 } })),
  });
  return story.id;
}

beforeEach(async () => {
  await resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
});

describe("creationAgent unified story visual object routes", () => {
  it("routes copy/paste/delete/split by authenticated user and story", async () => {
    const storyId = await seed();
    const owner = appRouter.createCaller(context(901));
    const stranger = appRouter.createCaller(context(902));
    await expect(stranger.creationAgent.copyStoryVisualObject({ storyId, editorSessionEpoch: "epoch", clipboardId: "copy", object: { type: "story-shot", stableShotId: "shot-a" } })).resolves.toMatchObject({ status: "error" });
    const copied = await owner.creationAgent.copyStoryVisualObject({ storyId, editorSessionEpoch: "epoch", clipboardId: "copy", object: { type: "story-shot", stableShotId: "shot-a" } });
    expect(copied).toMatchObject({ status: "ok", snapshot: { kind: "story-shot", sourceLayer: 0 } });
    await expect(owner.creationAgent.pasteStoryVisualObject({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "paste" }, clipboardId: "copy", targetFrame: 60, targetLayer: 2 })).resolves.toMatchObject({ status: "ok", stableShotId: expect.any(String) });
    await expect(owner.creationAgent.splitStoryVisualShot({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "split" }, stableShotId: "shot-a", cutFrame: 15 })).resolves.toMatchObject({ status: "ok", rightStableShotId: expect.any(String) });
    await expect(owner.creationAgent.deleteStoryVisualShot({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "delete" }, stableShotId: "shot-b" })).resolves.toMatchObject({ status: "ok", selectedStableShotId: expect.any(String) });
    await expect(stranger.creationAgent.deleteStoryVisualShot({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "foreign-delete" }, stableShotId: "shot-a" })).resolves.toMatchObject({ status: "error" });
  });

  it("accepts strict domain intents and rejects client Story/Timeline snapshots", async () => {
    const storyId = await seed();
    const caller = appRouter.createCaller(context(901));
    const poison = { beforeStoryBody: { shots: [] }, beforeTimelineItems: [], snapshot: { shot: { stableShotId: "forged" } } };
    await expect(caller.creationAgent.copyStoryVisualObject({ storyId, editorSessionEpoch: "epoch", clipboardId: "copy", object: { type: "story-shot", stableShotId: "shot-a" }, ...poison } as any)).rejects.toThrow();
    await expect(caller.creationAgent.pasteStoryVisualObject({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "paste" }, clipboardId: "copy", targetFrame: 0, targetLayer: 0, ...poison } as any)).rejects.toThrow();
    await expect(caller.creationAgent.deleteStoryVisualShot({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "delete" }, stableShotId: "shot-a", ...poison } as any)).rejects.toThrow();
    await expect(caller.creationAgent.splitStoryVisualShot({ storyId, operation: { editorSessionEpoch: "epoch", operationId: "split" }, stableShotId: "shot-a", cutFrame: 15, ...poison } as any)).rejects.toThrow();
  });

  it("activates a strict authenticated editor client session", async () => {
    const storyId = await seed();
    const owner = appRouter.createCaller(context(901));
    const stranger = appRouter.createCaller(context(902));
    await expect(owner.creationAgent.activateVisualEditSession({ storyId, editorClientId: "tab-a", editorSessionEpoch: "epoch-a", activationSequence: 1 })).resolves.toMatchObject({ status: "ok", activeEpoch: "epoch-a" });
    await expect(owner.creationAgent.activateVisualEditSession({ storyId, editorClientId: "tab-a", editorSessionEpoch: "epoch-b", activationSequence: 2 })).resolves.toMatchObject({ status: "ok", replacedEpoch: "epoch-a" });
    await expect(stranger.creationAgent.activateVisualEditSession({ storyId, editorClientId: "tab-x", editorSessionEpoch: "epoch-x", activationSequence: 1 })).resolves.toMatchObject({ status: "error" });
    await expect(owner.creationAgent.activateVisualEditSession({ storyId, editorClientId: "tab-a", editorSessionEpoch: "epoch-c", activationSequence: 3, beforeStoryBody: {} } as any)).rejects.toThrow();
  });

  it("releases both clipboard and undo snapshots when replacing an editor epoch", async () => {
    const storyId = await seed();
    const owner = appRouter.createCaller(context(901));
    const retiredScope = {
      storyId,
      userId: 901,
      editorSessionEpoch: "epoch-a",
    };
    await owner.creationAgent.activateVisualEditSession({
      storyId,
      editorClientId: "tab-a",
      editorSessionEpoch: "epoch-a",
      activationSequence: 1,
    });
    await owner.creationAgent.copyStoryVisualObject({
      storyId,
      editorSessionEpoch: "epoch-a",
      clipboardId: "copy-a",
      object: { type: "story-shot", stableShotId: "shot-a" },
    });
    await owner.creationAgent.deleteStoryVisualShot({
      storyId,
      operation: { editorSessionEpoch: "epoch-a", operationId: "delete-a" },
      stableShotId: "shot-b",
    });
    expect(storyVisualClipboardSizeForTesting(retiredScope)).toBe(1);
    expect(visualEditUndoDepth(retiredScope)).toBe(1);

    await expect(
      owner.creationAgent.activateVisualEditSession({
        storyId,
        editorClientId: "tab-a",
        editorSessionEpoch: "epoch-b",
        activationSequence: 2,
      })
    ).resolves.toMatchObject({ status: "ok", replacedEpoch: "epoch-a" });

    expect(storyVisualClipboardSizeForTesting(retiredScope)).toBe(0);
    expect(visualEditUndoDepth(retiredScope)).toBe(0);
  });
});
