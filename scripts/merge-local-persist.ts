/**
 * 一次性工具：合并多份 .webdev/local-persist.json（环境收敛 U5）。
 *
 * 背景：各 worktree 环境的数据文件 id 空间互相冲突（同 id 不同内容），
 * 不能挑一份，必须按内容去重 + 全量重新编号 + 同步重映射所有外键。
 *
 * 用法（默认 dry-run，只出报告不写文件）：
 *   npx tsx scripts/merge-local-persist.ts <源文件1> <源文件2> ...
 * 确认报告无误后落盘：
 *   npx tsx scripts/merge-local-persist.ts --write --out 合并结果.json <源文件1> <源文件2> ...
 *
 * 源文件顺序 = 优先级顺序（内容相同的行保留先出现的那份）。
 * 外键图谱依据 drizzle/schema.ts（2026-06-12 版本）。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;
export interface PersistData {
  [table: string]: Row[] | Record<string, number>;
}

// ── 表结构：处理顺序必须父表在前（FK 重映射依赖父表的 id 映射）──

interface TableSpec {
  table: string;
  idSpace: string; // nextIds 里的键名
  /** 外键字段 → 引用的 idSpace */
  fks: Record<string, string>;
  /** 自引用外键字段（指向本表，表内两遍处理）*/
  selfFks: string[];
  /** 业务唯一键：存在时用它去重（如 users.openId），否则用整行内容哈希 */
  naturalKey?: string;
}

export const TABLE_SPECS: TableSpec[] = [
  { table: "users", idSpace: "user", fks: {}, selfFks: [], naturalKey: "openId" },
  { table: "projects", idSpace: "project", fks: { userId: "user" }, selfFks: [] },
  { table: "stories", idSpace: "story", fks: { userId: "user", projectId: "project" }, selfFks: [] },
  { table: "shots", idSpace: "shot", fks: { projectId: "project", userId: "user" }, selfFks: [] },
  { table: "references", idSpace: "reference", fks: { projectId: "project", userId: "user" }, selfFks: [] },
  { table: "analysisResults", idSpace: "analysisResult", fks: { projectId: "project", userId: "user" }, selfFks: [] },
  { table: "emotionAnalysisProfiles", idSpace: "emotionAnalysisProfile", fks: { userId: "user", projectId: "project" }, selfFks: [] },
  { table: "editSnapshots", idSpace: "editSnapshot", fks: { projectId: "project" }, selfFks: ["previousSnapshotId"] },
  { table: "generatedImages", idSpace: "generatedImage", fks: { projectId: "project", storyId: "story", userId: "user" }, selfFks: ["parentImageId"] },
  { table: "imageSignals", idSpace: "imageSignal", fks: { userId: "user", storyId: "story", imageId: "generatedImage" }, selfFks: [] },
  { table: "semanticAnnotations", idSpace: "semanticAnnotation", fks: { snapshotId: "editSnapshot", previousSnapshotId: "editSnapshot" }, selfFks: [] },
];

const KNOWN_KEYS = new Set([...TABLE_SPECS.map((t) => t.table), "nextIds"]);

// ── 工具函数 ──

/** 键序无关的稳定序列化 + 哈希，用于内容去重 */
export function contentHash(obj: unknown): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Row)
          .sort()
          .map((k) => [k, stable((v as Row)[k])])
      );
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(stable(obj))).digest("hex");
}

export interface SourceInput {
  label: string;
  data: PersistData;
}

export interface MergeReport {
  perSource: { label: string; counts: Record<string, number> }[];
  finalCounts: Record<string, number>;
  dedupedCounts: Record<string, number>;
  warnings: string[];
  /** 供人工核对的故事清单 */
  storyInventory: { id: number; title: string; createdAt: unknown; from: string }[];
  /**
   * 分叉副本（近似重复）：createdAt 完全相同但内容已各自演化的故事组。
   * 工具不自动取舍——哪个版本是真的只有用户知道，报告出来人工拍板。
   */
  nearDuplicates: { createdAt: unknown; versions: { id: number; title: string; from: string; updatedAt: unknown }[] }[];
}

export interface MergeResult {
  merged: PersistData;
  report: MergeReport;
}

/**
 * 合并核心（纯函数）。
 * 每个源各表逐行：外键先经父表映射重写 → 算内容哈希（不含 id 与自引用字段）→
 * 重复则把旧 id 映射到既有行，否则发新 id。自引用字段表内第二遍统一回填。
 */
