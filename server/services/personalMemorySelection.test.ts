/**
 * 每日来信记忆选材的仓储装配层（U6）。
 *
 * 用真实的本地持久化 + 真实的提炼完成路径（`seedEvent` → claim → complete）
 * 建出真实的 active 理解和真实的证据边，而不是直接手写理解行——后者会
 * 悄悄跳过 DB 层本该保证的"active 理解至少有一条证据"这条前提，让测试
 * 对不上生产环境真实产生的数据形状。
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyPersonalMemoryEventSnapshot,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryInsightMutation,
  type PersonalMemoryLetterPayload,
} from "@shared/personalMemory";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "dt-pm-selection-")
);
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
const db = await import("../db");
const realWriteFile = (
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
).writeFile;

const USER = 601;
const OTHER_USER = 602;
let nextMessageId = 1;

function identity(
  overrides: Partial<PersonalMemoryEventIdentity> = {}
): PersonalMemoryEventIdentity {
  const id = nextMessageId++;
  return {
    userId: USER,
    sourceType: "chat_message",
    sourceKey: `message:${id}`,
    sourceRevision: "1",
    actionKind: "submitted",
    actionId: `client-msg-${id}`,
    ...overrides,
  };
}

async function seedEvent(
  occurredOn: string,
  overrides: Partial<PersonalMemoryEventIdentity> = {}
) {
  const builtIdentity = identity(overrides);
  const capture: PersonalMemoryCapture = {
    identity: builtIdentity,
    occurredOn,
    occurredAt: `${occurredOn}T02:00:00.000Z`,
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: {
      operationId: `pm-test-${builtIdentity.userId}-${builtIdentity.sourceKey}`,
      extractorVersion: "v1",
    },
  };
  const result = await db.capturePersonalMemoryEventStandalone(capture);
  return result.event;
}

async function claimOne() {
  const [job] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
  return job;
}

function newMutation(
  overrides: Partial<Extract<PersonalMemoryInsightMutation, { action: "new" }>> = {}
): PersonalMemoryInsightMutation {
  return {
    action: "new",
    origin: "inferred",
    category: "preference",
    text: "喜欢暖色调",
    scope: null,
    confidence: 0.5,
    allowProactiveMention: true,
    ...overrides,
  };
}

/** 建一条真实的 active 理解：捕获经历 → claim → 提炼完成写入理解与证据。 */
async function seedActiveInsight(
  occurredOn: string,
  overrides: Partial<Extract<PersonalMemoryInsightMutation, { action: "new" }>> = {}
) {
  const event = await seedEvent(occurredOn);
  const job = await claimOne();
  if (!job) throw new Error("expected a claimable job");
  const result = await db.completePersonalMemoryExtractionJob({
    jobId: job.id,
    leaseToken: job.leaseToken!,
    userId: USER,
    eventId: event.id,
    mutations: [newMutation(overrides)],
  });
  const applied = result.applied[0];
  if (applied.insightId == null || applied.lineageKey == null) {
    throw new Error("expected insight to be created");
  }
  return {
    event,
    insightId: applied.insightId,
    lineageKey: applied.lineageKey,
  };
}

function emptyPayload(
  overrides: Partial<PersonalMemoryLetterPayload> = {}
): PersonalMemoryLetterPayload {
  return {
    dailyReference: {},
    analysisSeed: {},
    userMessage: null,
    profileRevision: null,
    almanac: null,
    selectedEvidence: [],
    ...overrides,
  };
}

/** 直接写一条来信版本，模拟"过去某天生成时选中了某条理解"。 */
async function seedLetterMentioning(
  letterDate: string,
  insightId: number,
  eventIds: number[]
) {
  const written = await db.appendEmotionDailyLetterVersion({
    userId: USER,
    letterDate,
    actionId: `seed-mention:${letterDate}`,
    trigger: "generated",
    selectorVersion: "test",
    promptVersion: "test",
    modelVersion: "test",
    privacyEpoch: 1,
    payload: emptyPayload({
      selectedEvidence: [{ insightId, insightRevision: 1, eventIds }],
    }),
  });
  if (!written) throw new Error("expected letter version to be written");
  return written;
}

