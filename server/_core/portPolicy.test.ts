import { createServer, type Server } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDevelopmentPort,
  assertDevelopmentServerCwd,
  findAvailablePort,
} from "./portPolicy";
import { validateDevelopmentServerStartup } from "./devServerPreflight";

let blocker: Server | null = null;

afterEach(async () => {
  if (!blocker) return;
  await new Promise<void>((resolve, reject) => {
    blocker!.close(error => (error ? reject(error) : resolve()));
  });
  blocker = null;
});

describe("findAvailablePort", () => {
  it("refuses to fall back when the requested port is already occupied", async () => {
    blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker!.listen(0, () => resolve());
      blocker!.on("error", reject);
    });
    const address = blocker.address();
    if (!address || typeof address === "string")
      throw new Error("missing port");

    await expect(findAvailablePort(address.port)).rejects.toThrow(
      `Port ${address.port} is already in use`
    );
  });

  it("keeps the requested port when it is available", async () => {
    await expect(findAvailablePort(0)).resolves.toBe(0);
  });
});

describe("development server invariants", () => {
  it("refuses to run the development server from a linked worktree", () => {
    expect(() =>
      assertDevelopmentServerCwd("/repo/.worktrees/codex/port-fix", "/repo")
    ).toThrow("must be started from the primary worktree");
  });

  it("accepts only port 3000 for development", () => {
    expect(() => assertDevelopmentPort(3001)).toThrow(
      "Development server must use port 3000"
    );
    expect(() => assertDevelopmentPort(3000)).not.toThrow();
  });
});

describe("pnpm development lifecycle", () => {
  it("delegates old-server cleanup to the verified preflight without broad pkill", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "../../package.json"),
        "utf-8"
      )
    ) as { scripts: Record<string, string> };
    const predev = packageJson.scripts.predev;

    expect(predev).toBe("tsx scripts/dev-preflight.ts");
    expect(predev).not.toContain("pkill");
  });
});

describe("development startup preflight", () => {
  const worktreeList = `worktree /repo
HEAD abc
branch refs/heads/main

worktree /repo/.worktrees/codex/port-fix
HEAD def
branch refs/heads/codex/port-fix
`;

  it("allows only the main worktree on port 3000", () => {
    expect(() =>
      validateDevelopmentServerStartup({
        cwd: "/repo",
        port: 3000,
        worktreeList,
      })
    ).not.toThrow();

    expect(() =>
      validateDevelopmentServerStartup({
        cwd: "/repo/.worktrees/codex/port-fix",
        port: 3000,
        worktreeList,
      })
    ).toThrow("must be started from the primary worktree");

    expect(() =>
      validateDevelopmentServerStartup({
        cwd: "/repo",
        port: 3001,
        worktreeList,
      })
    ).toThrow("Development server must use port 3000");
  });
});
