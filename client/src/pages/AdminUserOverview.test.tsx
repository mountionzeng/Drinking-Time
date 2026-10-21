import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import AdminUserOverview from "./AdminUserOverview";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ error: null as unknown, isLoading: false }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ adminUsers: { overview: { invalidate: vi.fn() } } }),
    adminUsers: {
      setCategory: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
      overview: {
        useQuery: () => ({
          ...state,
          refetch: vi.fn(),
          data: {
            generatedAt: new Date("2026-10-21T12:00:00Z"),
            siteHost: "www.drinkingtime.top",
            summary: {
              registered: 5,
              external: 0,
              own: 2,
              test: 0,
              unclassified: 3,
              new7d: 1,
              active7d: 3,
              externalActive7d: 0,
              lifetimeSpentMinor: 500000,
              externalSpentMinor: 0,
              legacy: 1,
              guests: 0,
            },
            users: [
              {
                userId: 7,
                email: "sample@example.com",
                name: "Sample",
                role: "user",
                registration: "verified",
                providers: ["email", "google"],
                category: "unclassified",
                createdAt: new Date("2026-10-21T12:00:00Z"),
                lastSignedIn: new Date("2026-10-21T12:00:00Z"),
                lastSeenAt: null,
                visitCount: 0,
                durationSeconds: 0,
                giftMinor: 2500000,
                lifetimeSpentMinor: 500000,
                reservedMinor: 0,
                availableMinor: 2000000,
              },
            ],
          },
        }),
      },
    },
  },
}));
beforeEach(() => {
  state.error = null;
  state.isLoading = false;
});
it("distinguishes known external users from pending accounts and shows ledger values and editable categories", () => {
  const html = renderToStaticMarkup(
    <AdminUserOverview siteHost="www.drinkingtime.top" />
  );
  for (const text of [
    "已验证注册账号",
    "已确认外部用户",
    "待确认账号",
    "自己的账号 2 个",
    "sample@example.com",
    "邮箱 / Google",
    "尚无访问记录",
    "1.00 算力",
    "4.00 算力",
    "查看账号 7 的账单",
    "账号 7 的分类",
    "不以登录时间代替",
  ])
    expect(html).toContain(text);
});
it("never presents a failed or loading query as zero users or stale success", () => {
  state.error = new Error("offline");
  const failed = renderToStaticMarkup(
    <AdminUserOverview siteHost="www.drinkingtime.top" />
  );
  expect(failed).toContain("当前人数未知");
  expect(failed).not.toContain("sample@example.com");
  expect(failed).not.toContain("已验证注册账号");
  state.error = null;
  state.isLoading = true;
  const loading = renderToStaticMarkup(
    <AdminUserOverview siteHost="www.drinkingtime.top" />
  );
  expect(loading).toContain("正在核对");
  expect(loading).not.toContain("sample@example.com");
});
