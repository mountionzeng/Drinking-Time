import { describe, expect, it } from "vitest";
import { describeAuthMode, isAuthDisabled, resolveListenHost } from "./authMode";

describe("authMode", () => {
  it("keeps auth on by default", () => {
    expect(isAuthDisabled({})).toBe(false);
    expect(isAuthDisabled({ NODE_ENV: "development" })).toBe(false);
    expect(isAuthDisabled({ NODE_ENV: "development", DISABLE_AUTH: "false" })).toBe(false);
    expect(isAuthDisabled({ NODE_ENV: "development", DISABLE_AUTH: "1" })).toBe(false);
  });

  it("only disables auth for explicit DISABLE_AUTH=true on loopback dev", () => {
    expect(resolveListenHost({ NODE_ENV: "development" })).toBe("127.0.0.1");
    expect(isAuthDisabled({ NODE_ENV: "development", DISABLE_AUTH: "true" })).toBe(true);
  });

  it("ignores DISABLE_AUTH=true in production or when listening on all interfaces", () => {
    expect(isAuthDisabled({ NODE_ENV: "production", DISABLE_AUTH: "true" })).toBe(false);
    expect(resolveListenHost({ NODE_ENV: "test" })).toBeUndefined();
    expect(isAuthDisabled({ NODE_ENV: "test", DISABLE_AUTH: "true" })).toBe(false);
    expect(isAuthDisabled({ DISABLE_AUTH: "true" })).toBe(false);
    expect(describeAuthMode({ NODE_ENV: "production", DISABLE_AUTH: "true" })).toMatch(/被忽略/);
    expect(describeAuthMode({ NODE_ENV: "development" })).toBeNull();
  });
});
