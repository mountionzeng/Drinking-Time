import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalPromptLineageStateForStory,
  getLocalPromptCompilationHeadsForStory,
  resetMemoryStateForTesting,
} from "./db";
import { createPersistentLocalPromptLineageStore } from "./services/promptLineageStore";

const target = { storyId: 71, userId: 4 };
const other = { storyId: 72, userId: 4 };

async function seedTwoStories() {
  const store = await createPersistentLocalPromptLineageStore();
  for (const owner of [target, other]) {
    await store.transact(
      { ...owner, expectedVersion: 0, operationKey: `seed-${owner.storyId}` },
      tx => {
        const node = tx.createNode({
          stableShotId: "shot-01",
          scope: "shot",
          modality: "shared",
          dimension: "subject",
        });
        const revision = tx.createRevision({
          nodeId: node.id,
          content: `story ${owner.storyId} 的内容`,
          authorType: "user",
        });
        tx.confirmRevision(node.id, revision.id);
        tx.createCompilation({
          stableShotId: "shot-01",
          modality: "video",
          finalText: `story ${owner.storyId} 的编译`,
          inputFingerprint: `fp-${owner.storyId}`,
          revisionIds: [revision.id],
        });
      },
    );
  }
}

describe("getLocalPromptLineageStateForStory", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("only returns the requested Story's rows, excluding the other seeded Story", async () => {
    await seedTwoStories();

    const slice = await getLocalPromptLineageStateForStory(target.storyId);

    expect(slice?.storyStates.map(s => s.storyId)).toEqual([target.storyId]);
    expect(slice?.nodes.map(n => n.storyId)).toEqual([target.storyId]);
    expect(slice?.revisions.map(r => r.content)).toEqual([
      `story ${target.storyId} 的内容`,
    ]);
    expect(slice?.compilations.map(c => c.finalText)).toEqual([
      `story ${target.storyId} 的编译`,
    ]);
    // compilationInputs 是通过 compilationId 间接关联的，同样必须只剩这个
    // Story 自己那条编译产生的输入，不带上另一个 Story 的编译输入。
    const otherCompilationIds = new Set(
      (await getLocalPromptLineageStateForStory(other.storyId))?.compilations.map(
        c => c.id,
      ),
    );
    for (const input of slice?.compilationInputs ?? []) {
      expect(otherCompilationIds.has(input.compilationId)).toBe(false);
    }
  });

  it("returns a clone, not a live reference into the shared memory state", async () => {
    await seedTwoStories();

    const slice = await getLocalPromptLineageStateForStory(target.storyId);
    expect(slice).not.toBeNull();
    // 拿到切片后直接改它——如果这是可变全局对象的引用，下一次读取会看到
    // 这次的污染；是真正 clone 的话，下一次读取应该干干净净。
    slice!.nodes.push({
      id: 999999,
      storyId: target.storyId,
      userId: target.userId,
      stableShotId: "injected",
      scope: "shot",
      modality: "shared",
      dimension: "poison",
      currentRevisionId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const rereadSlice = await getLocalPromptLineageStateForStory(
      target.storyId,
    );
    expect(rereadSlice?.nodes).toHaveLength(1);
    expect(
      rereadSlice?.nodes.some(node => node.dimension === "poison"),
    ).toBe(false);
  });
});

describe("getLocalPromptCompilationHeadsForStory", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("only returns the requested Story's compilation heads", async () => {
    await seedTwoStories();

    const heads = await getLocalPromptCompilationHeadsForStory(
      target.storyId,
    );

    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({
      storyId: target.storyId,
      stableShotId: "shot-01",
      modality: "video",
    });
  });

  it("returns an empty array for a Story with no compilations", async () => {
    await seedTwoStories();
    const heads = await getLocalPromptCompilationHeadsForStory(999);
    expect(heads).toEqual([]);
  });
});
