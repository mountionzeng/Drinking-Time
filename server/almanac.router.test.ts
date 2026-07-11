import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const almanacMock = vi.hoisted(() => ({
  getAlmanacDay: vi.fn(),
}));

vi.mock("./services/almanac", () => almanacMock);

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("almanac tRPC router", () => {
  // 整棵 appRouter 模块树的转换加载不能算进单测的 5s 超时：
  // 全量套件并发跑时，首个用例内的动态 import 会偶发超线（flaky）。
  let appRouter: typeof import("./routers").appRouter;
  beforeAll(async () => {
    ({ appRouter } = await import("./routers"));
  }, 30_000);

  beforeEach(() => {
    almanacMock.getAlmanacDay.mockReset();
  });

  it("returns normalized almanac data for a valid date", async () => {
    almanacMock.getAlmanacDay.mockResolvedValue({
      date: "2026-05-13",
      provider: "tianapi",
      sourceLabel: "天行数据老黄历",
      status: "ok",
      message: null,
      yi: ["祭祀"],
      ji: ["开市"],
      luckyHours: [],
      directions: [{ name: "财神", value: "正东" }],
      meta: {},
      fetchedAt: "2026-05-13T00:00:00.000Z",
    });
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.almanac.today({ date: "2026-05-13" });

    expect(result).toMatchObject({
      status: "ok",
      yi: ["祭祀"],
      ji: ["开市"],
      directions: [{ name: "财神", value: "正东" }],
    });
    expect(almanacMock.getAlmanacDay).toHaveBeenCalledWith("2026-05-13");
  });

  it("returns unavailable status without throwing when the service degrades", async () => {
    almanacMock.getAlmanacDay.mockResolvedValue({
      date: "2026-05-13",
      provider: "tianapi",
      sourceLabel: "天行数据老黄历",
      status: "unavailable",
      message: "API调用频率超限",
      yi: [],
      ji: [],
      luckyHours: [],
      directions: [],
      meta: {},
      fetchedAt: null,
    });
    const caller = appRouter.createCaller(createPublicContext());

    await expect(caller.almanac.today({ date: "2026-05-13" })).resolves.toMatchObject({
      status: "unavailable",
      message: "API调用频率超限",
    });
  });

  it("rejects invalid date strings before hitting the service", async () => {
    const caller = appRouter.createCaller(createPublicContext());

    await expect(caller.almanac.today({ date: "2026-5-13" })).rejects.toThrow();
    expect(almanacMock.getAlmanacDay).not.toHaveBeenCalled();
  });
});
