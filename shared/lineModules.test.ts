import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { linePosition, locateLine, reconcileLines, trimLineContext } from "./lineModules";

const cases = JSON.parse(
  readFileSync(join(__dirname, "../tests/fixtures/line-modules/cases.json"), "utf8")
);

describe("line modules fixtures", () => {
  for (const c of cases.reconcile)
    it(`reconcile: ${c.name}`, () => {
      let n = 0;
      const out = reconcileLines(
        c.prev.map(([id, text]: string[]) => ({ id, text })),
        c.next,
        () => `new${++n}`
      );
      expect(out.map(m => [m.id, m.text])).toEqual(c.expect);
    });
  for (const c of cases.locate)
    it(`locate: ${c.name}`, () => expect(locateLine(c.text, c.cursor)).toBe(c.index));
  it("trim keeps layers in order", () => {
    const t = cases.trim;
    for (const b of t.budgets) {
      const r = trimLineContext({ lines: t.lines, index: t.index, titles: t.titles, limit: b.limit });
      expect(r.included).toEqual(b.keep);
    }
  });
  it("position object has neighbours", () => {
    const mods = [{ id: "a", text: "一" }, { id: "b", text: "二" }, { id: "c", text: "三" }];
    expect(linePosition("ch", mods, 1)).toEqual({
      chapterId: "ch", blockId: "b", index: 1, total: 3, prevText: "一", text: "二", nextText: "三",
    });
    expect(linePosition("ch", mods, null)).toBeNull();
  });
});
