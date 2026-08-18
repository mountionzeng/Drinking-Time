import { describe, expect, it } from "vitest";

import {
  buildCheckReport,
  buildReport,
  findEnvironmentViolations,
  formatSize,
  inspectDataFile,
  mapListenersToWorktrees,
  normalizeListenerCollection,
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

function wt(
  path: string,
  branch: string,
  dataFile: WorktreeStatus["dataFile"],
  sidecars: Pick<WorktreeStatus, "promptLineageFile" | "editSnapshotsFile"> = {
    promptLineageFile: { exists: false },
    editSnapshotsFile: { exists: false },
  }
): WorktreeStatus {
  return { path, branch, head: "abc", dataFile, ...sidecars };
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

  it("非零退出即使含部分 LISTEN 输出也保留结果并标记采集失败", () => {
    const result = normalizeListenerCollection({
      stdout: LSOF_2_NODE,
      error: "exit status 1",
    });

    expect(result.listeners).toHaveLength(2);
    expect(result.error).toContain("exit status 1");
    expect(
      findEnvironmentViolations({
        worktrees: [wt("/repo", "main", { exists: false })],
        listeners: [],
        lsofError: result.error,
      }).map(item => item.code)
    ).toContain("LISTENER_COLLECTION_FAILED");
  });
});

describe("inspectDataFile", () => {
  it("ENOENT 代表文件不存在，其他 stat 错误保留为采集失败", () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });

    expect(
      inspectDataFile("/missing", () => {
        throw missing;
      })
    ).toEqual({ exists: false });
    expect(
      inspectDataFile("/denied", () => {
        throw denied;
      })
    ).toEqual({
      exists: false,
      error: "/denied 检查失败：EACCES",
    });
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
    wt("/a", "main", {
      exists: true,
      sizeBytes: 3 * 1024 * 1024,
      mtimeMs: Date.now(),
    }),
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

  it("error path: 数据文件检查失败 → 显示失败而非不存在", () => {
    const report = buildReport({
      worktrees: [
        wt("/c", "main", {
          exists: false,
          error: "/c/.webdev/local-persist.json 检查失败：EACCES",
        }),
      ],
      listeners: [],
    });

    expect(report).toContain("数据: 检查失败");
    expect(report).not.toContain("数据: 无数据文件");
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

  it("error path: worktree 采集失败且存在监听进程 → 不推断服务数量或环境健康", () => {
    const report = buildReport({
      worktrees: [],
      listeners: [listener(8, 3000, null)],
      worktreeError: "git worktree list failed",
    });

    expect(report).toContain("git worktree list failed");
    expect(report).toContain("服务归属无法确认");
    expect(report).toContain("PID 8 端口 3000");
    expect(report).not.toContain("当前没有任何 dev server");
    expect(report).not.toContain("环境健康");
  });

  it("同一 worktree 的服务行展示端口与 PID", () => {
    const report = buildReport({
      worktrees: twoWorktrees,
      listeners: [listener(7, 3000, "/a")],
    });
    expect(report).toContain("端口 3000（PID 7）");
  });
});

describe("findEnvironmentViolations", () => {
  it("healthy: 主仓 3000 单服务和无数据 inactive worktree 通过严格检查", () => {
    const violations = findEnvironmentViolations({
      worktrees: [
        wt("/repo", "main", { exists: true }),
        wt("/repo/.worktrees/feature", "feature", { exists: false }),
      ],
      listeners: [listener(1, 3000, "/repo")],
    });

    expect(violations).toEqual([]);
    expect(buildCheckReport(violations)).toContain("环境门禁通过");
  });

  it("error: worktree 服务、非 3000 端口和 worktree 业务数据都会失败", () => {
    const violations = findEnvironmentViolations({
      worktrees: [
        wt("/repo", "main", { exists: true }),
        wt(
          "/repo/.worktrees/feature",
          "feature",
          { exists: true },
          {
            promptLineageFile: { exists: true },
            editSnapshotsFile: { exists: true },
          }
        ),
      ],
      listeners: [
        listener(1, 3001, "/repo"),
        listener(2, 3000, "/repo/.worktrees/feature"),
      ],
    });

    expect(violations.map(v => v.code)).toEqual(
      expect.arrayContaining([
        "NON_PRIMARY_DATA",
        "NON_PRIMARY_SERVER",
        "WRONG_PRIMARY_PORT",
        "MULTIPLE_PROJECT_SERVERS",
      ])
    );
    expect(buildCheckReport(violations)).toContain("环境门禁失败");
  });

  it("error: Git、lsof 或监听进程 cwd 无法确认时严格检查 fail closed", () => {
    const violations = findEnvironmentViolations({
      worktrees: [],
      listeners: [
        {
          command: "node",
          pid: 9,
          port: 3000,
          cwd: null,
          worktreePath: null,
        },
      ],
      worktreeError: "git worktree list failed",
      lsofError: "lsof unavailable",
    });

    expect(violations.map(v => v.code)).toEqual(
      expect.arrayContaining([
        "WORKTREE_COLLECTION_FAILED",
        "LISTENER_COLLECTION_FAILED",
        "UNKNOWN_LISTENER_CWD",
      ])
    );
  });

  it("edge: cwd 已知且位于仓库外的 node 服务不属于项目，不阻塞检查", () => {
    expect(
      findEnvironmentViolations({
        worktrees: [wt("/repo", "main", { exists: true })],
        listeners: [
          {
            command: "node",
            pid: 10,
            port: 4000,
            cwd: "/other/app",
            worktreePath: null,
          },
        ],
      })
    ).toEqual([]);
  });

  it("error: 主仓或非主 worktree 的业务文件检查失败都阻断", () => {
    const violations = findEnvironmentViolations({
      worktrees: [
        wt("/repo", "main", { exists: false, error: "EACCES" }),
        wt(
          "/repo/.worktrees/feature",
          "feature",
          { exists: false },
          {
            promptLineageFile: { exists: false },
            editSnapshotsFile: { exists: false, error: "EIO" },
          }
        ),
      ],
      listeners: [],
    });

    expect(
      violations.filter(item => item.code === "DATA_COLLECTION_FAILED")
    ).toHaveLength(2);
  });

  it.each([
    ["prompt-lineage-only", "promptLineageFile"],
    ["edit-snapshots-only", "editSnapshotsFile"],
  ] as const)("error: %s 非主业务数据被识别", (_label, field) => {
    const sidecars = {
      promptLineageFile: { exists: false },
      editSnapshotsFile: { exists: false },
      [field]: { exists: true },
    };
    const violations = findEnvironmentViolations({
      worktrees: [
        wt("/repo", "main", { exists: false }),
        wt("/repo/.worktrees/feature", "feature", { exists: false }, sidecars),
      ],
      listeners: [],
    });

    expect(violations.map(item => item.code)).toContain("NON_PRIMARY_DATA");
  });
});

describe("formatSize", () => {
  it("字节/KB/MB 三档", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2048)).toBe("2.0KB");
    expect(formatSize(2.98 * 1024 * 1024)).toBe("2.98MB");
  });
});
