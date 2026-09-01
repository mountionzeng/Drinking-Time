import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./securityHeaders";

describe("production security headers", () => {
  it("enforces CSP, HSTS and browser hardening on HTTPS", () => {
    const headers = buildSecurityHeaders({
      isProduction: true,
      secureRequest: true,
      cspMediaOrigins: "https://file.302.ai https://assets.example.com",
    });

    expect(headers["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(headers["Content-Security-Policy"]).not.toContain(
      "script-src 'self' 'unsafe-inline'"
    );
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(headers["Content-Security-Policy"]).toContain(
      "img-src 'self' data: blob: https://file.302.ai https://assets.example.com"
    );
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("refuses an empty or wildcard production media allowlist", () => {
    expect(() =>
      buildSecurityHeaders({
        isProduction: true,
        secureRequest: true,
        cspMediaOrigins: "",
      })
    ).toThrow("CSP_MEDIA_ORIGINS");
    expect(() =>
      buildSecurityHeaders({
        isProduction: true,
        secureRequest: true,
        cspMediaOrigins: "*",
      })
    ).toThrow("CSP_MEDIA_ORIGINS");
    expect(() =>
      buildSecurityHeaders({
        isProduction: true,
        secureRequest: true,
        cspMediaOrigins: "https://*.example.com",
      })
    ).toThrow("CSP_MEDIA_ORIGINS");
  });

  it("does not send HSTS from local HTTP development", () => {
    const headers = buildSecurityHeaders({
      isProduction: false,
      secureRequest: false,
      cspMediaOrigins: "",
    });
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });
});
