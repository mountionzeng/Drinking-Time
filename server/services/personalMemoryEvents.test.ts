import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildChatMessageCapture,
  buildDailyLetterMessageCapture,
  isPersonalMemoryCaptureEnabled,
} from "./personalMemoryEvents";
import { normalizePersonalMemoryEventIdentity } from "../../shared/personalMemory";

const previousAllowlist = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;

afterEach(() => {
  if (previousAllowlist === undefined) {
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
  } else {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = previousAllowlist;
  }
});

describe("Phase 1 捕获门禁", () => {
  beforeEach(() => {
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
  });

  // 这条是产品承诺，不是防御性编程：向真实用户开启捕获之前，必须先有
  // 记忆状态说明、暂停开关和清除入口。三者都还不存在，所以默认必须是关。
  it("环境变量不填时谁都不捕获", () => {
    expect(isPersonalMemoryCaptureEnabled(7)).toBe(false);
    expect(isPersonalMemoryCaptureEnabled(1)).toBe(false);
  });

  it("空串同样是关，而不是「空白名单即全部」", () => {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = "   ";
    expect(isPersonalMemoryCaptureEnabled(7)).toBe(false);
  });

  it("只对显式列入的账号开启", () => {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = "7, 12";
    expect(isPersonalMemoryCaptureEnabled(7)).toBe(true);
    expect(isPersonalMemoryCaptureEnabled(12)).toBe(true);
    expect(isPersonalMemoryCaptureEnabled(8)).toBe(false);
  });

  it("垃圾值被忽略而不是放行", () => {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = "abc,0,-3,7";
    expect(isPersonalMemoryCaptureEnabled(7)).toBe(true);
    expect(isPersonalMemoryCaptureEnabled(0)).toBe(false);
    expect(isPersonalMemoryCaptureEnabled(-3)).toBe(false);
  });
});

describe("普通聊天来源身份", () => {
  function capture(overrides: Partial<Parameters<typeof buildChatMessageCapture>[0]> = {}) {
    return buildChatMessageCapture({
      userId: 7,
      storyId: 1186,
      messageId: 1287,
      content: "  最近在学游泳  ",
      clientMessageId: "client-msg-abc",
      occurredAt: new Date("2026-09-03T02:00:00.000Z"),
      ...overrides,
    });
  }

  // 稳定来源必须是消息行 ID，不是客户端 ID——删除传播和来源解析都要靠它回源。
  it("来源是标准化消息行 ID，动作 ID 才是客户端 ID", () => {
    const built = capture();
    expect(built.identity.sourceKey).toBe("message:1287");
    expect(built.identity.actionId).toBe("client-msg-abc");
    expect(built.identity.actionKind).toBe("submitted");
    expect(() => normalizePersonalMemoryEventIdentity(built.identity)).not.toThrow();
  });

  it("同一条消息重复构造得到同一身份（重试安全）", () => {
    expect(capture().identity).toEqual(capture().identity);
  });

  it("摘录归一化空白，不保留原始排版", () => {
    expect(capture().snapshot.excerpt).toBe("最近在学游泳");
  });

  it("超长内容被截断——聊天有稳定权威修订，完整正文永远可回源解析", () => {
    const built = capture({ content: "游".repeat(500) });
    expect(built.snapshot.excerpt).toHaveLength(201);
    expect(built.snapshot.excerpt?.endsWith("…")).toBe(true);
  });

  it("按中国日期归属，不用 UTC 日期", () => {
    // UTC 的 2026-09-02T17:30Z 在中国已经是 9 月 3 日凌晨 1:30。
    const built = capture({ occurredAt: new Date("2026-09-02T17:30:00.000Z") });
    expect(built.occurredOn).toBe("2026-09-03");
  });

  it("入队一个与消息绑定的稳定 operation ID", () => {
    expect(capture().job).toEqual({
      operationId: "pm-chat-7-1287",
      extractorVersion: "v1",
    });
  });
});

describe("每日留言来源身份", () => {
  function capture(
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

  it("首次写下是 submitted", () => {
    expect(capture().identity.actionKind).toBe("submitted");
  });

  it("在已有留言上改写是 revised，且修订号进入身份", () => {
    const built = capture({ revision: 2, previousMessage: "原来那句话" });
    expect(built.identity.actionKind).toBe("revised");
    expect(built.identity.sourceRevision).toBe("2");
  });

  // 每次编辑都是新的一条经历：旧修订仍留在时间线上，不被改写。
  it("同一天的不同修订是不同事件", () => {
    expect(capture({ revision: 1 }).identity.actionId).not.toBe(
      capture({ revision: 2 }).identity.actionId
    );
  });

  // 这是修复过的真实 bug：日期级行只保留当前修订，旧修订一旦被覆盖就
  // 不存在于任何别的表里。事件是「旧修订的历史权威」，截断等于默默丢历史。
  it("不截断——事件是旧修订唯一保留全文的地方", () => {
    const longMessage = "今天想说的话，".repeat(60); // 远超聊天的 200 字上限
    const built = capture({ message: longMessage });
    expect(built.snapshot.excerpt).toBe(longMessage);
    expect(built.snapshot.excerpt?.endsWith("…")).toBe(false);
  });

  // 清空是明确的编辑/删除语义，不是一条新感悟。
  it("清空记为 cleared，且不入队提炼任务", () => {
    const built = capture({ message: "  ", previousMessage: "原来那句话" });
    expect(built.identity.actionKind).toBe("cleared");
    expect(built.job).toBeNull();
    expect(built.snapshot.excerpt).toBeNull();
  });

  // 跨日补写不能改写旧日期：留言属于它那一天，不是写下它的那一天。
  it("按留言所属日期归属，而不是写下的时刻", () => {
    const built = capture({
      letterDate: "2026-09-01",
      occurredAt: new Date("2026-09-03T02:00:00.000Z"),
    });
    expect(built.occurredOn).toBe("2026-09-01");
  });

  it("构造出的身份都能通过合同校验", () => {
    for (const built of [
      capture(),
      capture({ revision: 3, previousMessage: "旧的" }),
      capture({ message: "", previousMessage: "旧的" }),
    ]) {
      expect(() =>
        normalizePersonalMemoryEventIdentity(built.identity)
      ).not.toThrow();
    }
  });
});
