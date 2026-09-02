import { describe, expect, it } from "vitest";

import {
  buildCrossSourceEmailIndex,
  buildEmailGroups,
  buildOwnershipCandidates,
  editDistance,
  findNearMissEmailPairs,
  summarizeCounts,
  type InventoryUser,
} from "./inventory-account-migration";

function user(overrides: Partial<InventoryUser> = {}): InventoryUser {
  return {
    id: 1,
    openId: "email:a@example.com",
    name: "A",
    email: "a@example.com",
    ...overrides,
  };
}

describe("editDistance", () => {
  it("算出常见拼写差异的距离", () => {
    expect(editDistance("mountionzeng", "mountainzeng")).toBe(2);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "abd")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("buildEmailGroups", () => {
  it("按标准化邮箱分组；一个邮箱对应多个用户就是冲突", () => {
    const groups = buildEmailGroups([
      user({ id: 1, email: "Owner@Example.com" }),
      user({ id: 2, email: " owner@example.com " }),
      user({ id: 3, email: "other@example.com" }),
      user({ id: 4, email: null }),
      user({ id: 5, email: "" }),
    ]);

    const owner = groups.find(g => g.normalizedEmail === "owner@example.com")!;
    expect(owner.userIds).toEqual([1, 2]);
    expect(owner.resolution).toBe("conflict");

    const other = groups.find(g => g.normalizedEmail === "other@example.com")!;
    expect(other.resolution).toBe("unique");

    // 没有邮箱的账号单独归类，绝不并进任何邮箱分组
    const anonymous = groups.find(g => g.normalizedEmail === null)!;
    expect(anonymous.userIds).toEqual([4, 5]);
    expect(anonymous.resolution).toBe("no_email");
  });
});

describe("findNearMissEmailPairs", () => {
  it("找出拼写相近但不相同的邮箱，交给人判断", () => {
    const pairs = findNearMissEmailPairs([
      "mountionzeng@gmail.com",
      "mountainzeng@gmail.com",
      "someone@example.com",
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      left: "mountainzeng@gmail.com",
      right: "mountionzeng@gmail.com",
      distance: 2,
    });
  });

  it("完全相同的邮箱不算近似；差得太远的也不算", () => {
    expect(findNearMissEmailPairs(["a@example.com", "a@example.com"])).toEqual([]);
    expect(
      findNearMissEmailPairs(["alice@example.com", "bob@example.com"])
    ).toEqual([]);
  });

  it("不同域名的相同用户名不当作近似——那是两个人", () => {
    expect(
      findNearMissEmailPairs(["a@gmail.com", "a@outlook.com"])
    ).toEqual([]);
  });
});

describe("buildOwnershipCandidates", () => {
  const users = [
    user({ id: 48, email: null, name: "Guest" }),
    user({ id: 7, email: "owner@example.com", name: "Owner" }),
  ];
  const projects = [
    { id: 1, userId: 48 },
    { id: 2, userId: 48 },
    { id: 3, userId: 7 },
  ];
  const stories = [
    { id: 100, userId: 48, projectId: 1 },
    { id: 101, userId: 48, projectId: 1 },
  ];

  it("统计每个账号持有的内容，并标出无邮箱账号", () => {
    const candidates = buildOwnershipCandidates({ users, projects, stories });
    const guest = candidates.find(c => c.userId === 48)!;

    expect(guest).toMatchObject({
      userId: 48,
      email: null,
      projectCount: 2,
      storyCount: 2,
      needsManualMapping: true,
    });
    expect(guest.reason).toContain("没有邮箱");
  });

  it("有邮箱且唯一的账号不需要人工映射", () => {
    const owner = buildOwnershipCandidates({ users, projects, stories }).find(
      c => c.userId === 7
    )!;

    expect(owner.needsManualMapping).toBe(false);
    expect(owner.storyCount).toBe(0);
  });

  it("持有内容的无邮箱账号绝不给出自动归属建议", () => {
    const candidates = buildOwnershipCandidates({ users, projects, stories });

    for (const candidate of candidates) {
      expect(candidate).not.toHaveProperty("proposedEmail");
      expect(candidate).not.toHaveProperty("autoMapTo");
    }
  });
});

describe("summarizeCounts", () => {
  it("给出每表计数与稳定摘要", () => {
    const summary = summarizeCounts({ users: [user()], stories: [] });

    expect(summary.counts).toEqual({ users: 1, stories: 0 });
    expect(summary.digests.users).toMatch(/^[a-f0-9]{64}$/);
    // 同样的输入得到同样的摘要
    expect(summarizeCounts({ users: [user()], stories: [] }).digests.users).toBe(
      summary.digests.users
    );
  });
});

describe("buildCrossSourceEmailIndex", () => {
  const sources = [
    {
      sourceKey: "legacy_mysql",
      users: [
        user({ id: 1, email: "owner@example.com" }),
        user({ id: 11, email: null, name: "历史待认领" }),
      ],
    },
    {
      sourceKey: "staging_mysql",
      users: [user({ id: 1, email: "Owner@Example.com" })],
    },
  ];

  it("同一邮箱跨来源出现时列为跨库映射候选，而不是冲突", () => {
    const index = buildCrossSourceEmailIndex(sources);
    const owner = index.find(e => e.normalizedEmail === "owner@example.com")!;

    expect(owner.appearances).toEqual([
      { sourceKey: "legacy_mysql", userIds: [1] },
      { sourceKey: "staging_mysql", userIds: [1] },
    ]);
    expect(owner.withinSourceConflict).toBe(false);
    expect(owner.spansMultipleSources).toBe(true);
  });

  it("单个来源里同邮箱多账号才是冲突", () => {
    const index = buildCrossSourceEmailIndex([
      {
        sourceKey: "legacy_mysql",
        users: [
          user({ id: 1, email: "dup@example.com" }),
          user({ id: 2, email: "dup@example.com" }),
        ],
      },
    ]);

    expect(index[0]).toMatchObject({
      normalizedEmail: "dup@example.com",
      withinSourceConflict: true,
    });
  });

  it("无邮箱账号不进入邮箱索引——它们只能靠人工映射", () => {
    const index = buildCrossSourceEmailIndex(sources);

    expect(index.every(entry => entry.normalizedEmail !== null)).toBe(true);
    expect(JSON.stringify(index)).not.toContain("历史待认领");
  });
});
