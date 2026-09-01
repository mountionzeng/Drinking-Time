import { describe, expect, it } from "vitest";

import {
  mysqlTestDatabaseName,
  normalizeMysqlTestRootUrl,
} from "./mysqlTestHarness";

describe("mysqlTestHarness", () => {
  it("requires an explicit MySQL test URL and strips any database path", () => {
    const root = normalizeMysqlTestRootUrl(
      "mysql://tester:secret@127.0.0.1:3306/template?ssl=false",
    );

    expect(root.pathname).toBe("/");
    expect(root.searchParams.get("charset")).toBe("utf8mb4");
    expect(root.searchParams.get("ssl")).toBe("false");
  });

  it("rejects local fallback paths and non-MySQL protocols", () => {
    expect(() => normalizeMysqlTestRootUrl("")).toThrow(/required/i);
    expect(() =>
      normalizeMysqlTestRootUrl("file:///tmp/local-persist.json"),
    ).toThrow(/mysql/i);
    expect(() =>
      normalizeMysqlTestRootUrl("postgres://localhost/example"),
    ).toThrow(/mysql/i);
  });

  it("creates a narrowly scoped database name safe for quoted DDL", () => {
    const name = mysqlTestDatabaseName({ now: 1_788_000_000_000, nonce: "A-b_9" });
    expect(name).toBe("drinking_time_test_1788000000000_a_b_9");
    expect(name).toMatch(/^[a-z0-9_]+$/);
  });
});
