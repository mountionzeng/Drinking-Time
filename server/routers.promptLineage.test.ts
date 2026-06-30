import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStateForTesting } from "./db";
import { appRouter } from "./routers";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `prompt-user-${userId}`,
      email: `prompt-${userId}@example.com`,
      name: `Prompt User ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

async function createStory(userId = 501) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "提示词谱系测试",
    body: {
      cards: [],
      characters: [],
      shots: [
        {
          stableShotId: "shot-01",
          shotNo: 1,
          subject: "主角站在雨后的街口",
          dialogue: "没关系，就这样吧",
          promptDraft: "雨后的街口，写实电影感",
          cameraMove: "固定机位",
        },
      ],
    },
  });
  return { caller, story: story! };
}

describe("promptLineage tRPC router", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("creates, previews, and confirms one video-local candidate", async () => {
    const { caller, story } = await createStory();
    const loaded = await caller.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    expect(loaded.mode).toBe("lineage");
    if (loaded.mode !== "lineage") throw new Error("expected lineage mode");
    const videoNode = loaded.projection.nodes.find(
      node => node.dimension === "camera_motion",
    )!;
    const headsBefore = Object.fromEntries(
      loaded.projection.compilationHeads.map(head => [
        head.modality,
        head.currentCompilationId,
      ]),
    );

    const created = await caller.promptLineage.createCandidate({
      storyId: story.id,
      nodeId: videoNode.id,
      content: "缓慢推近",
      reason: "更靠近人物",
      expectedVersion: loaded.projection.state.version,
      operationKey: "router-candidate-1",
    });
    const preview = await caller.promptLineage.previewCandidate({
      storyId: story.id,
      candidateRevisionId: created.candidate.id,
    });
    expect(preview.impactedModalities).toEqual(["video"]);

    const confirmed = await caller.promptLineage.confirmCandidate({
      storyId: story.id,
      candidateRevisionId: created.candidate.id,
      expectedVersion: created.version,
      operationKey: "router-confirm-1",
    });
    const headsAfter = Object.fromEntries(
      confirmed.projection!.compilationHeads.map(head => [
        head.modality,
        head.currentCompilationId,
      ]),
    );
    expect(headsAfter.dialogue).toBe(headsBefore.dialogue);
    expect(headsAfter.image).toBe(headsBefore.image);
    expect(headsAfter.video).not.toBe(headsBefore.video);
  });

  it("rejects stale expected versions and preserves the current pointer", async () => {
    const { caller, story } = await createStory();
    const loaded = await caller.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    if (loaded.mode !== "lineage") throw new Error("expected lineage mode");
    const dialogueNode = loaded.projection.nodes.find(
      node => node.dimension === "dialogue",
    )!;
    const currentRevisionId = dialogueNode.currentRevisionId;

    await expect(
      caller.promptLineage.createCandidate({
        storyId: story.id,
        nodeId: dialogueNode.id,
        content: "我已经不在乎了",
        expectedVersion: loaded.projection.state.version - 1,
        operationKey: "router-stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await caller.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    if (after.mode !== "lineage") throw new Error("expected lineage mode");
    expect(
      after.projection.nodes.find(node => node.id === dialogueNode.id)
        ?.currentRevisionId,
    ).toBe(currentRevisionId);
  });

  it("restores a historical revision as a new confirmed current revision", async () => {
    const { caller, story } = await createStory();
    const loaded = await caller.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    if (loaded.mode !== "lineage") throw new Error("expected lineage mode");
    const node = loaded.projection.nodes.find(
      item => item.dimension === "camera_motion",
    )!;
    const original = loaded.projection.revisions.find(
      revision => revision.id === node.currentRevisionId,
    )!;

    const created = await caller.promptLineage.createCandidate({
      storyId: story.id,
      nodeId: node.id,
      content: "快速横移",
      weight: 0.9,
      expectedVersion: loaded.projection.state.version,
      operationKey: "router-restore-create",
    });
    const changed = await caller.promptLineage.confirmCandidate({
      storyId: story.id,
      candidateRevisionId: created.candidate.id,
      expectedVersion: created.version,
      operationKey: "router-restore-confirm",
    });

    const restored = await caller.promptLineage.restoreRevision({
      storyId: story.id,
      revisionId: original.id,
      expectedVersion: changed.version,
      operationKey: "router-restore-history",
    });

    expect(restored.candidate).toMatchObject({
      status: "confirmed",
      content: original.content,
      weight: original.weight,
    });
    expect(restored.candidate.id).not.toBe(original.id);
    expect(
      restored.projection?.nodes.find(item => item.id === node.id)
        ?.currentRevisionId,
    ).toBe(restored.candidate.id);
  });

  it("does not expose another user's prompt projection", async () => {
    const { story } = await createStory(501);
    const intruder = appRouter.createCaller(context(502));

    await expect(
      intruder.promptLineage.getStoryProjection({ storyId: story.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refreshes an initial empty projection after storyUpsert adds shots", async () => {
    const caller = appRouter.createCaller(context(503));
    const story = await caller.storyAgent.storyUpsert({
      title: "先空后补镜头",
      body: {
        cards: [],
        characters: [],
        shots: [],
      },
    });
    expect(story).toBeTruthy();

    await caller.storyAgent.storyUpsert({
      id: story!.id,
      title: story!.title,
      body: {
        cards: [],
        characters: [],
        shots: [
          {
            stableShotId: "shot-01",
            shotNo: 1,
            subject: "主角站在地铁口",
            dialogue: "今天先这样",
            promptDraft: "single cinematic frame, subway entrance, warm realism",
            cameraMove: "轻微推近",
          },
        ],
      },
    });

    const loaded = await caller.promptLineage.getStoryProjection({
      storyId: story!.id,
    });
    expect(loaded.mode).toBe("lineage");
    if (loaded.mode !== "lineage") throw new Error("expected lineage mode");
    expect(
      loaded.projection.compilationHeads.map(
        head => `${head.stableShotId}:${head.modality}`,
      ),
    ).toEqual([
      "shot-01:dialogue",
      "shot-01:image",
      "shot-01:video",
    ]);
  });
});
