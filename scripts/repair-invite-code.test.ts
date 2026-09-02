import { describe, expect, it } from "vitest";

import {
  hashInviteCode,
  unnormalizedInviteCodeDigest,
} from "../server/services/inviteAccess";
import {
  evaluateInviteRepair,
  evaluateInviteRetirement,
  summarizeInviteRecords,
  type InviteRepairInput,
  type InviteRepairRecord,
} from "./repair-invite-code";

const RAW_CODE = "LH-AB12-CD34";
const NOW = new Date("2026-09-02T12:00:00Z");
const STAGING = "drinking_time_mobile_staging";

function record(overrides: Partial<InviteRepairRecord> = {}): InviteRepairRecord {
  return {
    id: 1,
    label: "测试站首码",
    codeHash: unnormalizedInviteCodeDigest(RAW_CODE),
    redeemedAt: null,
    redeemedByEmail: null,
    expiresAt: new Date("2026-10-02T05:52:10Z"),
    ...overrides,
  };
}

function input(overrides: Partial<InviteRepairInput> = {}): InviteRepairInput {
  return {
    rawCode: RAW_CODE,
    actualDatabaseName: STAGING,
    expectedDatabaseName: STAGING,
    legacyMatch: record(),
    authoritativeMatch: null,
    now: NOW,
    ...overrides,
  };
}

describe("evaluateInviteRepair", () => {
  it("五个前置条件同时成立时，才把旧摘要换成权威摘要", () => {
    const decision = evaluateInviteRepair(input());

    expect(decision.action).toBe("repair");
    expect(decision.recordId).toBe(1);
    expect(decision.nextCodeHash).toBe(hashInviteCode(RAW_CODE));
    expect(decision.previousCodeHash).toBe(unnormalizedInviteCodeDigest(RAW_CODE));
  });

  it("重复运行收敛为 no-op：记录已经是权威摘要就不再写", () => {
    const decision = evaluateInviteRepair(
      input({
        legacyMatch: null,
        authoritativeMatch: record({ codeHash: hashInviteCode(RAW_CODE) }),
      })
    );

    expect(decision.action).toBe("no-op");
    expect(decision.recordId).toBe(1);
    expect(decision.nextCodeHash).toBeNull();
  });

  it("目标库不是显式确认的测试库时一律拒绝", () => {
    expect(
      evaluateInviteRepair(input({ actualDatabaseName: "drinking_time" })).action
    ).toBe("refuse");
    expect(
      evaluateInviteRepair(input({ expectedDatabaseName: "" })).action
    ).toBe("refuse");
    // 即使调用方把正式库同时写进 expected，也不允许本脚本写它
    expect(
      evaluateInviteRepair(
        input({
          actualDatabaseName: "drinking_time",
          expectedDatabaseName: "drinking_time",
        })
      ).action
    ).toBe("refuse");
  });

  it("记录已领取时不改旧记录，改走签发替代卡", () => {
    const decision = evaluateInviteRepair(
      input({
        legacyMatch: record({
          redeemedAt: new Date("2026-09-01T00:00:00Z"),
          redeemedByEmail: "someone@example.com",
        }),
      })
    );

    expect(decision.action).toBe("refuse");
    expect(decision.fallback).toBe("issue-replacement");
    expect(decision.reasons.join(" ")).toContain("已领取");
  });

  it("记录已过期时不改旧记录，改走签发替代卡", () => {
    const decision = evaluateInviteRepair(
      input({ legacyMatch: record({ expiresAt: new Date("2026-08-01T00:00:00Z") }) })
    );

    expect(decision.action).toBe("refuse");
    expect(decision.fallback).toBe("issue-replacement");
    expect(decision.reasons.join(" ")).toContain("已过期");
  });

  it("原码在目标库里找不到对应记录时不猜测", () => {
    const decision = evaluateInviteRepair(
      input({ legacyMatch: null, authoritativeMatch: null })
    );

    expect(decision.action).toBe("refuse");
    expect(decision.fallback).toBeNull();
  });

  it("权威摘要已被另一条记录占用时拒绝，避免出现两个有效凭据", () => {
    const decision = evaluateInviteRepair(
      input({
        authoritativeMatch: record({ id: 7, codeHash: hashInviteCode(RAW_CODE) }),
      })
    );

    expect(decision.action).toBe("refuse");
    expect(decision.fallback).toBeNull();
    expect(decision.reasons.join(" ")).toContain("两个");
  });

  it("任何判定结果都不包含邀请码原码", () => {
    const decisions = [
      evaluateInviteRepair(input()),
      evaluateInviteRepair(input({ legacyMatch: null, authoritativeMatch: null })),
      evaluateInviteRepair(input({ actualDatabaseName: "drinking_time" })),
      evaluateInviteRepair(
        input({ legacyMatch: record({ redeemedAt: new Date("2026-09-01T00:00:00Z") }) })
      ),
    ];

    for (const decision of decisions) {
      const serialized = JSON.stringify(decision);
      expect(serialized).not.toContain(RAW_CODE);
      expect(serialized).not.toContain("AB12");
      expect(serialized).not.toContain("LHAB12CD34");
    }
  });
});

