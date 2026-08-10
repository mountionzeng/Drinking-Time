/** 评测脚本的本地只读数据路径解析。 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function buildEvalDataPathCandidates(options: {
  filename: string;
  explicit?: string;
  environmentPath?: string;
  cwd?: string;
  gitCommonDir?: string;
}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const candidates: string[] = [];
  if (options.explicit) candidates.push(resolve(cwd, options.explicit));
  if (options.environmentPath)
    candidates.push(resolve(cwd, options.environmentPath));
  if (options.gitCommonDir) {
    candidates.push(
      resolve(dirname(resolve(cwd, options.gitCommonDir)), options.filename)
    );
  }
  candidates.push(resolve(cwd, options.filename));
  return Array.from(new Set(candidates));
}

export function firstExistingEvalDataPath(
  candidates: readonly string[],
  exists: (path: string) => boolean = existsSync
): string | undefined {
  return candidates.find(candidate => exists(candidate));
}

function readGitCommonDir(cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function resolveEvalDataPath(options: {
  filename: string;
  description: string;
  usage: string;
  explicit?: string;
  environmentPath?: string;
}): string {
  const cwd = process.cwd();
  const candidates = buildEvalDataPathCandidates({
    ...options,
    cwd,
    gitCommonDir: readGitCommonDir(cwd),
  });
  const found = firstExistingEvalDataPath(candidates);
  if (found) return found;
  throw new Error(
    `找不到${options.description}。试过：\n${candidates.map(path => `  - ${path}`).join("\n")}\n${options.usage}`
  );
}
