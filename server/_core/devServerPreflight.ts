import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertDevelopmentPort,
  assertDevelopmentServerCwd,
} from "./portPolicy";

function currentWorktreeList(): string {
  return execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf-8",
  });
}

function primaryWorktreePath(worktreeList: string): string {
  const first = worktreeList
    .split("\n")
    .find(line => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  if (!first) throw new Error("Unable to determine the primary worktree path.");
  return first;
}

export function validateDevelopmentServerStartup({
  cwd = process.cwd(),
  port = Number(process.env.PORT || "3000"),
  worktreeList = currentWorktreeList(),
}: {
  cwd?: string;
  port?: number;
  worktreeList?: string;
} = {}): void {
  // TEST-ONLY (feat/chat-i2v-loop, do not merge): an isolated preview may run on
  // another port from a secondary worktree only when it points at its own copy
  // of the local store, so it can never write the primary server's data.
  const isolatedStore = process.env.LOCAL_PERSIST_PATH?.trim();
  if (
    process.env.DT_ISOLATED_PREVIEW === "1" &&
    isolatedStore &&
    !isolatedStore.includes("/Library/Application Support/Drinking Time/") &&
    !isolatedStore.startsWith(path.resolve(primaryWorktreePath(worktreeList)))
  ) {
    return;
  }
  assertDevelopmentPort(port);
  assertDevelopmentServerCwd(cwd, primaryWorktreePath(worktreeList));
}
