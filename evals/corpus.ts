/**
 * 评测语料 —— 从提示词谱系存档里读出「事实」，用真实编译器现场编译成样本。
 *
 * 只读。绝不写 `.webdev/`（见 AGENTS.md 环境铁律），所以本模块可以安全地在
 * worktree 里跑：语料路径显式传入，默认回退到主仓库的存档。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { compilePromptTargets } from "../shared/promptCompiler";
import type {
  PromptNode,
  PromptNodeBinding,
  PromptRevision,
} from "../shared/promptLineage";
import type {
  CorpusDrift,
  EvalModality,
  EvalSample,
  GoldenSet,
} from "./types";

const CORPUS_FILENAME = ".webdev/prompt-lineage-local.json";
const MODALITIES: EvalModality[] = ["dialogue", "image", "video"];

type LineageArchive = {
  nodes: PromptNode[];
  revisions: PromptRevision[];
  bindings: PromptNodeBinding[];
  compilationHeads: Array<{
    storyId: number;
    stableShotId: string;
    modality: EvalModality;
  }>;
};

/**
 * 找到语料文件。优先级：显式参数 > 环境变量 > 当前目录 > 主 checkout。
 *
 * 最后一档是为 worktree 准备的：worktree 自己没有 `.webdev/`，
 * `git rev-parse --git-common-dir` 会指回主仓库的 `.git`，其父目录即主 checkout。
 */
export function resolveCorpusPath(explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(resolve(explicit));
  if (process.env.PROMPT_EVAL_CORPUS)
    candidates.push(resolve(process.env.PROMPT_EVAL_CORPUS));
  candidates.push(resolve(process.cwd(), CORPUS_FILENAME));

  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonDir) {
      candidates.push(
        resolve(dirname(resolve(process.cwd(), commonDir)), CORPUS_FILENAME),
      );
    }
  } catch {
    // 不在 git 仓库里，或没有 git——跳过这一档
  }

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(
      `找不到提示词谱系语料。试过：\n${candidates.map(c => `  - ${c}`).join("\n")}\n` +
        `用 --corpus <路径> 或设 PROMPT_EVAL_CORPUS 指定。`,
    );
  }
  return found;
}

/** 把谱系存档编译成评测样本。纯函数，方便单测直接喂构造数据。 */
export function buildSamples(archive: LineageArchive): EvalSample[] {
  const revisionById = new Map(
    archive.revisions.map(revision => [revision.id, revision]),
  );
  const nodeById = new Map(archive.nodes.map(node => [node.id, node]));

  // 从 compilationHeads 取「哪些故事的哪些镜头需要评测」，
  // 这样评测范围跟真实生成过的镜头一致，不会评到没人用过的孤儿节点。
  const shotsByStory = new Map<number, Set<string>>();
  for (const head of archive.compilationHeads) {
    const shots = shotsByStory.get(head.storyId) ?? new Set<string>();
    shots.add(head.stableShotId);
    shotsByStory.set(head.storyId, shots);
  }

  const samples: EvalSample[] = [];
  for (const [storyId, shotIds] of Array.from(shotsByStory.entries()).sort(
    (left, right) => left[0] - right[0],
  )) {
    const nodes = archive.nodes.filter(node => node.storyId === storyId);
    const revisions = archive.revisions.filter(
      revision => revision.storyId === storyId,
    );
    const bindings = archive.bindings.filter(
      binding => binding.storyId === storyId,
    );

    for (const stableShotId of Array.from(shotIds).sort()) {
      const compiled = compilePromptTargets({
        stableShotId,
        nodes,
        revisions,
        bindings,
      });
      for (const modality of MODALITIES) {
        const target = compiled[modality];
        const contentByDimension: Record<string, string> = {};
        const sourceByDimension: Record<string, string | null> = {};
        const dimensions: string[] = [];

        for (const revisionId of target.revisionIds) {
          const revision = revisionById.get(revisionId);
          if (!revision) continue;
          const node = nodeById.get(revision.nodeId);
          if (!node) continue;
          dimensions.push(node.dimension);
          contentByDimension[node.dimension] = revision.content;
          sourceByDimension[node.dimension] = revision.source;
        }

        samples.push({
          storyId,
          stableShotId,
          modality,
          finalText: target.finalText,
          dimensions,
          contentByDimension,
          sourceByDimension,
        });
      }
    }
  }
  return samples;
}

/**
 * 用 golden set 把样本收敛到冻结的总体。
 *
 * 分数只有在**同一批镜头**上才可比：语料是活的（用户天天在创作，故事会新增会删除），
 * 不冻结总体的话，「分数掉了」永远分不清是代码退步还是换了一批故事。
 */
export function applyGoldenSet(
  samples: readonly EvalSample[],
  golden: GoldenSet,
): { samples: EvalSample[]; drift: CorpusDrift } {
  const wanted = new Set(
    golden.shots.map(shot => `${shot.storyId}::${shot.stableShotId}`),
  );
  const present = new Set(
    samples.map(sample => `${sample.storyId}::${sample.stableShotId}`),
  );

  return {
    samples: samples.filter(sample =>
      wanted.has(`${sample.storyId}::${sample.stableShotId}`),
    ),
    drift: {
      missing: golden.shots.filter(
        shot => !present.has(`${shot.storyId}::${shot.stableShotId}`),
      ),
      extra: Array.from(present).filter(key => !wanted.has(key)).length,
    },
  };
}

/** 从当前语料冻结一份 golden set */
export function freezeGoldenSet(samples: readonly EvalSample[]): GoldenSet {
  const seen = new Map<string, { storyId: number; stableShotId: string }>();
  for (const sample of samples) {
    seen.set(`${sample.storyId}::${sample.stableShotId}`, {
      storyId: sample.storyId,
      stableShotId: sample.stableShotId,
    });
  }
  return {
    frozenAt: new Date().toISOString(),
    shots: Array.from(seen.values()).sort(
      (left, right) =>
        left.storyId - right.storyId ||
        left.stableShotId.localeCompare(right.stableShotId),
    ),
  };
}

export function loadCorpus(corpusPath?: string): {
  path: string;
  samples: EvalSample[];
} {
  const path = resolveCorpusPath(corpusPath);
  const archive = JSON.parse(readFileSync(path, "utf8")) as LineageArchive;
  return { path, samples: buildSamples(archive) };
}
