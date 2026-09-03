import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppendDailyLetterVersionInput } from "./db";
import { buildDailyLetterMessageCapture } from "./services/personalMemoryEvents";
import {
  appendPersonalMemoryOutboxEntry,
  createEmptyPersonalMemoryEventSnapshot,
  createEmptyPersonalMemoryOutbox,
  PersonalMemoryIdentityError,
  type PersonalMemoryCapture,
  type PersonalMemoryEventIdentity,
  type PersonalMemoryLetterPayload,
} from "../shared/personalMemory";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-personal-memory-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");

const fs = await import("node:fs/promises");
const db = await import("./db");
// 每个用例都可能用 mockRejectedValueOnce 模拟一次落盘失败，
// 所以 beforeEach 必须把真实实现装回去，否则失败会渗到下一个用例。
const realWriteFile = (
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
).writeFile;

function identity(
  overrides: Partial<PersonalMemoryEventIdentity> = {}
): PersonalMemoryEventIdentity {
  return {
    userId: 7,
    sourceType: "chat_message",
    sourceKey: "message:1287",
    sourceRevision: "1",
    actionKind: "submitted",
    actionId: "client-msg-abc",
    ...overrides,
  };
}

function capture(
  overrides: Partial<PersonalMemoryCapture> = {}
): PersonalMemoryCapture {
  return {
    identity: identity(),
    occurredOn: "2026-09-03",
    occurredAt: "2026-09-03T02:00:00.000Z",
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: 1186,
    job: { operationId: "op-1", extractorVersion: "v1" },
    ...overrides,
  };
}

function payload(
  message: string | null = "最近在学游泳"
): PersonalMemoryLetterPayload {
  return {
    dailyReference: { todayDate: "2026-09-03" },
    analysisSeed: { userMessage: message },
    userMessage: message,
    profileRevision: "r1",
    almanac: null,
    selectedEvidence: [],
  };
}

function letterInput(
  overrides: Partial<AppendDailyLetterVersionInput> = {}
): AppendDailyLetterVersionInput {
  return {
    userId: 7,
    letterDate: "2026-09-03",
    actionId: "letter-first",
    trigger: "generated",
    selectorVersion: "s1",
    promptVersion: "p1",
    modelVersion: "m1",
    privacyEpoch: 1,
    payload: payload(),
    ...overrides,
  };
}

describe("每日留言捕获与来信版本同事务（U2）", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
  });

  function letterCapture(
    overrides: Partial<Parameters<typeof buildDailyLetterMessageCapture>[0]> = {}
  ) {
    return buildDailyLetterMessageCapture({
      userId: 7,
      letterDate: "2026-09-03",
      revision: 1,
      message: "今天想说点别的",
      previousMessage: null,
      occurredAt: new Date("2026-09-03T02:00:00.000Z"),
      ...overrides,
    });
  }

  it("留言经历与来信版本在同一次写入里成立", async () => {
    const written = (await db.appendEmotionDailyLetterVersion(
      letterInput({ personalMemoryCapture: letterCapture() })
    ))!;
    expect(written.version.envelope.versionNumber).toBe(1);

    const events = await db.listPersonalMemoryEvents(7);
    expect(events).toHaveLength(1);
    expect(events[0].sourceType).toBe("daily_letter_message");
    expect(events[0].occurredOn).toBe("2026-09-03");
  });

  // 版本写不进去时，经历也不能留下——否则时间线上会出现一条
  // 指向根本不存在的留言修订的经历。
  it("落盘失败时留言经历与版本一起消失", async () => {
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
    await expect(
      db.appendEmotionDailyLetterVersion(
        letterInput({ personalMemoryCapture: letterCapture() })
      )
    ).rejects.toThrow();

    expect(await db.listPersonalMemoryEvents(7)).toHaveLength(0);
    expect(
      await db.listEmotionDailyLetterVersions(7, "2026-09-03")
    ).toHaveLength(0);
  });

  it("每次编辑留下一条新经历，旧修订不被改写", async () => {
    await db.appendEmotionDailyLetterVersion(
      letterInput({ personalMemoryCapture: letterCapture() })
    );
    await db.appendEmotionDailyLetterVersion(
      letterInput({
        actionId: "letter-second",
        payload: payload("改了一版"),
        personalMemoryCapture: letterCapture({
          revision: 2,
          message: "改了一版",
          previousMessage: "今天想说点别的",
        }),
      })
    );

    const events = await db.listPersonalMemoryEvents(7);
    expect(events).toHaveLength(2);
    expect(events.map(event => event.actionKind).sort()).toEqual([
      "revised",
      "submitted",
    ]);
    expect(
      events.find(event => event.actionKind === "submitted")?.snapshot.excerpt
    ).toBe("今天想说点别的");
  });

  it("重复提交同一 action ID 不重复捕获", async () => {
    const input = letterInput({ personalMemoryCapture: letterCapture() });
    await db.appendEmotionDailyLetterVersion(input);
    await db.appendEmotionDailyLetterVersion(input);
    expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
  });

  it("不传捕获时只写版本，不产生经历", async () => {
    await db.appendEmotionDailyLetterVersion(letterInput());
    expect(await db.listPersonalMemoryEvents(7)).toHaveLength(0);
    expect(
      await db.listEmotionDailyLetterVersions(7, "2026-09-03")
    ).toHaveLength(1);
  });
});

