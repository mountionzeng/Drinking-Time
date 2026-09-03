import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyPersonalMemoryEventSnapshot,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryInsightMutation,
} from "../shared/personalMemory";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-insights-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
const db = await import("./db");
const realWriteFile = (
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
).writeFile;

const USER = 7;
const OTHER_USER = 8;
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
  overrides: Partial<PersonalMemoryEventIdentity> = {}
) {
  const builtIdentity = identity(overrides);
  const capture: PersonalMemoryCapture = {
    identity: builtIdentity,
    occurredOn: "2026-09-03",
    occurredAt: "2026-09-03T02:00:00.000Z",
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
    allowProactiveMention: false,
    ...overrides,
  };
}

describe("提炼完成：写入理解与证据", () => {
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

  async function claimOne() {
    const [job] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
    return job;
  }

  it("claim 一个任务，完成后写入一条 active 理解与一条证据", async () => {
    const event = await seedEvent();
    const job = await claimOne();
    expect(job).toBeDefined();

    const result = await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(result.jobClaimValid).toBe(true);
    expect(result.discarded).toBeNull();
    expect(result.applied[0].outcome).toBe("created");

    const candidates = await db.listActivePersonalMemoryInsightCandidates(
      USER,
      10
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("喜欢暖色调");
    expect(candidates[0].origin).toBe("inferred");

    const evidence = await db.listPersonalMemoryEvidenceForInsight(
      candidates[0].id
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].eventId).toBe(event.id);
  });

  // 计划的 Happy path：三次采用形成带三个来源的候选理解。
  it("三次 reinforce 累积三条证据、置信度递增，但不产生新 revision", async () => {
    const first = await seedEvent();
    const j1 = await claimOne();
    const create = await db.completePersonalMemoryExtractionJob({
      jobId: j1!.id,
      leaseToken: j1!.leaseToken!,
      userId: USER,
      eventId: first.id,
      mutations: [newMutation({ confidence: 0.3 })],
    });
    expect(create.applied[0].outcome).toBe("created");
    // 用返回的 lineageKey，而不是回头查「最近更新的一条」——同一毫秒内建
    // 多条时那种查法不稳定。
    const lineageKey = create.applied[0].lineageKey!;

    for (let i = 0; i < 2; i += 1) {
      const event = await seedEvent();
      const job = await claimOne();
      const result = await db.completePersonalMemoryExtractionJob({
        jobId: job!.id,
        leaseToken: job!.leaseToken!,
        userId: USER,
        eventId: event.id,
        // reinforce 不改 revision，所以三次都是 expectedRevision: 1
        mutations: [{ action: "reinforce", lineageKey, expectedRevision: 1 }],
      });
      expect(result.applied[0].outcome).toBe("reinforced");
    }

    const lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage).toHaveLength(1); // 没有新 revision
    expect(lineage[0].confidence).toBeCloseTo(0.5); // 0.3 + 0.1 + 0.1
    const evidence = await db.listPersonalMemoryEvidenceForInsight(
      lineage[0].id
    );
    expect(evidence).toHaveLength(3);
  });

  // 用户纠正为项目限定后，全局旧理解被替代——纠正入口不经过提炼任务，
  // 直接调用 correctPersonalMemoryInsight。
  it("用户纠正后旧理解被 superseded，新 revision 是 user_corrected", async () => {
    const event = await seedEvent();
    const job = await claimOne();
    await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation({ text: "全局都喜欢暖色调" })],
    });
    const lineageKey = (
      await db.listActivePersonalMemoryInsightCandidates(USER, 1)
    )[0].lineageKey;

    const corrected = await db.correctPersonalMemoryInsight({
      userId: USER,
      lineageKey,
      category: "preference",
      text: "只在这个项目里喜欢暖色调",
      scope: { storyId: 1186 },
      allowProactiveMention: false,
    });
    expect(corrected.outcome).toBe("applied");

    const lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage).toHaveLength(2);
    expect(lineage[0].state).toBe("superseded");
    expect(lineage[1].state).toBe("active");
    expect(lineage[1].origin).toBe("user_corrected");
    expect(lineage[1].text).toBe("只在这个项目里喜欢暖色调");
    expect(lineage[0].supersededByInsightId).toBe(lineage[1].id);

    // 纠正本身也留下一条可追溯的经历。
    const events = await db.listPersonalMemoryEvents(USER);
    expect(
      events.some(e => e.sourceType === "insight" && e.actionKind === "insight_corrected")
    ).toBe(true);
  });

  // 承重约束：旧任务在完成前，用户已经纠正/归档/忘记，结果必须丢弃不覆盖。
  it("旧任务完成时 lineage 已被用户纠正——reinforce/supersede 都判 stale，不覆盖", async () => {
    const first = await seedEvent();
    const j1 = await claimOne();
    await db.completePersonalMemoryExtractionJob({
      jobId: j1!.id,
      leaseToken: j1!.leaseToken!,
      userId: USER,
      eventId: first.id,
      mutations: [newMutation()],
    });
    const lineageKey = (
      await db.listActivePersonalMemoryInsightCandidates(USER, 1)
    )[0].lineageKey;

    // 模拟：第二个任务已经 claim（拿到旧的 lineage 快照信息），
    // 但用户在它完成前先纠正了。
    const second = await seedEvent();
    const j2 = await claimOne();

    await db.correctPersonalMemoryInsight({
      userId: USER,
      lineageKey,
      category: "preference",
      text: "纠正为别的内容",
      scope: null,
      allowProactiveMention: false,
    });

    const staleResult = await db.completePersonalMemoryExtractionJob({
      jobId: j2!.id,
      leaseToken: j2!.leaseToken!,
      userId: USER,
      eventId: second.id,
      // j2 决定要 reinforce 时看到的是纠正之前的 revision 1；纠正之后 tip
      // 虽然仍是 active，但已经是 revision 2 的不同内容了——这正是序列号
      // 检查要挡住的那种「陈旧覆盖」。
      mutations: [{ action: "reinforce", lineageKey, expectedRevision: 1 }],
    });
    expect(staleResult.applied[0].outcome).toMatch(/^stale:/);

    const lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[1].text).toBe("纠正为别的内容"); // 没被旧任务的 reinforce 污染
    const evidence = await db.listPersonalMemoryEvidenceForInsight(lineage[1].id);
    expect(evidence.some(e => e.eventId === second.id)).toBe(false);
  });

  it("重复完成同一个任务是幂等的——lease 已经不是 claimed，第二次不生效", async () => {
    const event = await seedEvent();
    const job = await claimOne();
    const first = await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(first.jobClaimValid).toBe(true);

    const second = await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(second.jobClaimValid).toBe(false);

    expect(
      await db.listActivePersonalMemoryInsightCandidates(USER, 10)
    ).toHaveLength(1);
  });

  it("过期 lease 的任务被别的 runner 重新 claim 后，旧 leaseToken 完成失效", async () => {
    const event = await seedEvent();
    const shortLease = await db.claimPersonalMemoryJobs({
      limit: 1,
      leaseMs: -1, // 立刻过期
    });
    const staleToken = shortLease[0].leaseToken!;

    const reclaimed = await db.claimPersonalMemoryJobs({
      limit: 1,
      leaseMs: 60_000,
    });
    expect(reclaimed[0].id).toBe(shortLease[0].id);
    expect(reclaimed[0].leaseToken).not.toBe(staleToken);

    const staleAttempt = await db.completePersonalMemoryExtractionJob({
      jobId: shortLease[0].id,
      leaseToken: staleToken,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(staleAttempt.jobClaimValid).toBe(false);
  });

  it("内容被清空的事件——完成时结果整体丢弃，但任务仍标成功", async () => {
    const event = await seedEvent();
    const job = await claimOne();
    await db.scrubPersonalMemoryEventAndRecompute(USER, event.id);

    const result = await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(result.jobClaimValid).toBe(true);
    expect(result.discarded).toBe("content_scrubbed");
    expect(
      await db.listActivePersonalMemoryInsightCandidates(USER, 10)
    ).toHaveLength(0);
  });

  it("被抑制的事件——不再生成理解，任务仍标成功", async () => {
    const event = await seedEvent();
    const j1 = await claimOne();
    await db.completePersonalMemoryExtractionJob({
      jobId: j1!.id,
      leaseToken: j1!.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    const lineageKey = (
      await db.listActivePersonalMemoryInsightCandidates(USER, 1)
    )[0].lineageKey;
    await db.forgetPersonalMemoryInsightLineage(USER, lineageKey);
    expect(await db.isPersonalMemoryEventSuppressed(USER, event.id)).toBe(true);

    // 同一个（已经 succeeded 的）事件不能再 claim 一次任务，直接单测抑制检查
    // 路径：模拟另一个任务指向这同一个事件。
    const otherEvent = await seedEvent();
    const j2 = await claimOne();
    const result = await db.completePersonalMemoryExtractionJob({
      jobId: j2!.id,
      leaseToken: j2!.leaseToken!,
      userId: USER,
      eventId: event.id, // 故意复用被抑制的事件
      mutations: [newMutation()],
    });
    expect(result.discarded).toBe("event_suppressed");
    void otherEvent;
    void j2;
  });

  it("两个账号的理解互不可见", async () => {
    const event = await seedEvent({ userId: OTHER_USER, sourceKey: "message:other" });
    const job = await claimOne();
    await db.completePersonalMemoryExtractionJob({
      jobId: job!.id,
      leaseToken: job!.leaseToken!,
      userId: OTHER_USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    expect(
      await db.listActivePersonalMemoryInsightCandidates(USER, 10)
    ).toHaveLength(0);
    expect(
      await db.listActivePersonalMemoryInsightCandidates(OTHER_USER, 10)
    ).toHaveLength(1);
  });
});

describe("归档／恢复／忘记", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
    nextMessageId = 1;
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.writeFile).mockImplementation(realWriteFile);
  });

  async function seedActiveInsight() {
    const event = await seedEvent();
    const [job] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
    const result = await db.completePersonalMemoryExtractionJob({
      jobId: job.id,
      leaseToken: job.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    // 用返回的 lineageKey，不要回头按「最近更新」查——同一毫秒内连续建两条
    // 时，updatedAt 打平会让排序不稳定，之前就是这样把两条 lineage 撞成一条。
    return result.applied[0].lineageKey!;
  }

  it("归档后恢复回到 active", async () => {
    const lineageKey = await seedActiveInsight();
    expect((await db.archivePersonalMemoryInsightLineage(USER, lineageKey)).outcome).toBe(
      "applied"
    );
    let lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("archived");

    expect((await db.restorePersonalMemoryInsightLineage(USER, lineageKey)).outcome).toBe(
      "applied"
    );
    lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("active");
  });

  it("不能恢复一个从未归档过的理解", async () => {
    const lineageKey = await seedActiveInsight();
    const result = await db.restorePersonalMemoryInsightLineage(USER, lineageKey);
    expect(result.outcome).toBe("invalid");
  });

  // 忘记后旧任务和旧证据无法重新创建同一理解。
  it("忘记清除正文、建立抑制、递增隐私 epoch", async () => {
    const before = await db.getPersonalMemoryPrivacyEpoch(USER);
    const lineageKey = await seedActiveInsight();

    const result = await db.forgetPersonalMemoryInsightLineage(USER, lineageKey);
    expect(result.outcome).toBe("applied");

    const lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("forgotten");
    expect(lineage[0].text).toBeNull();

    const suppression = await db.getPersonalMemorySuppression(USER, lineageKey);
    expect(suppression).not.toBeNull();
    expect(suppression!.suppressedEventIds.length).toBeGreaterThan(0);

    expect(await db.getPersonalMemoryPrivacyEpoch(USER)).toBe(before + 1);

    // 证据边被清掉，避免忘记后还能查到「谁支持过它」。
    expect(await db.listPersonalMemoryEvidenceForInsight(lineage[0].id)).toHaveLength(0);
  });

  it("忘记不影响其他 lineage", async () => {
    const lineageA = await seedActiveInsight();
    const lineageB = await seedActiveInsight();
    await db.forgetPersonalMemoryInsightLineage(USER, lineageA);
    const b = await db.listPersonalMemoryInsightLineage(USER, lineageB);
    expect(b[0].state).toBe("active");
  });

  it("忘记后再想恢复会被拒绝——forgotten 是终态", async () => {
    const lineageKey = await seedActiveInsight();
    await db.forgetPersonalMemoryInsightLineage(USER, lineageKey);
    const result = await db.restorePersonalMemoryInsightLineage(USER, lineageKey);
    expect(result.outcome).toBe("invalid");
  });
});

describe("来源清空后重新计算依据", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
    nextMessageId = 1;
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.writeFile).mockImplementation(realWriteFile);
  });

  // 计划的 Edge case：删除多来源中的一个仍保留有依据理解；
  // 删除最后来源后召回为零。
  it("三来源理解删掉一个仍然 active；删到最后一个后变 unsupported", async () => {
    const events = [];
    for (let i = 0; i < 3; i += 1) events.push(await seedEvent());

    const [j1] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
    const created = await db.completePersonalMemoryExtractionJob({
      jobId: j1.id,
      leaseToken: j1.leaseToken!,
      userId: USER,
      eventId: events[0].id,
      mutations: [newMutation()],
    });
    const lineageKey = created.applied[0].lineageKey!;
    for (const event of events.slice(1)) {
      const [job] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
      await db.completePersonalMemoryExtractionJob({
        jobId: job.id,
        leaseToken: job.leaseToken!,
        userId: USER,
        eventId: event.id,
        // reinforce 不改 revision，三次采用全部是 expectedRevision: 1。
        mutations: [{ action: "reinforce", lineageKey, expectedRevision: 1 }],
      });
    }

    const firstScrub = await db.scrubPersonalMemoryEventAndRecompute(
      USER,
      events[0].id
    );
    expect(firstScrub.changed).toBe(true);
    expect(firstScrub.unsupportedInsightIds).toHaveLength(0);
    let lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("active");

    await db.scrubPersonalMemoryEventAndRecompute(USER, events[1].id);
    lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("active"); // 还剩一个

    const lastScrub = await db.scrubPersonalMemoryEventAndRecompute(
      USER,
      events[2].id
    );
    expect(lastScrub.unsupportedInsightIds).toContain(lineage[0].id);
    lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("unsupported");
    expect(lineage[0].text).toBeNull();
  });

  it("清空同一个事件两次是幂等的", async () => {
    const event = await seedEvent();
    const first = await db.scrubPersonalMemoryEventAndRecompute(USER, event.id);
    const second = await db.scrubPersonalMemoryEventAndRecompute(USER, event.id);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it("归档的理解不受来源清空影响——非活跃理解不参与召回判定", async () => {
    const event = await seedEvent();
    const [job] = await db.claimPersonalMemoryJobs({ limit: 1, leaseMs: 60_000 });
    await db.completePersonalMemoryExtractionJob({
      jobId: job.id,
      leaseToken: job.leaseToken!,
      userId: USER,
      eventId: event.id,
      mutations: [newMutation()],
    });
    const lineageKey = (
      await db.listActivePersonalMemoryInsightCandidates(USER, 1)
    )[0].lineageKey;
    await db.archivePersonalMemoryInsightLineage(USER, lineageKey);

    await db.scrubPersonalMemoryEventAndRecompute(USER, event.id);
    const lineage = await db.listPersonalMemoryInsightLineage(USER, lineageKey);
    expect(lineage[0].state).toBe("archived"); // 没被打成 unsupported
  });
});

