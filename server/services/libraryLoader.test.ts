import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import { createLibraryLoader } from "./libraryLoader";

// 一个最小条目 schema，仅用于测试通用底座本身（不依赖任何具体库）
const TinySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["draft", "active"]).catch("draft"),
});
type TinyEntry = z.infer<typeof TinySchema>;

let tmp: string;
let lib: ReturnType<typeof makeLib>;

function makeLib() {
  return createLibraryLoader<TinyEntry>({
    schema: TinySchema,
    resolveDir: (dir) => path.resolve(dir ?? tmp),
    label: "tinyLib",
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "liblib-"));
  lib = makeLib();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(name: string, content: string) {
  fs.writeFileSync(path.join(tmp, name), content, "utf8");
}

describe("createLibraryLoader（通用库加载底座）", () => {
  it("加载合法条目；getActive 只返回 active", () => {
    write("a.yaml", "id: a\nname: A\nstatus: active\n");
    write("b.yaml", "id: b\nname: B\nstatus: draft\n");

    expect(lib.getAll().map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(lib.getActive().map((e) => e.id)).toEqual(["a"]);
  });

  it("坏 YAML 与 schema 不合法条目被跳过，其余照常返回", () => {
    write("good.yaml", "id: good\nname: 好\nstatus: active\n");
    write("broken.yaml", "id: [unclosed flow sequence\n"); // YAML 解析抛错
    write("missing-id.yaml", "name: 无id\n"); // zod 失败：缺 id

    expect(lib.getAll().map((e) => e.id)).toEqual(["good"]);
  });

  it("按 id 去重，先到先得", () => {
    write("a1.yaml", "id: dup\nname: 甲\n");
    write("a2.yaml", "id: dup\nname: 乙\n");

    const all = lib.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("甲");
  });

  it("不存在 / 读不了的目录 → 返回空数组，不抛", () => {
    const missing = path.join(tmp, "nope");
    expect(lib.getAll(missing)).toEqual([]);
  });

  it("按目录缓存；force 与 clearCache 都能触发重读", () => {
    write("a.yaml", "id: a\nname: A\nstatus: active\n");
    expect(lib.getAll().map((e) => e.id)).toEqual(["a"]);

    write("b.yaml", "id: b\nname: B\nstatus: active\n");
    // 缓存命中：仍是旧结果
    expect(lib.getAll().map((e) => e.id)).toEqual(["a"]);

    // force：绕过缓存重读
    expect(
      lib.load(undefined, { force: true }).map((e) => e.id).sort(),
    ).toEqual(["a", "b"]);

    // clearCache 后也重读
    lib.clearCache();
    expect(lib.getAll().map((e) => e.id).sort()).toEqual(["a", "b"]);
  });
});
