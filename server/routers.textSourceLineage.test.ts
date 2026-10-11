import { readyDraft } from "./testing/creationFlowFixtures";
import { beforeEach, expect, it } from "vitest";
import { textSourceLineageRouter } from "./routers/textSourceLineage";
import { createStory, getStoryById } from "./repositories/stories";
import { resetMemoryStateForTesting } from "./repositories/runtime";
import type { TrpcContext } from "./_core/context";
import { normalizePublishingDraftState } from "../shared/publishingDraft";
import { normalizeFinishedProductState } from "../shared/finishedProductVersion";

process.env.DATABASE_URL = "";
const caller = (id = 41) =>
  textSourceLineageRouter.createCaller({ user: { id } } as TrpcContext);
beforeEach(() => resetMemoryStateForTesting());
it("sets only the source pointer; rejects stale, foreign, and non-ready drafts", async () => {
  const publishing = normalizePublishingDraftState(null);
  const story = await createStory({
    userId: 41,
    title: "test",
    body: {
      _revision: 0,
      publishing,
      textDraftHistory: {
        schemaVersion: 1,
        revision: 0,
        versions: [
          readyDraft("draft-a"),
          { ...readyDraft("pending"), status: "generating" },
        ],
      },
    },
  });
  const input = {
    storyId: story.id,
    draftId: "draft-a",
    expectedRevision: 0,
    operationToken: "source-operation",
  };
  const result = await caller().setCurrent(input);
  expect(result.current).toMatchObject({ textDraftId: "draft-a" });
  expect((await getStoryById(story.id, 41))?.body).toMatchObject({
    publishing,
  });
  expect(await caller().setCurrent(input)).toEqual(result);
  await expect(caller(42).setCurrent(input)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    caller().setCurrent({ ...input, operationToken: "source-operation-2" })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    caller().setCurrent({
      ...input,
      draftId: "pending",
      expectedRevision: 1,
      operationToken: "source-operation-3",
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
it("keeps publishing and finished sources distinct and old records unknown", async () => {
  const source = { textDraftId: "draft-a", contentFingerprint: "a".repeat(64) };
  const publishing = normalizePublishingDraftState(null);
  publishing.versions![0].textSource = source;
  const finished = {
    schemaVersion: 1,
    revision: 1,
    receipts: {},
    versions: [
      {
        id: "finished-1",
        sequence: 1,
        status: "completed",
        purpose: "留念",
        textVersionId: "v1",
        textSource: source,
        images: [],
        videos: [],
        imageVersion: null,
        videoVersion: null,
        createdAt: 1,
        updatedAt: 1,
        completedAt: 1,
      },
    ],
  };
  expect(
    normalizePublishingDraftState(publishing).versions![0].textSource
  ).toEqual(source);
  expect(
    normalizeFinishedProductState(finished).versions[0].textSource
  ).toEqual(source);
  const story = await createStory({
    userId: 41,
    title: "test",
    body: {
      _revision: 0,
      shots: [{ id: "old" }],
      publishing,
      finishedProduct: finished,
      textDraftHistory: {
        schemaVersion: 1,
        revision: 0,
        versions: [readyDraft("draft-b")],
      },
    },
  });
  await caller().setCurrent({
    storyId: story.id,
    draftId: "draft-b",
    expectedRevision: 0,
    operationToken: "source-operation",
  });
  const impact = await caller().impact({ storyId: story.id });
  expect(
    impact.items
      .filter(item => item.group === "stale")
      .map(item => item.targetKind)
  ).toEqual(["publishing", "finishedProduct"]);
  expect(
    impact.items.find(item => item.targetKind === "storyboard")?.group
  ).toBe("legacy_unknown");
  expect(
    normalizeFinishedProductState({
      ...finished,
      versions: finished.versions.map(({ textSource, ...v }) => v),
    }).versions[0].textSource
  ).toEqual({ kind: "legacy_unknown" });
});
