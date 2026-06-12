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
}

export interface WorktreeStatus extends WorktreeInfo {
  dataFile: DataFileInfo;
}

export interface MappedListener extends ListenerInfo {
  cwd: string | null;
  /** 归属的 worktree 路径；映射不到任何 worktree 时为 null */
  worktreePath: string | null;
}

export interface ReportInput {
  worktrees: WorktreeStatus[];
  listeners: MappedListener[];
  /** lsof 采集失败时的提示文本；存在时端口区块降级显示 */
  lsofError?: string;
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
    if (!command.toLowerCase().includes("node") || !Number.isFinite(pid)) continue;
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

/** 把监听进程按 cwd 归属到 worktree（cwd 在 worktree 目录内即归属）。 */
export function mapListenersToWorktrees(
  listeners: ListenerInfo[],
  pidCwds: Map<number, string | null>,
  worktrees: WorktreeInfo[]
): MappedListener[] {
  // 注意嵌套 worktree：.claude/worktrees/* 在主仓库目录内部，
  // 必须取最长前缀匹配，否则嵌套 worktree 的进程会被误归属到主仓库。
  const byDepth = [...worktrees].sort((a, b) => b.path.length - a.path.length);
  return listeners.map((l) => {
    const cwd = pidCwds.get(l.pid) ?? null;
    const worktreePath =
      cwd === null
        ? null
        : byDepth.find((w) => cwd === w.path || cwd.startsWith(w.path + path.sep))
            ?.path ?? null;
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

export function buildReport(input: ReportInput): string {
  const { worktrees, listeners, lsofError } = input;
  const lines: string[] = [];

  // 项目内 dev server（cwd 归属到某个 worktree 的监听进程），按 pid 去重
  const projectPids = new Map<number, MappedListener>();
  for (const l of listeners) {
    if (l.worktreePath !== null && !projectPids.has(l.pid)) projectPids.set(l.pid, l);
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

  lines.push("== Worktree 一览（git worktree list）==");
  worktrees.forEach((w, i) => {
    lines.push(`${i + 1}. ${w.path}`);
    lines.push(`   分支: ${w.branch}`);
    const df = w.dataFile;
    lines.push(
      df.exists
        ? `   数据: .webdev/local-persist.json  ${formatSize(df.sizeBytes ?? 0)}  最后改动 ${formatTime(df.mtimeMs ?? 0)}`
        : `   数据: 无数据文件`
    );
    const serving = [...projectPids.values()].filter((l) => l.worktreePath === w.path);
    lines.push(
      serving.length > 0
        ? `   服务: ${serving.map((l) => `端口 ${l.port}（PID ${l.pid}）`).join("、")}  ← 正在运行`
        : `   服务: 无`
    );
  });

  lines.push("");
  if (lsofError) {
    lines.push(`== 端口采集失败 ==`, `   ${lsofError}`, `   （worktree 信息不受影响；可手动运行 lsof -nP -iTCP -sTCP:LISTEN 查看）`);
  } else {
    const orphans = listeners.filter((l) => l.worktreePath === null);
    if (orphans.length > 0) {
      lines.push("== 其他 node 监听进程（未归属到任何 worktree）==");
      for (const l of orphans) {
        lines.push(`   PID ${l.pid} 端口 ${l.port}  cwd=${l.cwd ?? "未知"}`);
      }
    }
    if (projectPids.size === 0) {
      lines.push("当前没有任何 dev server 在运行。");
    } else if (projectPids.size === 1) {
      const only = [...projectPids.values()][0];
      lines.push(`✅ 只有一个 dev server 在跑：端口 ${only.port} ← ${only.worktreePath}，环境健康。`);
    }
  }

  return lines.join("\n");
}

// ── 采集（impure，不进单测）──

function collectWorktrees(): WorktreeInfo[] {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf-8",
  });
  return parseWorktreePorcelain(out);
}

function statDataFile(worktreePath: string): DataFileInfo {
  try {
    const s = statSync(path.join(worktreePath, ".webdev", "local-persist.json"));
    return { exists: true, sizeBytes: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return { exists: false };
  }
}

function collectListeners(): { listeners: ListenerInfo[]; error?: string } {
  try {
    // lsof 在部分进程无权限时返回非零但仍有有效输出，所以吞掉 status 只看 stdout
    const out = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      encoding: "utf-8",
    });
    return { listeners: parseLsofListeners(out) };
  } catch (err: unknown) {
    const e = err as { stdout?: string; message?: string };
    if (e.stdout && e.stdout.includes("(LISTEN)")) {
      return { listeners: parseLsofListeners(e.stdout) };
    }
    return { listeners: [], error: `lsof 执行失败：${e.message ?? String(err)}` };
  }
}

function collectPidCwd(pid: number): string | null {
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf-8",
    });
    const nLine = out.split("\n").find((l) => l.startsWith("n"));
    return nLine ? nLine.slice(1) : null;
  } catch {
    return null;
  }
}

function main(): void {
  const worktrees = collectWorktrees().map((w) => ({
    ...w,
    dataFile: statDataFile(w.path),
  }));
  const { listeners: raw, error } = collectListeners();
  const pidCwds = new Map<number, string | null>();
  for (const l of raw) {
    if (!pidCwds.has(l.pid)) pidCwds.set(l.pid, collectPidCwd(l.pid));
  }
  const listeners = mapListenersToWorktrees(raw, pidCwds, worktrees);
  console.log(buildReport({ worktrees, listeners, lsofError: error }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
