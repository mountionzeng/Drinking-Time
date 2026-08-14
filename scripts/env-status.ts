/**
 * 环境仪表盘：一条命令看清「现在有几个环境在跑、数据在哪一份文件里」。
 *
 * 用法：pnpm env:status
 *
 * 输出按需实时生成，不落盘——应对变化的逻辑是每次重新生成，而非维护快照
 * （见 docs/plans/2026-06-12-001-feat-environment-consolidation-plan.md U1）。
 *
 * 数据背景：server/db.ts 的本地持久化路径跟 process.cwd() 走，
 * 每个 worktree 启动的 dev server 读写自己目录下的 .webdev/local-persist.json，
 * 所以「多个 dev server 并行」=「多份互不相通的数据」。
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── 类型 ──

export interface WorktreeInfo {
  path: string;
  branch: string; // 分支名，detached 时为 "(detached)"
  head: string;
}

export interface ListenerInfo {
  command: string;
  pid: number;
  port: number;
}

export interface DataFileInfo {
  exists: boolean;
  sizeBytes?: number;
  mtimeMs?: number;
  error?: string;
}

export interface WorktreeStatus extends WorktreeInfo {
  dataFile: DataFileInfo;
  promptLineageFile: DataFileInfo;
  editSnapshotsFile: DataFileInfo;
}

export interface MappedListener extends ListenerInfo {
  cwd: string | null;
  /** 归属的 worktree 路径；映射不到任何 worktree 时为 null */
  worktreePath: string | null;
}

export interface ReportInput {
  worktrees: WorktreeStatus[];
  listeners: MappedListener[];
  /** git worktree 采集失败时的提示文本；严格检查会 fail closed */
  worktreeError?: string;
  /** lsof 采集失败时的提示文本；存在时端口区块降级显示 */
  lsofError?: string;
}

export type EnvironmentViolationCode =
  | "WORKTREE_COLLECTION_FAILED"
  | "LISTENER_COLLECTION_FAILED"
  | "UNKNOWN_LISTENER_CWD"
  | "MULTIPLE_PROJECT_SERVERS"
  | "NON_PRIMARY_SERVER"
  | "WRONG_PRIMARY_PORT"
  | "NON_PRIMARY_DATA"
  | "DATA_COLLECTION_FAILED";

export interface EnvironmentViolation {
  code: EnvironmentViolationCode;
  message: string;
}

// ── 解析（纯函数，可单测）──

/** 解析 `git worktree list --porcelain` 输出。块之间以空行分隔。 */
export function parseWorktreePorcelain(text: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length === 0) continue;
    let wtPath = "";
    let branch = "(detached)";
    let head = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch "))
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    if (wtPath) result.push({ path: wtPath, branch, head });
  }
  return result;
}

/**
 * 解析 `lsof -nP -iTCP -sTCP:LISTEN` 输出，只保留 node 系进程。
 * -nP 必须带：不带 -P 时 macOS 会把端口解析成服务名（3000 显示为 hbci），
 * 数字端口解析会全部落空。同一 pid 同端口（IPv4/IPv6 双行）去重。
 */
