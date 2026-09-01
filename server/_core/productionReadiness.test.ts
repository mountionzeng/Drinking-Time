import { describe, expect, it } from "vitest";

import {
  assertProductionReadiness,
  inspectProductionReadiness,
  productionTrustProxy,
} from "./productionReadiness";

function validProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DISABLE_AUTH: "false",
    JWT_SECRET: "4uP9xA2kL7mN5qR8vW3yB6cD1fG0hJzS",
    APP_ORIGIN: "https://www.drinkingtime.top",
    OAUTH_SERVER_URL: "https://auth.drinkingtime.top",
    DATABASE_URL:
      "mysql://app:secret@127.0.0.1:3306/drinking_time?charset=utf8mb4",
    CSP_MEDIA_ORIGINS: "https://file.302.ai https://assets.drinkingtime.top",
  };
}

describe("production readiness", () => {
  it("accepts real auth, strong sessions, HTTPS and shared utf8mb4 MySQL", () => {
    expect(inspectProductionReadiness(validProductionEnv())).toEqual({
      ready: true,
      errors: [],
    });
    expect(productionTrustProxy(validProductionEnv())).toBe("loopback");
  });

  it.each([
    "DISABLE_AUTH",
    "JWT_SECRET",
    "APP_ORIGIN",
    "OAUTH_SERVER_URL",
    "DATABASE_URL",
    "CSP_MEDIA_ORIGINS",
  ])("fails closed when %s is absent", key => {
    const env = validProductionEnv();
    delete env[key];
    expect(inspectProductionReadiness(env).ready).toBe(false);
    expect(() => assertProductionReadiness(env)).toThrow(
      "Production readiness failed"
    );
  });

  it("rejects disabled auth, HTTP origins, weak secrets and non-utf8mb4 DBs", () => {
    const cases = [
      { DISABLE_AUTH: "true" },
      { APP_ORIGIN: "http://www.drinkingtime.top" },
      { OAUTH_SERVER_URL: "http://auth.drinkingtime.top" },
      { JWT_SECRET: "short" },
      {
        DATABASE_URL: "mysql://app:secret@127.0.0.1/drinking_time?charset=utf8",
      },
      { DATABASE_URL: "file:///tmp/local.json" },
      { CSP_MEDIA_ORIGINS: "*" },
      { CSP_MEDIA_ORIGINS: "http://file.302.ai" },
    ];

    for (const overrides of cases) {
      expect(
        inspectProductionReadiness({
          ...validProductionEnv(),
          ...overrides,
        }).ready,
        JSON.stringify(overrides)
      ).toBe(false);
    }
  });

  it("does not impose production-only infrastructure on local development", () => {
    expect(inspectProductionReadiness({ NODE_ENV: "development" })).toEqual({
      ready: true,
      errors: [],
    });
    expect(productionTrustProxy({ NODE_ENV: "development" })).toBe(false);
  });
});