describe("selectPersonalMemoryContextForDailyLetter", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
    nextMessageId = 1;
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.writeFile).mockImplementation(realWriteFile);
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("选中真实创建的 active 理解，earliestEvidenceOn 来自真实证据事件", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const { event } = await seedActiveInsight("2026-09-01", {
      text: "喜欢暖色调的画面",
    });
    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].text).toBe("喜欢暖色调的画面");
    expect(result.selected[0].earliestEvidenceOn).toBe("2026-09-01");
    expect(result.selected[0].evidenceEventIds).toEqual([event.id]);
    expect(result.promptContext[0].origin).toBe("inferred");
  });

  it("allowProactiveMention=false 的理解一律不选（硬性隐私默认值）", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    await seedActiveInsight("2026-09-01", { allowProactiveMention: false });
    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected).toEqual([]);
  });

  it("换一个账号看不到别人的理解", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    await seedActiveInsight("2026-09-01");
    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: OTHER_USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected).toEqual([]);
  });

  it("7 天内提过的理解进入冷却期，不重复选中", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const { insightId, event } = await seedActiveInsight("2026-09-01");
    // 3 天前的信提到过它。
    await seedLetterMentioning("2026-09-01", insightId, [event.id]);

    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected).toEqual([]);
  });

  it("超过冷却期（8 天前提过）可以重新选中", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const { insightId, event } = await seedActiveInsight("2026-08-20");
    await seedLetterMentioning("2026-08-20", insightId, [event.id]);

    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-08-28", // 8 天后
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].insightId).toBe(insightId);
  });

  it("同一 lineage 被纠正后，旧修订的冷却期仍然对新修订生效", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const seeded = await seedActiveInsight("2026-09-01", {
      text: "喜欢暖色调",
    });
    await seedLetterMentioning("2026-09-01", seeded.insightId, [
      seeded.event.id,
    ]);

    // 纠正产生新修订，新修订的 insightId 和旧的不一样。
    const corrected = await db.correctPersonalMemoryInsight({
      userId: USER,
      lineageKey: seeded.lineageKey,
      category: "preference",
      text: "其实更喜欢冷色调",
      scope: null,
      allowProactiveMention: true,
    });
    expect(corrected.outcome).toBe("applied");

    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    // 旧 payload 里存的是旧修订的 insightId，但两者共享同一个 lineageKey，
    // 冷却期必须认出"这是同一件事"，而不是因为 ID 变了就当作全新话题重新提。
    expect(result.selected).toEqual([]);
  });

  it("目标当天自己的 selectedEvidence 不算冷却期（不会自己排除自己）", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const { insightId, event } = await seedActiveInsight("2026-09-01");
    // 当天自己就已经有一版信提到过它（比如重读过一次）。
    await seedLetterMentioning("2026-09-04", insightId, [event.id]);

    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected).toHaveLength(1);
  });

  it("冷却期只排除被提过的那一条，不影响其它未被提及的理解", async () => {
    const { selectPersonalMemoryContextForDailyLetter } = await import(
      "./personalMemorySelection"
    );
    const cooling = await seedActiveInsight("2026-09-01", {
      text: "最近提过的理解",
    });
    await seedLetterMentioning("2026-09-02", cooling.insightId, [
      cooling.event.id,
    ]);
    // 第二条从未在任何来信里出现过，不该被牵连进冷却期。
    await seedActiveInsight("2026-09-01", { text: "从未提过的理解" });

    const result = await selectPersonalMemoryContextForDailyLetter({
      userId: USER,
      targetDate: "2026-09-04",
    });
    expect(result.selected.map(item => item.text)).toEqual(["从未提过的理解"]);
  });
});
