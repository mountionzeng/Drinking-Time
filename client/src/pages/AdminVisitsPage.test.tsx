import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminVisitsPage from "./AdminVisitsPage";

vi.stubGlobal("React", React);
vi.stubGlobal("window", {
  location: {
    hostname: "preview.drinkingtime.top",
    href: "",
  },
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    accessAnalytics: {
      overview: {
        useQuery: () => ({
          data: {
            generatedAt: new Date("2026-07-27T12:00:30.000Z"),
            users: [
              {
                userId: 7,
                name: "测试用户",
                email: "tester@example.com",
                role: "user",
                firstSeenAt: new Date("2026-07-27T11:30:00.000Z"),
                lastSeenAt: new Date("2026-07-27T12:00:00.000Z"),
                visitCount: 2,
                durationSeconds: 3720,
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

describe("管理员访问看板", () => {
  it("展示用户、访问次数、停留时间和在线状态", () => {
    const html = renderToStaticMarkup(<AdminVisitsPage />);

    expect(html).toContain("访问情况");
    expect(html).toContain("preview.drinkingtime.top");
    expect(html).toContain("测试用户");
    expect(html).toContain("tester@example.com");
    expect(html).toContain("1 小时 2 分钟");
    expect(html).toContain("在线");
    expect(html).toContain("仅统计登录后的活跃时间");
    expect(html).toContain("不保存");
  });
});
