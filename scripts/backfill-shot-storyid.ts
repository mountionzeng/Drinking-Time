/**
 * 一次性工具：把现有镜头回填到所属故事的 storyId（U2）。
 *
 * 背景：镜头表原来只按 projectId 存，故事是唯一单位后要归到具体故事（storyId）。
 *
 * ⚠️ 评审实测：不能用 shotNo 精确匹配——shots.shotNo 是 "SH01" 字符串、
 * story.body.shots[].shotNo 是数字 1，编号体系不兼容；且"归最近更新的故事"单独兜底
 * 会系统性归给空壳新故事。所以归属用：
 *   在该 project 的故事里，归给 body.shots 数量与该 project 待归属镜头数最接近的故事；
 *   数量并列/都不接近时，以 updatedAt 最近兜底；同名同数量无法区分时标"歧义需裁决"。
 *
 * 默认 dry-run，逐条打印候选+理由+歧义，交用户核对；--write 才落盘，写前自动备份。
 *
 * 用法：
 *   npx tsx scripts/backfill-shot-storyid.ts                 # dry-run 报告
 *   npx tsx scripts/backfill-shot-storyid.ts --write         # 确认后落盘（含备份）
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;
interface PersistData {
  shots: Row[];
  stories: Row[];
  [k: string]: unknown;
}

interface StoryCandidate {
  id: number;
  title: string;
  bodyShotCount: number;
  updatedAt: string;
}

export interface Assignment {
  projectId: number;
  shotCount: number; // 该 project 待归属镜头数
  chosenStoryId: number | null;
  reason: string;
  ambiguous: boolean;
  candidates: StoryCandidate[];
}

function bodyShotCount(story: Row): number {
  const body = story.body as { shots?: unknown } | undefined;
  return Array.isArray(body?.shots) ? body!.shots!.length : 0;
}

/**
 * 为一个 project 的镜头集合选归属故事（纯函数，可测）。
 * 入参：该 project 的镜头数、该 project 的故事候选。
 */