describe("提炼的完整正文回源", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
    nextMessageId = 1;
    vi.mocked(fs.writeFile).mockClear();
    vi.mocked(fs.writeFile).mockImplementation(realWriteFile);
  });

  it("按事件 ID 能读回经历本身", async () => {
    const event = await seedEvent();
    const found = await db.getPersonalMemoryEventById(event.id, USER);
    expect(found?.id).toBe(event.id);
    expect(await db.getPersonalMemoryEventById(event.id, OTHER_USER)).toBeNull();
    expect(await db.getPersonalMemoryEventById(999999, USER)).toBeNull();
  });

  // 聊天消息的事件快照只存 200 字展示摘录；完整正文必须能从
  // story_conversation_messages 直接按 (messageId, userId) 回源，不需要 storyId。
  it("聊天消息的完整正文能按 messageId + userId 直接回源", async () => {
    const caller = (await import("./routers")).appRouter.createCaller({
      user: {
        id: USER,
        openId: `resolve-${USER}`,
        email: `resolve-${USER}@example.com`,
        name: "Resolve User",
        loginMethod: "test",
        role: "user" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        sessionVersion: 1,
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as never,
      res: { clearCookie: () => {} } as never,
    });
    const story = (await caller.storyAgent.storyUpsert({
      title: "回源测试",
      body: { cards: [], characters: [], shots: [] },
    }))!;
    await caller.promptLineage.getStoryProjection({ storyId: story.id });

    const longMessage = "完整正文".repeat(80); // 远超 200 字展示上限
    const { appendStoryConversationTurn } = await import("./services/storyConversation");
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = String(USER);
    await appendStoryConversationTurn({
      storyId: story.id,
      userId: USER,
      userMessage: { clientMessageId: "resolve-msg", content: longMessage },
      assistantMessage: { clientMessageId: "resolve-reply", content: "回答" },
    });
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;

    const [event] = await db.listPersonalMemoryEvents(USER);
    expect(event.sourceType).toBe("chat_message");
    // 事件快照本身是截断的展示摘录。
    expect(event.snapshot.excerpt?.length).toBeLessThan(longMessage.length);

    const messageId = Number(event.sourceKey.replace("message:", ""));
    const resolved = await db.getChatMessageContentForPersonalMemory(
      messageId,
      USER
    );
    expect(resolved).toBe(longMessage);

    // 另一个账号即使猜中 messageId 也读不到。
    expect(
      await db.getChatMessageContentForPersonalMemory(messageId, OTHER_USER)
    ).toBeNull();
  });

  it("不存在的消息 ID 返回 null，不编造正文", async () => {
    expect(
      await db.getChatMessageContentForPersonalMemory(999999, USER)
    ).toBeNull();
  });
});
