/**
 * 文学库加载器
 *
 * 读取并校验 `docs/literature-library/entries/*.yaml`，把每位「文学家的声音」条目
 * 暴露给剧本 Agent。与美术库 styleLibrary 同构（共用通用底座 libraryLoader 与字段助手
 * libraryFields），区别只在 schema 字段与「条目 → 片段」映射。
 *
 * 核心职责：
 * 1. 解析 + zod 校验（坏条目告警跳过，不让整库崩；逻辑在 libraryLoader）
 * 2. `getActiveVoices()` / `getAllVoices()` 供剧本侧取用
 * 3. `literatureToFragments(entry)` 把文学 DNA 落成带标签的文本片段，供剧本 prompt 注入
 *
 * 守则：库是共鸣透镜，不是代笔——借文学家的视角照见用户自己的思绪，
 * 不替用户拔高 / 评判 / 伪造其原话。
 */
import path from "path";
import { z } from "zod";
import { createLibraryLoader } from "./libraryLoader";
import {
  strField,
  strArrField,
  affinityField,
  statusField,
} from "./libraryFields";

// ── zod schema：镜像 _TEMPLATE.yaml 字段（字段助手见 libraryFields）──

const LiteratureEntrySchema = z.object({
  // 必填：缺 id/name 直接判为无效条目（跳过）
  id: z.string().min(1),
  name: z.string().min(1),
  one_liner: strField,
  status: statusField,

  // 文学 DNA：供剧本 prompt 注入
  viewpoint: strField, // 观点 / 世界观
  voice: strField, // 语言声音（句法、语气、节奏）
  themes: strArrField, // 母题
  devices: strArrField, // 手法
  signature_lines: strArrField, // 代表句（共鸣参照，非照抄）
  era_culture: strField,
  negative: strArrField, // 这把声音最不该被写成什么

  // 落点：共鸣排序先验（与 styleLibrary 同构，留给后续共鸣排序器）
  emotion_fit: strArrField,
  theme_fit: strArrField,
  affinity: affinityField,

  // 校准
  references: strArrField,
  notes: strField,
});

export type LiteratureEntry = z.infer<typeof LiteratureEntrySchema>;

// ── 加载（委托通用库底座 libraryLoader）──

function resolveEntriesDir(dir?: string): string {
  return dir
    ? path.resolve(dir)
    : path.resolve(process.cwd(), "docs/literature-library/entries");
}

const loader = createLibraryLoader<LiteratureEntry>({
  schema: LiteratureEntrySchema,
  resolveDir: resolveEntriesDir,
  label: "literatureLibrary",
});

/** 读取并解析一个 entries 目录。结果按目录缓存；单条失败只告警跳过。 */
export function loadLiteratureLibrary(
  dir?: string,
  opts: { force?: boolean } = {},
): LiteratureEntry[] {
  return loader.load(dir, opts);
}

/** 全部条目（active + draft） */
export function getAllVoices(dir?: string): LiteratureEntry[] {
  return loader.getAll(dir);
}

/** 仅上线条目 */
export function getActiveVoices(dir?: string): LiteratureEntry[] {
  return loader.getActive(dir);
}

/** 测试/热更用：清空目录缓存 */
export function clearLiteratureLibraryCache(): void {
  loader.clearCache();
}

// ── 条目 → 剧本 prompt 片段 ──

/** 文学条目映射出的带标签文本片段（供剧本 Agent 注入 prompt） */
export type LiteratureFragment = { tag: string; text: string };

/**
 * 把一位文学家的 DNA 映射成带标签的片段。空字段不产出片段。
 * 这些片段是「共鸣参照」——告诉剧本 Agent 用怎样的视角和声音去呼应用户，
 * 而不是把代表句原样塞进剧本。
 */
export function literatureToFragments(entry: LiteratureEntry): LiteratureFragment[] {
  const frags: LiteratureFragment[] = [];
  const push = (tag: string, text: string) => {
    const t = text.trim();
    if (t) frags.push({ tag, text: t });
  };
  const joinList = (xs: string[]) =>
    xs.map((x) => x.trim()).filter(Boolean).join(" / ");

  push("观点", entry.viewpoint);
  push("声音", entry.voice);
  push("母题", joinList(entry.themes));
  push("手法", joinList(entry.devices));
  push("代表句", joinList(entry.signature_lines));
  push("年代", entry.era_culture);
  return frags;
}

/** 一把声音的负面清单（这把声音最不该被写成什么） */
export function literatureNegatives(entry: LiteratureEntry): string[] {
  return entry.negative.map((n) => n.trim()).filter(Boolean);
}
