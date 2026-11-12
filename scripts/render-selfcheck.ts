/**
 * 渲染自检（只读）：一条命令看清「为什么改了一个参数，别的图/视频也渲染不出来」。
 *
 * 用法：
 *   pnpm render:selfcheck                         # 检查当前目录（.env + .webdev/）
 *   pnpm render:selfcheck -- --root <仓库目录>     # 检查另一个工作区的数据
 *   pnpm render:selfcheck -- --port 3000 --json
 *
 * 只读保证：不写任何文件、不调用任何付费/外部接口；唯一的网络请求是
 * GET http://127.0.0.1:<port>/api/dev/render-health（本机开发服务的熔断状态，可选）。
 * 不输出任何密钥值：环境变量只报键名、是否存在、是否重复（以及重复的几行值是否相同）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { staleShotLockReason, type ShotLockTask } from "../server/services/shotLock";

export type Severity = "ok" | "warn" | "error" | "info";
export type Finding = { check: string; severity: Severity; message: string };

// ── .env ──

export type EnvFileReport = {
  exists: boolean;
  keys: Set<string>;
  duplicates: Array<{ key: string; lines: number[]; valuesDiffer: boolean }>;
  values: Map<string, string>; // effective value (last wins, like dotenv); never printed
};

/** Parse KEY=VALUE lines the way dotenv does; the last occurrence wins. */
export function parseEnvFile(text: string): EnvFileReport {
  const seen = new Map<string, Array<{ line: number; value: string }>>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    const list = seen.get(match[1]) ?? [];
    list.push({ line: index + 1, value });
    seen.set(match[1], list);
  });
  const duplicates = Array.from(seen.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      key,
      lines: list.map(item => item.line),
      valuesDiffer: new Set(list.map(item => item.value)).size > 1,
    }));
  const values = new Map(Array.from(seen.entries()).map(([key, list]) => [key, list[list.length - 1]!.value]));
  return { exists: true, keys: new Set(seen.keys()), duplicates, values };
}

// ── 渲染档位依赖的环境变量 ──

export type ProfileRequirement = { profile: string; anyOf: string[][]; note?: string };

const MJ_VIDEO_SUBMIT_PATH = "/mj-turbo/submit/video"; // 与 server/services/videoGen.ts 保持一致

export function renderProfiles(env: (key: string) => string): ProfileRequirement[] {
  const videoSubmit = env("VIDEO_302_SUBMIT_PATH") || MJ_VIDEO_SUBMIT_PATH;
  const isMjVideo = /^\/mj(?:-turbo)?\/submit\/video/.test(videoSubmit);
  return [
    { profile: "MJ 出图（302）", anyOf: [["API302_KEY"], ["IMAGE_302_API_KEY"]] },
    { profile: "MJ 出图（Legnext）", anyOf: [["LEGNEXT_API_KEY"]] },
    { profile: "GPT-image / 图生图 / 遮罩重绘（302）", anyOf: [["API302_KEY"], ["IMAGE_302_API_KEY"]] },
    { profile: "FLUX Kontext 参考图（302）", anyOf: [["API302_KEY"], ["IMAGE_302_API_KEY"]] },
    { profile: "fal flux-pro-ultra", anyOf: [["FAL_KEY"]], note: "未配时 fal 请求会自动改走 302 gpt-image" },
    {
      profile: `镜头视频（302，${isMjVideo ? "MJ-Video" : "自定义路径"}）`,
      anyOf: [
        [
          "API302_KEY",
          ...(!isMjVideo && videoSubmit.includes("{model}") ? ["VIDEO_302_MODEL"] : []),
          ...(!isMjVideo ? ["VIDEO_302_POLL_PATH"] : []),
        ],
      ],
    },
    { profile: "镜头视频（经济档 Vidu）", anyOf: [["API302_KEY"]] },
    { profile: "看图模型（读图/改图理解）", anyOf: [["VISION_302_MODEL"]] },
    { profile: "图片提示词模型", anyOf: [["IMAGE_PROMPT_302_MODEL"]], note: "未配时使用代码默认值" },
    { profile: "视频提示词模型", anyOf: [["VIDEO_PROMPT_302_MODEL"]], note: "未配时使用代码默认值" },
  ];
}

export function checkProfiles(env: (key: string) => string): Finding[] {
  return renderProfiles(env).map(requirement => {
    const satisfied = requirement.anyOf.find(keys => keys.every(key => Boolean(env(key))));
    if (satisfied) return { check: "档位环境变量", severity: "ok" as const, message: `${requirement.profile}：齐全（${satisfied.join(" + ")}）` };
    const missing = requirement.anyOf[0]!.filter(key => !env(key));
    return {
      check: "档位环境变量",
      severity: requirement.note ? ("info" as const) : ("warn" as const),
      message: `${requirement.profile}：缺 ${missing.join("、")}${requirement.note ? `（${requirement.note}）` : ""}`,
    };
  });
}

