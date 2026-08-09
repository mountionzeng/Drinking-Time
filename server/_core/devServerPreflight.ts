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
  assertDevelopmentPort(port);
  assertDevelopmentServerCwd(cwd, primaryWorktreePath(worktreeList));
}
