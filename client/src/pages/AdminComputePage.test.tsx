import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AdminComputePage from "./AdminComputePage";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ error: null as unknown, users: [{ userId: 1, email: "demo@example.com", name: "演示测试账号", createdAt: new Date("2026-10-18"), lastSignedIn: new Date("2026-10-18"), giftMinor: 2500000, lifetimeSpentMinor: 500000, reservedMinor: 0, availableMinor: 2000000 }] }));
vi.mock("@/lib/trpc", () => ({ trpc: { adminCompute: { users: { useQuery: () => ({ data: { users: state.users, hasMore: false }, error: state.error, refetch: vi.fn() }) } } } }));
it("shows real credits rather than generation counts, with email lookup and account details", () => {
 const html = renderToStaticMarkup(<AdminComputePage />);
 expect(html).toContain("demo@example.com"); expect(html).toContain("5.00 算力");
 expect(html).toContain("1.00 算力"); expect(html).toContain("4.00 算力");
 expect(html).toContain("按完整邮箱查询"); expect(html).toContain("查看");
 expect(html).toContain("仅统计已进入算力账本的调用");
});
it("does not render cached account data when refresh fails", () => {
 state.error = new Error("unavailable");
 const html = renderToStaticMarkup(<AdminComputePage />);
 expect(html).toContain("读取失败"); expect(html).not.toContain("demo@example.com");
 state.error = null;
});
