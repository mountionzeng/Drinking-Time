import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAllStyles,
  getActiveStyles,
  styleToFragments,
  styleNegatives,
  clearStyleLibraryCache,
} from "./styleLibrary";

let tmp: string;

beforeEach(() => {
  clearStyleLibraryCache();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stylelib-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  clearStyleLibraryCache();
});

function write(name: string, content: string) {
  fs.writeFileSync(path.join(tmp, name), content, "utf8");
}

describe("styleLibrary loader", () => {
  it("maps each DNA field to the correct fragment tag (+ negatives)", () => {
    write(
      "test.yaml",
      [
        "id: test-style",
        "name: 测试流派",
        "status: active",
        "style: [oil painting, in the manner of X]",
        "palette: [暖土, 赭石]",
        "light: 单一侧逆光",
        "composition: 近景半身",
        "material: 厚涂笔触",
        "era_culture: 17 世纪",
        "signature: 暗部里那束光",
        "negative: [平光, 霓虹]",
        "",
      ].join("\n"),
    );

    const all = getAllStyles(tmp);
    expect(all).toHaveLength(1);

    const frags = styleToFragments(all[0]);
    const byTag = Object.fromEntries(frags.map((f) => [f.tag, f.text]));
    expect(byTag["风格"]).toBe("oil painting / in the manner of X");
    expect(byTag["色彩"]).toBe("暖土 / 赭石");
    expect(byTag["光线"]).toBe("单一侧逆光");
    expect(byTag["构图"]).toBe("近景半身");
    expect(byTag["材质"]).toBe("厚涂笔触");
    expect(byTag["年代"]).toBe("17 世纪");
    expect(byTag["签名"]).toBe("暗部里那束光");
    expect(styleNegatives(all[0])).toEqual(["平光", "霓虹"]);
  });

  it("getActiveStyles returns only active entries", () => {
    write("a.yaml", "id: a\nname: A\nstatus: active\nstyle: [x]\n");
    write("b.yaml", "id: b\nname: B\nstatus: draft\nstyle: [y]\n");
    write("c.yaml", "id: c\nname: C\nstatus: active\nstyle: [z]\n");

    expect(getActiveStyles(tmp).map((e) => e.id).sort()).toEqual(["a", "c"]);
    expect(getAllStyles(tmp)).toHaveLength(3);
  });

  it("parses an entry that omits optional fields", () => {
    write("min.yaml", "id: min\nname: 最小\nstatus: draft\nstyle: [x]\n");

    const [entry] = getAllStyles(tmp);
    expect(entry.id).toBe("min");
    expect(entry.palette).toEqual([]);
    expect(entry.light).toBe("");
    expect(entry.affinity).toEqual({ age: {}, profession: {}, wuxing: {} });
    const frags = styleToFragments(entry);
    expect(frags.find((f) => f.tag === "风格")?.text).toBe("x");
    // 缺的字段不产出片段
    expect(frags.find((f) => f.tag === "光线")).toBeUndefined();
  });

  it("treats empty scalars (yaml null) as empty strings", () => {
    write(
      "nul.yaml",
      "id: nul\nname: 空\nstatus: draft\nstyle: [x]\nlight:\ncomposition:\n",
    );
    const [entry] = getAllStyles(tmp);
    expect(entry.light).toBe("");
    expect(entry.composition).toBe("");
  });

  it("parses affinity weight tables (partial keys ok)", () => {
    write(
      "aff.yaml",
      [
        "id: aff",
        "name: A",
        "status: active",
        "style: [x]",
        "affinity:",
        "  age: {青年: 2, 中年: 1}",
        "  wuxing: {金: 2}",
        "",
      ].join("\n"),
    );
    const [e] = getAllStyles(tmp);
    expect(e.affinity.age["青年"]).toBe(2);
    expect(e.affinity.age["中年"]).toBe(1);
    expect(e.affinity.wuxing["金"]).toBe(2);
    expect(e.affinity.profession).toEqual({});
  });

  it("skips corrupt YAML and zod-invalid entries, returns the rest", () => {
    write("good.yaml", "id: good\nname: 好\nstatus: active\nstyle: [x]\n");
    write("broken.yaml", "id: [unclosed flow sequence\n"); // YAML parse throws
    write("missing-id.yaml", "name: 无id\nstatus: active\n"); // zod fails: id required

    const all = getAllStyles(tmp);
    expect(all.map((e) => e.id)).toEqual(["good"]);
  });

  it("coerces unknown status to draft (never auto-activates bad data)", () => {
    write("weird.yaml", "id: weird\nname: 怪\nstatus: published\nstyle: [x]\n");
    const [e] = getAllStyles(tmp);
    expect(e.status).toBe("draft");
    expect(getActiveStyles(tmp)).toHaveLength(0);
  });

  it("skips duplicate ids (first file wins)", () => {
    write("a1.yaml", "id: dup\nname: 甲\nstatus: active\nstyle: [x]\n");
    write("a2.yaml", "id: dup\nname: 乙\nstatus: active\nstyle: [y]\n");
    const all = getAllStyles(tmp);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("甲");
  });
});

describe("styleLibrary against the real docs/style-library/entries", () => {
  const realDir = path.resolve(
    import.meta.dirname,
    "../../docs/style-library/entries",
  );

  it("loads every real entry without throwing and exposes the active seeds", () => {
    clearStyleLibraryCache();
    const all = getAllStyles(realDir);
    expect(all.length).toBeGreaterThanOrEqual(15);
    // 每条都有 id/name
    expect(all.every((e) => e.id && e.name)).toBe(true);

    const active = getActiveStyles(realDir);
    expect(active.length).toBeGreaterThanOrEqual(3);
    expect(active.every((e) => e.status === "active")).toBe(true);
    // 文档化的三颗种子
    const activeIds = active.map((e) => e.id);
    expect(activeIds).toContain("rembrandt-oil");
    expect(activeIds).toContain("shinkai-light");
    expect(activeIds).toContain("song-ink");
  });

  it("produces non-empty fragments for the rembrandt seed", () => {
    clearStyleLibraryCache();
    const rembrandt = getAllStyles(realDir).find((e) => e.id === "rembrandt-oil");
    expect(rembrandt).toBeDefined();
    const frags = styleToFragments(rembrandt!);
    expect(frags.length).toBeGreaterThan(0);
    expect(frags.find((f) => f.tag === "风格")?.text).toContain("Rembrandt");
    expect(frags.find((f) => f.tag === "签名")).toBeDefined();
    expect(styleNegatives(rembrandt!).length).toBeGreaterThan(0);
  });
});
