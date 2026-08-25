import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  story: {
    id: 1,
    userId: 7,
    body: {
      shots: [{ stableShotId: "shot-a", subject: "original", secret: "no" }],
    },
  },
  material: {
    timeline: {
      version: 1,
      items: [
        {
          stableShotId: "shot-a",
          included: true,
          position: 0,
          plannedDurationMs: 1000,
          durationFrames: 30,
          timelineStartFrame: 0,
          visualLayer: 2,
          transform: {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          },
        },
      ],
      overlays: [],
    },
    shots: [],
  },
  runStoryTimelineCommand: vi.fn(),
}));

vi.mock("../persistence/storyVisualPersistence", () => ({
  loadOwnedStoryVisualAggregate: vi.fn(
    async ({ storyId, userId }: { storyId: number; userId: number }) =>
      storyId === mocks.story.id && userId === mocks.story.userId
        ? { story: mocks.story, timeline: null, videoTakes: [] }
        : null
  ),
  authorizeStoryVisualReferences: vi.fn(async () => ({
    referencedImage: null,
    videoTakes: [],
  })),
}));
vi.mock("./storyMaterials", () => ({
  getStoryMaterialState: vi.fn(async (storyId: number, userId: number) =>
    storyId === mocks.story.id && userId === mocks.story.userId
      ? mocks.material
      : null
  ),
  projectStoryTimelineDocument: vi.fn(() => mocks.material.timeline),
}));
vi.mock("./storyTimelineEditing", () => ({
  runStoryTimelineCommand: mocks.runStoryTimelineCommand,
}));

import {
  clearStoryVisualClipboardForTesting,
  copyStoryVisualObject,
  deleteStoryVisualShot,
  pasteStoryVisualObject,
  retireStoryVisualClipboardScope,
} from "./storyVisualObjectEditing";

describe("story visual object clipboard", () => {
  beforeEach(() => clearStoryVisualClipboardForTesting());

  it("stores an immutable canonical allow-listed copy-time snapshot", async () => {
    const copied = await copyStoryVisualObject({
      storyId: 1,
      userId: 7,
      editorSessionEpoch: "epoch-a",
      clipboardId: "clipboard-a",
      object: { type: "story-shot", stableShotId: "shot-a" },
    });
    expect(copied.status).toBe("ok");
    if (copied.status !== "ok" || copied.snapshot.kind !== "story-shot") return;
    expect(copied.snapshot.shot).toMatchObject({ subject: "original" });
    expect(copied.snapshot.sourceLayer).toBe(2);
    expect(copied.snapshot.shot).not.toHaveProperty("secret");
    mocks.story.body.shots[0].subject = "changed-later";
    expect(copied.snapshot.shot.subject).toBe("original");
  });

  it("does not expose a clipboard across users, stories, or epochs", async () => {
    await copyStoryVisualObject({
      storyId: 1,
      userId: 7,
      editorSessionEpoch: "epoch-a",
      clipboardId: "clipboard-a",
      object: { type: "story-shot", stableShotId: "shot-a" },
    });
    for (const scope of [
      { storyId: 1, userId: 8, epoch: "epoch-a" },
      { storyId: 2, userId: 7, epoch: "epoch-a" },
      { storyId: 1, userId: 7, epoch: "epoch-b" },
    ]) {
      const result = await pasteStoryVisualObject({
        storyId: scope.storyId,
        userId: scope.userId,
        operation: { editorSessionEpoch: scope.epoch, operationId: "paste-a" },
        clipboardId: "clipboard-a",
        targetFrame: 0,
        targetLayer: 0,
      });
      expect(result).toMatchObject({ status: "error", errorKind: "invalid" });
    }
  });

  it("releases clipboard snapshots when an editor epoch is retired", async () => {
    await copyStoryVisualObject({
      storyId: 1,
      userId: 7,
      editorSessionEpoch: "epoch-a",
      clipboardId: "clipboard-a",
      object: { type: "story-shot", stableShotId: "shot-a" },
    });

    retireStoryVisualClipboardScope({
      storyId: 1,
      userId: 7,
      editorSessionEpoch: "epoch-a",
    });

    await expect(
      pasteStoryVisualObject({
        storyId: 1,
        userId: 7,
        operation: {
          editorSessionEpoch: "epoch-a",
          operationId: "paste-retired",
        },
        clipboardId: "clipboard-a",
        targetFrame: 0,
        targetLayer: 0,
      })
    ).resolves.toMatchObject({ status: "error", errorKind: "invalid" });
  });

  it("serializes aggregate commands in the shared user/story service lock", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    mocks.runStoryTimelineCommand
      .mockImplementationOnce(async () => {
        await firstGate;
        return { status: "error", error: "first", errorKind: "invalid" };
      })
      .mockResolvedValueOnce({
        status: "error",
        error: "second",
        errorKind: "invalid",
      });
    const first = deleteStoryVisualShot({
      storyId: 1,
      userId: 7,
      operation: { editorSessionEpoch: "epoch-a", operationId: "delete-a" },
      stableShotId: "shot-a",
    });
    await Promise.resolve();
    const second = deleteStoryVisualShot({
      storyId: 1,
      userId: 7,
      operation: { editorSessionEpoch: "epoch-a", operationId: "delete-b" },
      stableShotId: "shot-a",
    });
    await vi.waitFor(() =>
      expect(mocks.runStoryTimelineCommand).toHaveBeenCalledTimes(1)
    );
    releaseFirst();
    await Promise.all([first, second]);
    expect(mocks.runStoryTimelineCommand).toHaveBeenCalledTimes(2);
  });
});
