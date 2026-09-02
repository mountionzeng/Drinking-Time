import { describe, expect, it } from "vitest";

import { getSessionCookieOptions } from "./cookies";

describe("session cookie options", () => {
  it("uses Secure and SameSite=Lax for a trusted HTTPS request", () => {
    expect(
      getSessionCookieOptions({ protocol: "https", headers: {} } as never)
    ).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("does not trust a client-supplied forwarded protocol by itself", () => {
    expect(
      getSessionCookieOptions({
        protocol: "http",
        headers: { "x-forwarded-proto": "https" },
      } as never)
    ).toMatchObject({ sameSite: "lax", secure: false });
  });

  it("keeps local HTTP development cookies usable without weakening SameSite", () => {
    expect(
      getSessionCookieOptions({ protocol: "http", headers: {} } as never)
    ).toMatchObject({ sameSite: "lax", secure: false });
  });
});
