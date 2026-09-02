import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { getStoryMaterialState } from "./services/storyMaterials";
import {
  getStoryVideoTimelineSelections,
  resetMemoryStateForTesting,
  setVideoTimelineSelection,
} from "./db";
import { appRouter } from "./routers";

const savedDatabaseUrl = ENV.databaseUrl;

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `material-import-${userId}`,
      email: `material-import-${userId}@example.com`,
      name: "Material Import",
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

beforeEach(() => {
  ENV.databaseUrl = "";
  resetMemoryStateForTesting();
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});

describe("creationAgent.importStoryMaterial", () => {
  it("binds an imported image directly to the requested stable shot", async () => {
    const caller = appRouter.createCaller(context(702));
    const story = await caller.storyAgent.storyUpsert({
      title: "SheSelf",
      body: {
        shots: [
          {
            stableShotId: "shot-0101",
            shotIdentity: "shot-0101",
            shotNo: 1,
            subject: "女人站在画前",
          },
        ],
      },
    });
    if (!story) throw new Error("story creation failed");

    const result = await caller.creationAgent.importStoryMaterial({
      storyId: story.id,
      fileName: "0101.png",
      mimeType: "image/png",
      fileBase64: "iVBORw0KGgo=",
      targetStableShotId: "shot-0101",
    });
    const materials = await getStoryMaterialState(story.id, 702);

    expect(result).toMatchObject({
      status: "ok",
      kind: "image",
      stableShotId: "shot-0101",
      shotNo: "SH01",
    });
    expect(materials?.shots[0]?.currentImage?.id).toBe(
      result.status === "ok" && result.kind === "image"
        ? result.imageId
        : undefined
    );
    expect(materials?.unassignedImages).toHaveLength(0);
  });

  it("keeps an adopted video selected when a storyboard frame is dropped", async () => {
    const caller = appRouter.createCaller(context(703));
    const story = await caller.storyAgent.storyUpsert({
      title: "SheSelf",
      body: {
        shots: [
          {
            stableShotId: "shot-0102",
            shotIdentity: "shot-0102",
            shotNo: 1,
            subject: "女人看向画框",
          },
        ],
      },
    });
    if (!story) throw new Error("story creation failed");
    await setVideoTimelineSelection({
      storyId: story.id,
      userId: 703,
      stableShotId: "shot-0102",
      takeId: 88,
      rangeId: null,
      selectionType: "full_take",
    });

    const result = await caller.creationAgent.importStoryMaterial({
      storyId: story.id,
      fileName: "0102-last.png",
      mimeType: "image/png",
      fileBase64: "iVBORw0KGgo=",
      targetStableShotId: "shot-0102",
    });
    const selections = await getStoryVideoTimelineSelections(story.id, 703);

    expect(result).toMatchObject({
      status: "ok",
      kind: "image",
      stableShotId: "shot-0102",
    });
    expect(selections).toHaveLength(1);
    expect(selections[0]).toMatchObject({
      stableShotId: "shot-0102",
      takeId: 88,
    });
  });

  it("keeps an adopted video selected when an older image is promoted", async () => {
    const caller = appRouter.createCaller(context(704));
    const story = await caller.storyAgent.storyUpsert({
      title: "Independent layers",
      body: {
        shots: [
          {
            stableShotId: "shot-0103",
            shotIdentity: "shot-0103",
            shotNo: 1,
            subject: "人物回头",
          },
        ],
      },
    });
    if (!story) throw new Error("story creation failed");
    const older = await caller.creationAgent.importStoryMaterial({
      storyId: story.id,
      fileName: "0103-old.png",
      mimeType: "image/png",
      fileBase64: "iVBORw0KGgo=",
      targetStableShotId: "shot-0103",
    });
    await caller.creationAgent.importStoryMaterial({
      storyId: story.id,
      fileName: "0103-new.png",
      mimeType: "image/png",
      fileBase64: "iVBORw0KGgo=",
      targetStableShotId: "shot-0103",
    });
    if (older.status !== "ok" || older.kind !== "image") {
      throw new Error("image import failed");
    }
    await setVideoTimelineSelection({
      storyId: story.id,
      userId: 704,
      stableShotId: "shot-0103",
      takeId: 89,
      rangeId: null,
      selectionType: "full_take",
    });

    await caller.creationAgent.promoteStoryImage({
      storyId: story.id,
      imageId: older.imageId,
    });

    expect(await getStoryVideoTimelineSelections(story.id, 704)).toMatchObject([
      { stableShotId: "shot-0103", takeId: 89 },
    ]);
  });
});
