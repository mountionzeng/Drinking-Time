import { describe, expect, it } from "vitest";

import { sdk } from "./sdk";

describe("SDKServer guest sessions", () => {
  it("round-trips a signed guest session when the local app id is empty", async () => {
    const token = await sdk.createSessionToken("guest:test-browser", {
      name: "Guest",
    });

    await expect(sdk.verifySession(token)).resolves.toEqual({
      openId: "guest:test-browser",
      appId: "",
      name: "Guest",
    });
  });
});
