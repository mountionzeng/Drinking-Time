import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateDevelopmentServerStartup } from "../server/_core/devServerPreflight";
import {
  buildCheckReport,
  collectEnvironment,
  findEnvironmentViolations,
  type MappedListener,
} from "./env-status";

export interface ProcessSnapshot {
  pid: number;
  parentPid: number;
  processGroupId: number;
  uid: number;
  cwd: string;
  commandLine: string;
}

export interface DevServerShutdownTarget {
  listenerPid: number;
  processGroupId: number;
  expectedListener: ProcessSnapshot;
  expectedGroupLeader: ProcessSnapshot;
}

export interface DevServerShutdownPlan {
  targets: DevServerShutdownTarget[];
  errors: string[];
}

export interface ProcessControl {
  snapshot(pid: number): ProcessSnapshot | null;
  signalGroup(processGroupId: number): void;
  groupExists(processGroupId: number): boolean;
  pause(ms: number): Promise<void>;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function isServerEntrypoint(commandLine: string): boolean {
  return /(?:^|[\\/\s])server[\\/]_core[\\/]index\.ts(?:\s|$)/.test(
    commandLine
  );
}

function isPnpmDev(commandLine: string): boolean {
  return /(?:^|\s)\S*pnpm(?:\.[cm]?js)?\s+dev(?:\s|$)/.test(commandLine);
}

/**
 * 用途：从环境快照和进程快照中挑出唯一允许安全终止的旧主仓 dev 进程组。
 * 调用入口：dev preflight 主流程与 scripts/dev-preflight.test.ts。
 * 下游调用：只校验端口、cwd、uid、服务命令和进程组 leader，不发送信号。
 */
export function planDevServerShutdown({
  primaryWorktreePath,
  listeners,
  currentUid,
  processes,
}: {
  primaryWorktreePath: string;
  listeners: MappedListener[];
  currentUid: number;
  processes: Map<number, ProcessSnapshot>;
}): DevServerShutdownPlan {
  const errors: string[] = [];
  const targets = new Map<number, DevServerShutdownTarget>();

  for (const listener of listeners) {
    if (
      listener.worktreePath !== primaryWorktreePath ||
      listener.port !== 3000
    ) {
      continue;
    }

    const processInfo = processes.get(listener.pid);
    if (!processInfo) {
      errors.push(`无法读取端口 3000 监听进程 PID ${listener.pid}。`);
      continue;
    }
    const groupLeader = processes.get(processInfo.processGroupId);
    if (!groupLeader || groupLeader.pid !== processInfo.processGroupId) {
      errors.push(`无法验证 PID ${listener.pid} 的进程组 leader。`);
      continue;
    }

    const invalidReason =
      processInfo.uid !== currentUid || groupLeader.uid !== currentUid
        ? "进程不属于当前用户"
        : !samePath(processInfo.cwd, primaryWorktreePath) ||
            !samePath(groupLeader.cwd, primaryWorktreePath)
          ? "进程 cwd 不属于主仓根目录"
          : !isServerEntrypoint(processInfo.commandLine)
            ? "监听进程命令不是 server/_core/index.ts"
            : !isPnpmDev(groupLeader.commandLine)
              ? "进程组 leader 不是 pnpm dev"
              : null;

    if (invalidReason) {
      errors.push(`拒绝终止 PID ${listener.pid}：${invalidReason}。`);
      continue;
    }

    if (!targets.has(processInfo.processGroupId)) {
      targets.set(processInfo.processGroupId, {
        listenerPid: listener.pid,
        processGroupId: processInfo.processGroupId,
        expectedListener: processInfo,
        expectedGroupLeader: groupLeader,
      });
    }
  }

  return { targets: [...targets.values()], errors };
}

function collectProcessCwd(pid: number): string | null {
  try {
    const out = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { encoding: "utf-8" }
    );
    const cwdLine = out.split("\n").find(line => line.startsWith("n"));
    return cwdLine ? cwdLine.slice(1) : null;
  } catch {
    return null;
  }
}

function collectProcessSnapshot(pid: number): ProcessSnapshot | null {
  try {
    const out = execFileSync(
      "ps",
      ["-o", "ppid=,pgid=,uid=,command=", "-p", String(pid)],
      { encoding: "utf-8" }
    ).trim();
    const match = out.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\s\S]+)$/);
    const cwd = collectProcessCwd(pid);
    if (!match || cwd === null) return null;
    return {
      pid,
      parentPid: Number(match[1]),
      processGroupId: Number(match[2]),
      uid: Number(match[3]),
      cwd,
      commandLine: match[4],
    };
  } catch {
    return null;
  }
}

