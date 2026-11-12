import { describe, it, expect } from "vitest";
import {
  analyzeCreationEmotion,
  readCreationEmotion,
  resolveCreationEmotion,
  compileCreationEmotion,
  emotionFreshness,
  type CreationEmotionState,
} from "./creationEmotion";
import {
  matchByLabel,
  findSubcategory,
  getOpposite,
  getMixedEmotions,
  getAllSubcategories,
  groupByNarrativeArc,
} from "./emotionTaxonomy";
function state(raw: string): CreationEmotionState {
  return {
    schemaVersion: 1,
    revision: 1,
    history: [
      {
        revision: 1,
        scope: { kind: "story" },
        intent: { raw, mediumDirections: {} },
        reading: analyzeCreationEmotion(raw),
        createdAt: "2026-11-10T00:00:00.000Z",
        userId: 1,
      },
    ],
  };
}
describe("shared work emotion", () => {
  it("keeps all six taxonomy APIs and rejects empty retrieval", () => {
    expect(matchByLabel(" ")).toEqual([]);
    expect(findSubcategory("loss")?.subcategory.label).toBe("失落");
    expect(getOpposite("joy")?.key).toBe("sadness");
    expect(getMixedEmotions("joy").length).toBeGreaterThan(0);
    expect(getAllSubcategories().length).toBeGreaterThan(40);
    expect(groupByNarrativeArc()["转折"].length).toBeGreaterThan(0);
  });
  it("retains mixed, intensity, negation and narrative change without inventing a diagnosis", () => {
    const raw = "有一点失落，但并不绝望，最后慢慢释怀。不要焦虑";
    const reading = analyzeCreationEmotion(raw);
    expect(reading.segments[0].signals).toContainEqual(
      expect.objectContaining({ key: "loss", intensity: 1 })
    );
    expect(reading.segments[2]).toMatchObject({
      stage: "ending",
      signals: [expect.objectContaining({ key: "acceptance" })],
    });
    expect(reading.segments[3].signals).toContainEqual(
      expect.objectContaining({ key: "anxiety", polarity: "avoid" })
    );
    const prompt = compileCreationEmotion(
      resolveCreationEmotion(state(raw)),
      "music"
    );
    expect(prompt).toContain("并不绝望");
    expect(prompt).not.toContain("大脑");
    expect(prompt).not.toContain("不等于提高音量"); // avoided anxiety never supplies positive advice
  });
  it("changes actual medium guidance while retaining user contrast", () => {
    for (const raw of ["温暖怀念", "压抑不安", "释然平静"]) {
      const s = state(raw);
      s.history[0].intent!.mediumDirections.music = "音乐轻快形成反差";
      const snap = resolveCreationEmotion(s);
      expect(compileCreationEmotion(snap, "music")).toContain(
        "音乐轻快形成反差"
      );
      expect(compileCreationEmotion(snap, "art")).not.toContain(
        "音乐轻快形成反差"
      );
      expect(compileCreationEmotion(snap, "text")).toContain(raw);
    }
    expect(
      compileCreationEmotion(resolveCreationEmotion(state("温暖怀念")), "music")
    ).toContain("主题轻微回返");
    expect(
      compileCreationEmotion(resolveCreationEmotion(state("压抑不安")), "music")
    ).toContain("延迟解决");
    expect(
      compileCreationEmotion(resolveCreationEmotion(state("释然平静")), "music")
    ).toContain("张力逐步释放");
  });
  it("keeps hierarchy, unrelated revisions and reset-to-inheritance distinct", () => {
    const s = state("温暖怀念");
    const old = resolveCreationEmotion(s);
    s.history.push({
      ...s.history[0],
      revision: 2,
      scope: { kind: "shot", id: "other" },
    });
    s.revision = 2;
    expect(emotionFreshness(old, resolveCreationEmotion(s))).toBe("current");
    s.history.push({
      ...s.history[0],
      revision: 3,
      scope: { kind: "shot", id: "one" },
      intent: { raw: "压抑不安", mediumDirections: {} },
      reading: analyzeCreationEmotion("压抑不安"),
    });
    const local = resolveCreationEmotion(s, { shotId: "one" });
    expect(local?.layers.map(x => x.revision)).toEqual([1, 3]);
    s.history.push({
      ...s.history[2],
      revision: 4,
      intent: null,
      reading: null,
    });
    expect(resolveCreationEmotion(s, { shotId: "one" })).toEqual(old);
    expect(emotionFreshness(local, old)).toBe("older-setting");
  });
  it("resolves chapter and shot overrides without dropping global facts", () => {
    const s = state("温暖怀念");
    s.history.push({
      ...s.history[0],
      revision: 2,
      scope: { kind: "chapter", id: "chapter-one" },
      intent: { raw: "最后释然", mediumDirections: {} },
    });
    s.history.push({
      ...s.history[0],
      revision: 3,
      scope: { kind: "shot", id: "one" },
      intent: { raw: "有点不安", mediumDirections: { music: "轻快反差" } },
    });
    expect(
      resolveCreationEmotion(s, {
        chapterId: "chapter-one",
        shotId: "one",
      })?.layers.map(x => x.revision)
    ).toEqual([1, 2, 3]);
    expect(
      resolveCreationEmotion(s, { chapterId: "other" })?.layers.map(
        x => x.revision
      )
    ).toEqual([1]);
  });
  it("leaves legacy works unchanged and rejects damaged/future state rather than erasing history", () => {
    expect(
      compileCreationEmotion(
        resolveCreationEmotion(readCreationEmotion(undefined)),
        "text"
      )
    ).toBe("");
    expect(() => readCreationEmotion({ schemaVersion: 2 })).toThrow();
    expect(
      analyzeCreationEmotion("难以命名的感觉").segments[0].signals
    ).toEqual([]);
  });
});