// ── 本地数据（.webdev/local-persist.json）──

type StoryRow = { id: number; body?: unknown };
type VideoTakeRow = { id: number; storyId?: number; status?: string; taskId?: string | null; parameterSnapshot?: unknown; createdAt?: string | number; updatedAt?: string | number };
type StoryboardTask = ShotLockTask & { id?: string; shotIdentity?: string; requestId?: string; meta?: { provider?: string } };

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function ageText(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} 小时`;
  return `${(ms / 86_400_000).toFixed(1)} 天`;
}

export function checkStoryboardTasks(stories: StoryRow[], now = Date.now()): Finding[] {
  const findings: Finding[] = [];
  let open = 0;
  for (const story of stories) {
    const tasks = record(story.body).storyboardImageTasks;
    if (!Array.isArray(tasks)) continue;
    for (const raw of tasks as StoryboardTask[]) {
      if (!raw || raw.status === "failed" || raw.status === "succeeded") continue;
      open++;
      const age = raw.createdAt ? ageText(now - raw.createdAt) : "未知时长";
      const leaseAlive = (raw.leaseUntil ?? 0) > now;
      const releasable = staleShotLockReason(raw, now);
      const where = `故事 #${story.id} 镜头 ${raw.shotIdentity ?? "?"}`;
      if (raw.status === "accepted" || raw.providerTaskId) {
        findings.push({ check: "镜头锁/任务", severity: "warn", message: `${where}：${raw.status}，已有供应商回执，已挂 ${age}${leaseAlive ? "（正在取回）" : ""}；再次点击会恢复原任务，不会重复购买` });
      } else {
        findings.push({
          check: "镜头锁/任务",
          severity: "error",
          message: `${where}：${raw.status}，无回执，已挂 ${age}，租约${leaseAlive ? "仍有效" : "已过期"}——${releasable ? "新规则下下次生成会自动释放" : "新规则下暂不释放（仍在保护期内）"}`,
        });
      }
    }
  }
  if (!open) findings.push({ check: "镜头锁/任务", severity: "ok", message: "没有未结束的分镜图片任务" });
  return findings;
}

export type VideoRoute = { submitPath: string; pollPath: string; baseOrigin: string };

export function currentVideoRoute(env: (key: string) => string): VideoRoute {
  const submitPath = (env("VIDEO_302_SUBMIT_PATH") || MJ_VIDEO_SUBMIT_PATH).trim().replace(/\/+$/, "");
  const mj = /^\/mj(?:-turbo)?\//.test(submitPath);
  const pollPath = (env("VIDEO_302_POLL_PATH") || (mj ? (submitPath.startsWith("/mj-turbo/") ? "/mj-turbo/task/{taskId}/fetch" : "/mj/task/{taskId}/fetch") : "")).trim().replace(/\/+$/, "");
  let baseOrigin = "https://api.302.ai";
  try { baseOrigin = new URL(env("API302_BASE_URL") || baseOrigin).origin; } catch { /* keep default */ }
  return { submitPath, pollPath, baseOrigin };
}

