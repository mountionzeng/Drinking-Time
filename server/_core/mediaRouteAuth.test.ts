import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME } from "../../shared/const";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import { sdk } from "./sdk";

describe("resolveMediaRouteUserId", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  afterEach(() => {
    resetMemoryStateForTesting();
  });

  it("uses the browser guest session instead of the legacy user id", async () => {
    await upsertUser({
      openId: "local-guest",
      name: "Legacy Guest",
      loginMethod: "guest",
      lastSignedIn: new Date(),
    });
    await upsertUser({
      openId: "guest:test-browser",
      name: "Guest",
      loginMethod: "guest",
      lastSignedIn: new Date(),
    });
    const currentUser = await getUserByOpenId("guest:test-browser");
    expect(currentUser?.id).toBeGreaterThan(1);

    const token = await sdk.createSessionToken("guest:test-browser", {
      name: "Guest",
    });
    const req = {
      headers: {
        cookie: `${COOKIE_NAME}=${token}`,
      },
      protocol: "http",
    };
    await expect(
      resolveMediaRouteUserId(req as never)
    ).resolves.toBe(currentUser?.id);
  });

  it("does not fall back to user 1 when the request has no session", async () => {
    await upsertUser({
      openId: "local-guest",
      name: "Legacy Guest",
      loginMethod: "guest",
      lastSignedIn: new Date(),
    });

    await expect(
      resolveMediaRouteUserId({ headers: {} } as never)
    ).resolves.toBeNull();
  });
});
