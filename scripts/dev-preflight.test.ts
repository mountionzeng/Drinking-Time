import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  planDevServerShutdown,
  stopVerifiedDevServers,
  type ProcessControl,
  type ProcessSnapshot,
} from "./dev-preflight";
import type { MappedListener } from "./env-status";

function processSnapshot(
  overrides: Partial<ProcessSnapshot> = {}
): ProcessSnapshot {
  return {
    pid: 101,
    parentPid: 100,
    processGroupId: 99,
    uid: 501,
    cwd: "/repo",
    commandLine: "node --import tsx server/_core/index.ts",
    ...overrides,
  };
}

function listener(overrides: Partial<MappedListener> = {}): MappedListener {
  return {
    command: "node",
    pid: 101,
    port: 3000,
    cwd: "/repo",
    worktreePath: "/repo",
    ...overrides,
  };
}

describe("planDevServerShutdown", () => {
  it("happy path: 只选择主仓 3000 且由当前用户 pnpm dev 启动的进程组", () => {
    const processes = new Map<number, ProcessSnapshot>([
      [101, processSnapshot()],
      [
        99,
        processSnapshot({
          pid: 99,
          parentPid: 1,
          commandLine: "node /opt/homebrew/bin/pnpm dev",
        }),
      ],
    ]);

    expect(
      planDevServerShutdown({
        primaryWorktreePath: "/repo",
        listeners: [listener()],
        currentUid: 501,
        processes,
      })
    ).toEqual({
      targets: [
        {
          listenerPid: 101,
          processGroupId: 99,
          expectedListener: processes.get(101),
          expectedGroupLeader: processes.get(99),
        },
      ],
      errors: [],
    });
  });

  it.each([
    {
      label: "错误用户",
      currentUid: 502,
      listener: listener(),
      process: processSnapshot(),
      leader: processSnapshot({
        pid: 99,
        commandLine: "node /opt/homebrew/bin/pnpm dev",
      }),
      expectedError: "拒绝终止 PID 101：进程不属于当前用户。",
    },
    {
      label: "错误 cwd",
      currentUid: 501,
      listener: listener(),
      process: processSnapshot({ cwd: "/other" }),
      leader: processSnapshot({
        pid: 99,
        commandLine: "node /opt/homebrew/bin/pnpm dev",
      }),
      expectedError: "拒绝终止 PID 101：进程 cwd 不属于主仓根目录。",
    },
    {
      label: "错误服务命令",
      currentUid: 501,
      listener: listener(),
      process: processSnapshot({ commandLine: "node other-server.ts" }),
      leader: processSnapshot({
        pid: 99,
        commandLine: "node /opt/homebrew/bin/pnpm dev",
      }),
      expectedError:
        "拒绝终止 PID 101：监听进程命令不是 server/_core/index.ts。",
    },
    {
      label: "错误进程组命令",
      currentUid: 501,
      listener: listener(),
      process: processSnapshot(),
      leader: processSnapshot({
        pid: 99,
        commandLine: "node unrelated-worker.js",
      }),
      expectedError: "拒绝终止 PID 101：进程组 leader 不是 pnpm dev。",
    },
  ])(
    "$label 时拒绝终止并返回精确原因",
    ({
      currentUid,
      listener: targetListener,
      process,
      leader,
      expectedError,
    }) => {
      const result = planDevServerShutdown({
        primaryWorktreePath: "/repo",
        listeners: [targetListener],
        currentUid,
        processes: new Map([
          [process.pid, process],
          [leader.pid, leader],
        ]),
      });

      expect(result.targets).toEqual([]);
      expect(result.errors).toEqual([expectedError]);
    }
  );

  it("edge: 无主仓 3000 监听进程时无需终止任何进程", () => {
    expect(
      planDevServerShutdown({
        primaryWorktreePath: "/repo",
        listeners: [],
        currentUid: 501,
        processes: new Map(),
      })
    ).toEqual({ targets: [], errors: [] });
  });
});

