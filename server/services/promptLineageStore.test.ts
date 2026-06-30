import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalPromptLineageState,
  resetMemoryStateForTesting,
} from "../db";
import {
  PromptLineageConflictError,
  PromptLineageOwnershipError,
  createPromptLineageMemoryStore,
  createPersistentLocalPromptLineageStore,
} from "./promptLineageStore";

const owner = { storyId: 28, userId: 7 };

describe("prompt lineage memory store", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("keeps immutable revision history while moving one current pointer", async () => {
    const store = createPromptLineageMemoryStore();

    const seeded = await store.transact(
      { ...owner, expectedVersion: 0, operationKey: "seed" },
      tx => {
        const node = tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "shared",
          dimension: "subject",
        });
        const revision = tx.createRevision({
          nodeId: node.id,
          content: "主角站在雨后的街口",
          authorType: "migration",
          reason: "legacy import",
        });
        tx.confirmRevision(node.id, revision.id);
        tx.bindNode({
          nodeId: node.id,
          stableShotId: "shot-01",
          modality: "shared",
          sortOrder: 0,
        });
        return { nodeId: node.id, revisionId: revision.id };
      },
    );

    const candidate = await store.transact(
      { ...owner, expectedVersion: 1, operationKey: "candidate-1" },
      tx =>
        tx.createRevision({
          nodeId: seeded.result.nodeId,
          content: "主角穿深色风衣站在雨后的街口",
          authorType: "user",
          parentRevisionId: seeded.result.revisionId,
          reason: "强调服装连续性",
          status: "candidate",
        }),
    );

    await store.transact(
      { ...owner, expectedVersion: 2, operationKey: "confirm-1" },
      tx => tx.confirmRevision(seeded.result.nodeId, candidate.result.id),
    );

    const aggregate = store.getStoryAggregate(owner);
    expect(aggregate.state.version).toBe(3);
    expect(aggregate.nodes[0]?.currentRevisionId).toBe(candidate.result.id);
    expect(aggregate.revisions).toHaveLength(2);
    expect(aggregate.revisions.map(revision => revision.content)).toEqual([
      "主角站在雨后的街口",
      "主角穿深色风衣站在雨后的街口",
    ]);
  });

  it("returns the original receipt for a repeated operation key", async () => {
    const store = createPromptLineageMemoryStore();
    const run = () =>
      store.transact(
        { ...owner, expectedVersion: 0, operationKey: "seed-once" },
        tx =>
          tx.createNode({
            stableShotId: "shot-01",
            scope: "shot",
            modality: "dialogue",
            dimension: "dialogue",
          }),
      );

    const first = await run();
    const second = await run();

    expect(second).toEqual(first);
    expect(store.getStoryAggregate(owner).nodes).toHaveLength(1);
    expect(store.getStoryAggregate(owner).state.version).toBe(1);
  });

  it("rejects stale versions without changing the aggregate", async () => {
    const store = createPromptLineageMemoryStore();
    await store.transact(
      { ...owner, expectedVersion: 0, operationKey: "seed" },
      tx =>
        tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "image",
          dimension: "composition",
        }),
    );

    await expect(
      store.transact(
        { ...owner, expectedVersion: 0, operationKey: "stale" },
        tx =>
          tx.createNode({
            stableShotId: "shot-02",
            scope: "shot",
            modality: "image",
            dimension: "composition",
          }),
      ),
    ).rejects.toBeInstanceOf(PromptLineageConflictError);

    expect(store.getStoryAggregate(owner).nodes).toHaveLength(1);
    expect(store.getStoryAggregate(owner).state.version).toBe(1);
  });

  it("rejects cross-story revisions and rolls back earlier writes", async () => {
    const store = createPromptLineageMemoryStore();
    const other = { storyId: 29, userId: 7 };
    const otherNode = await store.transact(
      { ...other, expectedVersion: 0, operationKey: "other-seed" },
      tx =>
        tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "video",
          dimension: "camera_motion",
        }),
    );

    await expect(
      store.transact(
        { ...owner, expectedVersion: 0, operationKey: "bad-cross-story" },
        tx => {
          tx.createNode({
            stableShotId: "shot-01",
            scope: "shot",
            modality: "video",
            dimension: "camera_motion",
          });
          tx.createRevision({
            nodeId: otherNode.result.id,
            content: "缓慢推近",
            authorType: "user",
          });
        },
      ),
    ).rejects.toBeInstanceOf(PromptLineageOwnershipError);

    expect(store.hasStoryState(owner)).toBe(false);
  });

  it("round-trips serialized local state with compilation input order", async () => {
    const store = createPromptLineageMemoryStore();
    await store.transact(
      { ...owner, expectedVersion: 0, operationKey: "compile" },
      tx => {
        const firstNode = tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "shared",
          dimension: "subject",
        });
        const firstRevision = tx.createRevision({
          nodeId: firstNode.id,
          content: "主角",
          authorType: "user",
        });
        tx.confirmRevision(firstNode.id, firstRevision.id);

        const secondNode = tx.createNode({
          stableShotId: "shot-01",
          scope: "modality",
          modality: "video",
          dimension: "camera_motion",
        });
        const secondRevision = tx.createRevision({
          nodeId: secondNode.id,
          content: "轻微推近",
          authorType: "user",
        });
        tx.confirmRevision(secondNode.id, secondRevision.id);

        tx.createCompilation({
          stableShotId: "shot-01",
          modality: "video",
          finalText: "主角，轻微推近",
          inputFingerprint: "fingerprint-1",
          revisionIds: [firstRevision.id, secondRevision.id],
        });
      },
    );

    const restored = createPromptLineageMemoryStore(store.serialize());
    const aggregate = restored.getStoryAggregate(owner);

    expect(aggregate.compilations).toHaveLength(1);
    expect(aggregate.compilationInputs.map(input => input.position)).toEqual([
      0, 1,
    ]);
    expect(aggregate.compilationInputs.map(input => input.revisionId)).toEqual(
      aggregate.revisions.map(revision => revision.id),
    );
  });

  it("commits the aggregate through the repository local persistence path", async () => {
    const store = await createPersistentLocalPromptLineageStore();
    await store.transact(
      { ...owner, expectedVersion: 0, operationKey: "persisted-seed" },
      tx =>
        tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "dialogue",
          dimension: "dialogue",
        }),
    );

    const persisted = await getLocalPromptLineageState();
    expect(persisted?.storyStates).toMatchObject([
      { storyId: 28, userId: 7, version: 1 },
    ]);
    expect(persisted?.nodes).toHaveLength(1);
  });
});