export function mergePersist(sources: SourceInput[]): MergeResult {
  const merged: PersistData = {};
  const report: MergeReport = {
    perSource: sources.map((s) => ({ label: s.label, counts: {} })),
    finalCounts: {},
    dedupedCounts: {},
    warnings: [],
    storyInventory: [],
    nearDuplicates: [],
  };

  // maps[源下标][idSpace]: 旧 id → 新 id
  const maps: Map<string, Map<number, number>>[] = sources.map(() => new Map());
  const nextIds: Record<string, number> = {};

  // 引用表在所有源里都为空 → 该 FK 原样保留（典型：users 表为空但全部行带 userId=1
  // 的隐式本地用户）。置 null 会破坏 notNull 约束和按 userId 的查询。
  const spaceHasRows = new Map<string, boolean>();
  for (const spec of TABLE_SPECS) {
    spaceHasRows.set(
      spec.idSpace,
      sources.some((s) => ((s.data[spec.table] as Row[] | undefined) ?? []).length > 0)
    );
  }
  const passthroughWarned = new Set<string>();

  for (const spec of TABLE_SPECS) {
    const outRows: Row[] = [];
    const seen = new Map<string, number>(); // 内容哈希 → 新 id
    let next = 1;
    let deduped = 0;
    // 自引用回填队列：[行, 字段, 源下标, 旧值]
    const selfFixes: [Row, string, number, number][] = [];

    sources.forEach((src, si) => {
      const rows = (src.data[spec.table] as Row[] | undefined) ?? [];
      report.perSource[si].counts[spec.table] = rows.length;
      if (!maps[si].has(spec.idSpace)) maps[si].set(spec.idSpace, new Map());
      const idMap = maps[si].get(spec.idSpace)!;

      for (const row of rows) {
        const oldId = row.id as number;
        // 1) 重写普通外键（父表已处理完，映射必然可查）
        const rewritten: Row = { ...row };
        let orphaned = false;
        for (const [fkField, fkSpace] of Object.entries(spec.fks)) {
          const v = rewritten[fkField];
          if (v === null || v === undefined) continue;
          if (!spaceHasRows.get(fkSpace)) {
            // 引用表在所有源里都为空：原样保留（隐式实体，如本地用户 id=1），只提示一次
            const wk = `${spec.table}.${fkField}`;
            if (!passthroughWarned.has(wk)) {
              passthroughWarned.add(wk);
              report.warnings.push(
                `提示: ${fkSpace} 表在所有源中为空，${wk} 原样保留（隐式实体，未重映射）`
              );
            }
            continue;
          }
          const mapped = maps[si].get(fkSpace)?.get(v as number);
          if (mapped === undefined) {
            report.warnings.push(
              `[${src.label}] ${spec.table}#${oldId} 的 ${fkField}=${v} 找不到引用目标，已置 null`
            );
            rewritten[fkField] = null;
            orphaned = true;
          } else {
            rewritten[fkField] = mapped;
          }
        }
        void orphaned;
        // 2) 内容哈希：不含 id 与自引用字段（链式身份由内容+时间戳保证）
        const keySource: Row = { ...rewritten };
        delete keySource.id;
        for (const f of spec.selfFks) delete keySource[f];
        const key = spec.naturalKey
          ? `nk:${String(rewritten[spec.naturalKey])}`
          : contentHash(keySource);
        // 3) 去重 or 发新 id
        const existing = seen.get(key);
        if (existing !== undefined) {
          idMap.set(oldId, existing);
          deduped++;
          continue;
        }
        const newId = next++;
        idMap.set(oldId, newId);
        seen.set(key, newId);
        const outRow: Row = { ...rewritten, id: newId };
        for (const f of spec.selfFks) {
          const v = outRow[f];
          if (v !== null && v !== undefined) {
            selfFixes.push([outRow, f, si, v as number]);
            outRow[f] = null; // 先置空，第二遍回填
          }
        }
        outRows.push(outRow);
        if (spec.table === "stories") {
          report.storyInventory.push({
            id: newId,
            title: String(outRow.title ?? "(无题)"),
            createdAt: outRow.createdAt,
            from: src.label,
          });
        }
      }
    });

    // 自引用第二遍回填
    for (const [row, field, si, oldVal] of selfFixes) {
      const mapped = maps[si].get(spec.idSpace)?.get(oldVal);
      if (mapped === undefined) {
        report.warnings.push(
          `[${sources[si].label}] ${spec.table}#${row.id} 的自引用 ${field}=${oldVal} 找不到目标，保持 null`
        );
      } else {
        row[field] = mapped;
      }
    }

    merged[spec.table] = outRows;
    report.finalCounts[spec.table] = outRows.length;
    report.dedupedCounts[spec.table] = deduped;
    nextIds[spec.idSpace] = next;

    // 分叉副本检测（仅故事表）：createdAt 相同 = 同一篇的不同演化版本
    if (spec.table === "stories") {
      const byCreatedAt = new Map<string, Row[]>();
      for (const row of outRows) {
        const k = String(row.createdAt ?? "");
        if (!byCreatedAt.has(k)) byCreatedAt.set(k, []);
        byCreatedAt.get(k)!.push(row);
      }
      for (const [createdAt, rows] of byCreatedAt) {
        if (rows.length < 2) continue;
        report.nearDuplicates.push({
          createdAt,
          versions: rows.map((r) => ({
            id: r.id as number,
            title: String(r.title ?? "(无题)"),
            from: report.storyInventory.find((s) => s.id === r.id)?.from ?? "?",
            updatedAt: r.updatedAt,
          })),
        });
      }
    }
  }

  merged.nextIds = nextIds;

  // 未知顶层键：不静默丢弃，从最后一个含该键的源透传并告警
  for (const src of sources) {
    for (const key of Object.keys(src.data)) {
      if (!KNOWN_KEYS.has(key)) {
        merged[key] = src.data[key];
        report.warnings.push(
          `[${src.label}] 未知顶层键 "${key}" 原样透传（未做 id 重映射），请人工确认`
        );
      }
    }
  }

  return { merged, report };
}

