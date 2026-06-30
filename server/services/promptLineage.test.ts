import { describe, expect, it } from "vitest";
import { migrateLegacyPromptLineage } from "./promptLineageMigration";
import {
  createPromptCandidate,
  confirmPromptCandidate,
  previewPromptCandidate,
  rejectPromptCandidate,
  restorePromptRevision,
} from "./promptLineage";
import { createPromptLineageMemoryStore } from "./promptLineageStore";

async function seededStore() {
  const store = createPromptLineageMemoryStore();
  await migrateLegacyPromptLineage(store, {
    storyId: 28,
    userId: 7,
    body: {
      shots: [
        {
          stableShotId: "shot-01",
          shotNo: 1,
          subject: "主角站在雨后的街口",
          dialogue: "没关系，就这样吧",
          promptDraft: "雨后街口，写实电影感",
          cameraMove: "固定机位",
        },
      ],
    },
  });
  return store;
}

describe("prompt lineage candidate service", () => {
  it("previews and confirms a video-local revision without recompiling other modalities", async () => {
    const store = await seededStore();
    const before = store.getStoryAggregate({ storyId: 28, userId: 7 });
    const videoNode = before.nodes.find(
      node => node.dimension === "camera_motion",
    )!;
    const currentHeads = Object.fromEntries(
      before.compilationHeads.map(head => [head.modality, head.currentCompilationId]),
    );

    const candidate = await createPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      nodeId: videoNode.id,
      content: "缓慢推近",
      reason: "让情绪更靠近人物",
      authorType: "user",
      expectedVersion: 1,
      operationKey: "candidate-video-1",
    });
    const preview = previewPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      candidateRevisionId: candidate.candidate.id,
    });

    expect(preview.impactedModalities).toEqual(["video"]);
    expect(preview.proposed.video.finalText).toContain("缓慢推近");

    const confirmed = await confirmPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      candidateRevisionId: candidate.candidate.id,
      expectedVersion: candidate.version,
      operationKey: "confirm-video-1",
    });
    const after = store.getStoryAggregate({ storyId: 28, userId: 7 });
    const nextHeads = Object.fromEntries(
      after.compilationHeads.map(head => [head.modality, head.currentCompilationId]),
    );

    expect(confirmed.impactedModalities).toEqual(["video"]);
    expect(nextHeads.dialogue).toBe(currentHeads.dialogue);
    expect(nextHeads.image).toBe(currentHeads.image);
    expect(nextHeads.video).not.toBe(currentHeads.video);
  });

  it("rejects an agent candidate without changing current revision or compilations", async () => {
    const store = await seededStore();
    const before = store.getStoryAggregate({ storyId: 28, userId: 7 });
    const dialogueNode = before.nodes.find(
      node => node.dimension === "dialogue",
    )!;
    const candidate = await createPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      nodeId: dialogueNode.id,
      content: "我已经不在乎了",
      reason: "agent suggestion",
      authorType: "agent",
      expectedVersion: 1,
      operationKey: "candidate-dialogue-1",
    });

    await rejectPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      candidateRevisionId: candidate.candidate.id,
      expectedVersion: candidate.version,
      operationKey: "reject-dialogue-1",
    });

    const after = store.getStoryAggregate({ storyId: 28, userId: 7 });
    expect(
      after.nodes.find(node => node.id === dialogueNode.id)?.currentRevisionId,
    ).toBe(dialogueNode.currentRevisionId);
    expect(after.compilationHeads).toEqual(before.compilationHeads);
    expect(
      after.revisions.find(revision => revision.id === candidate.candidate.id)
        ?.status,
    ).toBe("rejected");
  });

  it("restores history by creating a new candidate whose parent is current", async () => {
    const store = await seededStore();
    const aggregate = store.getStoryAggregate({ storyId: 28, userId: 7 });
    const videoNode = aggregate.nodes.find(
      node => node.dimension === "camera_motion",
    )!;
    const historicalRevisionId = videoNode.currentRevisionId!;
    const candidate = await createPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      nodeId: videoNode.id,
      content: "快速横移",
      reason: "first edit",
      authorType: "user",
      expectedVersion: 1,
      operationKey: "candidate-video-edit",
    });
    await confirmPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      candidateRevisionId: candidate.candidate.id,
      expectedVersion: candidate.version,
      operationKey: "confirm-video-edit",
    });

    const restored = await restorePromptRevision(store, {
      storyId: 28,
      userId: 7,
      revisionId: historicalRevisionId,
      expectedVersion: 3,
      operationKey: "restore-video-history",
    });

    expect(restored.candidate.content).toBe("固定机位");
    expect(restored.candidate.id).not.toBe(historicalRevisionId);
    expect(restored.candidate.parentRevisionId).toBe(candidate.candidate.id);
    expect(restored.candidate.status).toBe("candidate");
  });

  it("allows a weight-only candidate and recompiles the affected modality", async () => {
    const store = await seededStore();
    const aggregate = store.getStoryAggregate({ storyId: 28, userId: 7 });
    const videoNode = aggregate.nodes.find(
      node => node.dimension === "camera_motion",
    )!;
    const currentRevision = aggregate.revisions.find(
      revision => revision.id === videoNode.currentRevisionId,
    )!;

    const candidate = await createPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      nodeId: videoNode.id,
      content: currentRevision.content,
      weight: 0.55,
      reason: "提高视频动作权重",
      authorType: "user",
      expectedVersion: 1,
      operationKey: "candidate-video-weight-only",
    });
    const preview = previewPromptCandidate(store, {
      storyId: 28,
      userId: 7,
      candidateRevisionId: candidate.candidate.id,
    });

    expect(candidate.candidate.weight).toBe(0.55);
    expect(preview.impactedModalities).toEqual(["video"]);
    expect(preview.proposed.video.finalText).toContain(
      "camera_motion(55%): 固定机位",
    );
  });
});
