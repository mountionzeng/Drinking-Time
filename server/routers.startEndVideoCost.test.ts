import { describe, expect, it } from "vitest";

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function context(): TrpcContext {
  return {
    user: {
      id: 702,
      openId: "start-end-video-cost-702",
      email: "start-end-video-cost@example.com",
      name: "Start End Video Cost",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("creationAgent.submitStartEndShotVideo cost confirmation", () => {
  it("rejects paid submission without an exact RMB confirmation", async () => {
    const caller = appRouter.createCaller(context());

    await expect(
      caller.creationAgent.submitStartEndShotVideo({
        storyId: 1165,
        stableShotId: "manual-sh03-mrd2a2mg-8tibci",
      } as never)
    ).rejects.toThrow(/costConfirmation/);
  });
});
