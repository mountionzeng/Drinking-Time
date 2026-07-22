import { afterEach, describe, expect, it } from "vitest";

import { ENV } from "./env";
import { sdk } from "./sdk";

const originalAppId = ENV.appId;
const originalCookieSecret = ENV.cookieSecret;

describe("本地账号会话", () => {
  afterEach(() => {
    ENV.appId = originalAppId;
    ENV.cookieSecret = originalCookieSecret;
  });

  it("没有外部应用 ID 时仍能签发并验证会话", async () => {
    ENV.appId = "";
    ENV.cookieSecret = "local-session-test-secret";

    const token = await sdk.createSessionToken("email:user@example.com", {
      name: "user",
    });
    const session = await sdk.verifySession(token);

    expect(session).toEqual({
      openId: "email:user@example.com",
      appId: "drinking-time",
      name: "user",
    });
  });
});
