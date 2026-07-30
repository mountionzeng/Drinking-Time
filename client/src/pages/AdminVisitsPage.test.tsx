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
                createdAt: new Date("2026-07-27T10:00:00.000Z"),
                lastSignedIn: new Date("2026-07-27T11:29:00.000Z"),
                firstSeenAt: new Date("2026-07-27T11:30:00.000Z"),
                lastSeenAt: new Date("2026-07-27T12:00:00.000Z"),
                hasAccessHistory: true,
                visitCount: 2,
                durationSeconds: 3720,
                imageGenerations: 4,
                videoGenerations: 2,
                videoSeconds: 9,
                recentSessions: [
                  {
                    startedAt: new Date("2026-07-27T11:30:00.000Z"),
                    lastSeenAt: new Date("2026-07-27T12:00:00.000Z"),
                    durationSeconds: 1800,
                  },
                ],
              },
              {
                userId: 8,
                name: null,
                email: "new@example.com",
                role: "user",
                createdAt: new Date("2026-07-27T09:00:00.000Z"),
                lastSignedIn: new Date("2026-07-27T09:30:00.000Z"),
                firstSeenAt: new Date("2026-07-27T09:00:00.000Z"),
                lastSeenAt: new Date("2026-07-27T09:30:00.000Z"),
                hasAccessHistory: false,
                visitCount: 0,
                durationSeconds: 0,
                imageGenerations: 0,
                videoGenerations: 0,
                videoSeconds: 0,
                recentSessions: [],
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

    expect(html).toContain("用户管理");
    expect(html).toContain("preview.drinkingtime.top");
    expect(html).toContain("测试用户");
    expect(html).toContain("tester@example.com");
    expect(html).toContain("1 小时 2 分钟");
    expect(html).toContain("在线");
    expect(html).toContain("登录活跃与生成算力概览");
    expect(html).toContain("图片 4 次");
    expect(html).toContain("视频 2 次");
    expect(html).toContain("近期使用时段");
    expect(html).toContain("new@example.com");
    expect(html).toContain("尚无访问记录");
    expect(html).toContain("不保存");
  });
});
