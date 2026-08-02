import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KNOWN_DIMENSION_NAMES,
  PROMPT_DIMENSIONS,
  PSEUDO_DIMENSIONS,
  canonicalDimension,
  isKnownDimension,
  promptDimension,
} from "./promptDimensions";
import {
  DEFAULT_PROMPT_WEIGHT,
  promptDimensionWeight,
} from "./promptDimensionWeights";
import { CONSISTENCY_DIMENSIONS } from "./shotConsistency";

/**
 * 建表前（八处独立声明、无统一别名）时期的权威表快照。
 * 这不是「应该是多少」，是「统一之前实际生效的值」——用来钉住零行为变更。
 */
const PRE_UNIFICATION_SNAPSHOT: Record<string, number> = {
  title: 0.18,
  theme: 0.26,
  story_arc: 0.26,
  visual_style: 0.36,
  color_palette: 0.28,
  composition: 0.24,
  lighting: 0.24,
  material: 0.24,
  character_reference: 0.52,
  scene_reference: 0.42,
  art_style_recipe: 0.4,
  subject: 0.42,
  action: 0.38,
  sceneTitle: 0.34,
  sceneArtBrief: 0.4,
  dialogue: 0.34,
  location: 0.32,
  time_light: 0.24,
  mood: 0.3,
  style_reference: 0.26,
  beat: 0.28,
  intent: 0.5,
  rationale: 0.46,
  image_prompt: 0.5,
  negative_prompt: 0.22,
  camera_motion: 0.36,
  video_prompt: 0.5,
  sound: 0.32,
  narrativeClaim: 0.54,
  roleConcern: 0.5,
  visualTranslation: 0.48,
  causalExplanation: 0.46,
  narrativeEvidence: 0.44,
  externalValue: 0.42,
  storyContext: 0.36,
  avoidMisread: 0.3,
  recommendationStatus: 0.26,
  intentSummary: 0.22,
};

describe("promptDimensionWeight — 统一前 38 个键值原样钉住", () => {
  for (const [key, expected] of Object.entries(PRE_UNIFICATION_SNAPSHOT)) {
    it(`"${key}" 仍返回 ${expected}`, () => {
      expect(promptDimensionWeight(key)).toBe(expected);
    });
  }

  it("未登记的名字仍落到 DEFAULT_PROMPT_WEIGHT", () => {
    expect(promptDimensionWeight("made_up_dimension")).toBe(
      DEFAULT_PROMPT_WEIGHT,
    );
  });
});

describe("别名解析", () => {
  const withAliases = PROMPT_DIMENSIONS.filter(
    def => (def.aliases?.length ?? 0) > 0,
  );

  it("至少覆盖 migration 元组暴露的真别名", () => {
    expect(withAliases.length).toBeGreaterThan(0);
  });

  for (const def of withAliases) {
    for (const alias of def.aliases ?? []) {
      it(`"${alias}" 归一到规范 id "${def.id}"`, () => {
        expect(canonicalDimension(alias)).toBe(def.id);
        expect(promptDimension(alias)).toBe(promptDimension(def.id));
        expect(promptDimensionWeight(alias)).toBe(def.weight);
      });
    }
  }

  it("未登记的名字原样返回，不抛错", () => {
    expect(canonicalDimension("totally_unknown_xyz")).toBe(
      "totally_unknown_xyz",
    );
    expect(isKnownDimension("totally_unknown_xyz")).toBe(false);
  });
});

describe("declaredElsewhere 记录——只作记录，不参与计算", () => {
  const withDeclarations = PROMPT_DIMENSIONS.filter(
    def => (def.declaredElsewhere?.length ?? 0) > 0,
  );

  it("存在待收敛的权重分歧记录", () => {
    expect(withDeclarations.length).toBeGreaterThan(0);
  });

  for (const def of withDeclarations) {
    it(`"${def.id}" 的生效权重不等于 declaredElsewhere 记录的值（否则该记录已过时，应删除）`, () => {
      for (const declaration of def.declaredElsewhere ?? []) {
        expect(declaration.weight).not.toBe(def.weight);
      }
    });
  }
});

describe("CONSISTENCY_DIMENSIONS 与提示词维度词表互不冲突", () => {
  it("一致性比对类别（face/hairstyle/...）不是任何 prompt 维度的 id 或别名", () => {
    for (const dimension of CONSISTENCY_DIMENSIONS) {
      expect(isKnownDimension(dimension)).toBe(false);
    }
  });
});

describe("无孤儿维度——生产代码里出现的 dimension 字面量必须都在词表里", () => {
  const repoRoot = join(import.meta.dirname, "..");
  const scanDirs = ["server", "shared", "client/src"];
  const skipDirNames = new Set([
    "node_modules",
    "dist",
    ".git",
    ".worktrees",
    ".pnpm-store",
    ".webdev",
    "coverage",
    "build",
  ]);
  const scanExts = new Set([".ts", ".tsx"]);

  function walk(dir: string, acc: string[]): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return acc;
    }
    for (const name of entries) {
      if (skipDirNames.has(name)) continue;
      const full = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full, acc);
      else if (scanExts.has(extname(name))) acc.push(full);
    }
    return acc;
  }

  const files = scanDirs.flatMap(dir => walk(join(repoRoot, dir), []));
  const dimensionLiteralPattern = /dimension:\s*["'`]([A-Za-z_][\w]*)["'`]/g;

  const foundByName = new Map<string, Set<string>>();
  for (const file of files) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(dimensionLiteralPattern)) {
      const name = match[1];
      const rel = relative(repoRoot, file);
      if (!foundByName.has(name)) foundByName.set(name, new Set());
      foundByName.get(name)!.add(rel);
    }
  }

  it("扫到了维度字面量（护栏没有失效变成空跑）", () => {
    expect(foundByName.size).toBeGreaterThan(0);
  });

  const exempt = new Set(PSEUDO_DIMENSIONS);

  for (const [name, sites] of foundByName) {
    if (exempt.has(name)) continue;
    it(`"${name}"（${[...sites].join(", ")}）已登记在 promptDimensions.ts`, () => {
      expect(
        isKnownDimension(name),
        `"${name}" 在生产代码里使用但未登记：把它加进 shared/promptDimensions.ts 的 id 或某个 def 的 aliases。`,
      ).toBe(true);
    });
  }
});

describe("KNOWN_DIMENSION_NAMES 是一次性生成、不重复", () => {
  it("id + 别名总数与去重后的名字数一致", () => {
    const expectedCount =
      PROMPT_DIMENSIONS.length +
      PROMPT_DIMENSIONS.reduce((sum, def) => sum + (def.aliases?.length ?? 0), 0);
    expect(new Set(KNOWN_DIMENSION_NAMES).size).toBe(expectedCount);
    expect(KNOWN_DIMENSION_NAMES.length).toBe(expectedCount);
  });
});