export function chooseStoryForProject(
  shotCount: number,
  stories: StoryCandidate[]
): { chosenStoryId: number | null; reason: string; ambiguous: boolean } {
  if (stories.length === 0) {
    return { chosenStoryId: null, reason: "该 project 下无故事，保持 null", ambiguous: false };
  }
  if (stories.length === 1) {
    return { chosenStoryId: stories[0].id, reason: "该 project 仅一个故事", ambiguous: false };
  }
  // 按"body.shots 数量与镜头数的差"升序，差同则 updatedAt 新者优先
  const ranked = [...stories].sort((a, b) => {
    const da = Math.abs(a.bodyShotCount - shotCount);
    const db = Math.abs(b.bodyShotCount - shotCount);
    if (da !== db) return da - db;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const best = ranked[0];
  const second = ranked[1];
  const bestDiff = Math.abs(best.bodyShotCount - shotCount);
  const secondDiff = Math.abs(second.bodyShotCount - shotCount);

  // 数量精确命中（差 0）且唯一 → 强匹配
  if (bestDiff === 0 && secondDiff !== 0) {
    return {
      chosenStoryId: best.id,
      reason: `body.shots 数量精确命中（${best.bodyShotCount}=${shotCount}）`,
      ambiguous: false,
    };
  }
  // 最优与次优数量并列（含都精确命中）→ 歧义，需用户裁决
  if (bestDiff === secondDiff) {
    return {
      chosenStoryId: best.id,
      reason: `数量并列（${best.title}≈${second.title}），按 updatedAt 兜底选 ${best.id}，但需用户裁决`,
      ambiguous: true,
    };
  }
  // 最优数量更接近但非精确 → 按时间兜底色彩，标注
  return {
    chosenStoryId: best.id,
    reason: `数量最接近（差 ${bestDiff}），按"接近+时间"选 ${best.id}`,
    ambiguous: false,
  };
}

export function planBackfill(data: PersistData): Assignment[] {
  // 按 project 分组镜头与故事
  const shotsByProject = new Map<number, Row[]>();
  for (const s of data.shots) {
    const pid = s.projectId as number;
    if (!shotsByProject.has(pid)) shotsByProject.set(pid, []);
    shotsByProject.get(pid)!.push(s);
  }
  const storiesByProject = new Map<number, StoryCandidate[]>();
  for (const st of data.stories) {
    const pid = st.projectId as number;
    if (pid == null) continue;
    if (!storiesByProject.has(pid)) storiesByProject.set(pid, []);
    storiesByProject.get(pid)!.push({
      id: st.id as number,
      title: String(st.title ?? "(无题)"),
      bodyShotCount: bodyShotCount(st),
      updatedAt: String(st.updatedAt ?? ""),
    });
  }

  const out: Assignment[] = [];
  for (const [pid, shots] of shotsByProject) {
    const stories = storiesByProject.get(pid) ?? [];
    const { chosenStoryId, reason, ambiguous } = chooseStoryForProject(
      shots.length,
      stories
    );
    out.push({
      projectId: pid,
      shotCount: shots.length,
      chosenStoryId,
      reason,
      ambiguous,
      candidates: stories,
    });
  }
  return out.sort((a, b) => a.projectId - b.projectId);
}

export function formatPlan(plan: Assignment[]): string {
  const lines: string[] = ["== 镜头回填 storyId 计划（dry-run）=="];
  for (const a of plan) {
    lines.push(
      `\n项目 ${a.projectId}：${a.shotCount} 条镜头 → 拟归故事 ${a.chosenStoryId ?? "(null)"}` +
        (a.ambiguous ? "  ⚠️ 歧义，需裁决" : "")
    );
    lines.push(`  理由：${a.reason}`);
    lines.push(`  候选故事：`);
    for (const c of a.candidates) {
      const mark = c.id === a.chosenStoryId ? "→" : " ";
      lines.push(
        `   ${mark} #${c.id} 《${c.title}》 body.shots=${c.bodyShotCount} updatedAt=${c.updatedAt}`
      );
    }
  }
  const ambiguous = plan.filter((a) => a.ambiguous);
  if (ambiguous.length) {
    lines.push(`\n⚠️ ${ambiguous.length} 个项目归属有歧义，落盘前请人工确认：` +
      ambiguous.map((a) => a.projectId).join("、"));
  }
  return lines.join("\n");
}

/** 应用计划：给每条镜头写 storyId，并校验 userId 一致性。返回告警。 */
export function applyPlan(data: PersistData, plan: Assignment[]): string[] {
  const warnings: string[] = [];
  const chosenByProject = new Map(plan.map((a) => [a.projectId, a.chosenStoryId]));
  const storyUserById = new Map(
    data.stories.map((st) => [st.id as number, st.userId as number])
  );
  for (const shot of data.shots) {
    // 幂等：已归属（storyId 非 null）的镜头跳过，重跑不改写已正确归属者（评审 P2）
    if (shot.storyId != null) continue;
    const pid = shot.projectId as number;
    const storyId = chosenByProject.get(pid) ?? null;
    shot.storyId = storyId;
    if (storyId !== null) {
      const storyUser = storyUserById.get(storyId);
      // storyUser 为 undefined（override 指向不存在的故事）也视为不可确认 → 不写
      // （评审 P3：override 到不存在 storyId 会绕过 userId 校验）
      if (storyUser === undefined || storyUser !== (shot.userId as number)) {
        warnings.push(
          `镜头 ${shot.id}(user ${shot.userId}) 拟归故事 ${storyId}(user ${storyUser ?? '不存在'})——userId 不一致或故事不存在，跳过`
        );
        shot.storyId = null; // 不跨用户污染、不归到不存在的故事
      }
    }
  }
  return warnings;
}

/** 解析 --override projectId:storyId（用户对歧义项目的裁决）。 */
export function parseOverrides(args: string[]): Map<number, number> {
  const overrides = new Map<number, number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--override") continue;
    const [pid, sid] = (args[i + 1] ?? "").split(":").map(Number);
    if (Number.isFinite(pid) && Number.isFinite(sid)) overrides.set(pid, sid);
  }
  return overrides;
}

/** 把用户裁决套到计划上：覆盖归属、清除歧义标记。 */
export function applyOverrides(plan: Assignment[], overrides: Map<number, number>): Assignment[] {
  return plan.map((a) => {
    if (!overrides.has(a.projectId)) return a;
    const storyId = overrides.get(a.projectId)!;
    return {
      ...a,
      chosenStoryId: storyId,
      reason: `用户裁决：归故事 ${storyId}`,
      ambiguous: false,
    };
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const overrides = parseOverrides(args);
  const file = path.resolve(".webdev/local-persist.json");
  const data = JSON.parse(readFileSync(file, "utf-8")) as PersistData;

  const plan = applyOverrides(planBackfill(data), overrides);
  console.log(formatPlan(plan));

  if (!write) {
    console.log("\n（dry-run：未写任何文件。核对无误后加 --write 落盘）");
    return;
  }

  const ambiguous = plan.filter((a) => a.ambiguous);
  if (ambiguous.length) {
    console.log(
      `\n⛔ 有 ${ambiguous.length} 个项目归属歧义，拒绝自动落盘。请人工裁决后再处理这些项目。`
    );
    return;
  }

  const backupDir = path.resolve(".webdev/manual-backups-20260613");
  mkdirSync(backupDir, { recursive: true }); // 目录不存在时先建，否则 copyFileSync 抛错（评审 P2）
  const backup = path.join(backupDir, `pre-backfill-${Date.now()}.json`);
  copyFileSync(file, backup);
  const warnings = applyPlan(data, plan);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`\n已备份到 ${backup}`);
  console.log(`已写入 ${file}`);
  if (warnings.length) {
    console.log(`⚠️ ${warnings.length} 条告警：`);
    for (const w of warnings) console.log(`  ${w}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