describe("summarizeInviteRecords", () => {
  const NOW_LOCAL = new Date("2026-09-02T12:00:00Z");

  it("只读盘点：给出状态和摘要指纹，不需要原码", () => {
    const summary = summarizeInviteRecords(
      [
        record({ id: 1 }),
        record({ id: 2, redeemedAt: new Date("2026-08-01T00:00:00Z"), redeemedByEmail: "a@example.com" }),
        record({ id: 3, expiresAt: new Date("2026-08-01T00:00:00Z") }),
        record({ id: 4, expiresAt: null }),
      ],
      NOW_LOCAL
    );

    expect(summary.map(item => item.state)).toEqual([
      "claimable",
      "redeemed",
      "expired",
      "claimable",
    ]);
    expect(summary[0].hashFingerprint).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(summary)).not.toContain(RAW_CODE);
    // 完整摘要不出现在盘点结果里
    expect(JSON.stringify(summary)).not.toContain(
      unnormalizedInviteCodeDigest(RAW_CODE)
    );
  });
});

describe("evaluateInviteRetirement", () => {
  it("未领取未过期的记录：置为立即过期，保留全部字段供审计", () => {
    const decision = evaluateInviteRetirement({
      record: record(),
      actualDatabaseName: STAGING,
      expectedDatabaseName: STAGING,
      now: NOW,
    });

    expect(decision).toMatchObject({ action: "retire", recordId: 1 });
  });

  it("已经过期或已领取的记录是 no-op：它本来就不可再领取", () => {
    expect(
      evaluateInviteRetirement({
        record: record({ expiresAt: new Date("2026-08-01T00:00:00Z") }),
        actualDatabaseName: STAGING,
        expectedDatabaseName: STAGING,
        now: NOW,
      })
    ).toMatchObject({ action: "no-op" });

    expect(
      evaluateInviteRetirement({
        record: record({ redeemedAt: new Date("2026-08-01T00:00:00Z") }),
        actualDatabaseName: STAGING,
        expectedDatabaseName: STAGING,
        now: NOW,
      })
    ).toMatchObject({ action: "no-op" });
  });

  it("目标库不是显式确认的测试库时一律拒绝", () => {
    expect(
      evaluateInviteRetirement({
        record: record(),
        actualDatabaseName: "drinking_time",
        expectedDatabaseName: "drinking_time",
        now: NOW,
      })
    ).toMatchObject({ action: "refuse" });
    expect(
      evaluateInviteRetirement({
        record: record(),
        actualDatabaseName: STAGING,
        expectedDatabaseName: "",
        now: NOW,
      })
    ).toMatchObject({ action: "refuse" });
  });

  it("记录不存在时不猜", () => {
    expect(
      evaluateInviteRetirement({
        record: null,
        actualDatabaseName: STAGING,
        expectedDatabaseName: STAGING,
        now: NOW,
      })
    ).toMatchObject({ action: "refuse" });
  });

  it("退役判定不包含原码", () => {
    const serialized = JSON.stringify(
      evaluateInviteRetirement({
        record: record(),
        actualDatabaseName: STAGING,
        expectedDatabaseName: STAGING,
        now: NOW,
      })
    );

    expect(serialized).not.toContain(RAW_CODE);
    expect(serialized).not.toContain("AB12");
  });
});
