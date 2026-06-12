import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAllVoices,
  getActiveVoices,
  literatureToFragments,
  literatureNegatives,
  rankVoicesBySignal,
  clearLiteratureLibraryCache,
} from "./literatureLibrary";

let tmp: string;

beforeEach(() => {
  clearLiteratureLibraryCache();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "litlib-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  clearLiteratureLibraryCache();
});

function write(name: string, content: string) {
  fs.writeFileSync(path.join(tmp, name), content, "utf8");
}

describe("literatureLibrary loader", () => {
  it("把文学 DNA 映射成正确的片段标签（+ 负面清单）", () => {
    write(
      "test.yaml",
      [
        "id: test-voice",
        "name: 测试声音",
        "status: active",
        "viewpoint: 直视荒凉",
        "voice: 冷峻简省",
        "themes: [孤独, 清醒]",
        "devices: [反讽, 留白]",
        "signature_lines: [一句, 又一句]",
        "era_culture: 二十世纪初",
        "negative: [滥情, 说教]",
        "",
      ].join("\n"),
    );

    const all = getAllVoices(tmp);
    expect(all).toHaveLength(1);

    const frags = literatureToFragments(all[0]);
    const byTag = Object.fromEntries(frags.map((f) => [f.tag, f.text]));
    expect(byTag["观点"]).toBe("直视荒凉");
    expect(byTag["声音"]).toBe("冷峻简省");
    expect(byTag["母题"]).toBe("孤独 / 清醒");
    expect(byTag["手法"]).toBe("反讽 / 留白");
    expect(byTag["代表句"]).toBe("一句 / 又一句");
    expect(byTag["年代"]).toBe("二十世纪初");
    expect(literatureNegatives(all[0])).toEqual(["滥情", "说教"]);
  });

  it("getActiveVoices 只返回 active 条目", () => {
    write("a.yaml", "id: a\nname: A\nstatus: active\nvoice: x\n");
    write("b.yaml", "id: b\nname: B\nstatus: draft\nvoice: y\n");

    expect(getActiveVoices(tmp).map((e) => e.id)).toEqual(["a"]);
    expect(getAllVoices(tmp)).toHaveLength(2);
  });

  it("缺字段收敛到安全默认；缺的字段不产出片段", () => {
    write("min.yaml", "id: min\nname: 最小\nstatus: draft\nviewpoint: 只有观点\n");

    const [entry] = getAllVoices(tmp);
    expect(entry.themes).toEqual([]);
    expect(entry.voice).toBe("");
    expect(entry.affinity).toEqual({ age: {}, profession: {}, wuxing: {} });

    const frags = literatureToFragments(entry);
    expect(frags.find((f) => f.tag === "观点")?.text).toBe("只有观点");
    expect(frags.find((f) => f.tag === "声音")).toBeUndefined();
  });
});

describe("literatureLibrary 对真实 docs/literature-library/entries", () => {
  const realDir = path.resolve(
    import.meta.dirname,
    "../../docs/literature-library/entries",
  );

  it("加载全部种子且暴露 active 声音", () => {
    clearLiteratureLibraryCache();
    const all = getAllVoices(realDir);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((e) => e.id && e.name)).toBe(true);

    const activeIds = getActiveVoices(realDir).map((e) => e.id);
    expect(activeIds).toContain("lu-xun");
    expect(activeIds).toContain("zhang-ailing");
  });

  it("鲁迅种子产出非空片段与负面清单", () => {
    clearLiteratureLibraryCache();
    const luxun = getAllVoices(realDir).find((e) => e.id === "lu-xun");
    expect(luxun).toBeDefined();
    const frags = literatureToFragments(luxun!);
    expect(frags.length).toBeGreaterThan(0);
    expect(frags.find((f) => f.tag === "观点")).toBeDefined();
    expect(frags.find((f) => f.tag === "代表句")).toBeDefined();
    expect(literatureNegatives(luxun!).length).toBeGreaterThan(0);
  });

  it("rankVoicesBySignal：按情绪信号把共鸣的声音排前", () => {
    clearLiteratureLibraryCache();
    // 张爱玲 emotion_fit 含「苍凉」→ 情绪信号「苍凉」应把她排在鲁迅前
    const byEmotion = rankVoicesBySignal({ emotion: ["苍凉"] }, realDir);
    expect(byEmotion[0].id).toBe("zhang-ailing");

    // 鲁迅 affinity.wuxing 金=2 → 当日五行「金」应把他排前
    const byWuxing = rankVoicesBySignal({ profile: { wuxing: "金" } }, realDir);
    expect(byWuxing[0].id).toBe("lu-xun");
  });

  it("rankVoicesBySignal：空信号 → 原序返回全部 active 声音", () => {
    clearLiteratureLibraryCache();
    const ranked = rankVoicesBySignal({}, realDir);
    expect(ranked.map((e) => e.id).sort()).toEqual(["lu-xun", "zhang-ailing"]);
  });
});
