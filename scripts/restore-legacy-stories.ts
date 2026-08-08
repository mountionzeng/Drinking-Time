/**
 * 一次性、本地数据恢复工具。
 *
 * 早期版本按 storyId 保存了图片，但后来的整理删除了相应的故事记录；
 * 因此新版工作台虽然媒体文件仍在，却无法从故事中读取它们。此脚本只做
 * 明确可证实的恢复：从历史快照取回完整故事，并把已知的遗留图片归回。
 *
 * 默认 dry-run；传入 --write 才会写入。在写入前会复制整个 local-persist
 * 文件到 local-data/backups，故可直接回滚。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type Row = Record<string, unknown>;

interface PersistData {
  stories: Row[];
  generatedImages: Row[];
  [key: string]: unknown;
}

const localDataDir = path.join(homedir(), "Library", "Application Support", "Drinking Time", "local-data");
const persistFile = path.join(localDataDir, "local-persist.json");
const archiveRoot = path.join(homedir(), "Library", "Application Support", "Drinking Time", "archive", "2026-07-30");
const mainArchive = path.join(
  archiveRoot,
  "manual-backups-20260614",
  "local-persist-before-reset-151622.json"
);
const story22Archive = path.join(
  archiveRoot,
  "historical-backups",
  "local-persist-before-story22-image-prompt-clean-20260619-1901.json"
);

// 这些故事在归档中有完整正文；恢复时保留它们原来的 ID 以重新接上图片。
const storySourceById = new Map<number, string>([
  [2, mainArchive],
  [3, mainArchive],
  [6, mainArchive],
  [7, mainArchive],
  [9, mainArchive],
  [11, mainArchive],
  [15, mainArchive],
  [16, mainArchive],
  [22, story22Archive],
]);

export interface RestorePlan {
  restoredStoryIds: number[];
  imageAssignments: Array<{ imageId: number; fromStoryId: number | null; toStoryId: number }>;
  warnings: string[];
}

function readPersist(file: string): PersistData {
  return JSON.parse(readFileSync(file, "utf8")) as PersistData;
}

function currentOwnerId(data: PersistData): number {
  const userIds = data.stories.map(row => row.userId).filter((id): id is number => typeof id === "number");
  if (userIds.length === 0) throw new Error("当前数据没有故事 owner，拒绝猜测恢复目标用户。");
  const counts = new Map<number, number>();
  for (const id of userIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function archiveStory(id: number): Row {
  const source = storySourceById.get(id);
  if (!source || !existsSync(source)) throw new Error(`缺少故事 #${id} 的历史快照：${source ?? "unknown"}`);
  const story = readPersist(source).stories.find(row => row.id === id);
  if (!story) throw new Error(`历史快照中找不到故事 #${id}：${source}`);
  return structuredClone(story);
}

/** 只生成计划，不写入。 */
export function planLegacyStoryRestore(data: PersistData): RestorePlan {
  const ownerId = currentOwnerId(data);
  const existingIds = new Set(data.stories.map(row => row.id));
  const restoredStoryIds: number[] = [];
  const warnings: string[] = [];

  for (const id of storySourceById.keys()) {
    if (existingIds.has(id)) continue;
    const story = archiveStory(id);
    if (story.userId !== ownerId) {
      warnings.push(`故事 #${id} 将从历史 owner ${String(story.userId)} 转给当前 owner ${ownerId}，以便在当前帐号的故事列表显示。`);
    }
    restoredStoryIds.push(id);
  }

  const plannedStoryIds = new Set([...existingIds, ...restoredStoryIds]);
  const imageAssignments: RestorePlan["imageAssignments"] = [];
  for (const image of data.generatedImages) {
    const imageId = image.id;
    if (typeof imageId !== "number") continue;
    const storyId = typeof image.storyId === "number" ? image.storyId : null;
    if (storyId !== null && plannedStoryIds.has(storyId)) continue;

    // #24/#26 是 #22 这条职业故事的历史重渲染版本，归回有完整正文的 #22。
    if (storyId === 24 || storyId === 26) {
      imageAssignments.push({ imageId, fromStoryId: storyId, toStoryId: 22 });
      continue;
    }
    // 5 张完全没有 storyId 的早期图，与 #2 的「身体状态变好 / 小草开花」正文一致。
    if (storyId === null && image.projectId === 1 && imageId >= 1 && imageId <= 5) {
      imageAssignments.push({ imageId, fromStoryId: null, toStoryId: 2 });
      continue;
    }
    warnings.push(`图片 #${imageId} 的 storyId=${String(storyId)} 无法从证据确定归属，保持不动。`);
  }

  return { restoredStoryIds, imageAssignments, warnings };
}

/** 应用已审计计划。已存在故事、已有正确归属的图片保持不变，支持幂等重跑。 */
export function applyLegacyStoryRestore(data: PersistData, plan: RestorePlan): void {
  const ownerId = currentOwnerId(data);
  const existingIds = new Set(data.stories.map(row => row.id));
  for (const id of plan.restoredStoryIds) {
    if (existingIds.has(id)) continue;
    const story = archiveStory(id);
    story.userId = ownerId;
    // 当前图片记录是迁移后的 project 归属，使用它来修正少数旧快照 project 漂移。
    const imageProject = data.generatedImages.find(image => image.storyId === id)?.projectId;
    if (typeof imageProject === "number") story.projectId = imageProject;
    data.stories.push(story);
    existingIds.add(id);
  }

  const assignments = new Map(plan.imageAssignments.map(item => [item.imageId, item]));
  for (const image of data.generatedImages) {
    if (typeof image.id !== "number") continue;
    const assignment = assignments.get(image.id);
    if (!assignment) continue;
    if (image.storyId === assignment.fromStoryId) image.storyId = assignment.toStoryId;
  }
}

function formatPlan(plan: RestorePlan): string {
  const lines = [
    "== 历史故事与媒体恢复计划（dry-run） ==",
    `恢复完整故事：${plan.restoredStoryIds.map(id => `#${id}`).join("、") || "无"}`,
    `补回图片归属：${plan.imageAssignments.length} 张`,
  ];
  const grouped = new Map<number, number>();
  for (const item of plan.imageAssignments) grouped.set(item.toStoryId, (grouped.get(item.toStoryId) ?? 0) + 1);
  for (const [storyId, count] of grouped) lines.push(`  #${storyId} ← ${count} 张图片`);
  if (plan.warnings.length) {
    lines.push(`告警（${plan.warnings.length}）：`);
    lines.push(...plan.warnings.map(item => `  - ${item}`));
  }
  return lines.join("\n");
}

function main(): void {
  const write = process.argv.includes("--write");
  const data = readPersist(persistFile);
  const plan = planLegacyStoryRestore(data);
  console.log(formatPlan(plan));
  if (!write) {
    console.log("\n（dry-run：未写入。确认计划后运行 pnpm exec tsx scripts/restore-legacy-stories.ts --write）");
    return;
  }

  const backupDir = path.join(localDataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `local-persist-before-legacy-story-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  copyFileSync(persistFile, backup);
  applyLegacyStoryRestore(data, plan);
  writeFileSync(persistFile, JSON.stringify(data, null, 2));
  console.log(`\n已备份：${backup}`);
  console.log(`已恢复：${plan.restoredStoryIds.length} 个故事、${plan.imageAssignments.length} 张图片关联。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
