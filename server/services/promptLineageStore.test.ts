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
  loadStoryPromptAggregate,
  loadStoryPromptCompilationHeads,
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

describe("loadStoryPromptAggregate — single-Story narrow read (local mode)", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  const seedStory = async (
    seedOwner: { storyId: number; userId: number },
    dimension: string,
  ) => {
    const store = await createPersistentLocalPromptLineageStore();
    await store.transact(
      { ...seedOwner, expectedVersion: 0, operationKey: `seed-${seedOwner.storyId}` },
      tx => {
        const node = tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "shared",
          dimension,
        });
        const revision = tx.createRevision({
          nodeId: node.id,
          content: `内容属于 story ${seedOwner.storyId}`,
          authorType: "user",
        });
        tx.confirmRevision(node.id, revision.id);
        tx.createCompilation({
          stableShotId: "shot-01",
          modality: "video",
          finalText: `编译属于 story ${seedOwner.storyId}`,
          inputFingerprint: `fp-${seedOwner.storyId}`,
          revisionIds: [revision.id],
        });
      },
    );
  };

  it("excludes an unrelated Story's nodes/revisions/compilations from the aggregate", async () => {
    const target = { storyId: 101, userId: 5 };
    const other = { storyId: 202, userId: 5 };
    await seedStory(target, "subject");
    await seedStory(other, "subject");

    const aggregate = await loadStoryPromptAggregate(target);

    expect(aggregate?.state.storyId).toBe(target.storyId);
    expect(aggregate?.nodes).toHaveLength(1);
    expect(aggregate?.revisions.map(r => r.content)).toEqual([
      "内容属于 story 101",
    ]);
    expect(aggregate?.compilations.map(c => c.finalText)).toEqual([
      "编译属于 story 101",
    ]);
    // 没有一条记录把另一个 Story 的 storyId 带出来。
    for (const collection of [
      aggregate?.nodes,
      aggregate?.revisions,
      aggregate?.compilations,
    ]) {
      for (const item of collection ?? []) {
        expect((item as { storyId: number }).storyId).toBe(target.storyId);
      }
    }
  });

  it("throws PromptLineageOwnershipError when the Story belongs to a different user", async () => {
    const target = { storyId: 303, userId: 5 };
    await seedStory(target, "subject");

    await expect(
      loadStoryPromptAggregate({ storyId: target.storyId, userId: 999 }),
    ).rejects.toBeInstanceOf(PromptLineageOwnershipError);
  });

  it("returns null for a Story with no prompt lineage state yet, without throwing", async () => {
    const aggregate = await loadStoryPromptAggregate({
      storyId: 404,
      userId: 5,
    });
    expect(aggregate).toBeNull();
  });
});

describe("loadStoryPromptCompilationHeads — heads-only narrow read (local mode)", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("returns only this Story's compilation heads with the fields storyMaterials needs", async () => {
    const target = { storyId: 111, userId: 8 };
    const other = { storyId: 222, userId: 8 };
    const store = await createPersistentLocalPromptLineageStore();
    for (const seedOwner of [target, other]) {
      await store.transact(
        {
          ...seedOwner,
          expectedVersion: 0,
          operationKey: `seed-${seedOwner.storyId}`,
        },
        tx => {
          const node = tx.createNode({
            stableShotId: "shot-01",
            scope: "shot",
            modality: "shared",
            dimension: "subject",
          });
          const revision = tx.createRevision({
            nodeId: node.id,
            content: "内容",
            authorType: "user",
          });
          tx.confirmRevision(node.id, revision.id);
          tx.createCompilation({
            stableShotId: "shot-01",
            modality: "video",
            finalText: "编译",
            inputFingerprint: `fp-${seedOwner.storyId}`,
            revisionIds: [revision.id],
          });
        },
      );
    }

    const heads = await loadStoryPromptCompilationHeads(target);

    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({
      stableShotId: "shot-01",
      modality: "video",
      storyId: target.storyId,
    });
    expect(typeof heads[0]?.currentCompilationId).toBe("number");
  });

  it("throws PromptLineageOwnershipError when the Story belongs to a different user", async () => {
    const target = { storyId: 333, userId: 8 };
    const store = await createPersistentLocalPromptLineageStore();
    await store.transact(
      { ...target, expectedVersion: 0, operationKey: "seed" },
      tx => {
        const node = tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "shared",
          dimension: "subject",
        });
        const revision = tx.createRevision({
          nodeId: node.id,
          content: "内容",
          authorType: "user",
        });
        tx.confirmRevision(node.id, revision.id);
        tx.createCompilation({
          stableShotId: "shot-01",
          modality: "video",
          finalText: "编译",
          inputFingerprint: "fp",
          revisionIds: [revision.id],
        });
      },
    );

    await expect(
      loadStoryPromptCompilationHeads({ storyId: target.storyId, userId: 999 }),
    ).rejects.toBeInstanceOf(PromptLineageOwnershipError);
  });

  it("returns an empty array for a Story with no compilations yet", async () => {
    const heads = await loadStoryPromptCompilationHeads({
      storyId: 555,
      userId: 8,
    });
    expect(heads).toEqual([]);
  });
});
