/**
 * 通用「库加载底座」
 *
 * 把「一个目录 = 一堆 YAML 条目」型知识库（美术流派库 styleLibrary、文学库
 * literatureLibrary…）共用的加载逻辑收成一处，避免每加一个库就复制一遍：
 * 1. 读目录下 *.yaml/*.yml，逐条 YAML 解析
 * 2. 用调用方给的 zod schema 校验；坏条目只告警跳过，不让整库崩
 * 3. 按 id 去重（先到先得）、按解析后的绝对目录缓存
 * 4. 暴露 load / getAll / getActive(status==="active") / clearCache
 *
 * 每个具体库只需提供：自己的 zod schema、如何解析目录(resolveDir)、日志标签(label)；
 * 而「条目 → prompt 片段」这类各库专有的映射不在本底座内，留在各库自己的文件里。
 */
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

/** 任何库条目的最小形状：底座只依赖 id（去重）与可选 status（getActive 过滤） */
export type LibraryEntryBase = { id: string; status?: "draft" | "active" };

/**
 * 本底座对 schema 的唯一要求：能 safeParse 出 T。
 * 用结构化类型而非具体 zod 泛型，避免绑死某个 zod 版本的类型签名。
 */
type EntryValidator<T> = {
  safeParse(data: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
};

export type LibraryLoader<T extends LibraryEntryBase> = {
  /** 读并解析一个 entries 目录（按目录缓存；force 跳过缓存重读） */
  load(dir?: string, opts?: { force?: boolean }): T[];
  /** 全部条目（active + draft） */
  getAll(dir?: string): T[];
  /** 仅 status==="active" 的条目 */
  getActive(dir?: string): T[];
  /** 清空缓存（测试 / 热更用） */
  clearCache(): void;
};

/**
 * 造一个库加载器。
 *
 * @param config.schema     校验单条目的 zod schema（safeParse 失败的条目被跳过）
 * @param config.resolveDir 把可选入参目录解析成绝对路径（含各库自己的默认值 / 环境变量）
 * @param config.label      日志标签，例如 "styleLibrary" / "literatureLibrary"
 * @returns 一个带独立缓存的 LibraryLoader
 */
export function createLibraryLoader<T extends LibraryEntryBase>(config: {
  schema: EntryValidator<T>;
  resolveDir: (dir?: string) => string;
  label: string;
}): LibraryLoader<T> {
  const cache = new Map<string, T[]>();

  function load(dir?: string, opts: { force?: boolean } = {}): T[] {
    const resolved = config.resolveDir(dir);
    if (!opts.force) {
      const cached = cache.get(resolved);
      if (cached) return cached;
    }

    const entries: T[] = [];
    const seen = new Set<string>();

    let files: string[] = [];
    try {
      files = fs
        .readdirSync(resolved)
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .sort();
    } catch (err) {
      console.warn(
        `[${config.label}] 无法读取库目录 ${resolved}：${(err as Error).message}`,
      );
      cache.set(resolved, entries);
      return entries;
    }

    for (const file of files) {
      const full = path.join(resolved, file);
      try {
        const raw = fs.readFileSync(full, "utf8");
        const parsed = parseYaml(raw);
        const result = config.schema.safeParse(parsed);
        if (!result.success) {
          console.warn(
            `[${config.label}] 跳过无效条目 ${file}：${result.error.issues
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`,
          );
          continue;
        }
        if (seen.has(result.data.id)) {
          console.warn(
            `[${config.label}] 跳过重复 id「${result.data.id}」（${file}）`,
          );
          continue;
        }
        seen.add(result.data.id);
        entries.push(result.data);
      } catch (err) {
        console.warn(
          `[${config.label}] 解析失败，跳过 ${file}：${(err as Error).message}`,
        );
      }
    }

    cache.set(resolved, entries);
    return entries;
  }

  return {
    load,
    getAll: (dir) => load(dir),
    getActive: (dir) => load(dir).filter((e) => e.status === "active"),
    clearCache: () => cache.clear(),
  };
}