export function checkVideoTakes(takes: VideoTakeRow[], route: VideoRoute, now = Date.now()): Finding[] {
  const findings: Finding[] = [];
  const active = takes.filter(take => take.status === "processing" || take.status === "queued" || take.status === "submitting");
  const counts = new Map<string, number>();
  for (const take of takes) counts.set(take.status ?? "?", (counts.get(take.status ?? "?") ?? 0) + 1);
  findings.push({ check: "视频任务", severity: "info", message: `共 ${takes.length} 条：${Array.from(counts.entries()).map(([k, v]) => `${k} ${v}`).join("，")}` });
  const unfollowable = takes.filter(take => take.status === "unfollowable");
  if (unfollowable.length) {
    const reasons = new Map<string, number>();
    for (const take of unfollowable) {
      const raw = String((take as { errorMessage?: unknown }).errorMessage ?? "（无说明）");
      const reason = raw.replace(/https?:\/\/\S+/g, "[url]").replace(/[A-Za-z0-9_-]{24,}/g, "[id]").slice(0, 40);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const top = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    findings.push({ check: "视频任务", severity: "info", message: `${unfollowable.length} 条视频处于“无法跟进”（含用户手动标记不可用），最常见原因：${top.map(([r, n]) => `「${r}」×${n}`).join("；")}` });
  }
  let mismatched = 0;
  let legacy = 0;
  for (const take of active) {
    const snapshot = record(take.parameterSnapshot);
    if (snapshot.renderMode === "economy" || snapshot.kind) continue; // 经济档/首尾帧走各自固定路由
    const storedSubmit = typeof snapshot.submitPath === "string" ? snapshot.submitPath.replace(/\/+$/, "") : "";
    const storedPoll = typeof snapshot.pollPath === "string" ? snapshot.pollPath.replace(/\/+$/, "") : "";
    let storedOrigin = "";
    try { storedOrigin = typeof snapshot.submitUrl === "string" ? new URL(snapshot.submitUrl).origin : ""; } catch { storedOrigin = ""; }
    if (!storedSubmit && !storedPoll) { legacy++; continue; }
    const diffs = [
      storedSubmit && storedSubmit !== route.submitPath ? "提交路径" : "",
      storedPoll && storedPoll !== route.pollPath ? "查询路径" : "",
      storedOrigin && storedOrigin !== route.baseOrigin ? "接口域名" : "",
    ].filter(Boolean);
    if (diffs.length) {
      mismatched++;
      const age = take.createdAt ? ageText(now - new Date(take.createdAt).getTime()) : "未知时长";
      findings.push({ check: "视频快照 vs 当前配置", severity: "warn", message: `视频 take #${take.id}（处理中，已 ${age}）：${diffs.join("、")}与当前配置不同——修复后按提交快照查询，修复前会查错地方` });
    }
  }
  if (legacy) findings.push({ check: "视频快照 vs 当前配置", severity: "info", message: `${legacy} 条处理中的视频没有提交快照，只能按当前配置查询` });
  if (!mismatched) findings.push({ check: "视频快照 vs 当前配置", severity: "ok", message: `处理中的 ${active.length} 条视频与当前配置一致或无快照` });
  const stale = active.filter(take => take.createdAt && now - new Date(take.createdAt).getTime() > 60 * 60_000);
  if (stale.length) findings.push({ check: "视频任务", severity: "warn", message: `${stale.length} 条视频处理中超过 1 小时（id：${stale.slice(0, 10).map(t => t.id).join(", ")}${stale.length > 10 ? " …" : ""}）` });
  return findings;
}

/** Signal 0 only checks existence; it never affects the process. */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function checkTempFiles(dir: string, now = Date.now(), isAlive: (pid: number) => boolean = processAlive): Finding[] {
  if (!existsSync(dir)) return [{ check: "半截 .tmp 文件", severity: "info", message: `${dir} 不存在` }];
  const temps = readdirSync(dir).filter(name => /\.tmp(?:\.\w+)?$/.test(name) || /\.tmp-[0-9a-f]+$/.test(name));
  if (!temps.length) return [{ check: "半截 .tmp 文件", severity: "ok", message: "没有残留的 .tmp 文件" }];
  const byTarget = new Map<string, { count: number; bytes: number; newest: number }>();
  let inProgress = 0;
  for (const name of temps) {
    const target = name.replace(/\.\d+-\d+-[a-z0-9]+\.tmp$/, "").replace(/\.tmp.*$/, "");
    const stat = statSync(path.join(dir, name));
    // <target>.<pid>-<ms>-<rand>.tmp: a live writer may be mid-write, not orphaned.
    const pid = Number(/\.(\d+)-\d+-[a-z0-9]+\.tmp$/.exec(name)?.[1]);
    if (isAlive(pid) && now - stat.mtimeMs < 5 * 60_000) { inProgress++; continue; }
    const entry = byTarget.get(target) ?? { count: 0, bytes: 0, newest: 0 };
    entry.count++; entry.bytes += stat.size; entry.newest = Math.max(entry.newest, stat.mtimeMs);
    byTarget.set(target, entry);
  }
  const findings: Finding[] = Array.from(byTarget.entries()).map(([target, entry]) => ({
    check: "半截 .tmp 文件",
    severity: "warn" as const,
    message: `${target}：${entry.count} 个残留（共 ${(entry.bytes / 1024 / 1024).toFixed(1)} MB，最新一个在 ${ageText(now - entry.newest)}前）——写盘进程已退出，写盘被重启打断；本脚本不删除`,
  }));
  if (inProgress) findings.push({ check: "半截 .tmp 文件", severity: "info", message: `${inProgress} 个 .tmp 属于仍在运行的进程且很新，可能正在写盘，未计入残留` });
  if (!findings.length) findings.push({ check: "半截 .tmp 文件", severity: "ok", message: "没有残留的 .tmp 文件" });
  return findings;
}

// ── 熔断状态 ──

export function checkBreakerLog(logText: string): Finding[] {
  const keys = new Map<string, number>();
  for (const match of Array.from(logText.matchAll(/\[imageGen\] Provider (?:short cooldown \((?:overload|network)\): )?([a-z0-9._:-]+)/gi))) {
    let key = match[1]!.replace(/:+$/, "");
    if (key === "cooldown" || key === "short") key = "（旧格式，未记录供应商）";
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  if (!keys.size) return [{ check: "熔断（日志）", severity: "ok", message: "开发日志里没有熔断记录" }];
  return [{ check: "熔断（日志）", severity: "warn", message: `开发日志里有熔断记录：${Array.from(keys.entries()).map(([k, v]) => `${k} ×${v}`).join("，")}（日志不带时间，可能是历史记录）` }];
}

async function checkBreakerLive(port: number): Promise<Finding[]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/dev/render-health`, { signal: AbortSignal.timeout(1500) });
    // Old builds answer unknown paths with the SPA's index.html (HTTP 200, text/html).
    if (!response.ok || !/json/i.test(response.headers.get("content-type") ?? ""))
      return [{ check: "熔断（运行中服务）", severity: "info", message: `端口 ${port} 有服务在运行，但不提供 /api/dev/render-health（修复前的旧代码），读不到熔断状态` }];
    const json = record(await response.json());
    const health = record(json.imageProviderHealth);
    const open = Array.isArray(health.open) ? (health.open as Array<{ key: string; retryAt: string }>) : [];
    if (!open.length) return [{ check: "熔断（运行中服务）", severity: "ok", message: `端口 ${port}：没有供应商/模型在冷却` }];
    return open.map(item => ({ check: "熔断（运行中服务）", severity: "error" as const, message: `端口 ${port}：${item.key} 冷却中，预计 ${item.retryAt} 恢复` }));
  } catch {
    return [{ check: "熔断（运行中服务）", severity: "info", message: `端口 ${port} 没有运行中的服务，跳过（熔断状态只在进程内存里）` }];
  }
}

// ── main ──

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runSelfcheck(args: string[]): Promise<Finding[]> {
  const root = path.resolve(argValue(args, "--root") ?? process.cwd());
  const port = Number(argValue(args, "--port") ?? process.env.PORT ?? 3000);
  const findings: Finding[] = [];

  const envPath = path.join(root, ".env");
  const envFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : null;
  if (!envFile) findings.push({ check: ".env", severity: "warn", message: `${envPath} 不存在` });
  else if (!envFile.duplicates.length) findings.push({ check: ".env 重复键", severity: "ok", message: `${envFile.keys.size} 个键，无重复` });
  else for (const dup of envFile.duplicates)
    findings.push({ check: ".env 重复键", severity: dup.valuesDiffer ? "error" : "warn", message: `${dup.key} 出现 ${dup.lines.length} 次（第 ${dup.lines.join("、")} 行）${dup.valuesDiffer ? "，值不同——生效的是最后一行，改前面那行不会生效" : "，值相同"}` });
  // Shell environment overrides .env (dotenv never overwrites an existing variable).
  const env = (key: string) => (process.env[key] ?? envFile?.values.get(key) ?? "").trim();
  findings.push(...checkProfiles(env));
  findings.push({ check: "接口域名", severity: env("API302_BASE_URL") ? "ok" : "info", message: env("API302_BASE_URL") ? "API302_BASE_URL 已设置" : "API302_BASE_URL 未设置，使用代码默认 https://api.302.ai（与线上配置可能不同）" });

  const dataDir = path.join(root, ".webdev");
  const persistPath = process.env.LOCAL_PERSIST_PATH && argValue(args, "--root") == null ? process.env.LOCAL_PERSIST_PATH : path.join(dataDir, "local-persist.json");
  if (existsSync(persistPath)) {
    const state = record(JSON.parse(readFileSync(persistPath, "utf8")));
    findings.push(...checkStoryboardTasks((state.stories as StoryRow[]) ?? []));
    findings.push(...checkVideoTakes((state.videoTakes as VideoTakeRow[]) ?? [], currentVideoRoute(env)));
  } else {
    findings.push({ check: "本地数据", severity: "info", message: `${persistPath} 不存在（MySQL 模式或新工作区），跳过任务检查` });
  }
  findings.push(...checkTempFiles(dataDir));
  const logPath = path.join(dataDir, "dev-server.log");
  if (existsSync(logPath)) findings.push(...checkBreakerLog(readFileSync(logPath, "utf8").slice(-2_000_000)));
  findings.push(...(await checkBreakerLive(port)));
  return findings;
}

const ICON: Record<Severity, string> = { ok: "✓", info: "·", warn: "!", error: "✗" };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  runSelfcheck(args).then(findings => {
    if (args.includes("--json")) {
      console.log(JSON.stringify(findings, null, 2));
    } else {
      let current = "";
      for (const finding of findings) {
        if (finding.check !== current) { current = finding.check; console.log(`\n[${current}]`); }
        console.log(`  ${ICON[finding.severity]} ${finding.message}`);
      }
      const errors = findings.filter(f => f.severity === "error").length;
      const warns = findings.filter(f => f.severity === "warn").length;
      console.log(`\n合计：${errors} 个错误，${warns} 个警告（只读检查，未修改任何文件）`);
    }
  }).catch(error => {
    console.error("[render-selfcheck] 失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
