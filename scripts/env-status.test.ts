import { describe, expect, it } from "vitest";

import {
  buildReport,
  formatSize,
  mapListenersToWorktrees,
  parseLsofListeners,
  parseWorktreePorcelain,
  type MappedListener,
  type WorktreeStatus,
} from "./env-status";

const PORCELAIN_3 = `worktree /Users/me/proj
HEAD 80a0c04aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/codex/six-draft-image-candidates

worktree /Users/me/dt-refactor
HEAD 8e28b11bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/claude/split-godobjects

worktree /Users/me/proj/.claude/worktrees/integration-ab
HEAD 8e28b11cccccccccccccccccccccccccccccccc
branch refs/heads/claude/integration-ab
`;

// 截取自真实 lsof -nP -iTCP -sTCP:LISTEN 输出形态
const LSOF_2_NODE = `COMMAND     PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      98226 yuandai   56u  IPv6 0xd1ce848c3d70f81d      0t0  TCP *:3000 (LISTEN)
node      50257 yuandai   25u  IPv6 0xeab17fed109ce367      0t0  TCP *:3010 (LISTEN)
node      98226 yuandai   57u  IPv4 0xd1ce848c3d70f81e      0t0  TCP *:3000 (LISTEN)
ControlCe   612 yuandai   10u  IPv4 0x9999999999999999      0t0  TCP *:7000 (LISTEN)
`;

function wt(path: string, branch: string, dataFile: WorktreeStatus["dataFile"]): WorktreeStatus {
  return { path, branch, head: "abc", dataFile };
}

function listener(
  pid: number,
  port: number,
  worktreePath: string | null
): MappedListener {
  return { command: "node", pid, port, cwd: worktreePath, worktreePath };
}

describe("parseWorktreePorcelain", () => {
  it("happy path: 解析 3 个 worktree 的路径与分支", () => {
    const result = parseWorktreePorcelain(PORCELAIN_3);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      path: "/Users/me/proj",
      branch: "codex/six-draft-image-candidates",
    });
    expect(result[2]).toMatchObject({
      path: "/Users/me/proj/.claude/worktrees/integration-ab",
      branch: "claude/integration-ab",
    });
  });

  it("edge case: 空输入返回空数组", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("parseLsofListeners", () => {
  it("happy path: 解析 node 进程的端口与 pid，去重 IPv4/IPv6 双行，过滤非 node 进程", () => {
    const result = parseLsofListeners(LSOF_2_NODE);
    expect(result).toEqual([
      { command: "node", pid: 98226, port: 3000 },
      { command: "node", pid: 50257, port: 3010 },
    ]);
  });
});

describe("mapListenersToWorktrees", () => {
  it("按 cwd 归属 worktree；cwd 在 worktree 子目录内也归属；映射不到的为 null", () => {
    const worktrees = parseWorktreePorcelain(PORCELAIN_3);
    const listeners = parseLsofListeners(LSOF_2_NODE);
    const cwds = new Map<number, string | null>([
      [98226, "/Users/me/proj/.claude/worktrees/integration-ab"],
      [50257, "/Users/me/elsewhere"],
    ]);
    const mapped = mapListenersToWorktrees(listeners, cwds, worktrees);
    expect(mapped[0].worktreePath).toBe(
      "/Users/me/proj/.claude/worktrees/integration-ab"
    );
    expect(mapped[1].worktreePath).toBeNull();
  });
});

describe("buildReport", () => {
  const twoWorktrees = [
    wt("/a", "main", { exists: true, sizeBytes: 3 * 1024 * 1024, mtimeMs: Date.now() }),
    wt("/b", "feat/x", { exists: true, sizeBytes: 1024, mtimeMs: Date.now() }),
  ];

  it("Covers AE1: ≥2 个 dev server 并行 → 首行醒目警告并列出各自数据文件路径", () => {
    const report = buildReport({
      worktrees: twoWorktrees,
      listeners: [listener(1, 3000, "/a"), listener(2, 3010, "/b")],
    });
    const firstLine = report.split("\n")[0];
    expect(firstLine).toContain("警告");
    expect(firstLine).toContain("2 个 dev server");
    expect(report).toContain("/a/.webdev/local-persist.json");
    expect(report).toContain("/b/.webdev/local-persist.json");
  });

  it("edge case: 仅 1 个 dev server → 无警告", () => {
    const report = buildReport({
      worktrees: twoWorktrees,
      listeners: [listener(1, 3000, "/a")],
    });
    expect(report).not.toContain("警告");
    expect(report).toContain("✅");
  });

  it("edge case: worktree 无数据文件 → 显示「无数据文件」而非报错", () => {
    const report = buildReport({
      worktrees: [wt("/c", "main", { exists: false })],
      listeners: [],
    });
    expect(report).toContain("无数据文件");
  });

  it("error path: lsof 失败 → 显示采集失败提示，worktree 区块仍正常输出", () => {
    const report = buildReport({
      worktrees: twoWorktrees,
      listeners: [],
      lsofError: "lsof 执行失败：command not found",
    });
    expect(report).toContain("端口采集失败");
    expect(report).toContain("== Worktree 一览");
    expect(report).toContain("/a");
    // lsof 失败时不应误报「没有任何 dev server」
    expect(report).not.toContain("当前没有任何 dev server");
  });

  it("同一 worktree 的服务行展示端口与 PID", () => {
    const report = buildReport({
      worktrees: twoWorktrees,
      listeners: [listener(7, 3000, "/a")],
    });
    expect(report).toContain("端口 3000（PID 7）");
  });
});

describe("formatSize", () => {
  it("字节/KB/MB 三档", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2048)).toBe("2.0KB");
    expect(formatSize(2.98 * 1024 * 1024)).toBe("2.98MB");
  });
});
