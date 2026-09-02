import { describe, expect, it } from "vitest";

import {
  clearRecoveryForScope,
  parseRecoveryKey,
  pruneRecoveryStorage,
  readRecoveryOwner,
  readRecoveryRecords,
  reconcileRecoveryOwner,
  recoveryKey,
  RECOVERY_MAX_BYTES,
  RECOVERY_MAX_RECORDS,
  RECOVERY_TTL_MS,
  utf8ByteLength,
  writeRecoveryRecords,
  type RecoveryRecordBase,
} from "../src/core/recoveryState";
import {
  createFailingStorage,
  createMemoryStorage,
} from "../src/services/storage";

const SCOPE_A = "demo-scope-aaaa";
const SCOPE_B = "demo-scope-bbbb";
const NOW = 1_760_000_000_000;

type TestRecord = RecoveryRecordBase & { body: string };

function record(body: string, updatedAt = NOW): TestRecord {
  return { body, updatedAt, expiresAt: updatedAt + RECOVERY_TTL_MS };
}

function normalize(value: unknown): TestRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TestRecord>;
  if (
    typeof candidate.body !== "string" ||
    typeof candidate.updatedAt !== "number" ||
    typeof candidate.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    body: candidate.body,
    updatedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
  };
}

describe("恢复键的作用域隔离", () => {
  it("键由不透明作用域 + 类别 + Story 组成，可往返解析", () => {
    const key = recoveryKey("document", SCOPE_A, 1186);
    expect(key).toBe("dt:mp:document:v1:demo-scope-aaaa:1186");
    expect(parseRecoveryKey(key)).toEqual({
      kind: "document",
      scope: SCOPE_A,
      storyId: 1186,
    });
  });

  it("键里不含邮箱、openid 形态的身份信息就无法解析", () => {
    expect(parseRecoveryKey("dt:mp:document:v1:someone@example.com:1")).toBeNull();
    expect(parseRecoveryKey("dt:mp:document:v2:demo-scope-aaaa:1")).toBeNull();
    expect(parseRecoveryKey("dt:mp:unknown:v1:demo-scope-aaaa:1")).toBeNull();
    expect(parseRecoveryKey("other-app:document:v1:demo-scope-aaaa:1")).toBeNull();
  });
});

describe("限额", () => {
  it("超过 8 条时只保留最近的 8 条", () => {
    const storage = createMemoryStorage();
    const key = recoveryKey("document", SCOPE_A, 1);
    const many = Array.from({ length: 12 }, (_, index) =>
      record(`第 ${index} 条`, NOW - index * 1000),
    );
    writeRecoveryRecords(storage, key, many, normalize, NOW);
    const loaded = readRecoveryRecords(storage, key, normalize, NOW);
    expect(loaded).toHaveLength(RECOVERY_MAX_RECORDS);
    expect(loaded[0]?.body).toBe("第 0 条");
    expect(loaded[loaded.length - 1]?.body).toBe("第 7 条");
  });

  it("总量超过 256KB 时丢掉最旧的，直到装得下", () => {
    const storage = createMemoryStorage();
    const key = recoveryKey("document", SCOPE_A, 1);
    const chunk = "字".repeat(20_000); // 每条约 60KB UTF-8
    const records = Array.from({ length: 6 }, (_, index) =>
      record(`${index}${chunk}`, NOW - index * 1000),
    );
    writeRecoveryRecords(storage, key, records, normalize, NOW);
    const stored = storage.getItem(key);
    expect(stored).not.toBeNull();
    expect(utf8ByteLength(stored as string)).toBeLessThanOrEqual(
      RECOVERY_MAX_BYTES,
    );
    const loaded = readRecoveryRecords(storage, key, normalize, NOW);
    expect(loaded.length).toBeLessThan(6);
    expect(loaded[0]?.body.startsWith("0")).toBe(true);
  });

  it("单条就超过总预算的记录被丢弃，不挤掉其他记录", () => {
    const storage = createMemoryStorage();
    const key = recoveryKey("document", SCOPE_A, 1);
    const monster = record("字".repeat(200_000), NOW);
    const normal = record("正常草稿", NOW - 1000);
    writeRecoveryRecords(storage, key, [monster, normal], normalize, NOW);
    const loaded = readRecoveryRecords(storage, key, normalize, NOW);
    expect(loaded.map(item => item.body)).toEqual(["正常草稿"]);
  });

  it("过期记录读不出来，并且顺手清掉键", () => {
    const storage = createMemoryStorage();
    const key = recoveryKey("conversation", SCOPE_A, 1);
    const stale = { body: "七天前的草稿", updatedAt: NOW, expiresAt: NOW - 1 };
    storage.setItem(key, JSON.stringify([stale]));
    expect(readRecoveryRecords(storage, key, normalize, NOW)).toEqual([]);
    expect(storage.getItem(key)).toBeNull();
  });
});