export function formatReport(report: MergeReport): string {
  const lines: string[] = ["== 合并报告（dry-run 与落盘内容一致）=="];
  for (const s of report.perSource) {
    const nonZero = Object.entries(s.counts).filter(([, n]) => n > 0);
    lines.push(
      `源 ${s.label}: ` +
        (nonZero.length ? nonZero.map(([t, n]) => `${t}=${n}`).join(", ") : "(空)")
    );
  }
  lines.push("-- 合并后各表行数:");
  for (const [t, n] of Object.entries(report.finalCounts)) {
    if (n > 0 || (report.dedupedCounts[t] ?? 0) > 0)
      lines.push(`   ${t}: ${n} 行（内容去重 ${report.dedupedCounts[t]} 行）`);
  }
  lines.push(`-- 故事清单（共 ${report.storyInventory.length} 篇，请逐篇核对）:`);
  for (const s of report.storyInventory) {
    lines.push(`   #${s.id} 《${s.title}》 ${String(s.createdAt ?? "")}  ← ${s.from}`);
  }
  if (report.nearDuplicates.length) {
    lines.push(`-- ⚠️ 分叉副本 ${report.nearDuplicates.length} 组（同一篇故事的不同演化版本，需要人工拍板留哪个/都留）:`);
    for (const g of report.nearDuplicates) {
      lines.push(`   createdAt=${g.createdAt}:`);
      for (const v of g.versions)
        lines.push(`     #${v.id} 《${v.title}》 updatedAt=${v.updatedAt} ← ${v.from}`);
    }
  }
  if (report.warnings.length) {
    lines.push(`-- ⚠️ 告警 ${report.warnings.length} 条:`);
    for (const w of report.warnings) lines.push(`   ${w}`);
  } else {
    lines.push("-- 无告警");
  }
  return lines.join("\n");
}

// ── CLI ──

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
  const files = args.filter(
    (a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1)
  );
  if (files.length < 2) {
    console.error("用法: tsx scripts/merge-local-persist.ts [--write --out 输出.json] <源1> <源2> ...");
    process.exit(1);
  }
  if (write && !outPath) {
    console.error("--write 必须配 --out 指定输出路径（拒绝覆盖任何源文件）");
    process.exit(1);
  }
  if (write && outPath && files.some((f) => path.resolve(f) === path.resolve(outPath))) {
    console.error("输出路径不能是源文件之一");
    process.exit(1);
  }
  // live 文件都叫 local-persist.json，撞名时用所属 worktree 目录名做标签
  const labelOf = (f: string): string => {
    const base = path.basename(f);
    if (base !== "local-persist.json") return base;
    const dir = path.dirname(f);
    return path.basename(dir) === ".webdev"
      ? `${path.basename(path.dirname(dir))}/${base}`
      : base;
  };
  const sources: SourceInput[] = files.map((f) => ({
    label: labelOf(f),
    data: JSON.parse(readFileSync(f, "utf-8")) as PersistData,
  }));
  const { merged, report } = mergePersist(sources);
  console.log(formatReport(report));
  if (write && outPath) {
    writeFileSync(outPath, JSON.stringify(merged, null, 2));
    console.log(`\n已写出: ${outPath}`);
  } else {
    console.log("\n（dry-run：未写任何文件。确认无误后加 --write --out <路径> 落盘）");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