function processControl(
  snapshots: Map<number, ProcessSnapshot | null>,
  groupStates: boolean[] = [false]
): ProcessControl {
  return {
    snapshot: vi.fn(pid => snapshots.get(pid) ?? null),
    signalGroup: vi.fn(),
    groupExists: vi.fn(() => groupStates.shift() ?? false),
    pause: vi.fn(async () => undefined),
  };
}

describe("stopVerifiedDevServers", () => {
  function validSnapshots(): Map<number, ProcessSnapshot | null> {
    return new Map([
      [101, processSnapshot()],
      [
        99,
        processSnapshot({
          pid: 99,
          parentPid: 1,
          commandLine: "node /opt/homebrew/bin/pnpm dev",
        }),
      ],
    ]);
  }

  it("成功时向已核验 PGID 发送 SIGTERM 并等待整个进程组退出", async () => {
    const control = processControl(validSnapshots(), [true, false]);

    await expect(
      stopVerifiedDevServers({
        primaryWorktreePath: "/repo",
        listeners: [listener()],
        currentUid: 501,
        processControl: control,
      })
    ).resolves.toBe(1);
    expect(control.signalGroup).toHaveBeenCalledWith(99);
    expect(control.groupExists).toHaveBeenCalledWith(99);
  });

  it.each(["listener 改变", "listener 缺失", "leader 改变", "leader 缺失"])(
    "二次快照%s时拒绝且不发送信号",
    async scenario => {
      const snapshots = validSnapshots();
      const control = processControl(snapshots);
      let calls = 0;
      const originalSnapshot = control.snapshot;
      control.snapshot = vi.fn(pid => {
        calls += 1;
        if (calls <= 2) return originalSnapshot(pid);
        if (scenario === "listener 缺失" && pid === 101) return null;
        if (scenario === "leader 缺失" && pid === 99) return null;
        if (scenario === "listener 改变" && pid === 101)
          return processSnapshot({ commandLine: "node changed.ts" });
        if (scenario === "leader 改变" && pid === 99)
          return processSnapshot({
            pid: 99,
            commandLine: "node changed-worker.ts",
          });
        return originalSnapshot(pid);
      });

      await expect(
        stopVerifiedDevServers({
          primaryWorktreePath: "/repo",
          listeners: [listener()],
          currentUid: 501,
          processControl: control,
        })
      ).rejects.toThrow("终止前发生变化");
      expect(control.signalGroup).not.toHaveBeenCalled();
    }
  );

  it("等待进程组失败时向上抛出", async () => {
    const control = processControl(validSnapshots());
    control.groupExists = vi.fn(() => {
      throw new Error("permission denied");
    });

    await expect(
      stopVerifiedDevServers({
        primaryWorktreePath: "/repo",
        listeners: [listener()],
        currentUid: 501,
        processControl: control,
      })
    ).rejects.toThrow("permission denied");
  });

  it("进程组超时未退出时失败关闭", async () => {
    const control = processControl(validSnapshots(), [true]);

    await expect(
      stopVerifiedDevServers({
        primaryWorktreePath: "/repo",
        listeners: [listener()],
        currentUid: 501,
        processControl: control,
        shutdownTimeoutMs: 0,
      })
    ).rejects.toThrow("进程组未在 0ms 内退出");
  });
});

describe("package environment gates", () => {
  it("predev 不再使用宽泛 pkill，并提供 env:check 与合并验证入口", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "../package.json"),
        "utf-8"
      )
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.predev).toBe("tsx scripts/dev-preflight.ts");
    expect(packageJson.scripts.predev).not.toContain("pkill");
    expect(packageJson.scripts["env:check"]).toBe(
      "tsx scripts/env-status.ts --check"
    );
    expect(packageJson.scripts["verify:merge"].split("&&").at(-1)?.trim()).toBe(
      "pnpm env:check"
    );
  });
});