describe("畸形数据安全清除", () => {
  it("不是 JSON、不是数组、字段缺失都不抛错，并清理存储", () => {
    const storage = createMemoryStorage();
    const brokenJson = recoveryKey("document", SCOPE_A, 1);
    const notArray = recoveryKey("document", SCOPE_A, 2);
    const partial = recoveryKey("document", SCOPE_A, 3);
    storage.setItem(brokenJson, "{不是 JSON");
    storage.setItem(notArray, JSON.stringify({ body: "x" }));
    storage.setItem(
      partial,
      JSON.stringify([{ body: "缺时间戳" }, record("好记录")]),
    );

    expect(readRecoveryRecords(storage, brokenJson, normalize, NOW)).toEqual([]);
    expect(readRecoveryRecords(storage, notArray, normalize, NOW)).toEqual([]);
    expect(
      readRecoveryRecords(storage, partial, normalize, NOW).map(r => r.body),
    ).toEqual(["好记录"]);

    expect(storage.getItem(brokenJson)).toBeNull();
    expect(storage.getItem(notArray)).toBeNull();
  });

  it("存储整体不可用时读写都不抛错", () => {
    const storage = createFailingStorage();
    const key = recoveryKey("document", SCOPE_A, 1);
    expect(() => readRecoveryRecords(storage, key, normalize, NOW)).not.toThrow();
    expect(() =>
      writeRecoveryRecords(storage, key, [record("x")], normalize, NOW),
    ).not.toThrow();
    expect(() => reconcileRecoveryOwner(storage, SCOPE_A)).not.toThrow();
    expect(() => pruneRecoveryStorage(storage, SCOPE_A, NOW)).not.toThrow();
    expect(() => clearRecoveryForScope(storage, SCOPE_A)).not.toThrow();
  });

  it("启动清扫会一次性收敛过期与畸形数据", () => {
    const storage = createMemoryStorage();
    const expired = recoveryKey("document", SCOPE_A, 1);
    const mixed = recoveryKey("conversation", SCOPE_A, 2);
    const foreign = recoveryKey("document", SCOPE_B, 3);
    storage.setItem(
      expired,
      JSON.stringify([{ body: "旧", updatedAt: NOW, expiresAt: NOW - 1 }]),
    );
    storage.setItem(
      mixed,
      JSON.stringify([
        { body: "旧", updatedAt: NOW, expiresAt: NOW - 1 },
        record("新"),
      ]),
    );
    storage.setItem(foreign, JSON.stringify([record("别的作用域")]));

    const result = pruneRecoveryStorage(storage, SCOPE_A, NOW);
    expect(result.removedKeys).toContain(expired);
    expect(storage.getItem(expired)).toBeNull();
    expect(readRecoveryRecords(storage, mixed, normalize, NOW)).toHaveLength(1);
    // 清扫只处理当前作用域；别的作用域交给 reconcile。
    expect(storage.getItem(foreign)).not.toBeNull();
  });
});

describe("账号作用域切换", () => {
  it("换作用域时先清旧数据，新作用域枚举不到旧文本", () => {
    const storage = createMemoryStorage();
    const oldKey = recoveryKey("document", SCOPE_A, 1);
    writeRecoveryRecords(storage, oldKey, [record("上一个账号的正文")], normalize, NOW);
    reconcileRecoveryOwner(storage, SCOPE_A);
    expect(readRecoveryOwner(storage)).toBe(SCOPE_A);

    const result = reconcileRecoveryOwner(storage, SCOPE_B);
    expect(result.previousScope).toBe(SCOPE_A);
    expect(result.changed).toBe(true);
    expect(storage.getItem(oldKey)).toBeNull();
    expect(readRecoveryOwner(storage)).toBe(SCOPE_B);

    const leaked = storage
      .keys()
      .map(key => storage.getItem(key) ?? "")
      .join("\n");
    expect(leaked).not.toContain("上一个账号的正文");
  });

  it("即使没记住 owner，外来作用域的记录也会在渲染前清掉", () => {
    const storage = createMemoryStorage();
    const foreign = recoveryKey("conversation", SCOPE_B, 9);
    writeRecoveryRecords(storage, foreign, [record("别人的草稿")], normalize, NOW);

    const result = reconcileRecoveryOwner(storage, SCOPE_A);
    expect(result.previousScope).toBeNull();
    expect(result.changed).toBe(true);
    expect(storage.getItem(foreign)).toBeNull();
  });

  it("退出时清掉本作用域的全部记录与 owner", () => {
    const storage = createMemoryStorage();
    const key = recoveryKey("document", SCOPE_A, 1);
    writeRecoveryRecords(storage, key, [record("草稿")], normalize, NOW);
    reconcileRecoveryOwner(storage, SCOPE_A);

    const removed = clearRecoveryForScope(storage, SCOPE_A);
    expect(removed).toContain(key);
    expect(storage.getItem(key)).toBeNull();
    expect(readRecoveryOwner(storage)).toBeNull();
  });
});

describe("UTF-8 字节计数", () => {
  it("中文按 3 字节、emoji 按 4 字节计", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("中文")).toBe(6);
    expect(utf8ByteLength("🍶")).toBe(4);
  });
});
