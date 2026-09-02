import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminInvitesPage from "./AdminInvitesPage";

vi.stubGlobal("React", React);
vi.stubGlobal("window", {
  location: {
    href: "",
  },
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    accessAnalytics: {
      invites: {
        useQuery: () => ({
          data: {
            generatedAt: new Date("2026-08-27T04:00:00.000Z"),
            invites: [
              {
                id: 3,
                label: "pending@example.com",
                status: "pending",
                redeemedByEmail: null,
                redeemedByUserId: null,
                userName: null,
                userEmail: null,
                createdAt: new Date("2026-08-27T03:00:00.000Z"),
                redeemedAt: null,
                expiresAt: new Date("2026-09-26T03:00:00.000Z"),
              },
              {
                id: 2,
                label: "claimed@example.com",
                status: "redeemed",
                redeemedByEmail: "claimed@example.com",
                redeemedByUserId: 9,
                userName: "已领取测试员",
                userEmail: "claimed@example.com",
                createdAt: new Date("2026-08-20T03:00:00.000Z"),
                redeemedAt: new Date("2026-08-21T03:00:00.000Z"),
                expiresAt: new Date("2026-09-19T03:00:00.000Z"),
              },
              {
                id: 1,
                label: "expired@example.com",
                status: "expired",
                redeemedByEmail: null,
                redeemedByUserId: null,
                userName: null,
                userEmail: null,
                createdAt: new Date("2026-07-01T03:00:00.000Z"),
                redeemedAt: null,
                expiresAt: new Date("2026-08-01T03:00:00.000Z"),
              },
            ],
          },
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

describe("管理员邀请页", () => {
  it("展示邀请状态、关联账号和安全说明", () => {
    const html = renderToStaticMarkup(<AdminInvitesPage />);

    expect(html).toContain("内测邀请");
    expect(html).toContain("pending@example.com");
    expect(html).toContain("已领取测试员");
    expect(html).toContain("expired@example.com");
    expect(html).toContain("待领取");
    expect(html).toContain("已领取");
    expect(html).toContain("已过期");
    expect(html).toContain("尚未绑定");
    expect(html).toContain("不可逆哈希");
    expect(html).toContain('href="/admin/users"');
    expect(html).toContain('href="/admin/invites"');
  });
});