describe("个人记忆本地持久化", () => {
  beforeEach(() => {
    db.resetMemoryStateForTesting();
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

  describe("捕获", () => {
    it("首次捕获建事件并入队任务，可按身份读回", async () => {
      const result = await db.capturePersonalMemoryEventStandalone(capture());
      expect(result.changed).toBe(true);

      const found = await db.getPersonalMemoryEventByIdentity(identity());
      expect(found?.id).toBe(result.event.id);
      expect(found?.occurredOn).toBe("2026-09-03");
    });

    it("重放同一动作 ID 不增加事件", async () => {
      await db.capturePersonalMemoryEventStandalone(capture());
      const replay = await db.capturePersonalMemoryEventStandalone(capture());
      await db.capturePersonalMemoryEventStandalone(capture());
      expect(replay.changed).toBe(false);
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
    });

    // 计划的 Edge case：两个用户具有相同 source ID，数据仍按用户隔离。
    it("两个账号的相同来源 ID 互不可见", async () => {
      await db.capturePersonalMemoryEventStandalone(capture());
      await db.capturePersonalMemoryEventStandalone(
        capture({ identity: identity({ userId: 8 }) })
      );
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
      expect(await db.listPersonalMemoryEvents(8)).toHaveLength(1);
      expect(
        (await db.listPersonalMemoryEvents(7))[0].userId
      ).toBe(7);
    });

    it("身份缺一段时拒绝捕获，不写任何行", async () => {
      await expect(
        db.capturePersonalMemoryEventStandalone(
          capture({ identity: identity({ sourceRevision: "" }) })
        )
      ).rejects.toThrow(PersonalMemoryIdentityError);
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(0);
    });

    // 「本地持久化中途失败时，经历和任务同时回滚，不留下半写状态」
    it("落盘失败时整份还原，不留半写状态", async () => {
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
      await expect(
        db.capturePersonalMemoryEventStandalone(capture())
      ).rejects.toThrow();
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(0);
      expect(await db.getPersonalMemoryEventByIdentity(identity())).toBeNull();
    });

    it("按 occurredAt 降序返回，同刻按 id 降序", async () => {
      await db.capturePersonalMemoryEventStandalone(
        capture({ occurredAt: "2026-09-01T02:00:00.000Z" })
      );
      await db.capturePersonalMemoryEventStandalone(
        capture({
          identity: identity({ actionId: "client-msg-def" }),
          occurredAt: "2026-09-03T02:00:00.000Z",
        })
      );
      const events = await db.listPersonalMemoryEvents(7);
      expect(events.map(event => event.actionId)).toEqual([
        "client-msg-def",
        "client-msg-abc",
      ]);
    });
  });

  describe("跨聚合投影", () => {
    it("prompt-lineage 聚合的 outbox 被幂等投影进统一索引", async () => {
      const box = createEmptyPersonalMemoryOutbox();
      appendPersonalMemoryOutboxEntry(box, capture());
      const first = await db.projectPersonalMemoryOutboxIntoIndex(
        "promptLineage",
        box.outbox
      );
      expect(first.applied).toBe(1);

      const rerun = await db.projectPersonalMemoryOutboxIntoIndex(
        "promptLineage",
        box.outbox
      );
      expect(rerun.applied).toBe(0);
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
    });

    it("投影落盘失败时索引不前进", async () => {
      const box = createEmptyPersonalMemoryOutbox();
      appendPersonalMemoryOutboxEntry(box, capture());
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
      await expect(
        db.projectPersonalMemoryOutboxIntoIndex("promptLineage", box.outbox)
      ).rejects.toThrow();
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(0);

      // 恢复后重投能补齐，且只补一次。
      const retry = await db.projectPersonalMemoryOutboxIntoIndex(
        "promptLineage",
        box.outbox
      );
      expect(retry.applied).toBe(1);
      expect(await db.listPersonalMemoryEvents(7)).toHaveLength(1);
    });
  });

  describe("隐私 epoch", () => {
    it("默认是 1，递增后可读回", async () => {
      expect(await db.getPersonalMemoryPrivacyEpoch(7)).toBe(1);
      expect(await db.bumpPersonalMemoryPrivacyEpoch(7)).toBe(2);
      expect(await db.bumpPersonalMemoryPrivacyEpoch(7)).toBe(3);
      expect(await db.getPersonalMemoryPrivacyEpoch(7)).toBe(3);
      // 另一个账号不受影响。
      expect(await db.getPersonalMemoryPrivacyEpoch(8)).toBe(1);
    });
  });

  describe("来信版本是唯一正文权威", () => {
    it("首次生成产生 version 1，日期级行成为它的投影", async () => {
      const result = (await db.appendEmotionDailyLetterVersion(letterInput()))!;
      expect(result.created).toBe(true);
      expect(result.version.envelope.versionNumber).toBe(1);
      expect(result.letter.revision).toBe(1);
      expect(result.letter.currentVersionId).toBe(result.version.id);
      expect(result.letter.userMessage).toBe("最近在学游泳");
    });

    it("重复提交同一 action ID 返回同一版本，不追加", async () => {
      const first = (await db.appendEmotionDailyLetterVersion(letterInput()))!;
      const replay = (await db.appendEmotionDailyLetterVersion(letterInput()))!;
      expect(replay.created).toBe(false);
      expect(replay.version.id).toBe(first.version.id);
      expect(
        await db.listEmotionDailyLetterVersions(7, "2026-09-03")
      ).toHaveLength(1);
    });

    // 显式「再读一遍」才追加同日新版本；旧版本保持只读。
    it("显式重读追加 version 2，指针前移而旧版本原样保留", async () => {
      const first = (await db.appendEmotionDailyLetterVersion(letterInput()))!;
      const second = (await db.appendEmotionDailyLetterVersion(
        letterInput({
          actionId: "letter-reread-1",
          trigger: "reread",
          payload: payload("今天又游了一次"),
        })
      ))!;
      expect(second.version.envelope.versionNumber).toBe(2);
      expect(second.version.envelope.trigger).toBe("reread");
      expect(second.letter.currentVersionId).toBe(second.version.id);
      expect(second.letter.userMessage).toBe("今天又游了一次");

      const versions = await db.listEmotionDailyLetterVersions(7, "2026-09-03");
      expect(versions.map(v => v.envelope.versionNumber)).toEqual([1, 2]);
      // 旧版本内容没有被后来的生成改写。
      expect(versions[0].id).toBe(first.version.id);
      expect(versions[0].payload?.userMessage).toBe("最近在学游泳");
    });

    it("不同日期各自从 version 1 开始", async () => {
      await db.appendEmotionDailyLetterVersion(letterInput());
      const other = (await db.appendEmotionDailyLetterVersion(
        letterInput({ letterDate: "2026-09-04", actionId: "letter-0904" })
      ))!;
      expect(other.version.envelope.versionNumber).toBe(1);
    });

    it("另一个账号的同日来信互不干扰", async () => {
      await db.appendEmotionDailyLetterVersion(letterInput());
      const other = (await db.appendEmotionDailyLetterVersion(
        letterInput({ userId: 8, payload: payload("别人的信") })
      ))!;
      expect(other.version.envelope.versionNumber).toBe(1);
      expect(
        await db.listEmotionDailyLetterVersions(7, "2026-09-03")
      ).toHaveLength(1);
      expect(
        await db.listEmotionDailyLetterVersions(8, "2026-09-03")
      ).toHaveLength(1);
    });

    // legacy 的 revision CAS 通过 expectedCurrentVersionNumber 继续成立：
    // 冲突时一行都不改，而不是悄悄追加一版盖掉别人刚写的内容。
    it("条件提交在版本号不匹配时拒绝追加", async () => {
      await db.appendEmotionDailyLetterVersion(letterInput());
      const stale = await db.appendEmotionDailyLetterVersion(
        letterInput({
          actionId: "letter-stale",
          payload: payload("过期的写入"),
          expectedCurrentVersionNumber: 0,
        })
      );
      expect(stale).toBeNull();

      const versions = await db.listEmotionDailyLetterVersions(7, "2026-09-03");
      expect(versions).toHaveLength(1);
      expect(
        (await db.getEmotionDailyLetter(7, "2026-09-03"))?.userMessage
      ).toBe("最近在学游泳");
    });

    it("条件提交在版本号匹配时正常追加", async () => {
      await db.appendEmotionDailyLetterVersion(letterInput());
      const next = await db.appendEmotionDailyLetterVersion(
        letterInput({
          actionId: "letter-next",
          payload: payload("接上一版"),
          expectedCurrentVersionNumber: 1,
        })
      );
      expect(next?.version.envelope.versionNumber).toBe(2);
    });

    // 向前兼容：U1 之前写下的日期级行没有版本，但 revision 是真的。
    // 第一次经过版本权威时必须接着它往下走，不能把 revision 打回 1——
    // 否则 legacy 的 CAS 调用方会拿着更大的 expectedRevision 永远冲突。
    it("存量无版本的日期级行被接续，而不是从 version 1 重来", async () => {
      await db.upsertEmotionDailyLetter({
        userId: 7,
        letterDate: "2026-09-03",
        userMessage: "U1 之前写下的",
        dailyReference: { todayDate: "2026-09-03" },
        analysisSeed: {},
        revision: 3,
      });

      const written = (await db.appendEmotionDailyLetterVersion(
        letterInput({
          actionId: "letter-after-legacy",
          payload: payload("U1 之后的第一版"),
          expectedCurrentVersionNumber: 3,
        })
      ))!;
      expect(written.version.envelope.versionNumber).toBe(4);
      expect(written.letter.revision).toBe(4);
      expect(written.letter.currentVersionId).toBe(written.version.id);
    });

    it("存量行上用过期 revision 做条件提交仍然被拒", async () => {
      await db.upsertEmotionDailyLetter({
        userId: 7,
        letterDate: "2026-09-03",
        userMessage: "U1 之前写下的",
        dailyReference: { todayDate: "2026-09-03" },
        analysisSeed: {},
        revision: 3,
      });
      expect(
        await db.appendEmotionDailyLetterVersion(
          letterInput({
            actionId: "letter-stale-legacy",
            expectedCurrentVersionNumber: 1,
          })
        )
      ).toBeNull();
    });

    it("版本落盘失败时不留下半成品当前版本", async () => {
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
      await expect(
        db.appendEmotionDailyLetterVersion(letterInput())
      ).rejects.toThrow();
      expect(
        await db.listEmotionDailyLetterVersions(7, "2026-09-03")
      ).toHaveLength(0);
      expect(await db.getEmotionDailyLetter(7, "2026-09-03")).toBeNull();
    });

    it("重读失败时旧版本仍是当前版本", async () => {
      const first = (await db.appendEmotionDailyLetterVersion(letterInput()))!;
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("disk full"));
      await expect(
        db.appendEmotionDailyLetterVersion(
          letterInput({
            actionId: "letter-reread-1",
            trigger: "reread",
            payload: payload("失败的重读"),
          })
        )
      ).rejects.toThrow();

      const letter = await db.getEmotionDailyLetter(7, "2026-09-03");
      expect(letter?.currentVersionId).toBe(first.version.id);
      expect(letter?.userMessage).toBe("最近在学游泳");
      expect(
        await db.listEmotionDailyLetterVersions(7, "2026-09-03")
      ).toHaveLength(1);
    });
  });
});
