/**
 * 来信生成 attempt 状态机（U6）：begin/commit/fail 的幂等、CAS 与失败重试。
 *
 * 用真实的本地持久化（不 mock 仓储层），理由和其它 db 层测试一样——这套
 * 状态机的重点恰恰是并发/重放语义，假仓储不会真的执行 CAS。
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PersonalMemoryLetterPayload } from "../shared/personalMemory";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-letter-attempts-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const db = await import("./db");

const USER = 501;
const LETTER_DATE = "2026-09-04";

function emptyPayload(): PersonalMemoryLetterPayload {
  return {
    dailyReference: {},
    analysisSeed: {},
    userMessage: null,
    profileRevision: null,
    almanac: null,
    selectedEvidence: [],
  };
}

afterAll(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousLocalPersistPath === undefined) {
    delete process.env.LOCAL_PERSIST_PATH;
  } else {
    process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
  }
});

beforeEach(() => {
  db.resetMemoryStateForTesting();
});

describe("beginPersonalMemoryLetterAttempt", () => {
  it("全新 action ID 产生一个 in_flight attempt", async () => {
    const result = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    expect(result.status).toBe("started");
    if (result.status !== "started") throw new Error("unreachable");
    expect(result.attempt.state).toBe("in_flight");
    expect(result.attempt.privacyEpoch).toBe(1);
  });

  it("同一个 action ID 再次 begin（还在跑）返回 in_flight，不重启", async () => {
    const first = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (first.status !== "started") throw new Error("unreachable");
    const second = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    expect(second.status).toBe("in_flight");
    if (second.status !== "in_flight") throw new Error("unreachable");
    expect(second.attempt.id).toBe(first.attempt.id);
  });

  it("已提交过的 action ID 再次 begin 返回 already_committed，不重新生成", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const committed = await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    });
    expect(committed.outcome).toBe("committed");

    const again = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    expect(again.status).toBe("already_committed");
    if (again.status !== "already_committed") throw new Error("unreachable");
    if (committed.outcome !== "committed") throw new Error("unreachable");
    expect(again.committedVersionId).toBe(committed.version.id);
  });

  it("失败的 attempt 可以用同一个 action ID 重新拉回 in_flight（可重试）", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    await db.failPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      outcome: "failed",
    });

    const retried = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    expect(retried.status).toBe("started");
    if (retried.status !== "started") throw new Error("unreachable");
    expect(retried.attempt.id).toBe(begun.attempt.id);
    expect(retried.attempt.state).toBe("in_flight");
  });

  it("不同 letterDate 用同一个 action ID 互不干扰", async () => {
    const today = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: "2026-09-04",
      actionId: "profile-ensure:x",
    });
    const yesterday = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: "2026-09-03",
      actionId: "profile-ensure:x",
    });
    if (today.status !== "started" || yesterday.status !== "started") {
      throw new Error("unreachable");
    }
    expect(today.attempt.id).not.toBe(yesterday.attempt.id);
  });

  it("卡死超过阈值的陈旧 in_flight 可以被重新拉回，不会永久卡死", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    if (begun.status !== "started") throw new Error("unreachable");
    // 3 分钟后：既没提交也没失败上报（比如进程崩溃），超过陈旧阈值。
    const retried = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      now: new Date("2026-09-04T00:03:00.000Z"),
    });
    expect(retried.status).toBe("started");
  });

  it("还没超过阈值的 in_flight 不会被打断", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const soon = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      now: new Date("2026-09-04T00:00:30.000Z"),
    });
    expect(soon.status).toBe("in_flight");
  });
});

describe("commitPersonalMemoryLetterAttempt", () => {
  it("生成期间保存的新留言不会被旧输入覆盖", async () => {
    const first = await db.appendEmotionDailyLetterVersion({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "first",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: 1,
      payload: emptyPayload(),
    });
    const revision = first!.letter.revision;
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "reread",
    });
    await db.saveEmotionDailyLetterMessageIfRevision({
      userId: USER,
      letterDate: LETTER_DATE,
      expectedRevision: revision,
      userMessage: "生成期间刚保存的新话",
      userMessageSaidAt: new Date(),
      userMessageEditedAt: null,
      analysisSeed: {},
    });
    expect(
      await db.listEmotionDailyLetterVersions(USER, LETTER_DATE)
    ).toHaveLength(1);
    const result = await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "reread",
      trigger: "reread",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: 1,
      payload: emptyPayload(),
      expectedLetterRevision: revision,
      expectedCurrentVersionNumber: 1,
    });
    expect(result.outcome).toBe("revision_conflict");
    expect(
      (await db.getEmotionDailyLetter(USER, LETTER_DATE))?.userMessage
    ).toBe("生成期间刚保存的新话");
    expect(
      await db.listEmotionDailyLetterVersions(USER, LETTER_DATE)
    ).toHaveLength(1);
  });
  it("成功提交产生 version 1，attempt 转为 committed", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const result = await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    });
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("unreachable");
    expect(result.version.envelope.versionNumber).toBe(1);

    const attempt = await db.getPersonalMemoryLetterAttemptById(
      begun.attempt.id
    );
    expect(attempt?.state).toBe("committed");
    expect(attempt?.committedVersionId).toBe(result.version.id);
  });

  it("重复提交同一个 attempt（重试网络请求）返回同一版本，不追加第二版", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const commitInput = {
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated" as const,
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    };
    const first = await db.commitPersonalMemoryLetterAttempt(commitInput);
    const second = await db.commitPersonalMemoryLetterAttempt(commitInput);
    if (first.outcome !== "committed" || second.outcome !== "committed") {
      throw new Error("unreachable");
    }
    expect(second.version.id).toBe(first.version.id);
    const versions = await db.listEmotionDailyLetterVersions(USER, LETTER_DATE);
    expect(versions).toHaveLength(1);
  });

  it("提交期间隐私 epoch 变了（忘记/删除撤走了依据）：拒绝提交旧输入", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    // 模拟"选材开始后、模型返回前，用户在另一个标签页忘记了一条理解"。
    await db.bumpPersonalMemoryPrivacyEpoch(USER);

    const result = await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    });
    expect(result.outcome).toBe("epoch_conflict");
    if (result.outcome !== "epoch_conflict") throw new Error("unreachable");
    expect(result.currentEpoch).toBe(2);

    // 没有留下半成品版本——被拒绝的提交不应该悄悄把旧输入写成正式版本。
    const versions = await db.listEmotionDailyLetterVersions(USER, LETTER_DATE);
    expect(versions).toHaveLength(0);

    // attempt 被标记为 rejected_stale，而不是继续挂在 in_flight。
    const attempt = await db.getPersonalMemoryLetterAttemptById(
      begun.attempt.id
    );
    expect(attempt?.state).toBe("rejected_stale");
  });

  it("epoch_conflict 之后可以用同一 action ID 重新 begin 并成功提交", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    await db.bumpPersonalMemoryPrivacyEpoch(USER);
    await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    });

    const retried = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    expect(retried.status).toBe("started");
    if (retried.status !== "started") throw new Error("unreachable");
    expect(retried.attempt.privacyEpoch).toBe(2);

    const result = await db.commitPersonalMemoryLetterAttempt({
      attemptId: retried.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: retried.attempt.privacyEpoch,
      payload: emptyPayload(),
    });
    expect(result.outcome).toBe("committed");
  });

  it("commitPersonalMemoryLetterAttempt 拒绝别的用户的 attemptId", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    await expect(
      db.commitPersonalMemoryLetterAttempt({
        attemptId: begun.attempt.id,
        userId: USER + 1,
        letterDate: LETTER_DATE,
        actionId: "a1",
        trigger: "generated",
        selectorVersion: "test",
        promptVersion: "test",
        modelVersion: "test",
        privacyEpoch: begun.attempt.privacyEpoch,
        payload: emptyPayload(),
      })
    ).rejects.toThrow();
  });

  it("拒绝把同一用户的 attempt 偷换到另一日期或 action", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const base = {
      attemptId: begun.attempt.id,
      userId: USER,
      trigger: "generated" as const,
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    };

    await expect(
      db.commitPersonalMemoryLetterAttempt({
        ...base,
        letterDate: "2026-09-05",
        actionId: "a1",
      })
    ).rejects.toThrow(/日期|动作/);
    await expect(
      db.commitPersonalMemoryLetterAttempt({
        ...base,
        letterDate: LETTER_DATE,
        actionId: "a2",
      })
    ).rejects.toThrow(/日期|动作/);
    expect(
      await db.listEmotionDailyLetterVersions(USER, LETTER_DATE)
    ).toHaveLength(0);
  });

  it("新来信版本与 attempt 完成状态一起进入足迹，重放不重复", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const input = {
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated" as const,
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
      captureLetterVersionEvent: true,
    };

    await db.commitPersonalMemoryLetterAttempt(input);
    await db.commitPersonalMemoryLetterAttempt(input);

    const page = await db.listPersonalMemoryEventsPage({
      userId: USER,
      limit: 20,
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      sourceType: "daily_letter_version",
      actionKind: "letter_generated",
      occurredOn: LETTER_DATE,
      snapshot: {
        display: { versionNumber: 1, trigger: "generated" },
      },
    });
  });
});

describe("failPersonalMemoryLetterAttempt", () => {
  it("已经提交成功的 attempt 不会被过期的失败上报覆盖", async () => {
    const begun = await db.beginPersonalMemoryLetterAttempt({
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
    });
    if (begun.status !== "started") throw new Error("unreachable");
    const committed = await db.commitPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      letterDate: LETTER_DATE,
      actionId: "a1",
      trigger: "generated",
      selectorVersion: "test",
      promptVersion: "test",
      modelVersion: "test",
      privacyEpoch: begun.attempt.privacyEpoch,
      payload: emptyPayload(),
    });
    expect(committed.outcome).toBe("committed");

    // 客户端超时重发了一次失败上报——但服务端其实已经成功了。
    await db.failPersonalMemoryLetterAttempt({
      attemptId: begun.attempt.id,
      userId: USER,
      outcome: "failed",
    });
    const attempt = await db.getPersonalMemoryLetterAttemptById(
      begun.attempt.id
    );
    expect(attempt?.state).toBe("committed");
  });
});
