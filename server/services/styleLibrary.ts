/**
 * 流派库加载器
 *
 * 读取并校验 `docs/style-library/entries/*.yaml`，把每个「美术流派」条目
 * 暴露给出图管线。核心职责：
 * 1. 解析 + zod 校验（坏条目告警跳过，不让整库崩）
 * 2. `getActiveStyles()` / `getAllStyles()` 供「选 6」用
 * 3. `styleToFragments(entry)` 把视觉 DNA 落到 `shotPromptComposer` 已认得的
 *    `FragmentForPrompt` 槽位（这是库注入出图 prompt 的唯一缝）
 *
 * 守则：库是审美透镜，不是情绪滤镜——只决定「怎么好看」，不改「发生了什么」。
 */

import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ENV } from "../_core/env";
import type { FragmentForPrompt } from "./shotPromptComposer";

// ── zod schema：镜像 _TEMPLATE.yaml 字段。空标量（YAML null）/缺字段都收敛到安全默认 ──

/** null/undefined → "" */
const strField = z.preprocess((v) => (v == null ? "" : v), z.string());
/** null/undefined → [] */
const strArrField = z.preprocess((v) => (v == null ? [] : v), z.array(z.string()));
/** null/undefined → {}；权重表 */
const numRecField = z.preprocess(
  (v) => (v == null ? {} : v),
  z.record(z.string(), z.number()),
);
const affinityField = z.preprocess(
  (v) => (v == null ? {} : v),
  z.object({
    age: numRecField,
    profession: numRecField,
    wuxing: numRecField,
  }),
);

const StyleEntrySchema = z.object({
  // 必填：缺 id/name 直接判为无效条目（跳过）
  id: z.string().min(1),
  name: z.string().min(1),
  one_liner: strField,
  // 任何非 draft/active 的值或缺失都收敛为 draft（宁可不上线，别误上线）
  status: z.enum(["draft", "active"]).catch("draft"),

  // 视觉 DNA：注入出图 prompt
  style: strArrField,
  palette: strArrField,
  light: strField,
  composition: strField,
  material: strField,
  era_culture: strField,
  signature: strField,
  negative: strArrField,

  // 落点：冷启动排序先验（v1 不消费，留给后续排序器）
  emotion_fit: strArrField,
  theme_fit: strArrField,
  affinity: affinityField,

  // 校准
  references: strArrField,
  notes: strField,
});

export type StyleEntry = z.infer<typeof StyleEntrySchema>;

// ── 加载（按解析后的目录缓存）──

const cache = new Map<string, StyleEntry[]>();

function resolveEntriesDir(dir?: string): string {
  if (dir) return path.resolve(dir);
  if (ENV.styleLibraryDir) return path.resolve(ENV.styleLibraryDir);
  return path.resolve(process.cwd(), "docs/style-library/entries");
}

/**
 * 读取并解析一个 entries 目录。结果按目录缓存。
 * 单条解析/校验失败只告警跳过，保证「一个坏文件不毁整库」。
 */
export function loadStyleLibrary(
  dir?: string,
  opts: { force?: boolean } = {},
): StyleEntry[] {
  const resolved = resolveEntriesDir(dir);
  if (!opts.force) {
    const cached = cache.get(resolved);
    if (cached) return cached;
  }

  const entries: StyleEntry[] = [];
  const seen = new Set<string>();

  let files: string[] = [];
  try {
    files = fs
      .readdirSync(resolved)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();
  } catch (err) {
    console.warn(
      `[styleLibrary] 无法读取流派库目录 ${resolved}：${(err as Error).message}`,
    );
    cache.set(resolved, entries);
    return entries;
  }

  for (const file of files) {
    const full = path.join(resolved, file);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const parsed = parseYaml(raw);
      const result = StyleEntrySchema.safeParse(parsed);
      if (!result.success) {
        console.warn(
          `[styleLibrary] 跳过无效条目 ${file}：${result.error.issues
            .map((i) => `${i.path.join(".")} ${i.message}`)
            .join("; ")}`,
        );
        continue;
      }
      if (seen.has(result.data.id)) {
        console.warn(`[styleLibrary] 跳过重复 id「${result.data.id}」（${file}）`);
        continue;
      }
      seen.add(result.data.id);
      entries.push(result.data);
    } catch (err) {
      console.warn(
        `[styleLibrary] 解析失败，跳过 ${file}：${(err as Error).message}`,
      );
    }
  }

  cache.set(resolved, entries);
  return entries;
}

/** 全部条目（active + draft） */
export function getAllStyles(dir?: string): StyleEntry[] {
  return loadStyleLibrary(dir);
}

/** 仅上线条目（进 6 候选轮换） */
export function getActiveStyles(dir?: string): StyleEntry[] {
  return loadStyleLibrary(dir).filter((e) => e.status === "active");
}

/** 测试/热更用：清空目录缓存 */
export function clearStyleLibraryCache(): void {
  cache.clear();
}

// ── 条目 → 出图 prompt 片段 ──

/**
 * 把一个流派的视觉 DNA 映射成 `FragmentForPrompt[]`。
 * 每个 DNA 字段落到一个 `shotPromptComposer` 认得的离散 tag；空字段不产出片段。
 * `signature` 单独成「签名」tag——低分辨率草稿里也必须认得出的那个点。
 */
export function styleToFragments(entry: StyleEntry): FragmentForPrompt[] {
  const frags: FragmentForPrompt[] = [];
  const push = (tag: string, text: string) => {
    const t = text.trim();
    if (t) frags.push({ tag, text: t });
  };
  const joinList = (xs: string[]) =>
    xs.map((x) => x.trim()).filter(Boolean).join(" / ");

  push("风格", joinList(entry.style));
  push("色彩", joinList(entry.palette));
  push("光线", entry.light);
  push("构图", entry.composition);
  push("材质", entry.material);
  push("年代", entry.era_culture);
  push("签名", entry.signature);
  return frags;
}

/** 一个流派的负面清单（与正面 DNA 同等重要：这流派最怕变成什么） */
export function styleNegatives(entry: StyleEntry): string[] {
  return entry.negative.map((n) => n.trim()).filter(Boolean);
}
