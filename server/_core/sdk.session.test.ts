import { describe, expect, it } from "vitest";

import { sdk } from "./sdk";

describe("SDKServer guest sessions", () => {
  it("round-trips a signed guest session when the local app id is empty", async () => {
    const token = await sdk.createSessionToken("guest:test-browser", {
      name: "Guest",
    });

    await expect(sdk.verifySession(token)).resolves.toEqual({
      // 不带 sessionVersion claim 的旧 token 仍然可验证：用户从没撤销过会话时
      // 接受它们，否则一次上线就把所有人踢下线。
      sessionVersion: null,
      openId: "guest:test-browser",
      appId: "drinking-time",
      name: "Guest",
    });
  });
});