function collectProcessMap(
  listeners: MappedListener[],
  snapshot: ProcessControl["snapshot"] = collectProcessSnapshot
): Map<number, ProcessSnapshot> {
  const processes = new Map<number, ProcessSnapshot>();
  for (const listener of listeners) {
    const processInfo = snapshot(listener.pid);
    if (!processInfo) continue;
    processes.set(processInfo.pid, processInfo);
    if (!processes.has(processInfo.processGroupId)) {
      const groupLeader = snapshot(processInfo.processGroupId);
      if (groupLeader) processes.set(groupLeader.pid, groupLeader);
    }
  }
  return processes;
}

function sameProcess(
  expected: ProcessSnapshot,
  actual: ProcessSnapshot
): boolean {
  return (
    expected.pid === actual.pid &&
    expected.processGroupId === actual.processGroupId &&
    expected.uid === actual.uid &&
    samePath(expected.cwd, actual.cwd) &&
    expected.commandLine === actual.commandLine
  );
}

function groupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

const systemProcessControl: ProcessControl = {
  snapshot: collectProcessSnapshot,
  signalGroup: processGroupId => process.kill(-processGroupId, "SIGTERM"),
  groupExists,
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

async function waitForGroupExit(
  processGroupIds: number[],
  control: ProcessControl,
  timeoutMs: number = 3_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIds.some(id => control.groupExists(id))) {
    if (Date.now() >= deadline) {
      throw new Error(`旧 dev server 进程组未在 ${timeoutMs}ms 内退出。`);
    }
    await control.pause(50);
  }
}

/**
 * 用途：在发送 SIGTERM 前二次核验 PID，安全停止已确认属于主仓的旧 pnpm dev 进程组。
 * 调用入口：scripts/dev-preflight.ts 的 CLI 主流程。
 * 下游调用：planDevServerShutdown、ProcessControl 和 waitForGroupExit。
 */
export async function stopVerifiedDevServers({
  primaryWorktreePath,
  listeners,
  currentUid,
  processControl = systemProcessControl,
  shutdownTimeoutMs = 3_000,
}: {
  primaryWorktreePath: string;
  listeners: MappedListener[];
  currentUid: number;
  processControl?: ProcessControl;
  shutdownTimeoutMs?: number;
}): Promise<number> {
  const initialPlan = planDevServerShutdown({
    primaryWorktreePath,
    listeners,
    currentUid,
    processes: collectProcessMap(listeners, processControl.snapshot),
  });
  if (initialPlan.errors.length > 0) {
    throw new Error(initialPlan.errors.join("\n"));
  }

  const stoppedPids: number[] = [];
  for (const target of initialPlan.targets) {
    const currentListener = processControl.snapshot(target.listenerPid);
    const currentLeader = processControl.snapshot(target.processGroupId);
    if (
      !currentListener ||
      !currentLeader ||
      !sameProcess(target.expectedListener, currentListener) ||
      !sameProcess(target.expectedGroupLeader, currentLeader)
    ) {
      throw new Error(
        `PID ${target.listenerPid} 在终止前发生变化，拒绝发送信号。`
      );
    }
    processControl.signalGroup(target.processGroupId);
    stoppedPids.push(target.listenerPid);
  }

  await waitForGroupExit(
    initialPlan.targets.map(target => target.processGroupId),
    processControl,
    shutdownTimeoutMs
  );
  return stoppedPids.length;
}

async function main(): Promise<void> {
  validateDevelopmentServerStartup();
  const environment = collectEnvironment();
  const violations = findEnvironmentViolations(environment);
  if (violations.length > 0) {
    throw new Error(buildCheckReport(violations));
  }
  const primary = environment.worktrees[0];
  const currentUid = process.getuid?.();
  if (!primary || currentUid === undefined) {
    throw new Error("无法确认主 worktree 或当前用户 UID。");
  }
  const stopped = await stopVerifiedDevServers({
    primaryWorktreePath: primary.path,
    listeners: environment.listeners,
    currentUid,
  });
  console.log(
    stopped === 0
      ? "环境预检通过：没有需要停止的旧 dev server。"
      : `环境预检通过：已安全停止 ${stopped} 个旧 dev server。`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
