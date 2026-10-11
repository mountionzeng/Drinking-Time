import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { downstreamRegenerationRouter } from "./routers/downstreamRegeneration";
import { textSourceLineageRouter } from "./routers/textSourceLineage";
import { memoryWarehouseRouter } from "./routers/memoryWarehouse";
import {
  createStory,
  getStoryById,
  updateStoryBodyIfRevision,
} from "./repositories/stories";
import { resetMemoryStateForTesting } from "./repositories/runtime";
import {
  getStoryTimeline,
  updateStoryTimeline,
} from "./repositories/timelines";
import { DEFAULT_TIMELINE_TRANSFORM } from "../shared/storyMaterial";
import { readyDraft } from "./testing/creationFlowFixtures";
import * as candidateStore from "./repositories/downstreamRegenerationCandidates";
import * as timelines from "./repositories/timelines";
import * as runtime from "./repositories/runtime";
import * as memoryMirror from "./services/chatMemoryWarehouse";
import type { TrpcContext } from "./_core/context";
const model = vi.hoisted(() => vi.fn());
vi.mock("./services/agentRuntime", () => ({ runJsonAgent: model }));
process.env.DATABASE_URL = "";
const ctx = (id = 41) => ({ user: { id } }) as TrpcContext;
const caller = (id = 41) => downstreamRegenerationRouter.createCaller(ctx(id));
beforeEach(() => {
  resetMemoryStateForTesting();
  model.mockReset();
  model.mockResolvedValue({
    parsed: {
      summary: "先走进雨里，再看见灯光",
      shots: [
        {
          existingShotId: "shot-b",
          subject: "灯",
          action: "亮",
          scriptText: "新段落",
          dialogue: "",
          durationMs: 4000,
        },
        {
          existingShotId: "shot-a",
          subject: "雨",
          action: "落",
          scriptText: "雨",
          dialogue: "",
          durationMs: 3000,
        },
      ],
    },
  });
});
async function setup() {
  const story = await createStory({
    userId: 41,
    title: "测试",
    body: {
      _revision: 0,
      shots: [
        {
          stableShotId: "shot-a",
          shotNo: 1,
          subject: "雨",
          cameraMove: undefined,
        },
        { stableShotId: "shot-b", shotNo: 2, subject: "灯" },
      ],
      textDraftHistory: {
        schemaVersion: 1,
        revision: 0,
        versions: [readyDraft("new-draft")],
      },
    },
  });
  const items = ["shot-a", "shot-b"].map((stableShotId, position) => ({
    stableShotId,
    included: true,
    position,
    plannedDurationMs: 3000,
    transform: DEFAULT_TIMELINE_TRANSFORM,
    referencedImageId: position + 11,
  }));
  await updateStoryTimeline({
    storyId: story.id,
    userId: 41,
    expectedVersion: 0,
    items,
    extensions: {
      audioTracks: [{ assetId: "audio-1" }],
      textSource: {
        textDraftId: "old-draft",
        contentFingerprint: "a".repeat(64),
      },
    },
  });
  const source = await textSourceLineageRouter.createCaller(ctx()).setCurrent({
    storyId: story.id,
    draftId: "new-draft",
    expectedRevision: 0,
    operationToken: "select-source",
  });
  return {
    storyId: story.id,
    targetKind: "timeline" as const,
    targetId: `timeline:${story.id}`,
    draftId: "new-draft",
    expectedRevision: source.revision,
    expectedTargetRevision: 1,
    operationToken: randomUUID(),
  };
}
it("keeps a ready candidate valid across JSON persistence and editor reload", async () => {
  const input = await setup();
  const liveBody = runtime.memoryState.stories[0].body as {
    shots: Array<Record<string, unknown>>;
  };
  liveBody.shots.forEach((shot, index) => {
    shot.shotKey = `SH${String(index + 1).padStart(2, "0")}`;
  });
  const candidate = await caller().request(input);
  expect(candidate.status).toBe("ready");
  expect(candidate.before.shots[0].shotKey).toBe("SH01");
  // Simulate the same JSON round trip used by the local file and MySQL JSON.
  runtime.memoryState.stories = JSON.parse(
    JSON.stringify(runtime.memoryState.stories)
  );
  // The editor derives these legacy display aliases from shotNo on reload.
  const reloadedBody = runtime.memoryState.stories[0].body as {
    shots: Array<Record<string, unknown>>;
  };
  for (const shot of reloadedBody.shots) delete shot.shotKey;
  runtime.memoryState.storyTimelines = JSON.parse(
    JSON.stringify(runtime.memoryState.storyTimelines)
  );
  runtime.memoryState.downstreamRegenerationCandidates = JSON.parse(
    JSON.stringify(runtime.memoryState.downstreamRegenerationCandidates)
  );
  const restored = await caller().read({
    storyId: input.storyId,
    candidateId: candidate.id,
  });
  expect(restored.status).toBe("ready");
  const confirmation = await caller().confirm({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: restored.revision,
    sessionId: "chat-session",
  });
  const adopted = await caller().adopt({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: confirmation.revision,
    sessionId: "chat-session",
    confirmationToken: confirmation.confirmation!.token,
  });
  expect(adopted.status).toBe("adopted");
});
it("still invalidates a candidate when a custom shot code changes", async () => {
  const input = await setup();
  const candidate = await caller().request(input);
  const body = runtime.memoryState.stories[0].body as {
    shots: Array<Record<string, unknown>>;
  };
  body.shots[0].shotKey = "new-custom-cue";
  expect(
    (await caller().read({ storyId: input.storyId, candidateId: candidate.id }))
      .status
  ).toBe("stale");
});
it("AE4/AE5 saves a separate candidate, adopts atomically and preserves recoverable material references", async () => {
  const input = await setup();
  const before = await getStoryTimeline(input.storyId, 41);
  const candidate = await caller().request(input);
  expect(candidate.status).toBe("ready");
  expect(await getStoryTimeline(input.storyId, 41)).toEqual(before);
  const duplicate = await caller().request({
    ...input,
    operationToken: randomUUID(),
  });
  expect(duplicate.id).toBe(candidate.id);
  expect(model).toHaveBeenCalledTimes(1);
  const confirmed = await caller().confirm({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: duplicate.revision,
    sessionId: "chat-session",
  });
  await expect(
    caller().adopt({
      storyId: input.storyId,
      candidateId: candidate.id,
      expectedRevision: confirmed.revision,
      sessionId: "other-session",
      confirmationToken: confirmed.confirmation!.token,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const adopted = await caller().adopt({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: confirmed.revision,
    sessionId: "chat-session",
    confirmationToken: confirmed.confirmation!.token,
  });
  expect(adopted.status).toBe("adopted");
  expect(adopted.before.timeline.items).toEqual(before?.items);
  const after = await getStoryTimeline(input.storyId, 41);
  expect(
    (after?.items as { stableShotId: string }[]).map(i => i.stableShotId)
  ).toEqual(["shot-b", "shot-a"]);
  expect(after?.extensions?.audioTracks).toEqual(
    before?.extensions?.audioTracks
  );
  expect(after?.extensions?.textSource).toMatchObject({
    textDraftId: "new-draft",
  });
  const retry = await caller().adopt({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: confirmed.revision,
    sessionId: "chat-session",
    confirmationToken: confirmed.confirmation!.token,
  });
  expect(retry.status).toBe("adopted");
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(2);
  const disk = JSON.parse(
    await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
  );
  expect(disk.downstreamRegenerationCandidates[0].data.status).toBe("adopted");
  const reload = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { readCandidate } from './server/repositories/downstreamRegenerationCandidates.ts'; console.log(JSON.stringify((await readCandidate({storyId:${input.storyId},userId:41}, '${candidate.id}')).status));`,
    ],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "" } }
  );
  expect(reload.trim().split("\n").at(-1)).toBe('"adopted"');
});
it("manual edits and foreign owners cannot be overwritten by adoption", async () => {
  const input = await setup();
  const c = await caller().request(input);
  const confirmed = await caller().confirm({
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: c.revision,
    sessionId: "chat-session",
  });
  await updateStoryTimeline({
    storyId: input.storyId,
    userId: 41,
    expectedVersion: 1,
    items: c.before.timeline.items.slice(0, 1),
  });
  await expect(
    caller().adopt({
      storyId: input.storyId,
      candidateId: c.id,
      expectedRevision: confirmed.revision,
      sessionId: "chat-session",
      confirmationToken: confirmed.confirmation!.token,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await getStoryTimeline(input.storyId, 41))?.items).toHaveLength(1);
  expect(
    (await caller().read({ storyId: input.storyId, candidateId: c.id })).status
  ).toBe("stale");
  await expect(
    caller(42).read({ storyId: input.storyId, candidateId: c.id })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("unknown results never submit twice; discarded candidates never change formal work", async () => {
  const input = await setup();
  model.mockRejectedValueOnce(new Error("timeout"));
  expect((await caller().request(input)).status).toBe("unknown");
  await expect(
    caller().request({ ...input, expectedRevision: input.expectedRevision + 1 })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await caller().request(input)).status).toBe("unknown");
  expect(model).toHaveBeenCalledTimes(1);
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(1);
});
it("AE1/AE2 ordered composition preserves the earlier immutable draft and publishing", async () => {
  const input = await setup();
  const memories = memoryWarehouseRouter.createCaller(ctx());
  const cards = [];
  for (const title of ["雨", "灯", "门", "家"])
    cards.push(
      await memories.save({
        id: randomUUID(),
        title,
        content: `${title}的记忆`,
        kind: "event",
        origin: "note",
        sourceStoryId: null,
      })
    );
  model.mockResolvedValue({
    parsed: {
      draft: { title: "夜归", body: "回家", tags: [] },
      observation: {
        originalExpression: "",
        adoptionLearning: "",
        confidence: "insufficient",
        choices: [],
      },
    },
    modelLabel: "test",
  });
  const request = {
    storyId: input.storyId,
    operationToken: randomUUID(),
    expectedRevision: 0,
    platform: "xiaohongshu" as const,
    instruction: "写成散文",
    memoryCardIds: cards
      .slice(0, 3)
      .reverse()
      .map(c => c.id),
  };
  const first = await memories.compose(request);
  const version = first.versions.at(-1)!;
  expect(version.status).toBe("ready");
  expect(version.memoryCards?.map(c => c.id)).toEqual(request.memoryCardIds);
  const second = await memories.compose({
    ...request,
    operationToken: randomUUID(),
    expectedRevision: first.revision,
    memoryCardIds: [...request.memoryCardIds, cards[3].id],
  });
  expect(second.versions.find(v => v.id === version.id)).toEqual(version);
  expect(second.versions.at(-1)?.memoryCards).toHaveLength(4);
  expect((await getStoryById(input.storyId, 41))?.body).not.toHaveProperty(
    "publishing"
  );
  await memories.compose(request);
  expect(model).toHaveBeenCalledTimes(2);
});

it("a failed candidate write rolls back its local claim", async () => {
  const input = await setup();
  const fail = vi
    .spyOn(runtime, "persistMemoryState")
    .mockRejectedValueOnce(new Error("disk full"));
  try {
    await expect(caller().request(input)).rejects.toThrow("disk full");
  } finally {
    fail.mockRestore();
  }
  expect(
    await candidateStore.listCandidates({ storyId: input.storyId, userId: 41 })
  ).toEqual([]);
  expect(model).not.toHaveBeenCalled();
});
it("reconciles a committed adoption even if candidate completion could not be saved", async () => {
  const input = await setup();
  const c = await caller().request(input);
  const confirmed = await caller().confirm({
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: c.revision,
    sessionId: "chat-session",
  });
  const original = candidateStore.replaceCandidate;
  const fail = vi
    .spyOn(candidateStore, "replaceCandidate")
    .mockImplementation(async (owner, next, revision) => {
      if (next.status === "adopted") throw new Error("completion unavailable");
      return original(owner, next, revision);
    });
  try {
    await expect(
      caller().adopt({
        storyId: input.storyId,
        candidateId: c.id,
        expectedRevision: confirmed.revision,
        sessionId: "chat-session",
        confirmationToken: confirmed.confirmation!.token,
      })
    ).rejects.toThrow();
  } finally {
    fail.mockRestore();
  }
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(2);
  expect(
    (await caller().read({ storyId: input.storyId, candidateId: c.id })).status
  ).toBe("adopted");
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(2);
});
it("formal writer failure and expired confirmations cannot mark an adoption complete", async () => {
  const input = await setup();
  const c = await caller().request(input);
  const confirmed = await caller().confirm({
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: c.revision,
    sessionId: "chat-session",
  });
  const request = {
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: confirmed.revision,
    sessionId: "chat-session",
    confirmationToken: confirmed.confirmation!.token,
  };
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(confirmed.confirmation!.expiresAt + 1);
  try {
    await expect(caller().adopt(request)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  } finally {
    clock.mockRestore();
  }
  const fail = vi
    .spyOn(timelines, "updateStoryAndTimelineAtomic")
    .mockRejectedValueOnce(new Error("disk full"));
  try {
    expect((await caller().adopt(request)).status).toBe("unknown");
  } finally {
    fail.mockRestore();
  }
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(1);
});
it("concurrent confirmations apply only once and an old snapshot can become a recovery candidate", async () => {
  const input = await setup();
  const c = await caller().request(input);
  const confirmed = await caller().confirm({
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: c.revision,
    sessionId: "chat-session",
  });
  const request = {
    storyId: input.storyId,
    candidateId: c.id,
    expectedRevision: confirmed.revision,
    sessionId: "chat-session",
    confirmationToken: confirmed.confirmation!.token,
  };
  await Promise.allSettled([caller().adopt(request), caller().adopt(request)]);
  expect((await getStoryTimeline(input.storyId, 41))?.version).toBe(2);
  const impact = await textSourceLineageRouter
    .createCaller(ctx())
    .impact({ storyId: input.storyId });
  const recovery = await caller().request({
    ...input,
    expectedRevision: impact.revision,
    expectedTargetRevision: 2,
    operationToken: randomUUID(),
    restoreCandidateId: c.id,
  });
  expect(recovery.proposal?.timeline.items).toEqual(c.before.timeline.items);
  expect(model).toHaveBeenCalledTimes(1);
});
it("a lagging memory mirror returns memory_pending before invoking the text model", async () => {
  const input = await setup();
  const memories = memoryWarehouseRouter.createCaller(ctx());
  const card = await memories.save({
    id: randomUUID(),
    title: "雨",
    content: "雨夜",
    kind: "event",
    origin: "note",
    sourceStoryId: null,
  });
  const fail = vi
    .spyOn(memoryMirror, "syncStoryChatMemories")
    .mockRejectedValueOnce(new Error("mirror unavailable"));
  try {
    await expect(
      memories.compose({
        storyId: input.storyId,
        operationToken: randomUUID(),
        expectedRevision: 0,
        platform: "xiaohongshu",
        instruction: "",
        memoryCardIds: [card.id],
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  } finally {
    fail.mockRestore();
  }
  expect(model).not.toHaveBeenCalled();
});

it("storyboard conflicts and explicit discard preserve the formal manual edit", async () => {
  const input = await setup();
  const request = {
    ...input,
    targetKind: "storyboard" as const,
    targetId: `storyboard:${input.storyId}`,
    expectedTargetRevision: 0,
  };
  const candidate = await caller().request(request);
  const confirmation = await caller().confirm({
    storyId: input.storyId,
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    sessionId: "chat-session",
  });
  const body = (await getStoryById(input.storyId, 41))!.body as Record<
    string,
    unknown
  >;
  const edited = {
    ...body,
    _revision: input.expectedRevision + 1,
    shots: (body.shots as Record<string, unknown>[]).map(shot => ({
      ...shot,
      subject: "用户手动修改",
    })),
  };
  await updateStoryBodyIfRevision({
    id: input.storyId,
    userId: 41,
    expectedRevision: input.expectedRevision,
    body: edited,
  });
  await expect(
    caller().adopt({
      storyId: input.storyId,
      candidateId: candidate.id,
      expectedRevision: confirmation.revision,
      sessionId: "chat-session",
      confirmationToken: confirmation.confirmation!.token,
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const stale = await caller().read({
    storyId: input.storyId,
    candidateId: candidate.id,
  });
  expect(stale.status).toBe("stale");
  expect(
    (
      await caller().discard({
        storyId: input.storyId,
        candidateId: candidate.id,
        expectedRevision: stale.revision,
      })
    ).status
  ).toBe("discarded");
  expect((await getStoryById(input.storyId, 41))!.body).toEqual(edited);
  expect((await getStoryTimeline(input.storyId, 41))!.version).toBe(1);
});