export function parseLsofListeners(text: string): ListenerInfo[] {
  const seen = new Set<string>();
  const result: ListenerInfo[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes("(LISTEN)")) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const command = cols[0];
    const pid = Number(cols[1]);
    if (!command.toLowerCase().includes("node") || !Number.isFinite(pid))
      continue;
    const name = cols[cols.length - 2]; // "(LISTEN)" 前一列，如 "*:3000" / "127.0.0.1:18789"
    const port = Number(name.slice(name.lastIndexOf(":") + 1));
    if (!Number.isFinite(port)) continue;
    const key = `${pid}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ command, pid, port });
  }
  return result;
}

/**
 * 用途：统一解释 lsof 的输出与退出状态，保留部分结果但让非零退出可被严格门禁识别。
 * 调用入口：collectListeners 与环境采集单元测试。
 * 下游调用：parseLsofListeners，不执行外部命令。
 */
export function normalizeListenerCollection({
  stdout = "",
  error,
}: {
  stdout?: string;
  error?: string;
}): { listeners: ListenerInfo[]; error?: string } {
  return {
    listeners: parseLsofListeners(stdout),
    ...(error ? { error: `lsof 执行失败：${error}` } : {}),
  };
}

/**
 * 用途：检查一个业务数据文件，区分文件不存在与无法读取元数据。
 * 调用入口：collectEnvironment 与环境采集单元测试。
 * 下游调用：注入的 stat 实现；生产环境使用 statSync。
 */
export function inspectDataFile(
  filePath: string,
  stat: typeof statSync = statSync
): DataFileInfo {
  try {
    const info = stat(filePath);
    return { exists: true, sizeBytes: info.size, mtimeMs: info.mtimeMs };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT"
      ? { exists: false }
      : {
          exists: false,
          error: `${filePath} 检查失败：${code ?? (error instanceof Error ? error.message : String(error))}`,
        };
  }
}

/** 把监听进程按 cwd 归属到 worktree（cwd 在 worktree 目录内即归属）。 */
export function mapListenersToWorktrees(
  listeners: ListenerInfo[],
  pidCwds: Map<number, string | null>,
  worktrees: WorktreeInfo[]
): MappedListener[] {
  // 注意嵌套 worktree：.claude/worktrees/* 在主仓库目录内部，
  // 必须取最长前缀匹配，否则嵌套 worktree 的进程会被误归属到主仓库。
  const byDepth = [...worktrees].sort((a, b) => b.path.length - a.path.length);
  return listeners.map(l => {
    const cwd = pidCwds.get(l.pid) ?? null;
    const worktreePath =
      cwd === null
        ? null
        : (byDepth.find(
            w => cwd === w.path || cwd.startsWith(w.path + path.sep)
          )?.path ?? null);
    return { ...l, cwd, worktreePath };
  });
}

// ── 格式化（纯函数，可单测）──

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 用途：把环境快照格式化为只读诊断报告，不对环境做健康放行判断。
 * 调用入口：env:status、env:check 与环境单元测试。
 * 下游调用：formatSize、formatTime 和 worktree/listener 归属结果。
 */
export function buildReport(input: ReportInput): string {
  const { worktrees, listeners, worktreeError, lsofError } = input;
  const lines: string[] = [];

  // 项目内 dev server（cwd 归属到某个 worktree 的监听进程），按 pid 去重
  const projectPids = new Map<number, MappedListener>();
  for (const l of listeners) {
    if (l.worktreePath !== null && !projectPids.has(l.pid))
      projectPids.set(l.pid, l);
  }

  if (!lsofError && projectPids.size >= 2) {
    lines.push(
      `⚠️⚠️⚠️  警告：检测到 ${projectPids.size} 个 dev server 并行运行！`,
      `   每个环境读写各自的 .webdev/local-persist.json，数据会互相对不上。`
    );
    for (const l of projectPids.values()) {
      lines.push(
        `   - 端口 ${l.port}（PID ${l.pid}）← ${l.worktreePath} → 数据文件 ${path.join(l.worktreePath!, ".webdev", "local-persist.json")}`
      );
    }
    lines.push("");
  }

  if (worktreeError) {
    lines.push("== Worktree 采集失败 ==", `   ${worktreeError}`, "");
  }

  lines.push("== Worktree 一览（git worktree list）==");
  if (worktrees.length === 0) lines.push("   无法确认任何 worktree。");
  worktrees.forEach((w, i) => {
    lines.push(`${i + 1}. ${w.path}`);
    lines.push(`   分支: ${w.branch}`);
    const df = w.dataFile;
    lines.push(
      df.error
        ? `   数据: 检查失败（${df.error}）`
        : df.exists
          ? `   数据: .webdev/local-persist.json  ${formatSize(df.sizeBytes ?? 0)}  最后改动 ${formatTime(df.mtimeMs ?? 0)}`
          : `   数据: 无数据文件`
    );
    const pf = w.promptLineageFile;
    if (pf?.error) {
      lines.push(`   谱系: 检查失败（${pf.error}）`);
    } else if (pf?.exists) {
      lines.push(
        `   谱系: .webdev/prompt-lineage-local.json  ${formatSize(pf.sizeBytes ?? 0)}  最后改动 ${formatTime(pf.mtimeMs ?? 0)}`
      );
    }
    const sf = w.editSnapshotsFile;
    if (sf?.error) {
      lines.push(`   快照: 检查失败（${sf.error}）`);
    } else if (sf?.exists) {
      lines.push(
        `   快照: .webdev/edit-snapshots-local.json  ${formatSize(sf.sizeBytes ?? 0)}  最后改动 ${formatTime(sf.mtimeMs ?? 0)}`
      );
    }
    const serving = [...projectPids.values()].filter(
      l => l.worktreePath === w.path
    );
    lines.push(
      serving.length > 0
        ? `   服务: ${serving.map(l => `端口 ${l.port}（PID ${l.pid}）`).join("、")}  ← 正在运行`
        : `   服务: 无`
    );
  });

  lines.push("");
  if (lsofError) {
    lines.push(
      `== 端口采集失败 ==`,
      `   ${lsofError}`,
      `   （worktree 信息不受影响；可手动运行 lsof -nP -iTCP -sTCP:LISTEN 查看）`
    );
  } else {
    const orphans = listeners.filter(l => l.worktreePath === null);
    if (orphans.length > 0) {
      lines.push("== 其他 node 监听进程（未归属到任何 worktree）==");
      for (const l of orphans) {
        lines.push(`   PID ${l.pid} 端口 ${l.port}  cwd=${l.cwd ?? "未知"}`);
      }
    }
    if (worktreeError) {
      lines.push("服务归属无法确认，不能判断当前开发环境是否健康。");
    } else if (projectPids.size === 0) {
      lines.push("当前没有任何 dev server 在运行。");
    } else if (projectPids.size === 1) {
      const only = [...projectPids.values()][0];
      lines.push(
        `✅ 只有一个 dev server 在跑：端口 ${only.port} ← ${only.worktreePath}，环境健康。`
      );
    }
  }

  return lines.join("\n");
}

/**
 * 用途：把一次只读环境快照转换成可阻止启动、测试或合并的确定违规项。
 * 调用入口：env:check、dev preflight 和环境单元测试。
 * 下游调用：只读取 worktree、监听进程和采集错误，不执行清理或终止进程。
 */
export function findEnvironmentViolations(
  input: ReportInput
): EnvironmentViolation[] {
  const violations: EnvironmentViolation[] = [];
  const primary = input.worktrees[0];

  if (input.worktreeError || !primary) {
    violations.push({
      code: "WORKTREE_COLLECTION_FAILED",
      message: input.worktreeError ?? "无法确认主 worktree，拒绝推断环境安全。",
    });
  }
  if (input.lsofError) {
    violations.push({
      code: "LISTENER_COLLECTION_FAILED",
      message: input.lsofError,
    });
  }

  for (const listener of input.listeners) {
    if (listener.cwd === null) {
      violations.push({
        code: "UNKNOWN_LISTENER_CWD",
        message: `无法确认 PID ${listener.pid}（端口 ${listener.port}）的 cwd。`,
      });
    }
  }

  const projectListeners = input.listeners.filter(
    listener => listener.worktreePath !== null
  );
  const projectPids = new Set(projectListeners.map(listener => listener.pid));
  if (projectPids.size > 1) {
    violations.push({
      code: "MULTIPLE_PROJECT_SERVERS",
      message: `检测到 ${projectPids.size} 个项目 dev server，必须收敛为主仓单服务。`,
    });
  }

  if (primary) {
    for (const worktree of input.worktrees) {
      for (const file of [
        worktree.dataFile,
        worktree.promptLineageFile,
        worktree.editSnapshotsFile,
      ]) {
        if (file.error) {
          violations.push({
            code: "DATA_COLLECTION_FAILED",
            message: `${worktree.path} 的业务数据文件无法确认：${file.error}`,
          });
        }
      }
    }

    for (const listener of projectListeners) {
      if (listener.worktreePath !== primary.path) {
        violations.push({
          code: "NON_PRIMARY_SERVER",
          message: `PID ${listener.pid} 在非主 worktree ${listener.worktreePath} 监听端口 ${listener.port}。`,
        });
      } else if (listener.port !== 3000) {
        violations.push({
          code: "WRONG_PRIMARY_PORT",
          message: `主仓 PID ${listener.pid} 监听端口 ${listener.port}，唯一允许端口是 3000。`,
        });
      }
    }

    for (const worktree of input.worktrees.slice(1)) {
      const dataFiles = [
        ["local-persist.json", worktree.dataFile],
        ["prompt-lineage-local.json", worktree.promptLineageFile],
        ["edit-snapshots-local.json", worktree.editSnapshotsFile],
      ] as const;
      const existing = dataFiles
        .filter(([, file]) => file.exists)
        .map(([name]) => name);
      if (existing.length > 0) {
        violations.push({
          code: "NON_PRIMARY_DATA",
          message: `非主 worktree ${worktree.path} 含业务数据文件：${existing.join("、")}。`,
        });
      }
    }
  }

  return violations;
}

/**
 * 用途：把严格环境检查结果格式化为适合 CLI 和 CI 阅读的短报告。
 * 调用入口：env:check 主流程与环境单元测试。
 * 下游调用：不调用外部系统，只格式化 findEnvironmentViolations 的结果。
 */
export function buildCheckReport(violations: EnvironmentViolation[]): string {
  if (violations.length === 0) return "✅ 环境门禁通过。";
  return [
    "❌ 环境门禁失败：",
    ...violations.map(item => `   - [${item.code}] ${item.message}`),
  ].join("\n");
}

// ── 采集（impure，不进单测）──

function collectWorktrees(): {
  worktrees: WorktreeInfo[];
  error?: string;
} {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8",
    });
    return { worktrees: parseWorktreePorcelain(out) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { worktrees: [], error: `git worktree 执行失败：${message}` };
  }
}

function collectListeners(): { listeners: ListenerInfo[]; error?: string } {
  try {
    // 非零退出的 stdout 仍用于诊断，但 error 会让严格门禁失败关闭。
    const out = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      encoding: "utf-8",
    });
    return normalizeListenerCollection({ stdout: out });
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string };
    return normalizeListenerCollection({
      stdout: e.stdout,
      error: e.message ?? String(err),
    });
  }
}

function collectPidCwd(pid: number): string | null {
  try {
    const out = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      {
        encoding: "utf-8",
      }
    );
    const nLine = out.split("\n").find(l => l.startsWith("n"));
    return nLine ? nLine.slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * 用途：实时采集 worktree、业务数据文件、Node 监听端口和进程 cwd。
 * 调用入口：env:status、env:check 与 dev preflight。
 * 下游调用：git worktree、lsof、inspectDataFile 和 mapListenersToWorktrees。
 */
export function collectEnvironment(): ReportInput {
  const collectedWorktrees = collectWorktrees();
  const worktrees = collectedWorktrees.worktrees.map(w => ({
    ...w,
    dataFile: inspectDataFile(
      path.join(w.path, ".webdev", "local-persist.json")
    ),
    promptLineageFile: inspectDataFile(
      path.join(w.path, ".webdev", "prompt-lineage-local.json")
    ),
    editSnapshotsFile: inspectDataFile(
      path.join(w.path, ".webdev", "edit-snapshots-local.json")
    ),
  }));
  const { listeners: raw, error } = collectListeners();
  const pidCwds = new Map<number, string | null>();
  for (const l of raw) {
    if (!pidCwds.has(l.pid)) pidCwds.set(l.pid, collectPidCwd(l.pid));
  }
  const listeners = mapListenersToWorktrees(raw, pidCwds, worktrees);
  return {
    worktrees,
    listeners,
    worktreeError: collectedWorktrees.error,
    lsofError: error,
  };
}

function main(): void {
  const environment = collectEnvironment();
  console.log(buildReport(environment));

  if (process.argv.includes("--check")) {
    const violations = findEnvironmentViolations(environment);
    console.log("", buildCheckReport(violations));
    if (violations.length > 0) process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
