import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import {
  getLocalPromptLineageState,
  replaceLocalPromptLineageState,
  resetMemoryStateForTesting,
} from "./db";
import { appRouter } from "./routers";
import type { ArtPromptLibraryDimension } from "../shared/artPromptLibrary";
import type { StoryPromptAggregate } from "../shared/promptLineage";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `art-lib-user-${userId}`,
      email: `art-lib-${userId}@example.com`,
      name: `Art Library User ${userId}`,
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

async function createStory(userId: number) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "美术库路由测试",
    body: {
      cards: [],
      characters: [],
      shots: [
        {
          stableShotId: "shot-01",
          shotNo: 1,
          subject: "主角坐在窗边",
          dialogue: "就这样继续吧",
          promptDraft: "single person beside a window",
          cameraMove: "固定机位",
        },
      ],
    },
  });
  return { caller, story: story! };
}

function currentCompilation(
  projection: StoryPromptAggregate,
  stableShotId: string,
  modality: "dialogue" | "image" | "video",
) {
  const head = projection.compilationHeads.find(
    item => item.stableShotId === stableShotId && item.modality === modality,
  );
  return projection.compilations.find(
    item => item.id === head?.currentCompilationId,
  );
}

async function seedLocalArtLibrary(input: {
  userId: number;
  name: string;
  source?: string | null;
  items: Array<{
    dimension: ArtPromptLibraryDimension;
    content: string;
    negativeContent?: string | null;
  }>;
}) {
  const state = await getLocalPromptLineageState();
  if (!state) throw new Error("expected local prompt lineage state");
  const timestamp = new Date().toISOString();
  const library = {
    id: state.nextIds.artLibrary++,
    kind: "user" as const,
    ownerUserId: input.userId,
    name: input.name,
    description: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const version = {
    id: state.nextIds.artLibraryVersion++,
    libraryId: library.id,
    version: 1,
    status: "published" as const,
    contentFingerprint: `test-artlib-${library.id}`,
    source: input.source ?? null,
    createdAt: timestamp,
    publishedAt: timestamp,
  };
  const items = input.items.map((item, sortOrder) => ({
    id: state.nextIds.artLibraryItem++,
    libraryVersionId: version.id,
    dimension: item.dimension,
    content: item.content,
    negativeContent: item.negativeContent ?? null,
    sourceRevisionId: null,
    sortOrder,
  }));
  state.artLibraries.push(library);
  state.artLibraryVersions.push(version);
  state.artLibraryItems.push(...items);
  await replaceLocalPromptLineageState(state);
  return { library, version, items };
}

describe("artPromptLibrary tRPC router", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("lists and binds a user art library version to a story", async () => {
    const { caller, story } = await createStory(701);
    const imported = await seedLocalArtLibrary({
      userId: 701,
      name: "写实记录",
      source: "obsidian://styles/doc-realism",
      items: [
        { dimension: "visual_style", content: "documentary realism" },
        { dimension: "lighting", content: "soft directional key" },
      ],
    });
    const listed = await caller.artPromptLibrary.list();
    expect(listed.map(item => item.version.id)).toContain(imported.version.id);

    const projection = await caller.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    if (projection.mode !== "lineage") throw new Error("expected lineage mode");
    const bound = await caller.artPromptLibrary.bindToStory({
      storyId: story.id,
      libraryVersionId: imported.version.id,
      expectedVersion: projection.projection.state.version,
      operationKey: "bind-router-art-library",
    });

    expect(bound.binding.libraryVersionId).toBe(imported.version.id);
    expect(
      bound.projection
        ? currentCompilation(bound.projection, "shot-01", "image")?.finalText
        : "",
    ).toContain("documentary realism");
  });

  it("rejects binding another user's private library", async () => {
    const imported = await seedLocalArtLibrary({
      userId: 702,
      name: "私有暗调库",
      items: [{ dimension: "visual_style", content: "low key noir realism" }],
    });
    const { caller: intruder, story } = await createStory(703);
    const projection = await intruder.promptLineage.getStoryProjection({
      storyId: story.id,
    });
    if (projection.mode !== "lineage") throw new Error("expected lineage mode");

    await expect(
      intruder.artPromptLibrary.bindToStory({
        storyId: story.id,
        libraryVersionId: imported.version.id,
        expectedVersion: projection.projection.state.version,
        operationKey: "bind-private-library",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
