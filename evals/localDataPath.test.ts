import { describe, expect, it } from "vitest";

import {
  buildEvalDataPathCandidates,
  firstExistingEvalDataPath,
} from "./localDataPath";

describe("评测本地数据路径", () => {
  it("默认先读主 checkout，再用 worktree 当前目录兜底", () => {
    const candidates = buildEvalDataPathCandidates({
      filename: ".webdev/local-persist.json",
      cwd: "/repo/.worktrees/feature",
      gitCommonDir: "/repo/.git",
    });

    expect(candidates).toEqual([
      "/repo/.webdev/local-persist.json",
      "/repo/.worktrees/feature/.webdev/local-persist.json",
    ]);
    const bothExist = new Set(candidates);
    expect(
      firstExistingEvalDataPath(candidates, path => bothExist.has(path))
    ).toBe("/repo/.webdev/local-persist.json");
  });

  it("显式参数和环境变量仍高于主 checkout", () => {
    expect(
      buildEvalDataPathCandidates({
        filename: ".webdev/data.json",
        explicit: "/explicit.json",
        environmentPath: "/environment.json",
        cwd: "/repo/.worktrees/feature",
        gitCommonDir: "/repo/.git",
      })
    ).toEqual([
      "/explicit.json",
      "/environment.json",
      "/repo/.webdev/data.json",
      "/repo/.worktrees/feature/.webdev/data.json",
    ]);
  });

  it("主 checkout 就是当前目录时去重", () => {
    expect(
      buildEvalDataPathCandidates({
        filename: ".webdev/data.json",
        cwd: "/repo",
        gitCommonDir: ".git",
      })
    ).toEqual(["/repo/.webdev/data.json"]);
  });
});
