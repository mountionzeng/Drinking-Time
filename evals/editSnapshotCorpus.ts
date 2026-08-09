/**
 * 编辑快照语料 —— 从 `.webdev/edit-snapshots-local.json` 读出「用户实际改过哪个字段」。
 *
 * 这是比提示词谱系更直接的监督信号：谱系里 648 条修订有 641 条是迁移产生的
 * （见 evals/README「已知限制」），user authorType 只有 6 条，样本太少。
 * 但编辑快照记录的是**每次保存时镜头字段的 old/new 对比**，是编辑器一直在做的事，
 * 数据量和真实度都够——这才是「用户改了哪个维度」的真实分布。
 *
 * 只读。跟 corpus.ts 一样的路径解析策略（worktree 也能跑）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SNAPSHOT_FILENAME = ".webdev/edit-snapshots-local.json";

/**
 * 快照里的镜头字段是 camelCase（`styleRef`），服务端谱系维度键是 snake_case
 * （`style_reference`）。这份映射照抄 `promptLineageMigration.ts` 里
 * shared/dialogue/image/video 四组的字段→维度对应关系，保持单一事实来源的口径。
 * 不在映射表里的字段（如 `subject`/`action`/`mood`）本身就是维度键，原样返回。
 */
const FIELD_TO_DIMENSION: Record<string, string> = {
  timeLight: "time_light",
  styleRef: "style_reference",
  promptDraft: "image_prompt",
  negativePrompt: "negative_prompt",
  cameraMove: "camera_motion",
  videoPrompt: "video_prompt",
};

/**
 * 「真的是提示词维度」的白名单——不是「镜头上能编辑的字段」。
 *
 * `shared/shotDirector.ts` 的 `STORY_SHOT_EDITABLE_FIELDS` 有 30+ 个可编辑字段，
 * 但其中 `characterReference`/`wardrobeReference`/`hairReference`/`sceneReference`/
 * `textureReference`/`generationModel`/`generationParams` 是参考图绑定和出图配置，
 * 从来不会被编译进最终提示词文本，问「该给它多少权重」没有意义。
 *
 * 这份白名单 = `promptLineageMigration.ts` 的字段→维度映射（服务端真实编译用的）
 * ∪ `client/.../promptTable/buildPromptTable.ts` 的 `CONTENT_DIMENSIONS`/`VIDEO_DIMENSIONS`
 * （客户端提示词表用的，键名口径不同）。两处都不认的字段，就不是提示词维度。
 */
const KNOWN_DIMENSION_FIELDS = new Set([
  // 服务端 shared 维度（scope: shot, modality: shared）
  "sceneTitle",
  "sceneArtBrief",
  "subject",
  "action",
  "intent",
  "rationale",
  "location",
  "timeLight",
  "mood",
  "styleRef",
  "beat",
  // 服务端 dialogue/image/video 维度
  "dialogue",
  "promptDraft",
  "negativePrompt",
  "cameraMove",
  "videoPrompt",
  "sound",
  // 只在客户端 buildPromptTable 里加权、服务端 shared 权重表里还没有的维度——
  // 编辑率一旦跑出来，这本身就是「两份权重表不同步」的证据，不是要排除的噪音。
  "shotType",
  "cameraAngle",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
]);

export function dimensionForField(field: string): string {
  return FIELD_TO_DIMENSION[field] ?? field;
}

export function isCreativeField(field: string): boolean {
  return KNOWN_DIMENSION_FIELDS.has(field);
}

type ShotRecord = Record<string, unknown> & { stableShotId?: string };

type ModifiedPair = { old: ShotRecord | null; new: ShotRecord | null };

type EditSnapshot = {
  id: number;
  projectId: number;
  timestamp: string;
  diff?: { shots?: { modified?: ModifiedPair[] } } | null;
};

/** 一个镜头在其编辑历史里，每个创作字段是否被改过 */
export type ShotEditFacts = {
  stableShotId: string;
  /** dimension → 是否在任意一次快照里发生了变化 */
  editedDimensions: Set<string>;
  /** dimension → 该镜头历史上出现过这个字段（不论是否为空） */
  presentDimensions: Set<string>;
};

function fieldValueKey(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return JSON.stringify(value);
}

export function resolveEditSnapshotPath(explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  if (process.env.PROMPT_EVAL_EDIT_SNAPSHOTS)
    candidates.push(resolve(process.env.PROMPT_EVAL_EDIT_SNAPSHOTS));
  candidates.push(resolve(process.cwd(), SNAPSHOT_FILENAME));

  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonDir) {
      candidates.push(
        resolve(
          dirname(resolve(process.cwd(), commonDir)),
          SNAPSHOT_FILENAME,
        ),
      );
    }
  } catch {
    // 不在 git 仓库里——跳过
  }

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      `找不到编辑快照语料。试过：\n${candidates.map(c => `  - ${c}`).join("\n")}\n` +
        `用 --snapshots <路径> 或设 PROMPT_EVAL_EDIT_SNAPSHOTS 指定。`,
    );
  }
  return found;
}

/**
 * 把快照流折成「每个镜头 → 哪些维度改过」。
 *
 * 按 stableShotId 聚合而不是按 diff 记录计数：同一个镜头在自动保存间隔里
 * 会产生很多次快照（本地语料里中位数 1 次、最多 48 次），
 * 不去重会让「反复保存同一处修改」的镜头把统计喂歪。
 */
export function buildShotEditFacts(
  snapshots: readonly EditSnapshot[],
): Map<string, ShotEditFacts> {
  const byShot = new Map<string, ShotEditFacts>();

  for (const snapshot of snapshots) {
    const modified = snapshot.diff?.shots?.modified ?? [];
    for (const pair of modified) {
      const stableShotId = pair.old?.stableShotId ?? pair.new?.stableShotId;
      if (typeof stableShotId !== "string" || !stableShotId) continue;

      const facts = byShot.get(stableShotId) ?? {
        stableShotId,
        editedDimensions: new Set<string>(),
        presentDimensions: new Set<string>(),
      };

      const fields = new Set([
        ...Object.keys(pair.old ?? {}),
        ...Object.keys(pair.new ?? {}),
      ]);
      fields.forEach(field => {
        if (!isCreativeField(field)) return;
        const dimension = dimensionForField(field);
        const oldValue = fieldValueKey(pair.old?.[field]);
        const newValue = fieldValueKey(pair.new?.[field]);
        // 「present」= 这个字段在 old 或 new 里真的有内容，不是「object 里有这个 key」——
        // 镜头对象里几乎所有字段 key 恒在，值是空字符串时不代表用户用过这个维度。
        if (!oldValue && !newValue) return;
        facts.presentDimensions.add(dimension);
        if (oldValue !== newValue) facts.editedDimensions.add(dimension);
      });

      byShot.set(stableShotId, facts);
    }
  }

  return byShot;
}

export function loadEditSnapshotFacts(snapshotsPath?: string): {
  path: string;
  shots: Map<string, ShotEditFacts>;
  snapshotCount: number;
} {
  const path = resolveEditSnapshotPath(snapshotsPath);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const snapshots: EditSnapshot[] = Array.isArray(raw)
    ? raw
    : Object.values(raw);
  return {
    path,
    shots: buildShotEditFacts(snapshots),
    snapshotCount: snapshots.length,
  };
}
